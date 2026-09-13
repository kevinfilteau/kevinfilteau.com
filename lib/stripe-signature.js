// Checks the Stripe-Signature header of a webhook delivery: HMAC-SHA256 of "t.payload"
// with the endpoint secret, and the timestamp within five minutes. No SDK.
const TOLERANCE = 300;

const hex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');

export async function verifyStripeSignature(payload, header, secret, now = Math.floor(Date.now() / 1000)) {
    if (!header || !secret) return false;
    const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
    const t = Number(parts.t);
    if (!t || !parts.v1 || Math.abs(now - t) > TOLERANCE) return false;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`)));
    if (expected.length !== parts.v1.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ parts.v1.charCodeAt(i);
    return diff === 0;
}
