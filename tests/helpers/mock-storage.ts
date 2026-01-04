import { vi } from "vitest";
import type { RequestMetric, StorageAdapter } from "../../src/lib/types.js";

export interface MockStorage extends StorageAdapter {
  writeCalls: RequestMetric[];
  writeManyCalls: RequestMetric[][];
}

export function createMockStorage(): MockStorage {
  const storage: MockStorage = {
    writeCalls: [],
    writeManyCalls: [],
    write: vi.fn(async (metric: RequestMetric) => {
      storage.writeCalls.push(metric);
    }),
    writeMany: vi.fn(async (metrics: RequestMetric[]) => {
      storage.writeManyCalls.push(metrics);
    }),
    setup: vi.fn(async () => {}),
  };
  return storage;
}

export function createMetric(
  overrides: Partial<RequestMetric> = {}
): RequestMetric {
  return {
    timestamp: new Date(),
    route: "/test",
    method: "GET",
    status: 200,
    durationMs: 100,
    ...overrides,
  };
}
