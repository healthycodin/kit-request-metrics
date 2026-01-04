import type { Collection, Document, MongoClient } from "mongodb";
import type {
  MongoStorageConfig,
  PerformanceStats,
  QueryClient,
  RequestMetric,
  RouteStats,
  StatusBreakdown,
  StorageAdapter,
  TimeBucket,
  TimeRangeParams,
} from "../types.js";

interface MetricDocument {
  timestamp: Date;
  meta: {
    route: string | null;
    method: string;
  };
  status: number;
  durationMs: number;
  metadata?: Record<string, unknown>;
}

function parseVersion(version: string): {
  major: number;
  minor: number;
  patch: number;
} {
  const [major = 0, minor = 0, patch = 0] = version.split(".").map(Number);
  return { major, minor, patch };
}

function isVersionAtLeast(
  version: string,
  requiredMajor: number,
  requiredMinor: number
): boolean {
  const { major, minor } = parseVersion(version);
  if (major > requiredMajor) return true;
  if (major === requiredMajor && minor >= requiredMinor) return true;
  return false;
}

function isClientFactory(
  client: MongoClient | (() => MongoClient | Promise<MongoClient>)
): client is () => MongoClient | Promise<MongoClient> {
  return typeof client === "function";
}

/**
 * Creates a MongoDB storage adapter for request metrics.
 *
 * Uses MongoDB time series collections for efficient storage and querying
 * of time-stamped metrics data. Requires MongoDB 7.0+ for percentile
 * calculations and time series features.
 *
 * @param config - Configuration options for the MongoDB storage
 * @returns A storage adapter with write, query, and setup methods
 *
 * @example
 * ```typescript
 * // With direct client
 * const storage = createMongoStorage({
 *   client: mongoClient,
 *   database: 'myapp',
 *   collection: 'request_metrics',
 *   ttlDays: 90,
 * });
 *
 * // With lazy client factory
 * const storage = createMongoStorage({
 *   client: () => getMongoClient(),
 *   database: 'myapp',
 * });
 * ```
 */
export function createMongoStorage(
  config: MongoStorageConfig
): StorageAdapter & QueryClient {
  const {
    client: clientOrFactory,
    database,
    collection: collectionName = "request_metrics",
    ttlDays = 90,
  } = config;

  let resolvedClient: MongoClient | null = null;
  let collection: Collection<MetricDocument>;

  async function getClient(): Promise<MongoClient> {
    if (resolvedClient) {
      return resolvedClient;
    }

    if (isClientFactory(clientOrFactory)) {
      resolvedClient = await clientOrFactory();
    } else {
      resolvedClient = clientOrFactory;
    }

    return resolvedClient;
  }

  function toDocument(metric: RequestMetric): MetricDocument {
    return {
      timestamp: metric.timestamp,
      meta: {
        route: metric.route,
        method: metric.method,
      },
      status: metric.status,
      durationMs: metric.durationMs,
      metadata: metric.metadata,
    };
  }

  async function setup(): Promise<void> {
    const client = await getClient();
    const db = client.db(database);

    // Check MongoDB version
    const admin = db.admin();
    const buildInfo = await admin.command({ buildInfo: 1 });
    const serverVersion = buildInfo.version as string;

    if (!isVersionAtLeast(serverVersion, 7, 0)) {
      throw new Error(
        `@healthycodin/kit-request-metrics requires MongoDB 7.0+. Detected: ${serverVersion}`
      );
    }

    // Check if collection exists
    const collections = await db
      .listCollections({ name: collectionName })
      .toArray();

    if (collections.length === 0) {
      // Create time series collection
      const createOptions: Document = {
        timeseries: {
          timeField: "timestamp",
          metaField: "meta",
          granularity: "minutes",
        },
      };

      if (ttlDays > 0) {
        createOptions.expireAfterSeconds = ttlDays * 24 * 60 * 60;
      }

      await db.createCollection(collectionName, createOptions);
    }

    collection = db.collection<MetricDocument>(collectionName);

    // Create indexes
    await collection.createIndex({ "meta.route": 1, timestamp: -1 });
    await collection.createIndex({ status: 1, timestamp: -1 });
  }

  async function write(metric: RequestMetric): Promise<void> {
    await collection.insertOne(toDocument(metric));
  }

  async function writeMany(metrics: RequestMetric[]): Promise<void> {
    if (metrics.length === 0) return;
    await collection.insertMany(metrics.map(toDocument));
  }

  async function getRequestsOverTime(
    params: TimeRangeParams
  ): Promise<TimeBucket[]> {
    const { from, to, route, bucketMinutes = 60 } = params;

    const matchStage: Document = {
      timestamp: { $gte: from, $lte: to },
    };

    if (route) {
      matchStage["meta.route"] = route;
    }

    const pipeline: Document[] = [
      { $match: matchStage },
      {
        $group: {
          _id: {
            $dateTrunc: {
              date: "$timestamp",
              unit: "minute",
              binSize: bucketMinutes,
            },
          },
          requests: { $sum: 1 },
          avgDurationMs: { $avg: "$durationMs" },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          timestamp: "$_id",
          requests: 1,
          avgDurationMs: 1,
        },
      },
    ];

    const results = await collection.aggregate<TimeBucket>(pipeline).toArray();
    return results;
  }

  async function getRouteStats(params: TimeRangeParams): Promise<RouteStats[]> {
    const { from, to, route, groupByMethod = false } = params;

    const matchStage: Document = {
      timestamp: { $gte: from, $lte: to },
    };

    if (route) {
      matchStage["meta.route"] = route;
    }

    // Group by route only, or by route + method
    const groupId = groupByMethod
      ? { route: "$meta.route", method: "$meta.method" }
      : "$meta.route";

    // Project stage differs based on grouping
    const projectStage: Document = groupByMethod
      ? {
          _id: 0,
          route: { $ifNull: ["$_id.route", "unknown"] },
          method: { $ifNull: ["$_id.method", "unknown"] },
          requests: 1,
          avgDurationMs: 1,
          errorRate: {
            $cond: [
              { $eq: ["$requests", 0] },
              0,
              { $divide: ["$errorCount", "$requests"] },
            ],
          },
        }
      : {
          _id: 0,
          route: { $ifNull: ["$_id", "unknown"] },
          requests: 1,
          avgDurationMs: 1,
          errorRate: {
            $cond: [
              { $eq: ["$requests", 0] },
              0,
              { $divide: ["$errorCount", "$requests"] },
            ],
          },
        };

    const pipeline: Document[] = [
      { $match: matchStage },
      {
        $group: {
          _id: groupId,
          requests: { $sum: 1 },
          avgDurationMs: { $avg: "$durationMs" },
          errorCount: {
            $sum: {
              $cond: [{ $gte: ["$status", 400] }, 1, 0],
            },
          },
        },
      },
      { $project: projectStage },
      { $sort: { requests: -1 } },
    ];

    const results = await collection.aggregate<RouteStats>(pipeline).toArray();
    return results;
  }

  async function getStatusBreakdown(
    params: TimeRangeParams
  ): Promise<StatusBreakdown> {
    const { from, to, route } = params;

    const matchStage: Document = {
      timestamp: { $gte: from, $lte: to },
    };

    if (route) {
      matchStage["meta.route"] = route;
    }

    const pipeline: Document[] = [
      { $match: matchStage },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ];

    const results = await collection
      .aggregate<{ _id: number; count: number }>(pipeline)
      .toArray();

    const breakdown: StatusBreakdown = {
      total: 0,
      byStatus: {},
      byCategory: {
        success: 0,
        redirect: 0,
        clientError: 0,
        serverError: 0,
      },
    };

    for (const result of results) {
      const status = result._id;
      const count = result.count;

      breakdown.total += count;
      breakdown.byStatus[status] = count;

      if (status >= 200 && status < 300) {
        breakdown.byCategory.success += count;
      } else if (status >= 300 && status < 400) {
        breakdown.byCategory.redirect += count;
      } else if (status >= 400 && status < 500) {
        breakdown.byCategory.clientError += count;
      } else if (status >= 500) {
        breakdown.byCategory.serverError += count;
      }
    }

    return breakdown;
  }

  async function getPerformanceStats(
    params: TimeRangeParams
  ): Promise<PerformanceStats[]> {
    const { from, to, route, groupByMethod = false } = params;

    const matchStage: Document = {
      timestamp: { $gte: from, $lte: to },
    };

    if (route) {
      matchStage["meta.route"] = route;
    }

    // Group by route only, or by route + method
    const groupId = groupByMethod
      ? { route: "$meta.route", method: "$meta.method" }
      : "$meta.route";

    // First project stage differs based on grouping
    const firstProjectStage: Document = groupByMethod
      ? {
          _id: 0,
          route: { $ifNull: ["$_id.route", "unknown"] },
          method: { $ifNull: ["$_id.method", "unknown"] },
          avgDurationMs: 1,
          p50DurationMs: {
            $percentile: {
              input: "$durations",
              p: [0.5],
              method: "approximate",
            },
          },
          p95DurationMs: {
            $percentile: {
              input: "$durations",
              p: [0.95],
              method: "approximate",
            },
          },
          p99DurationMs: {
            $percentile: {
              input: "$durations",
              p: [0.99],
              method: "approximate",
            },
          },
        }
      : {
          _id: 0,
          route: { $ifNull: ["$_id", "unknown"] },
          avgDurationMs: 1,
          p50DurationMs: {
            $percentile: {
              input: "$durations",
              p: [0.5],
              method: "approximate",
            },
          },
          p95DurationMs: {
            $percentile: {
              input: "$durations",
              p: [0.95],
              method: "approximate",
            },
          },
          p99DurationMs: {
            $percentile: {
              input: "$durations",
              p: [0.99],
              method: "approximate",
            },
          },
        };

    // Second project stage to extract array elements
    const secondProjectStage: Document = groupByMethod
      ? {
          route: 1,
          method: 1,
          avgDurationMs: 1,
          p50DurationMs: { $arrayElemAt: ["$p50DurationMs", 0] },
          p95DurationMs: { $arrayElemAt: ["$p95DurationMs", 0] },
          p99DurationMs: { $arrayElemAt: ["$p99DurationMs", 0] },
        }
      : {
          route: 1,
          avgDurationMs: 1,
          p50DurationMs: { $arrayElemAt: ["$p50DurationMs", 0] },
          p95DurationMs: { $arrayElemAt: ["$p95DurationMs", 0] },
          p99DurationMs: { $arrayElemAt: ["$p99DurationMs", 0] },
        };

    const pipeline: Document[] = [
      { $match: matchStage },
      {
        $group: {
          _id: groupId,
          avgDurationMs: { $avg: "$durationMs" },
          durations: { $push: "$durationMs" },
        },
      },
      { $project: firstProjectStage },
      { $project: secondProjectStage },
      { $sort: { avgDurationMs: -1 } },
    ];

    const results = await collection
      .aggregate<PerformanceStats>(pipeline)
      .toArray();
    return results;
  }

  return {
    setup,
    write,
    writeMany,
    getRequestsOverTime,
    getRouteStats,
    getStatusBreakdown,
    getPerformanceStats,
  };
}
