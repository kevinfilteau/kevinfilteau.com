import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyTurnstile } from '../lib/turnstile.js';

const env = { TURNSTILE_SECRET_KEY: 'ts_secret' };

function mock(status, body) {
    const calls = [];
    globalThis.fetch = async (url, init) => { calls.push({ url, params: new URLSearchParams(init.body) }); return new Response(JSON.stringify(body), { status }); };
    return calls;
}

test('accepts a token Cloudflare confirms, sending the secret, the token and the ip', async () => {
    const calls = mock(200, { success: true });
    assert.equal(await verifyTurnstile(env, 'tok', '203.0.113.9'), true);
    assert.equal(calls[0].url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    assert.equal(calls[0].params.get('secret'), 'ts_secret');
    assert.equal(calls[0].params.get('response'), 'tok');
    assert.equal(calls[0].params.get('remoteip'), '203.0.113.9');
});

test('refuses a token Cloudflare rejects', async () => {
    mock(200, { success: false, 'error-codes': ['invalid-input-response'] });
    assert.equal(await verifyTurnstile(env, 'tok', null), false);
});

test('refuses without calling Cloudflare when the token or the secret is missing', async () => {
    const calls = mock(200, { success: true });
    assert.equal(await verifyTurnstile(env, '', null), false);
    assert.equal(await verifyTurnstile({}, 'tok', null), false);
    assert.equal(calls.length, 0);
});

test('refuses when Cloudflare is unreachable', async () => {
    globalThis.fetch = async () => { throw new Error('boom'); };
    assert.equal(await verifyTurnstile(env, 'tok', null), false);
});
