<h1>@healthycodin/kit-request-metrics</h1>
<p>Request metrics tracking for SvelteKit with MongoDB storage.</p>

<h2>Usage</h2>
<pre>
{`// hooks.server.ts
import { sequence } from '@sveltejs/kit/hooks';
import { createTracker, createMongoStorage } from '@healthycodin/kit-request-metrics';
import { client } from '$lib/server/mongo';

const tracker = createTracker({
  storage: createMongoStorage({
    client,
    database: 'myapp',
    ttlDays: 90,
  }),
  exclude: ['/health', /^\\/api\\/internal/],
  enrichMetadata: (event) => ({
    userId: event.locals.user?.id,
  }),
});

export const handle = sequence(tracker.hook());`}
</pre>

<h2>Querying Metrics</h2>
<pre>
{`const queryClient = tracker.getQueryClient();

// Requests over time
const timeSeries = await queryClient.getRequestsOverTime({
  from: new Date('2024-01-01'),
  to: new Date('2024-01-31'),
  bucketMinutes: 60,
});

// Per-route statistics
const routeStats = await queryClient.getRouteStats({
  from: new Date('2024-01-01'),
  to: new Date('2024-01-31'),
});`}
</pre>
