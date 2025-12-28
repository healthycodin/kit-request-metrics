import { sequence } from '@sveltejs/kit/hooks';
import { createTracker } from '$lib/index.js';
import type { StorageAdapter, RequestMetric } from '$lib/types.js';

/**
 * Demo: In-memory storage adapter for development/preview
 *
 * In production, use createMongoStorage instead:
 *
 * import { createMongoStorage } from '$lib/index.js';
 * const storage = createMongoStorage({
 *   client: mongoClient,
 *   database: 'myapp',
 * });
 */
function createDemoStorage(): StorageAdapter {
	const metrics: RequestMetric[] = [];

	return {
		async setup() {
			console.log('[demo] Storage initialized');
		},
		async write(metric) {
			metrics.push(metric);
			console.log('[demo] Metric:', metric.method, metric.route, metric.status, metric.durationMs.toFixed(2) + 'ms');
		},
		async writeMany(batch) {
			metrics.push(...batch);
			for (const metric of batch) {
				console.log('[demo] Metric:', metric.method, metric.route, metric.status, metric.durationMs.toFixed(2) + 'ms');
			}
		}
	};
}

const tracker = createTracker({
	storage: createDemoStorage(),

	// Skip tracking for health checks
	exclude: ['/health'],

	// Add custom metadata
	enrichMetadata: (event) => ({
		userAgent: event.request.headers.get('user-agent')?.slice(0, 50)
	}),

	// Log debug info in development
	debug: true
});

export const handle = sequence(tracker.hook());
