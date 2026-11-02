import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** The opaque value that goes in the cookie. 256 bits of entropy. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Sessions are keyed by the hash, never the token itself, so a leaked database
 * dump can't be replayed as a live session.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time compare, for CSRF-style token checks. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
