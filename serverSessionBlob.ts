import zlib from 'zlib';

/**
 * Packing for the WhatsApp session state stored in Firestore.
 *
 * Firestore hard-caps a document at ~1MB. Baileys' auth state grows past that
 * (the failed write logged exactly "longer than 1048487 bytes"), so storing the raw
 * JSON in one field silently corrupted the session: the socket worked while alive in
 * memory, and the next reconnect — reading the half-saved state — got rejected by
 * WhatsApp with 403s forever. That failure mode was THE root cause of the recurring
 * "WhatsApp keeps disconnecting" pain.
 *
 * Fix: gzip the JSON (3-6x smaller — it is repetitive base64-heavy JSON) and split the
 * result into chunks that individually fit a document with ample margin. Reading joins
 * the chunks and gunzips. Both directions are pure functions, unit-tested.
 */

export const AUTH_BLOB_VERSION = 2;

/** Max characters of base64 per Firestore document — well under the ~1MB cap. */
export const AUTH_CHUNK_CHARS = 900_000;

/** JSON string -> gzip -> base64 -> chunks, each guaranteed to fit a document. */
export function packAuthBlob(json: string): string[] {
  const b64 = zlib.gzipSync(Buffer.from(json, 'utf8')).toString('base64');
  const parts: string[] = [];
  for (let i = 0; i < b64.length; i += AUTH_CHUNK_CHARS) {
    parts.push(b64.slice(i, i + AUTH_CHUNK_CHARS));
  }
  return parts;
}

/** Chunks (in order) -> original JSON string. Throws on corrupt/missing data. */
export function unpackAuthBlob(parts: string[]): string {
  return zlib.gunzipSync(Buffer.from(parts.join(''), 'base64')).toString('utf8');
}
