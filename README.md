# @healthycodin/kit-request-metrics

Request metrics tracking for SvelteKit with MongoDB storage.

## Why?

Understanding how your SvelteKit application performs in production is crucial. This hook provides:

- **Non-blocking metrics collection** — tracking happens asynchronously, never slowing down responses
- **MongoDB time series storage** — efficient storage with automatic TTL and aggregation queries
- **Flexible querying** — get requests over time, per-route stats, status breakdowns, and percentile performance data

| Feature | Description |
|---------|-------------|
| Buffered writes | Metrics are batched for efficient storage |
| Route exclusion | Skip health checks and internal routes |
| Custom metadata | Enrich metrics with user IDs, request context, etc. |
| Query client | Built-in aggregation queries for dashboards |
| Graceful errors | Never crashes your app, silently handles failures |

## Installation

```bash
npm install @healthycodin/kit-request-metrics
```

> **Note:** For GitHub Packages, you need to authenticate. Add to your `.npmrc`:
> ```
> @healthycodin:registry=https://npm.pkg.github.com
> //npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
> ```

## Requirements

- Node.js 20+
- MongoDB 7.0+ (for time series collections and percentile aggregations)

## Usage

```typescript
// src/hooks.server.ts
import { sequence } from '@sveltejs/kit/hooks';
import { createTracker, createMongoStorage } from '@healthycodin/kit-request-metrics';
import { client } from '$lib/server/mongo'; // your MongoDB client

const tracker = createTracker({
  storage: createMongoStorage({
    client,
    database: 'myapp',
    collection: 'request_metrics', // default
    ttlDays: 90, // auto-delete after 90 days
  }),

  // Skip tracking for these routes
  exclude: ['/health', /^\/api\/internal/],

  // Add custom metadata to each metric
  enrichMetadata: (event) => ({
    userId: event.locals.user?.id,
  }),
});

export const handle = sequence(
  tracker.hook()
);
```

## Configuration

```typescript
interface TrackerConfig {
  // Storage adapter (required)
  storage: StorageAdapter;

  // Routes to exclude from tracking (strings or RegExp)
  // Example: ['/health', /^\/api\/internal/]
  exclude?: (string | RegExp)[];

  // Add custom metadata to each metric
  enrichMetadata?: (event: RequestEvent) => Record<string, unknown>;

  // Maximum buffered metrics before dropping oldest
  // Default: 1000
  maxBufferSize?: number;

  // How often to flush buffer to storage (ms)
  // Default: 5000
  flushIntervalMs?: number;

  // Error handler for storage failures
  onError?: (error: unknown, metric?: RequestMetric) => void;

  // Disable tracking entirely
  // Default: false
  disabled?: boolean;

  // Debug logging (true for console.log, or custom function)
  debug?: boolean | ((metric: RequestMetric) => void);
}
```

## MongoDB Storage Configuration

```typescript
interface MongoStorageConfig {
  // MongoDB client instance or factory function
  client: MongoClient | (() => MongoClient | Promise<MongoClient>);

  // Database name
  database: string;

  // Collection name (default: 'request_metrics')
  collection?: string;

  // TTL in days (default: 90, set to 0 to disable)
  ttlDays?: number;
}
```

## Querying Metrics

The storage adapter implements `QueryClient` for built-in aggregation queries:

```typescript
const queryClient = tracker.getQueryClient();

if (queryClient) {
  // Requests over time (bucketed)
  const timeSeries = await queryClient.getRequestsOverTime({
    from: new Date('2024-01-01'),
    to: new Date('2024-01-31'),
    bucketMinutes: 60, // 1-hour buckets
  });
  // [{ timestamp, requests, avgDurationMs }, ...]

  // Per-route statistics
  const routeStats = await queryClient.getRouteStats({
    from: new Date('2024-01-01'),
    to: new Date('2024-01-31'),
  });
  // [{ route, requests, avgDurationMs, errorRate }, ...]

  // Status code breakdown
  const statusBreakdown = await queryClient.getStatusBreakdown({
    from: new Date('2024-01-01'),
    to: new Date('2024-01-31'),
  });
  // { total, byStatus: { 200: 500, 404: 10 }, byCategory: { success, redirect, clientError, serverError } }

  // Performance percentiles
  const perfStats = await queryClient.getPerformanceStats({
    from: new Date('2024-01-01'),
    to: new Date('2024-01-31'),
  });
  // [{ route, avgDurationMs, p50DurationMs, p95DurationMs, p99DurationMs }, ...]
}
```

## Metric Structure

Each tracked request produces a metric with this shape:

```typescript
interface RequestMetric {
  timestamp: Date;
  route: string | null;  // SvelteKit route ID
  method: string;        // GET, POST, etc.
  status: number;        // HTTP status code
  durationMs: number;    // Response time in milliseconds
  metadata?: Record<string, unknown>;  // Custom data from enrichMetadata
}
```

## Manual Tracking

You can also track metrics manually:

```typescript
// Track a custom metric
tracker.track({
  timestamp: new Date(),
  route: '/custom-operation',
  method: 'BATCH',
  status: 200,
  durationMs: 1500,
  metadata: { itemsProcessed: 100 },
});

// Force flush buffered metrics
await tracker.flush();

// Initialize storage (called automatically, but can be awaited)
await tracker.setup();
```

## Disabling in Development

```typescript
import { dev } from '$app/environment';

const tracker = createTracker({
  storage: createMongoStorage({ ... }),
  disabled: dev, // Skip tracking in development
});
```

## Lazy MongoDB Client

For serverless environments, use a factory function to lazily connect:

```typescript
const storage = createMongoStorage({
  client: async () => {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    return client;
  },
  database: 'myapp',
});
```

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Type check
npm run check

# Build package
npm run build
```

## License

MIT
