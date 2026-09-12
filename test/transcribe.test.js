import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost, onRequestGet } from '../functions/api/transcribe.js';

const env = { NARAMACHINE_TRANSCRIBE_URL: 'https://door.naramachine.ai/chute/transcribe', NARAMACHINE_API_KEY: 'nk_test' };
const audio = new Uint8Array(4096).fill(1);

function call(body, type, fetchImpl, e = env) {
    const calls = [];
    globalThis.fetch = fetchImpl || (async (url, init) => {
        calls.push({ url, init, bytes: new Uint8Array(await new Response(init.body).arrayBuffer()) });
        return new Response(JSON.stringify({ text: ' Nous vendons des pneus. ' }), { status: 200 });
    });
    const request = new Request('https://kevinfilteau.com/api/transcribe', { method: 'POST', headers: type ? { 'Content-Type': type } : {}, body });
    return onRequestPost({ request, env: e }).then(async (res) => ({ res, body: await res.json(), calls }));
}

test('forwards the clip to NaraMachine and returns the trimmed text', async () => {
    const { res, body, calls } = await call(audio, 'audio/webm;codecs=opus');
    assert.equal(res.status, 200);
    assert.deepEqual(body, { text: 'Nous vendons des pneus.' });
    assert.equal(calls[0].url, env.NARAMACHINE_TRANSCRIBE_URL);
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer nk_test');
    assert.equal(calls[0].init.headers['Content-Type'], 'audio/webm;codecs=opus');
    assert.deepEqual(calls[0].bytes, audio);
});

test('GET says whether the engine is configured', async () => {
    assert.equal((await onRequestGet({ env })).status, 204);
    assert.equal((await onRequestGet({ env: {} })).status, 404);
});

test('answers unavailable when the engine is not configured, without calling it', async () => {
    const { res, body, calls } = await call(audio, 'audio/webm', null, {});
    assert.equal(res.status, 503);
    assert.deepEqual(body, { error: 'unavailable' });
    assert.equal(calls.length, 0);
});

for (const [name, [clip, type]] of Object.entries({
    'a non-audio type': [audio, 'text/plain'],
    'no type': [audio, null],
    'a clip too small to be speech': [new Uint8Array(100), 'audio/webm'],
    'a clip over the size cap': [new Uint8Array(10 * 1024 * 1024 + 1), 'audio/webm'],
})) {
    test(`rejects ${name} without calling NaraMachine`, async () => {
        const { res, body, calls } = await call(clip, type);
        assert.equal(res.status, name.includes('cap') ? 413 : 400);
        assert.equal(body.error, 'invalid');
        assert.equal(calls.length, 0);
    });
}

test('reports an engine failure with the status only', async () => {
    const logged = [];
    const original = console.error;
    console.error = (...a) => logged.push(a.join(' '));
    try {
        const { res, body } = await call(audio, 'audio/mp4', async () => new Response('{"detail":"secret nk_test leaked"}', { status: 500 }));
        assert.equal(res.status, 502);
        assert.deepEqual(body, { error: 'unavailable' });
        assert.equal(logged.length, 1);
        assert.match(logged[0], /500/);
        assert.doesNotMatch(logged[0], /nk_test|leaked/);
    } finally { console.error = original; }
});

test('reports a malformed engine answer the same way', async () => {
    const original = console.error;
    console.error = () => {};
    try {
        const { res, body } = await call(audio, 'audio/mp4', async () => new Response('{"foo":1}', { status: 200 }));
        assert.equal(res.status, 502);
        assert.deepEqual(body, { error: 'unavailable' });
    } finally { console.error = original; }
});
