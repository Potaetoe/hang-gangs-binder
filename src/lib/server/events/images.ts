/**
 * Event galleries, stored in D1 so a fork needs nothing beyond one
 * database. The per-image cap is the price of that. Bytes are split into
 * fixed chunks and go through the raw binding, never the query builder.
 */

import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db, EventImageRow } from '../db';
import * as table from '../db/schema';
import { runBatch } from '../db';
import { randomToken } from '../crypto';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGES_PER_EVENT = 8;
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
const CHUNK_BYTES = 256 * 1024;

export async function eventImageList(db: Db, eventId: string): Promise<EventImageRow[]> {
	return db
		.select()
		.from(table.eventImages)
		.where(eq(table.eventImages.eventId, eventId))
		.orderBy(asc(table.eventImages.position));
}

/** Image ids per event, in gallery order. */
export async function imageIdsByEvent(
	db: Db,
	eventIds: string[]
): Promise<Record<string, string[]>> {
	const out: Record<string, string[]> = {};
	if (!eventIds.length) return out;
	const rows = await db
		.select({ id: table.eventImages.id, eventId: table.eventImages.eventId })
		.from(table.eventImages)
		.where(inArray(table.eventImages.eventId, eventIds))
		.orderBy(asc(table.eventImages.position));
	for (const row of rows) (out[row.eventId] ??= []).push(row.id);
	return out;
}

/** The files a form really carried: an untouched file input still
 * submits one empty File. */
export const pickedFiles = (form: FormData, name: string): File[] =>
	form.getAll(name).filter((f): f is File => f instanceof File && f.size > 0 && f.name !== '');

/** Stores one image: its row and every chunk in one batch, so a dropped
 * connection never leaves half an image. False when the file is not an
 * image, is too big, or the gallery is full. */
async function addEventImage(
	db: Db,
	d1: D1Database,
	eventId: string,
	file: File
): Promise<boolean> {
	if (!IMAGE_MIMES.includes(file.type) || file.size > MAX_IMAGE_BYTES) return false;
	const existing = await eventImageList(db, eventId);
	if (existing.length >= MAX_IMAGES_PER_EVENT) return false;
	const id = randomToken(16);
	const position = (existing.at(-1)?.position ?? 0) + 1;
	const bytes = await file.arrayBuffer();
	const statements = [
		d1
			.prepare(
				'INSERT INTO event_images (id, event_id, position, mime, size) VALUES (?, ?, ?, ?, ?)'
			)
			.bind(id, eventId, position, file.type, bytes.byteLength)
	];
	for (let seq = 0; seq * CHUNK_BYTES < bytes.byteLength; seq++) {
		statements.push(
			d1
				.prepare('INSERT INTO event_image_chunks (image_id, seq, bytes) VALUES (?, ?, ?)')
				.bind(id, seq, bytes.slice(seq * CHUNK_BYTES, (seq + 1) * CHUNK_BYTES))
		);
	}
	await d1.batch(statements);
	return true;
}

/** One bad file never sinks the rest; the caller reports how many were
 * skipped. */
export async function addEventImages(db: Db, d1: D1Database, eventId: string, files: File[]) {
	let stored = 0;
	for (const file of files) if (await addEventImage(db, d1, eventId, file)) stored += 1;
	return { stored, skipped: files.length - stored };
}

export async function deleteEventImage(db: Db, eventId: string, imageId: string) {
	await runBatch(db, [
		db.delete(table.eventImageChunks).where(eq(table.eventImageChunks.imageId, imageId)),
		db
			.delete(table.eventImages)
			.where(and(eq(table.eventImages.id, imageId), eq(table.eventImages.eventId, eventId)))
	]);
}

/** D1 can hand blob bytes back in more than one shape. */
const asBytes = (value: unknown): Uint8Array => {
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (ArrayBuffer.isView(value))
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	if (Array.isArray(value)) return Uint8Array.from(value as number[]);
	return new Uint8Array(0);
};

/** Streams an image one chunk per read, so a gallery never holds whole
 * images in Worker memory. */
export async function imageResponse(db: Db, d1: D1Database, imageId: string): Promise<Response> {
	const [meta] = await db.select().from(table.eventImages).where(eq(table.eventImages.id, imageId));
	if (!meta) return new Response('Not found', { status: 404 });
	const chunkCount = Math.ceil(meta.size / CHUNK_BYTES);
	let seq = 0;
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (seq >= chunkCount) {
				controller.close();
				return;
			}
			const row = await d1
				.prepare('SELECT bytes FROM event_image_chunks WHERE image_id = ? AND seq = ?')
				.bind(imageId, seq)
				.first<unknown>('bytes');
			seq += 1;
			const bytes = asBytes(row);
			if (!bytes.byteLength) {
				controller.error(new Error('missing image chunk'));
				return;
			}
			controller.enqueue(bytes);
		}
	});
	return new Response(body, {
		headers: { 'Content-Type': meta.mime, 'Content-Length': String(meta.size) }
	});
}
