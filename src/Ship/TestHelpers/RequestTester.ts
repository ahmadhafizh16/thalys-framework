export interface RequestOptions {
	headers?: Record<string, string>;
	token?: string;
	body?: unknown;
}

export interface TestResponse {
	status: number;
	body: unknown;
	headers: Record<string, string>;
}

/**
 * In-process HTTP test client for Elysia apps.
 * Uses app.handle() — no port binding, no network I/O.
 */
export class RequestTester {
	constructor(private readonly app: { handle(request: Request): Promise<Response> }) {}

	async get(path: string, options?: RequestOptions): Promise<TestResponse> {
		return this.request("GET", path, options);
	}

	async post(path: string, body?: unknown, options?: RequestOptions): Promise<TestResponse> {
		return this.request("POST", path, { ...options, body });
	}

	async put(path: string, body?: unknown, options?: RequestOptions): Promise<TestResponse> {
		return this.request("PUT", path, { ...options, body });
	}

	async patch(path: string, body?: unknown, options?: RequestOptions): Promise<TestResponse> {
		return this.request("PATCH", path, { ...options, body });
	}

	async delete(path: string, options?: RequestOptions): Promise<TestResponse> {
		return this.request("DELETE", path, options);
	}

	private async request(
		method: string,
		path: string,
		options?: RequestOptions,
	): Promise<TestResponse> {
		const headers: Record<string, string> = {
			"content-type": "application/json",
			...options?.headers,
		};

		if (options?.token) {
			headers["authorization"] = `Bearer ${options.token}`;
		}

		const request = new Request(`http://localhost${path}`, {
			method,
			headers,
			body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
		});

		const response = await this.app.handle(request);
		const text = await response.text();
		let body: unknown;
		try {
			body = JSON.parse(text);
		} catch {
			body = text;
		}

		return {
			status: response.status,
			body,
			headers: Object.fromEntries(response.headers),
		};
	}
}
