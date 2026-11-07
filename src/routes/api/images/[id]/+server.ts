import type { RequestHandler } from '@sveltejs/kit';
import { ApiError, apiErrorResponse } from '#lib/server/api/errors.js';
import { getDb } from '#lib/server/db/client.js';
import { getQuestionImageById } from '#lib/server/images/service.js';

export const GET: RequestHandler = async (event) => {
	try {
		const imageId = event.params.id;
		if (!imageId) {
			throw new ApiError(400, 'missing_image_id', 'Image ID is required.');
		}

		const image = await getQuestionImageById(getDb(event.platform), imageId);
		if (!image) {
			throw new ApiError(404, 'image_not_found', 'Image not found.');
		}

		return new Response(new Uint8Array(image.buffer), {
			status: 200,
			headers: {
				'Content-Type': image.mimeType,
				'Content-Length': String(image.sizeBytes),
				'Cache-Control': 'public, max-age=31536000, immutable'
			}
		});
	} catch (error) {
		return apiErrorResponse(error);
	}
};
