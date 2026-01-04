import { afterEach, describe, expect, it, vi } from "vitest";
import { createTracker } from "../../src/lib/tracker.js";
import { createMetric, createMockStorage } from "../helpers/index.js";

describe("createTracker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("track()", () => {
    it("adds metric to buffer", async () => {
      const storage = createMockStorage();
      const tracker = createTracker({ storage });

      const metric = createMetric();
      tracker.track(metric);

      await tracker.flush();

      expect(storage.writeManyCalls).toHaveLength(1);
      expect(storage.writeManyCalls[0]).toContainEqual(metric);
    });

    it("does nothing when disabled", async () => {
      const storage = createMockStorage();
      const tracker = createTracker({ storage, disabled: true });

      tracker.track(createMetric());
      await tracker.flush();

      expect(storage.writeManyCalls).toHaveLength(0);
    });

    it("calls debug handler when debug is a function", () => {
      const storage = createMockStorage();
      const debugFn = vi.fn();
      const tracker = createTracker({ storage, debug: debugFn });

      const metric = createMetric();
      tracker.track(metric);

      expect(debugFn).toHaveBeenCalledWith(metric);
    });

    it("logs to console when debug is true", () => {
      const storage = createMockStorage();
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const tracker = createTracker({ storage, debug: true });

      const metric = createMetric();
      tracker.track(metric);

      expect(consoleSpy).toHaveBeenCalledWith("[kit-request-metrics]", metric);
      consoleSpy.mockRestore();
    });

    it("swallows errors from debug handler", () => {
      const storage = createMockStorage();
      const debugFn = vi.fn().mockImplementation(() => {
        throw new Error("Debug error");
      });
      const tracker = createTracker({ storage, debug: debugFn });

      // Should not throw
      expect(() => tracker.track(createMetric())).not.toThrow();
    });
  });

  describe("flush()", () => {
    it("writes buffered metrics to storage", async () => {
      const storage = createMockStorage();
      const tracker = createTracker({ storage });

      tracker.track(createMetric({ route: "/a" }));
      tracker.track(createMetric({ route: "/b" }));

      await tracker.flush();

      expect(storage.writeManyCalls).toHaveLength(1);
      expect(storage.writeManyCalls[0]).toHaveLength(2);
    });

    it("does nothing when buffer is empty", async () => {
      const storage = createMockStorage();
      const tracker = createTracker({ storage });

      await tracker.flush();

      expect(storage.writeManyCalls).toHaveLength(0);
    });

    it("does nothing when disabled", async () => {
      const storage = createMockStorage();
      const tracker = createTracker({ storage, disabled: true });

      tracker.track(createMetric());
      await tracker.flush();

      expect(storage.writeManyCalls).toHaveLength(0);
    });

    it("calls onError when storage.writeMany fails", async () => {
      const onError = vi.fn();
      const storage = createMockStorage();
      storage.writeMany = vi.fn().mockRejectedValue(new Error("Storage error"));

      const tracker = createTracker({ storage, onError });

      tracker.track(createMetric());
      await tracker.flush();

      expect(onError).toHaveBeenCalled();
    });
  });

  describe("setup()", () => {
    it("calls storage.setup()", async () => {
      const storage = createMockStorage();
      const tracker = createTracker({ storage });

      await tracker.setup();

      expect(storage.setup).toHaveBeenCalled();
    });

    it("initializes only once", async () => {
      const storage = createMockStorage();
      const tracker = createTracker({ storage });

      await tracker.setup();
      await tracker.setup();

      expect(storage.setup).toHaveBeenCalledTimes(1);
    });
  });

  describe("getQueryClient()", () => {
    it("returns null for storage without query methods", () => {
      const storage = createMockStorage();
      const tracker = createTracker({ storage });

      expect(tracker.getQueryClient()).toBeNull();
    });

    it("returns storage when it implements QueryClient", () => {
      const storage = {
        ...createMockStorage(),
        getRequestsOverTime: vi.fn(),
        getRouteStats: vi.fn(),
        getStatusBreakdown: vi.fn(),
        getPerformanceStats: vi.fn(),
      };
      const tracker = createTracker({ storage });

      expect(tracker.getQueryClient()).toBe(storage);
    });
  });

  describe("buffer overflow", () => {
    it("drops oldest metrics when buffer exceeds maxBufferSize", async () => {
      const onError = vi.fn();
      const storage = createMockStorage();
      const tracker = createTracker({
        storage,
        maxBufferSize: 3,
        onError,
      });

      tracker.track(createMetric({ route: "/1" }));
      tracker.track(createMetric({ route: "/2" }));
      tracker.track(createMetric({ route: "/3" }));
      tracker.track(createMetric({ route: "/4" })); // This should cause overflow

      expect(onError).toHaveBeenCalled();
      const errorArg = onError.mock.calls[0][0];
      expect(errorArg.message).toContain("Buffer overflow");

      await tracker.flush();

      // Should have dropped the first metric
      const metrics = storage.writeManyCalls[0];
      expect(metrics).toHaveLength(3);
      expect(metrics[0].route).toBe("/2");
    });

    it("only warns once about overflow", async () => {
      const onError = vi.fn();
      const storage = createMockStorage();
      const tracker = createTracker({
        storage,
        maxBufferSize: 2,
        onError,
      });

      tracker.track(createMetric());
      tracker.track(createMetric());
      tracker.track(createMetric()); // First overflow
      tracker.track(createMetric()); // Second overflow

      // Should only warn once
      const overflowCalls = onError.mock.calls.filter((call) =>
        call[0]?.message?.includes("Buffer overflow")
      );
      expect(overflowCalls).toHaveLength(1);
    });
  });

  describe("auto-flush", () => {
    it("auto-flushes at 100 items", async () => {
      const storage = createMockStorage();
      const tracker = createTracker({ storage });

      // Add 100 metrics
      for (let i = 0; i < 100; i++) {
        tracker.track(createMetric({ route: `/${i}` }));
      }

      // Wait for the async flush to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(storage.writeManyCalls.length).toBeGreaterThanOrEqual(1);

      // Clean up
      await tracker.flush();
    });
  });
});
