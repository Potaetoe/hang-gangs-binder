/**
 * The crypto behind the privacy model. WebCrypto only, so it runs the
 * same on Workers and anywhere else.
 */

const enc = new TextEncoder();

export function randomToken(bytes = 32): string {
	return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function hex(buf: Uint8Array | ArrayBuffer): string {
	return [...new Uint8Array(buf as ArrayBuffer & Uint8Array)]
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

export async function sha256Hex(text: string): Promise<string> {
	return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

/** Only for the breached-password lookup, which is defined in SHA-1.
 * Nothing here authenticates with it. */
export async function sha1Hex(text: string): Promise<string> {
	return hex(await crypto.subtle.digest('SHA-1', enc.encode(text)));
}

/** One-way scramble of an identity, e.g. hmacHex(ID_SECRET, "telegram:123"). */
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
 * AES-GCM ciphertext is as long as its plaintext, and against a roster
 * of twenty people a length is often a name. Padding every record to a
 * block boundary hides it.
 */
const PAD_BLOCK = 256;

/** base64(iv || ciphertext). Pads with spaces, so trailing whitespace
 * does not survive the round trip; the JSON this carries has none. */
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

/** Throws on a wrong secret or a tampered record. */
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
 * OWASP asks for 600k PBKDF2-SHA256 iterations, but Workers refuse any
 * count above 100k. Six chained passes of 100k, each feeding its output
 * back in as the password, cost an attacker the same 600k HMACs per
 * guess. The stored string names its scheme, so older hashes still
 * verify.
 */
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_ROUNDS = 6;

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

async function deriveChained(
	password: string,
	salt: Uint8Array,
	iterations: number,
	rounds: number
): Promise<Uint8Array> {
	let out = await derive(password, salt, iterations);
	for (let i = 1; i < rounds; i += 1) {
		out = await derive(hex(out), salt, iterations);
	}
	return out;
}

export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const derived = await deriveChained(password, salt, PBKDF2_ITERATIONS, PBKDF2_ROUNDS);
	return `pbkdf2x${PBKDF2_ROUNDS}:${PBKDF2_ITERATIONS}:${hex(salt)}:${hex(derived)}`;
}

/** True for a hash under an older, cheaper scheme. Re-hashing those on
 * sign-in brings every hash to one cost, which is what keeps the decoy
 * below indistinguishable from a real account. */
export function needsRehash(stored: string): boolean {
	const [scheme, iterations] = stored.split(':');
	return scheme !== `pbkdf2x${PBKDF2_ROUNDS}` || Number(iterations) !== PBKDF2_ITERATIONS;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const [scheme, iterations, saltHex, hashHex] = stored.split(':');
	// 'pbkdf2' is the original single pass; 'pbkdf2xN' chains N.
	const rounds = scheme === 'pbkdf2' ? 1 : Number(/^pbkdf2x(\d+)$/.exec(scheme ?? '')?.[1]);
	if (!Number.isInteger(rounds) || rounds < 1 || rounds > 64) return false;
	const salt = Uint8Array.from(saltHex.match(/.{2}/g) ?? [], (pair) => parseInt(pair, 16));
	const derived = await deriveChained(password, salt, Number(iterations), rounds);
	return timingSafeEqual(hex(derived), hashHex);
}

/** Verified against when no account matches, so "no such user" costs
 * the same time as "wrong password" and the door gives nothing away. */
export const DECOY_HASH = `pbkdf2x${PBKDF2_ROUNDS}:${PBKDF2_ITERATIONS}:${'00'.repeat(16)}:${'00'.repeat(32)}`;

export function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}
