/**
 * The small crypto kit behind DESIGN.md's privacy model, WebCrypto
 * only - it runs identically on Workers and in tests.
 */

const enc = new TextEncoder();

export function randomToken(bytes = 32): string {
	const buf = crypto.getRandomValues(new Uint8Array(bytes));
	return hex(buf);
}

export function hex(buf: Uint8Array | ArrayBuffer): string {
	return [...new Uint8Array(buf as ArrayBuffer & Uint8Array)]
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

export async function sha256Hex(text: string): Promise<string> {
	return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

/** SHA-1, and ONLY for the breached-password range lookup, which is
 * defined in terms of it. Nothing here authenticates anything. */
export async function sha1Hex(text: string): Promise<string> {
	return hex(await crypto.subtle.digest('SHA-1', enc.encode(text)));
}

/** One-way identity scramble: hmacHex(ID_SECRET, "telegram:123"). */
export async function hmacHex(secret: string, value: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		enc.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	return hex(await crypto.subtle.sign('HMAC', key, enc.encode(value)));
}

async function aesKey(secret: string): Promise<CryptoKey> {
	const material = await crypto.subtle.digest('SHA-256', enc.encode(secret));
	return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, [
		'encrypt',
		'decrypt'
	]);
}

/**
 * AES-GCM is a stream cipher: the ciphertext is exactly as long as the
 * plaintext. Unpadded, a sealed row would publish the combined length
 * of someone's handle and display name - and against a known roster of
 * twenty people, a length is often a name (security pass, 2026-08-24).
 * Padding every record up to the same size takes that away.
 */
const PAD_BLOCK = 256;

/** Seal a directory record: base64(iv || ciphertext), length-hidden.
 * The plaintext is padded with spaces, so trailing whitespace does not
 * survive a round trip - fine for the JSON this carries. */
export async function seal(secret: string, plaintext: string): Promise<string> {
	const padded = plaintext.padEnd(Math.ceil((plaintext.length + 1) / PAD_BLOCK) * PAD_BLOCK, ' ');
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await aesKey(secret);
	const sealed = new Uint8Array(
		await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(padded))
	);
	const joined = new Uint8Array(iv.length + sealed.length);
	joined.set(iv);
	joined.set(sealed, iv.length);
	return btoa(String.fromCharCode(...joined));
}

/** Open a sealed record; throws on tamper or a wrong secret. */
export async function open(secret: string, sealedText: string): Promise<string> {
	const joined = Uint8Array.from(atob(sealedText), (c) => c.charCodeAt(0));
	const key = await aesKey(secret);
	const plain = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: joined.slice(0, 12) },
		key,
		joined.slice(12)
	);
	return new TextDecoder().decode(plain).trimEnd();
}

/**
 * PBKDF2-SHA256 at OWASP's current floor (security pass, 2026-08-24 -
 * the old 100k predated it). The cost is paid once per sign-in and
 * measured against the Workers CPU budget before it shipped.
 *
 * Old hashes keep working: verifyPassword reads the iteration count
 * out of the stored string, so a password set under the old number
 * still opens and is re-hashed at the new one when its owner next
 * changes it.
 */
const PBKDF2_ITERATIONS = 600_000;

export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const derived = await derive(password, salt, PBKDF2_ITERATIONS);
	return `pbkdf2:${PBKDF2_ITERATIONS}:${hex(salt)}:${hex(derived)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const [scheme, iterations, saltHex, hashHex] = stored.split(':');
	if (scheme !== 'pbkdf2') return false;
	const salt = Uint8Array.from(saltHex.match(/.{2}/g) ?? [], (pair) => parseInt(pair, 16));
	const derived = await derive(password, salt, Number(iterations));
	return timingSafeEqual(hex(derived), hashHex);
}

async function derive(password: string, salt: Uint8Array, iterations: number) {
	const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
		'deriveBits'
	]);
	return new Uint8Array(
		await crypto.subtle.deriveBits(
			{ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
			key,
			256
		)
	);
}

/**
 * A decoy hash, used when no account matches the typed username. The
 * door has always given one answer for "no such user" and "wrong
 * password" - but it used to give the first one faster, because only
 * the second paid for PBKDF2. Verifying against this makes both cost
 * the same (security pass, 2026-08-24).
 */
export const DECOY_HASH = `pbkdf2:${PBKDF2_ITERATIONS}:${'00'.repeat(16)}:${'00'.repeat(32)}`;

export function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}
