import { Buffer } from 'node:buffer';
import { asc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { questionImageChunks, questionImages } from '../db/schema.js';
import { ApiError } from '../api/errors.js';

export const ALLOWED_IMAGE_MIME_TYPES = [
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/gif',
	'image/svg+xml'
] as const;

export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

export const MAX_IMAGE_FILE_SIZE_BYTES = 3 * 1024 * 1024; // 3 MB
const CHUNK_CHAR_SIZE = 45000; // ~33 KB of binary per chunk, comfortably below D1 statement length limits

export interface UploadedImageResult {
	id: string;
	url: string;
	mimeType: string;
	sizeBytes: number;
}

export interface StoredImageFile {
	id: string;
	mimeType: string;
	sizeBytes: number;
	buffer: Buffer;
}

export async function saveUploadedQuestionImage(
	db: Database,
	teacherId: string,
	file: File
): Promise<UploadedImageResult> {
	if (!file || typeof file.size !== 'number' || file.size === 0) {
		throw new ApiError(400, 'empty_image', 'No image file was provided.');
	}

	if (file.size > MAX_IMAGE_FILE_SIZE_BYTES) {
		throw new ApiError(
			413,
			'image_too_large',
			`Image file is too large. Maximum size is ${Math.round(MAX_IMAGE_FILE_SIZE_BYTES / (1024 * 1024))}MB.`
		);
	}

	const mimeType = file.type?.toLowerCase();
	if (!mimeType || !ALLOWED_IMAGE_MIME_TYPES.includes(mimeType as AllowedImageMimeType)) {
		throw new ApiError(
			415,
			'unsupported_media_type',
			'Unsupported image format. Allowed formats: PNG, JPEG, WebP, GIF, SVG.'
		);
	}

	const arrayBuffer = await file.arrayBuffer();
	const buffer = Buffer.from(arrayBuffer);
	const base64Data = buffer.toString('base64');
	const imageId = crypto.randomUUID();
	const now = new Date();

	// Split into chunks to guarantee we never exceed D1 SQL statement size limits
	const chunkStatements = [];
	let chunkIndex = 0;
	for (let offset = 0; offset < base64Data.length; offset += CHUNK_CHAR_SIZE) {
		const slice = base64Data.slice(offset, offset + CHUNK_CHAR_SIZE);
		chunkStatements.push(
			db.insert(questionImageChunks).values({
				imageId,
				chunkIndex,
				dataBase64: slice
			})
		);
		chunkIndex += 1;
	}

	const headerStatement = db.insert(questionImages).values({
		id: imageId,
		teacherId,
		mimeType,
		sizeBytes: buffer.length,
		createdAt: now
	});

	await db.batch([headerStatement, ...chunkStatements]);

	return {
		id: imageId,
		url: `/api/images/${imageId}`,
		mimeType,
		sizeBytes: buffer.length
	};
}

export async function getQuestionImageById(
	db: Database,
	imageId: string
): Promise<StoredImageFile | null> {
	const [meta] = await db
		.select()
		.from(questionImages)
		.where(eq(questionImages.id, imageId))
		.limit(1);

	if (!meta) {
		return null;
	}

	const chunks = await db
		.select({
			chunkIndex: questionImageChunks.chunkIndex,
			dataBase64: questionImageChunks.dataBase64
		})
		.from(questionImageChunks)
		.where(eq(questionImageChunks.imageId, imageId))
		.orderBy(asc(questionImageChunks.chunkIndex));

	const fullBase64 = chunks.map((c) => c.dataBase64).join('');
	const buffer = Buffer.from(fullBase64, 'base64');

	return {
		id: meta.id,
		mimeType: meta.mimeType,
		sizeBytes: meta.sizeBytes,
		buffer
	};
}
