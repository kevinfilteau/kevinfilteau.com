import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyStripeSignature } from '../lib/stripe-signature.js';

const secret = 'whsec_test';
const payload = '{"id":"evt_1","type":"checkout.session.completed"}';
async function sign(t, body, key = secret) {
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${t}.${body}`));
    return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
const now = 1_700_000_000;

test('accepts a fresh signature made with the secret', async () => {
    assert.equal(await verifyStripeSignature(payload, `t=${now},v1=${await sign(now, payload)}`, secret, now), true);
});

test('refuses a tampered payload, a wrong secret, a stale timestamp and a missing header', async () => {
    assert.equal(await verifyStripeSignature(payload + ' ', `t=${now},v1=${await sign(now, payload)}`, secret, now), false);
    assert.equal(await verifyStripeSignature(payload, `t=${now},v1=${await sign(now, payload, 'other')}`, secret, now), false);
    assert.equal(await verifyStripeSignature(payload, `t=${now - 600},v1=${await sign(now - 600, payload)}`, secret, now), false);
    assert.equal(await verifyStripeSignature(payload, null, secret, now), false);
    assert.equal(await verifyStripeSignature(payload, `t=${now},v1=${await sign(now, payload)}`, '', now), false);
});
