import { describe, expect, it } from "vitest";
import type {
  DebugHandler,
  PerformanceStats,
  QueryClient,
  RequestMetric,
  RouteStats,
  StatusBreakdown,
  StorageAdapter,
  TimeBucket,
  TimeRangeParams,
  TrackerConfig,
} from "../../src/lib/types.js";

describe("Type exports", () => {
  it("RequestMetric has correct shape", () => {
    const metric: RequestMetric = {
      timestamp: new Date(),
      route: "/api/test",
      method: "GET",
      status: 200,
      durationMs: 100,
    };

    expect(metric.timestamp).toBeInstanceOf(Date);
    expect(metric.route).toBe("/api/test");
    expect(metric.method).toBe("GET");
    expect(metric.status).toBe(200);
    expect(metric.durationMs).toBe(100);
  });

  it("RequestMetric supports optional metadata", () => {
    const metric: RequestMetric = {
      timestamp: new Date(),
      route: null,
      method: "POST",
      status: 201,
      durationMs: 50,
      metadata: { userId: "123", customField: "value" },
    };

    expect(metric.metadata).toEqual({ userId: "123", customField: "value" });
  });

  it("StorageAdapter has required methods", () => {
    const adapter: StorageAdapter = {
      write: async () => {},
      writeMany: async () => {},
      setup: async () => {},
    };

    expect(typeof adapter.write).toBe("function");
    expect(typeof adapter.writeMany).toBe("function");
    expect(typeof adapter.setup).toBe("function");
  });

  it("TrackerConfig has correct optional properties", () => {
    const config: TrackerConfig = {
      storage: {
        write: async () => {},
        writeMany: async () => {},
        setup: async () => {},
      },
    };

    expect(config.storage).toBeDefined();
    expect(config.exclude).toBeUndefined();
    expect(config.enrichMetadata).toBeUndefined();
  });

  it("TimeRangeParams has required and optional fields", () => {
    const params: TimeRangeParams = {
      from: new Date("2024-01-01"),
      to: new Date("2024-01-31"),
    };

    expect(params.from).toBeInstanceOf(Date);
    expect(params.to).toBeInstanceOf(Date);
    expect(params.route).toBeUndefined();
    expect(params.bucketMinutes).toBeUndefined();
  });

  it("TimeBucket has correct shape", () => {
    const bucket: TimeBucket = {
      timestamp: new Date(),
      requests: 100,
      avgDurationMs: 50.5,
    };

    expect(bucket.timestamp).toBeInstanceOf(Date);
    expect(bucket.requests).toBe(100);
    expect(bucket.avgDurationMs).toBe(50.5);
  });

  it("RouteStats has correct shape", () => {
    const stats: RouteStats = {
      route: "/api/users",
      requests: 1000,
      avgDurationMs: 45.2,
      errorRate: 0.05,
    };

    expect(stats.route).toBe("/api/users");
    expect(stats.requests).toBe(1000);
    expect(stats.avgDurationMs).toBe(45.2);
    expect(stats.errorRate).toBe(0.05);
  });

  it("StatusBreakdown has correct structure", () => {
    const breakdown: StatusBreakdown = {
      total: 1000,
      byStatus: { 200: 800, 404: 150, 500: 50 },
      byCategory: {
        success: 800,
        redirect: 0,
        clientError: 150,
        serverError: 50,
      },
    };

    expect(breakdown.total).toBe(1000);
    expect(breakdown.byStatus[200]).toBe(800);
    expect(breakdown.byCategory.success).toBe(800);
  });

  it("PerformanceStats has percentile fields", () => {
    const stats: PerformanceStats = {
      route: "/api/slow",
      avgDurationMs: 100,
      p50DurationMs: 80,
      p95DurationMs: 200,
      p99DurationMs: 500,
    };

    expect(stats.p50DurationMs).toBe(80);
    expect(stats.p95DurationMs).toBe(200);
    expect(stats.p99DurationMs).toBe(500);
  });

  it("QueryClient has required query methods", () => {
    const client: QueryClient = {
      getRequestsOverTime: async () => [],
      getRouteStats: async () => [],
      getStatusBreakdown: async () => ({
        total: 0,
        byStatus: {},
        byCategory: { success: 0, redirect: 0, clientError: 0, serverError: 0 },
      }),
      getPerformanceStats: async () => [],
    };

    expect(typeof client.getRequestsOverTime).toBe("function");
    expect(typeof client.getRouteStats).toBe("function");
    expect(typeof client.getStatusBreakdown).toBe("function");
    expect(typeof client.getPerformanceStats).toBe("function");
  });

  it("DebugHandler is a function type", () => {
    const handler: DebugHandler = (metric) => {
      console.log(metric.route);
    };

    expect(typeof handler).toBe("function");
  });
});
