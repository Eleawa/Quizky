export class ApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly fields?: Record<string, string>;

	constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.code = code;
		this.fields = fields;
	}
}

export function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
	const headers = new Headers(init.headers);
	headers.set('cache-control', 'no-store');
	return Response.json(data, { ...init, headers });
}

export function apiErrorResponse(error: unknown): Response {
	if (error instanceof ApiError) {
		return jsonResponse(
			{
				error: {
					code: error.code,
					message: error.message,
					...(error.fields ? { fields: error.fields } : {})
				}
			},
			{ status: error.status }
		);
	}

	console.error('Unhandled API error', error);
	return jsonResponse(
		{ error: { code: 'internal_error', message: 'Something went wrong. Try again.' } },
		{ status: 500 }
	);
}
