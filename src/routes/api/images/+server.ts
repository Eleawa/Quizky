import type { RequestHandler } from '@sveltejs/kit';
import { ApiError, apiErrorResponse, jsonResponse } from '#lib/server/api/errors.js';
import { requireSameOrigin } from '#lib/server/api/request.js';
import { requireAuthenticatedTeacher } from '#lib/server/auth/guard.js';
import { getDb } from '#lib/server/db/client.js';
import { saveUploadedQuestionImage } from '#lib/server/images/service.js';

export const POST: RequestHandler = async (event) => {
	try {
		requireSameOrigin(event);
		const teacher = requireAuthenticatedTeacher(event.locals.teacher);

		let formData: FormData;
		try {
			formData = await event.request.formData();
		} catch {
			throw new ApiError(400, 'invalid_form_data', 'Request must be multipart/form-data.');
		}

		const file = formData.get('file');
		if (!file || typeof file === 'string' || !(file instanceof File)) {
			throw new ApiError(400, 'invalid_upload', 'Form field "file" must be an image file.');
		}

		const result = await saveUploadedQuestionImage(getDb(event.platform), teacher.id, file);
		return jsonResponse(result, { status: 201 });
	} catch (error) {
		return apiErrorResponse(error);
	}
};
