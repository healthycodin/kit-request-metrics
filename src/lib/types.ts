import type { RequestEvent } from "@sveltejs/kit";
import type { MongoClient } from "mongodb";

/**
 * A single tracked request metric
 */
export interface RequestMetric {
  timestamp: Date;
  route: string | null;
  method: string;
  status: number;
  durationMs: number;
  metadata?: Record<string, unknown>;
}

/**
 * Storage adapter interface for persisting metrics
 */
export interface StorageAdapter {
  write(metric: RequestMetric): Promise<void>;
  writeMany(metrics: RequestMetric[]): Promise<void>;
  setup(): Promise<void>;
}

/**
 * Debug handler function type
 */
export type DebugHandler = (metric: RequestMetric) => void;

/**
 * Configuration for the request tracker
 */
export interface TrackerConfig {
  storage: StorageAdapter;
  exclude?: (string | RegExp)[];
  enrichMetadata?: (event: RequestEvent) => Record<string, unknown>;
  maxBufferSize?: number;
  flushIntervalMs?: number;
  onError?: (error: unknown, metric?: RequestMetric) => void;
  disabled?: boolean;
  debug?: boolean | DebugHandler;
}

/**
 * Parameters for time-range based queries
 */
export interface TimeRangeParams {
  from: Date;
  to: Date;
  route?: string;
  bucketMinutes?: number;
  /**
   * When true, getRouteStats and getPerformanceStats will group by both
   * route and HTTP method, returning separate entries for GET /api/users
   * vs POST /api/users
   */
  groupByMethod?: boolean;
}

/**
 * A time bucket containing aggregated request data
 */
export interface TimeBucket {
  timestamp: Date;
  requests: number;
  avgDurationMs: number;
}

/**
 * Statistics for a specific route (and optionally method)
 */
export interface RouteStats {
  route: string;
  /** HTTP method (GET, POST, etc.) - only present when groupByMethod is true */
  method?: string;
  requests: number;
  avgDurationMs: number;
  errorRate: number;
}

/**
 * Breakdown of requests by status code
 */
export interface StatusBreakdown {
  total: number;
  byStatus: Record<number, number>;
  byCategory: {
    success: number;
    redirect: number;
    clientError: number;
    serverError: number;
  };
}

/**
 * Performance statistics including percentiles
 */
export interface PerformanceStats {
  route: string;
  /** HTTP method (GET, POST, etc.) - only present when groupByMethod is true */
  method?: string;
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
}

/**
 * Query client interface for retrieving metrics
 */
export interface QueryClient {
  getRequestsOverTime(params: TimeRangeParams): Promise<TimeBucket[]>;
  getRouteStats(params: TimeRangeParams): Promise<RouteStats[]>;
  getStatusBreakdown(params: TimeRangeParams): Promise<StatusBreakdown>;
  getPerformanceStats(params: TimeRangeParams): Promise<PerformanceStats[]>;
}

/**
 * Client factory function type for lazy client initialization
 */
export type MongoClientFactory = () => MongoClient | Promise<MongoClient>;

/**
 * Configuration for MongoDB storage adapter
 */
export interface MongoStorageConfig {
  client: MongoClient | MongoClientFactory;
  database: string;
  collection?: string;
  ttlDays?: number;
}
