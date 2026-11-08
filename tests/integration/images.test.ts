import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Database } from '../../src/lib/server/db/client.js';
import { questionImageChunks, questionImages, teachers } from '../../src/lib/server/db/schema.js';
import {
	getQuestionImageById,
	MAX_IMAGE_FILE_SIZE_BYTES,
	saveUploadedQuestionImage
} from '../../src/lib/server/images/service.js';

interface PlatformProxy {
	env: { DB: D1Database };
	dispose: () => Promise<void>;
}

type GetPlatformProxy = (options?: {
	configPath?: string;
	persist?: boolean;
}) => Promise<PlatformProxy>;

const require = createRequire(import.meta.url);
const { getPlatformProxy } = require('wrangler') as {
	getPlatformProxy: GetPlatformProxy;
};

function migrationStatements(): string[] {
	const directory = join(process.cwd(), 'migrations');
	return readdirSync(directory)
		.filter((file) => file.endsWith('.sql'))
		.toSorted()
		.flatMap((file) =>
			readFileSync(join(directory, file), 'utf8')
				.split('--> statement-breakpoint')
				.map((statement) => statement.trim())
				.filter(Boolean)
		);
}

describe('question images integration', () => {
	let proxy: PlatformProxy;
	let db: Database;
	let teacherId: string;

	beforeAll(async () => {
		proxy = await getPlatformProxy({ persist: false });
		db = createDb(proxy.env.DB);
		for (const statement of migrationStatements()) {
			await proxy.env.DB.prepare(statement).run();
		}
	}, 30_000);

	afterAll(async () => {
		await proxy?.dispose();
	});

	beforeEach(async () => {
		await db.delete(questionImageChunks);
		await db.delete(questionImages);
		await db.delete(teachers);

		teacherId = crypto.randomUUID();
		await db.insert(teachers).values({
			id: teacherId,
			email: 'photo.teacher@quizky.test',
			passwordHash: 'dummy-hash',
			displayName: 'Photo Teacher',
			createdAt: new Date(),
			updatedAt: new Date()
		});
	});

	it('saves, chunks, and retrieves an uploaded image correctly', async () => {
		// Generate an image buffer larger than 1 chunk (> 45KB) to test chunking
		const testBytes = new Uint8Array(100 * 1024);
		for (let i = 0; i < testBytes.length; i += 1) {
			testBytes[i] = i % 256;
		}

		const file = new File([testBytes], 'diagram.png', { type: 'image/png' });
		const uploaded = await saveUploadedQuestionImage(db, teacherId, file);

		expect(uploaded.id).toBeDefined();
		expect(uploaded.url).toBe(`/api/images/${uploaded.id}`);
		expect(uploaded.mimeType).toBe('image/png');
		expect(uploaded.sizeBytes).toBe(testBytes.length);

		// Retrieve and check bit-for-bit integrity
		const retrieved = await getQuestionImageById(db, uploaded.id);
		expect(retrieved).not.toBeNull();
		expect(retrieved?.mimeType).toBe('image/png');
		expect(retrieved?.sizeBytes).toBe(testBytes.length);
		expect(Buffer.compare(retrieved!.buffer, Buffer.from(testBytes))).toBe(0);
	});

	it('rejects unsupported image types', async () => {
		const pdfFile = new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' });
		await expect(saveUploadedQuestionImage(db, teacherId, pdfFile)).rejects.toMatchObject({
			status: 415,
			code: 'unsupported_media_type'
		});
	});

	it('rejects oversized files', async () => {
		const hugeBytes = new Uint8Array(MAX_IMAGE_FILE_SIZE_BYTES + 1024);
		const hugeFile = new File([hugeBytes], 'huge.png', { type: 'image/png' });

		await expect(saveUploadedQuestionImage(db, teacherId, hugeFile)).rejects.toMatchObject({
			status: 413,
			code: 'image_too_large'
		});
	});

	it('returns null for nonexistent image id', async () => {
		const result = await getQuestionImageById(db, crypto.randomUUID());
		expect(result).toBeNull();
	});
});
