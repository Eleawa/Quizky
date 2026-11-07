export interface ClientApiError {
	message: string;
	fields: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function readFields(value: unknown): Record<string, string> {
	if (!isRecord(value)) return {};
	const fields: Record<string, string> = {};
	for (const [key, message] of Object.entries(value)) {
		if (typeof message === 'string') fields[key] = message;
	}
	return fields;
}

export async function readApiError(response: Response): Promise<ClientApiError> {
	try {
		const body: unknown = await response.json();
		if (isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string') {
			return {
				message: body.error.message,
				fields: readFields(body.error.fields)
			};
		}
	} catch {
		// Fall through to the generic message.
	}
	return { message: 'Something went wrong. Try again.', fields: {} };
}
