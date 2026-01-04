import type { Handle } from "@sveltejs/kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTracker } from "../../src/lib/tracker.js";
import { createMockEvent, createMockStorage } from "../helpers/index.js";

type HookEvent = Parameters<Handle>[0]["event"];

describe("hook()", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("captures route, method, status, duration", async () => {
    const storage = createMockStorage();
    const tracker = createTracker({ storage });
    const hook = tracker.hook();

    const event = createMockEvent({ method: "POST", routeId: "/api/users" });

    await hook({
      event: event as HookEvent,
      resolve: async () => new Response("Created", { status: 201 }),
    });

    // Wait for queueMicrotask
    await new Promise((resolve) => setTimeout(resolve, 10));
    await tracker.flush();

    expect(storage.writeManyCalls).toHaveLength(1);
    expect(storage.writeManyCalls[0]).toHaveLength(1);

    const metric = storage.writeManyCalls[0][0];
    expect(metric.route).toBe("/api/users");
    expect(metric.method).toBe("POST");
    expect(metric.status).toBe(201);
    expect(metric.durationMs).toBeGreaterThanOrEqual(0);
    expect(metric.timestamp).toBeInstanceOf(Date);
  });

  it("handles null route.id", async () => {
    const storage = createMockStorage();
    const tracker = createTracker({ storage });
    const hook = tracker.hook();

    const event = createMockEvent({ routeId: null });

    await hook({
      event: event as HookEvent,
      resolve: async () => new Response("OK", { status: 200 }),
    });

    // Wait for queueMicrotask
    await new Promise((resolve) => setTimeout(resolve, 10));
    await tracker.flush();

    expect(storage.writeManyCalls).toHaveLength(1);
    expect(storage.writeManyCalls[0][0].route).toBeNull();
  });

  it("calls enrichMetadata and includes result", async () => {
    const storage = createMockStorage();
    const tracker = createTracker({
      storage,
      enrichMetadata: () => ({ userId: "123", customField: "value" }),
    });
    const hook = tracker.hook();

    const event = createMockEvent();

    await hook({
      event: event as HookEvent,
      resolve: async () => new Response("OK", { status: 200 }),
    });

    // Wait for queueMicrotask
    await new Promise((resolve) => setTimeout(resolve, 10));
    await tracker.flush();

    expect(storage.writeManyCalls).toHaveLength(1);
    const metric = storage.writeManyCalls[0][0];
    expect(metric.metadata).toEqual({ userId: "123", customField: "value" });
  });

  it("does not block response", async () => {
    const storage = createMockStorage();
    // Make storage slow
    storage.writeMany = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    const tracker = createTracker({ storage });
    const hook = tracker.hook();

    const event = createMockEvent();

    const start = performance.now();
    await hook({
      event: event as HookEvent,
      resolve: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return new Response("OK", { status: 200 });
      },
    });
    const elapsed = performance.now() - start;

    // Hook should complete quickly (resolve time + small overhead)
    // Should NOT wait for storage
    expect(elapsed).toBeLessThan(50);

    // Clean up
    await tracker.flush();
  });

  it("swallows errors from enrichMetadata", async () => {
    const storage = createMockStorage();
    const tracker = createTracker({
      storage,
      enrichMetadata: () => {
        throw new Error("enrichMetadata failed");
      },
    });
    const hook = tracker.hook();

    const event = createMockEvent();

    // Should not throw
    const response = await hook({
      event: event as HookEvent,
      resolve: async () => new Response("OK", { status: 200 }),
    });

    expect(response.status).toBe(200);

    // Wait for queueMicrotask
    await new Promise((resolve) => setTimeout(resolve, 10));
    await tracker.flush();

    // Metric should still be tracked but without metadata
    expect(storage.writeManyCalls).toHaveLength(1);
    expect(storage.writeManyCalls[0][0].metadata).toBeUndefined();
  });

  it("tracks errors with 500 status", async () => {
    const storage = createMockStorage();
    const tracker = createTracker({ storage });
    const hook = tracker.hook();

    const event = createMockEvent({ routeId: "/api/error" });

    try {
      await hook({
        event: event as HookEvent,
        resolve: async () => {
          throw new Error("Something went wrong");
        },
      });
    } catch {
      // Expected
    }

    // Wait for queueMicrotask
    await new Promise((resolve) => setTimeout(resolve, 10));
    await tracker.flush();

    expect(storage.writeManyCalls).toHaveLength(1);
    const metric = storage.writeManyCalls[0][0];
    expect(metric.status).toBe(500);
    expect(metric.route).toBe("/api/error");
  });

  it("respects disabled flag", async () => {
    const storage = createMockStorage();
    const tracker = createTracker({ storage, disabled: true });
    const hook = tracker.hook();

    const event = createMockEvent();

    await hook({
      event: event as HookEvent,
      resolve: async () => new Response("OK", { status: 200 }),
    });

    await tracker.flush();

    expect(storage.writeManyCalls).toHaveLength(0);
  });

  describe("exclude patterns", () => {
    it("excludes exact string matches", async () => {
      const storage = createMockStorage();
      const tracker = createTracker({
        storage,
        exclude: ["/health"],
      });
      const hook = tracker.hook();

      const event = createMockEvent({ routeId: "/health" });

      await hook({
        event: event as HookEvent,
        resolve: async () => new Response("OK", { status: 200 }),
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      await tracker.flush();

      expect(storage.writeManyCalls).toHaveLength(0);
    });

    it("excludes regex matches", async () => {
      const storage = createMockStorage();
      const tracker = createTracker({
        storage,
        exclude: [/^\/api\/internal/],
      });
      const hook = tracker.hook();

      const event = createMockEvent({ routeId: "/api/internal/metrics" });

      await hook({
        event: event as HookEvent,
        resolve: async () => new Response("OK", { status: 200 }),
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      await tracker.flush();

      expect(storage.writeManyCalls).toHaveLength(0);
    });

    it("tracks non-excluded routes", async () => {
      const storage = createMockStorage();
      const tracker = createTracker({
        storage,
        exclude: ["/health", /^\/api\/internal/],
      });
      const hook = tracker.hook();

      const event = createMockEvent({ routeId: "/api/users" });

      await hook({
        event: event as HookEvent,
        resolve: async () => new Response("OK", { status: 200 }),
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      await tracker.flush();

      expect(storage.writeManyCalls).toHaveLength(1);
    });
  });
});
