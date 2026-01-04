import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMongoStorage } from "../../src/lib/storage/mongodb.js";
import type { RequestMetric } from "../../src/lib/types.js";

describe("MongoDB Storage", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create({
      binary: {
        version: "7.0.14",
      },
    });
    const uri = mongoServer.getUri();
    client = new MongoClient(uri);
    await client.connect();
    db = client.db("test_metrics");
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    // Clean up collections before each test (skip system collections)
    const collections = await db.listCollections().toArray();
    for (const col of collections) {
      if (!col.name.startsWith("system.")) {
        try {
          await db.dropCollection(col.name);
        } catch {
          // Ignore drop errors
        }
      }
    }
  });

  describe("setup()", () => {
    it("creates time series collection", async () => {
      const storage = createMongoStorage({
        client,
        database: "test_metrics",
        collection: "setup_test",
      });

      await storage.setup();

      const collections = await db
        .listCollections({ name: "setup_test" })
        .toArray();
      expect(collections).toHaveLength(1);
      // Check that it's a time series collection by checking the type
      expect(collections[0].type).toBe("timeseries");
    });

    it("creates indexes", async () => {
      const storage = createMongoStorage({
        client,
        database: "test_metrics",
        collection: "index_test",
      });

      await storage.setup();

      const collection = db.collection("index_test");
      const indexes = await collection.indexes();

      // Should have route+timestamp and status+timestamp indexes
      const indexNames = indexes.map((idx) => idx.name);
      expect(indexNames.some((name) => name?.includes("route"))).toBe(true);
      expect(indexNames.some((name) => name?.includes("status"))).toBe(true);
    });

    it("accepts lazy client factory", async () => {
      const storage = createMongoStorage({
        client: () => client,
        database: "test_metrics",
        collection: "factory_test",
      });

      await storage.setup();

      const collections = await db
        .listCollections({ name: "factory_test" })
        .toArray();
      expect(collections).toHaveLength(1);
    });
  });

  describe("write() and writeMany()", () => {
    it("writes a single metric", async () => {
      const storage = createMongoStorage({
        client,
        database: "test_metrics",
        collection: "write_test",
      });

      await storage.setup();

      const metric: RequestMetric = {
        timestamp: new Date(),
        route: "/api/test",
        method: "GET",
        status: 200,
        durationMs: 50,
      };

      await storage.write(metric);

      const collection = db.collection("write_test");
      const docs = await collection.find({}).toArray();
      expect(docs).toHaveLength(1);
      expect(docs[0].meta.route).toBe("/api/test");
    });

    it("writes multiple metrics in batch", async () => {
      const storage = createMongoStorage({
        client,
        database: "test_metrics",
        collection: "batch_test",
      });

      await storage.setup();

      const metrics: RequestMetric[] = [
        {
          timestamp: new Date(),
          route: "/a",
          method: "GET",
          status: 200,
          durationMs: 10,
        },
        {
          timestamp: new Date(),
          route: "/b",
          method: "POST",
          status: 201,
          durationMs: 20,
        },
        {
          timestamp: new Date(),
          route: "/c",
          method: "PUT",
          status: 200,
          durationMs: 30,
        },
      ];

      await storage.writeMany(metrics);

      const collection = db.collection("batch_test");
      const docs = await collection.find({}).toArray();
      expect(docs).toHaveLength(3);
    });

    it("handles empty writeMany gracefully", async () => {
      const storage = createMongoStorage({
        client,
        database: "test_metrics",
        collection: "empty_test",
      });

      await storage.setup();
      await storage.writeMany([]);

      const collection = db.collection("empty_test");
      const docs = await collection.find({}).toArray();
      expect(docs).toHaveLength(0);
    });
  });

  describe("Query methods", () => {
    async function seedTestData(collectionName: string) {
      const storage = createMongoStorage({
        client,
        database: "test_metrics",
        collection: collectionName,
      });

      await storage.setup();

      const now = new Date();
      const metrics: RequestMetric[] = [
        // Route /api/users - 3 requests
        {
          timestamp: new Date(now.getTime() - 3600000),
          route: "/api/users",
          method: "GET",
          status: 200,
          durationMs: 50,
        },
        {
          timestamp: new Date(now.getTime() - 3000000),
          route: "/api/users",
          method: "GET",
          status: 200,
          durationMs: 100,
        },
        {
          timestamp: new Date(now.getTime() - 2400000),
          route: "/api/users",
          method: "POST",
          status: 500,
          durationMs: 200,
        },
        // Route /api/products - 2 requests
        {
          timestamp: new Date(now.getTime() - 1800000),
          route: "/api/products",
          method: "GET",
          status: 200,
          durationMs: 30,
        },
        {
          timestamp: new Date(now.getTime() - 1200000),
          route: "/api/products",
          method: "GET",
          status: 404,
          durationMs: 20,
        },
      ];

      await storage.writeMany(metrics);
      return { storage, now };
    }

    it("getRequestsOverTime returns bucketed data", async () => {
      const { storage, now } = await seedTestData("query_time_test");

      const results = await storage.getRequestsOverTime({
        from: new Date(now.getTime() - 7200000),
        to: now,
        bucketMinutes: 60,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty("timestamp");
      expect(results[0]).toHaveProperty("requests");
      expect(results[0]).toHaveProperty("avgDurationMs");
    });

    it("getRouteStats returns per-route statistics", async () => {
      const { storage, now } = await seedTestData("query_route_test");

      const results = await storage.getRouteStats({
        from: new Date(now.getTime() - 7200000),
        to: now,
      });

      expect(results.length).toBe(2);

      const usersRoute = results.find((r) => r.route === "/api/users");
      expect(usersRoute).toBeDefined();
      expect(usersRoute!.requests).toBe(3);
      expect(usersRoute!.errorRate).toBeCloseTo(1 / 3, 2);

      const productsRoute = results.find((r) => r.route === "/api/products");
      expect(productsRoute).toBeDefined();
      expect(productsRoute!.requests).toBe(2);
    });

    it("getStatusBreakdown returns status code distribution", async () => {
      const { storage, now } = await seedTestData("query_status_test");

      const result = await storage.getStatusBreakdown({
        from: new Date(now.getTime() - 7200000),
        to: now,
      });

      expect(result.total).toBe(5);
      expect(result.byStatus[200]).toBe(3);
      expect(result.byStatus[404]).toBe(1);
      expect(result.byStatus[500]).toBe(1);
      expect(result.byCategory.success).toBe(3);
      expect(result.byCategory.clientError).toBe(1);
      expect(result.byCategory.serverError).toBe(1);
    });

    it("getPerformanceStats returns percentile data", async () => {
      const { storage, now } = await seedTestData("query_perf_test");

      const results = await storage.getPerformanceStats({
        from: new Date(now.getTime() - 7200000),
        to: now,
      });

      expect(results.length).toBe(2);

      const usersRoute = results.find((r) => r.route === "/api/users");
      expect(usersRoute).toBeDefined();
      expect(usersRoute!.avgDurationMs).toBeGreaterThan(0);
      expect(usersRoute!.p50DurationMs).toBeGreaterThan(0);
      expect(usersRoute!.p95DurationMs).toBeGreaterThan(0);
      expect(usersRoute!.p99DurationMs).toBeGreaterThan(0);
    });

    it("filters by route when specified", async () => {
      const { storage, now } = await seedTestData("query_filter_test");

      const results = await storage.getRouteStats({
        from: new Date(now.getTime() - 7200000),
        to: now,
        route: "/api/users",
      });

      expect(results.length).toBe(1);
      expect(results[0].route).toBe("/api/users");
    });

    it("getRouteStats with groupByMethod returns separate entries per method", async () => {
      const { storage, now } = await seedTestData("query_route_method_test");

      const results = await storage.getRouteStats({
        from: new Date(now.getTime() - 7200000),
        to: now,
        groupByMethod: true,
      });

      // Should have 3 entries: GET /api/users (2), POST /api/users (1), GET /api/products (2)
      expect(results.length).toBe(3);

      const getUsersRoute = results.find(
        (r) => r.route === "/api/users" && r.method === "GET"
      );
      expect(getUsersRoute).toBeDefined();
      expect(getUsersRoute!.method).toBe("GET");
      expect(getUsersRoute!.requests).toBe(2);

      const postUsersRoute = results.find(
        (r) => r.route === "/api/users" && r.method === "POST"
      );
      expect(postUsersRoute).toBeDefined();
      expect(postUsersRoute!.method).toBe("POST");
      expect(postUsersRoute!.requests).toBe(1);
      expect(postUsersRoute!.errorRate).toBe(1); // The POST request was a 500 error

      const getProductsRoute = results.find(
        (r) => r.route === "/api/products" && r.method === "GET"
      );
      expect(getProductsRoute).toBeDefined();
      expect(getProductsRoute!.requests).toBe(2);
    });

    it("getPerformanceStats with groupByMethod returns separate entries per method", async () => {
      const { storage, now } = await seedTestData("query_perf_method_test");

      const results = await storage.getPerformanceStats({
        from: new Date(now.getTime() - 7200000),
        to: now,
        groupByMethod: true,
      });

      // Should have 3 entries: GET /api/users, POST /api/users, GET /api/products
      expect(results.length).toBe(3);

      const getUsersRoute = results.find(
        (r) => r.route === "/api/users" && r.method === "GET"
      );
      expect(getUsersRoute).toBeDefined();
      expect(getUsersRoute!.method).toBe("GET");
      expect(getUsersRoute!.avgDurationMs).toBeGreaterThan(0);
      expect(getUsersRoute!.p50DurationMs).toBeGreaterThan(0);

      const postUsersRoute = results.find(
        (r) => r.route === "/api/users" && r.method === "POST"
      );
      expect(postUsersRoute).toBeDefined();
      expect(postUsersRoute!.method).toBe("POST");
      // POST request had 200ms duration
      expect(postUsersRoute!.avgDurationMs).toBe(200);
    });

    it("getRouteStats without groupByMethod does not include method field", async () => {
      const { storage, now } = await seedTestData("query_no_method_test");

      const results = await storage.getRouteStats({
        from: new Date(now.getTime() - 7200000),
        to: now,
      });

      // Should have 2 entries (grouped by route only)
      expect(results.length).toBe(2);
      // Method should not be present when groupByMethod is false/undefined
      expect(results[0].method).toBeUndefined();
    });
  });
});
