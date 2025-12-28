import type { Handle } from "@sveltejs/kit";
import type {
  QueryClient,
  RequestMetric,
  StorageAdapter,
  TrackerConfig,
} from "./types.js";

interface Tracker {
  track(metric: RequestMetric): void;
  hook(): Handle;
  flush(): Promise<void>;
  setup(): Promise<void>;
  getQueryClient(): QueryClient | null;
}

function isQueryClient(
  storage: StorageAdapter
): storage is StorageAdapter & QueryClient {
  return (
    "getRequestsOverTime" in storage &&
    "getRouteStats" in storage &&
    "getStatusBreakdown" in storage &&
    "getPerformanceStats" in storage
  );
}

/**
 * Creates a request metrics tracker for SvelteKit applications.
 *
 * The tracker automatically buffers metrics and flushes them to storage
 * periodically or when the buffer reaches a threshold. All operations
 * are non-blocking and errors are handled gracefully.
 *
 * @param config - Configuration options for the tracker
 * @returns A tracker instance with hook(), track(), flush(), setup(), and getQueryClient() methods
 *
 * @example
 * ```typescript
 * const tracker = createTracker({
 *   storage: createMongoStorage({ client, database: 'myapp' }),
 *   exclude: ['/health', /^\/api\/internal/],
 *   onError: (error) => console.error('Metrics error:', error),
 * });
 *
 * export const handle = tracker.hook();
 * ```
 */
export function createTracker(config: TrackerConfig): Tracker {
  const {
    storage,
    exclude = [],
    enrichMetadata,
    maxBufferSize = 1000,
    flushIntervalMs = 5000,
    onError,
    disabled = false,
    debug,
  } = config;

  let buffer: RequestMetric[] = [];
  let flushInterval: ReturnType<typeof setInterval> | null = null;
  let overflowWarned = false;
  let initialized = false;
  let initializing: Promise<void> | null = null;

  function safeOnError(error: unknown, metric?: RequestMetric): void {
    if (onError) {
      try {
        onError(error, metric);
      } catch {
        // Ignore errors from error handler
      }
    }
  }

  function ensureInitialized(): Promise<void> {
    if (initialized) {
      return Promise.resolve();
    }

    if (initializing) {
      return initializing;
    }

    initializing = storage
      .setup()
      .then(() => {
        initialized = true;
      })
      .catch((error) => {
        // Reset so we can retry on next request
        initializing = null;
        safeOnError(error);
      });

    return initializing;
  }

  function shouldExclude(routeId: string | null): boolean {
    if (!routeId) return false;

    for (const pattern of exclude) {
      if (typeof pattern === "string") {
        if (routeId === pattern) return true;
      } else if (pattern instanceof RegExp) {
        if (pattern.test(routeId)) return true;
      }
    }
    return false;
  }

  async function doFlush(): Promise<void> {
    if (buffer.length === 0) return;

    const metricsToWrite = buffer;
    buffer = [];

    try {
      await storage.writeMany(metricsToWrite);
    } catch (error) {
      safeOnError(error);
    }
  }

  function startAutoFlush(): void {
    if (flushInterval) return;

    flushInterval = setInterval(() => {
      doFlush().catch((error) => {
        safeOnError(error);
      });
    }, flushIntervalMs);
  }

  function track(metric: RequestMetric): void {
    if (disabled) return;

    // Debug logging (synchronous, before any async operations)
    if (debug) {
      if (typeof debug === "function") {
        try {
          debug(metric);
        } catch {
          // Ignore debug handler errors
        }
      } else {
        console.log("[kit-request-metrics]", metric);
      }
    }

    // Fire-and-forget initialization
    ensureInitialized();

    try {
      if (buffer.length >= maxBufferSize) {
        // Drop oldest metrics
        const dropped = buffer.shift();
        if (!overflowWarned) {
          overflowWarned = true;
          safeOnError(
            new Error(
              `Buffer overflow: dropping oldest metrics. Max size: ${maxBufferSize}`
            ),
            dropped
          );
        }
      }

      buffer.push(metric);

      // Auto-flush at 100 items
      if (buffer.length >= 100) {
        doFlush().catch((error) => {
          safeOnError(error);
        });
      }

      // Start interval-based flushing if not started
      startAutoFlush();
    } catch (error) {
      safeOnError(error, metric);
    }
  }

  async function flush(): Promise<void> {
    if (disabled) return;

    // Clear interval
    if (flushInterval) {
      clearInterval(flushInterval);
      flushInterval = null;
    }

    try {
      await doFlush();
    } catch (error) {
      safeOnError(error);
    }
  }

  function hook(): Handle {
    // Fire-and-forget initialization
    ensureInitialized();

    return async ({ event, resolve }) => {
      if (disabled) {
        return resolve(event);
      }

      const start = performance.now();
      let response: Response;

      try {
        response = await resolve(event);
      } catch (error) {
        // Re-throw the error but still try to track
        const duration = performance.now() - start;
        queueMicrotask(() => {
          try {
            const routeId = event.route?.id ?? null;
            if (!shouldExclude(routeId)) {
              let metadata: Record<string, unknown> | undefined;
              if (enrichMetadata) {
                try {
                  metadata = enrichMetadata(event);
                } catch {
                  // Ignore enrichMetadata errors
                }
              }
              track({
                timestamp: new Date(),
                route: routeId,
                method: event.request.method,
                status: 500,
                durationMs: duration,
                metadata,
              });
            }
          } catch {
            // Swallow all tracking errors
          }
        });
        throw error;
      }

      const duration = performance.now() - start;

      queueMicrotask(() => {
        try {
          const routeId = event.route?.id ?? null;
          if (!shouldExclude(routeId)) {
            let metadata: Record<string, unknown> | undefined;
            if (enrichMetadata) {
              try {
                metadata = enrichMetadata(event);
              } catch {
                // Ignore enrichMetadata errors
              }
            }
            track({
              timestamp: new Date(),
              route: routeId,
              method: event.request.method,
              status: response.status,
              durationMs: duration,
              metadata,
            });
          }
        } catch {
          // Swallow all tracking errors
        }
      });

      return response;
    };
  }

  function getQueryClient(): QueryClient | null {
    if (isQueryClient(storage)) {
      return storage;
    }
    return null;
  }

  async function setup(): Promise<void> {
    await ensureInitialized();
  }

  return {
    track,
    hook,
    flush,
    setup,
    getQueryClient,
  };
}
