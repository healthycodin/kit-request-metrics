import type { RequestEvent } from '@sveltejs/kit';

export interface MockEventOptions {
	method?: string;
	routeId?: string | null;
	pathname?: string;
	origin?: string;
	headers?: Record<string, string>;
}

export function createMockEvent(options: MockEventOptions = {}): RequestEvent {
	const {
		method = 'GET',
		routeId = '/test',
		pathname = '/',
		origin = 'http://localhost:5173',
		headers = {}
	} = options;

	const url = new URL(pathname, origin);
	const headersObj = new Headers(headers);

	return {
		request: new Request(url, {
			method,
			headers: headersObj
		}),
		url,
		params: {},
		route: { id: routeId },
		cookies: {
			get: () => undefined,
			getAll: () => [],
			set: () => {},
			delete: () => {},
			serialize: () => ''
		},
		locals: {},
		platform: undefined,
		isDataRequest: false,
		isSubRequest: false,
		getClientAddress: () => '127.0.0.1',
		fetch: globalThis.fetch,
		setHeaders: () => {}
	} as unknown as RequestEvent;
}
