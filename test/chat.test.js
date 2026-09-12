import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/chat.js';

const env = { ANTHROPIC_API_KEY: 'sk-ant-test', TURNSTILE_SECRET_KEY: 'ts' };
const answer = { reply: 'Combien de personnes travaillent chez vous?', choices: ['Moi seulement', '2 à 10'], done: false,
    summary: { business: '', size: '', challenges: [], situation: '', focus: '' } };

function call(body, opts = {}) {
    const calls = { turnstile: [], anthropic: [] };
    globalThis.fetch = async (url, init) => {
        const u = String(url);
        if (u.includes('turnstile')) { calls.turnstile.push(init); return new Response(JSON.stringify({ success: opts.human !== false }), { status: 200 }); }
        if (u.includes('anthropic.com')) {
            calls.anthropic.push({ headers: init.headers, body: JSON.parse(init.body) });
            if (opts.anthropic) return opts.anthropic();
            return new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5', stop_reason: 'end_turn',
                content: [{ type: 'text', text: JSON.stringify(opts.answer || answer) }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        throw new Error('unexpected fetch ' + u);
    };
    const request = new Request('https://kevinfilteau.com/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Turnstile-Token': 'tok', 'CF-Connecting-IP': '203.0.113.9' }, body: typeof body === 'string' ? body : JSON.stringify(body.messages && !('contact' in body) ? { contact, ...body } : body) });
    return onRequestPost({ request, env: opts.env || env }).then(async (res) => ({ res, body: await res.json(), calls }));
}

const turn = [{ role: 'user', content: 'On vend des pneus à des garages.' }];
const contact = { name: 'Anne', company: 'Pneus inc.', email: 'anne@example.com', phone: '418-555-0199', channel: 'sms' };

test('answers the visitor with the reply, the choices and the done flag', async () => {
    const { res, body, calls } = await call({ messages: turn });
    assert.equal(res.status, 200);
    assert.deepEqual(body, { ...answer, summary: null });
    assert.equal(calls.turnstile.length, 1);
    const req = calls.anthropic[0];
    assert.equal(req.body.model, 'claude-opus-5');
    assert.equal(req.body.fallbacks, 'default');
    assert.match(String(new Headers(req.headers).get('anthropic-beta')), /server-side-fallback-2026-07-01/);
    assert.equal(req.body.output_config.format.type, 'json_schema');
    assert.equal(req.body.output_config.effort, 'low');
    assert.deepEqual(req.body.messages, turn);
    assert.match(typeof req.body.system === 'string' ? req.body.system : JSON.stringify(req.body.system), /assistant/i);
});

test('tells the model to conclude once the visitor has answered six times', async () => {
    const six = [];
    for (let i = 0; i < 6; i++) six.push({ role: 'user', content: 'Réponse ' + i }, { role: 'assistant', content: 'Question ' + i });
    six.pop();
    const { res, calls } = await call({ messages: six });
    assert.equal(res.status, 200);
    const last = calls.anthropic[0].body.messages.at(-1);
    assert.equal(last.role, 'system');
    assert.match(JSON.stringify(last.content), /termin/i);
});

test('refuses a visitor Turnstile does not confirm, without calling the model', async () => {
    const { res, body, calls } = await call({ messages: turn }, { human: false });
    assert.equal(res.status, 403);
    assert.deepEqual(body, { error: 'verification' });
    assert.equal(calls.anthropic.length, 0);
});

for (const [name, messages] of Object.entries({
    'no messages': [],
    'a transcript that starts with the assistant': [{ role: 'assistant', content: 'x' }, { role: 'user', content: 'y' }],
    'a transcript that ends with the assistant': [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }],
    'two user messages in a row': [{ role: 'user', content: 'x' }, { role: 'user', content: 'y' }],
    'an unknown role': [{ role: 'system', content: 'x' }],
    'an empty message': [{ role: 'user', content: '  ' }],
    'a message over 500 characters': [{ role: 'user', content: 'x'.repeat(501) }],
    'more than eight visitor turns': Array.from({ length: 17 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'm' })),
})) {
    test(`rejects ${name} without calling the model`, async () => {
        const { res, body, calls } = await call({ messages });
        assert.equal(res.status, 400, name);
        assert.deepEqual(body, { error: 'invalid' });
        assert.equal(calls.anthropic.length, 0);
    });
}

test('rejects a chat without a valid contact, without calling the model', async () => {
    for (const bad of [{ messages: turn, contact: null }, { messages: turn, contact: { ...contact, phone: '12' } }, { messages: turn, contact: { ...contact, channel: 'fax' } }]) {
        const { res, body, calls } = await call(bad);
        assert.equal(res.status, 400);
        assert.deepEqual(body, { error: 'invalid' });
        assert.equal(calls.anthropic.length, 0);
    }
});

test('rejects a body that is not JSON', async () => {
    const { res, body } = await call('nope');
    assert.equal(res.status, 400);
    assert.deepEqual(body, { error: 'invalid' });
});

test('answers unavailable when the model fails, logging the status only', async () => {
    const logged = [];
    const original = console.error;
    console.error = (...a) => logged.push(a.join(' '));
    try {
        const { res, body } = await call({ messages: turn }, { anthropic: () => new Response('{"type":"error","error":{"type":"authentication_error","message":"bad key sk-ant-test"}}', { status: 401, headers: { 'Content-Type': 'application/json' } }) });
        assert.equal(res.status, 502);
        assert.deepEqual(body, { error: 'unavailable' });
        assert.ok(logged.length >= 1);
        assert.match(logged.join(' '), /401/);
        assert.doesNotMatch(logged.join(' '), /sk-ant-test|pneus/);
    } finally { console.error = original; }
});

test('answers unavailable when the model refuses', async () => {
    const original = console.error;
    console.error = () => {};
    try {
        const { res, body } = await call({ messages: turn }, { anthropic: () => new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5', stop_reason: 'refusal', stop_details: { type: 'refusal', category: null }, content: [], usage: { input_tokens: 1, output_tokens: 0 } }), { status: 200, headers: { 'Content-Type': 'application/json' } }) });
        assert.equal(res.status, 502);
        assert.deepEqual(body, { error: 'unavailable' });
    } finally { console.error = original; }
});

test('answers unavailable when the model answer does not fit the contract', async () => {
    const original = console.error;
    console.error = () => {};
    try {
        const { res } = await call({ messages: turn }, { answer: { reply: 'x' } });
        assert.equal(res.status, 502);
    } finally { console.error = original; }
});

test('keeps at most four choices and returns a summary only when done', async () => {
    const done = { reply: 'Merci.', choices: ['a', 'b', 'c', 'd', 'e'], done: true,
        summary: { business: 'Pneus', size: '11-50', challenges: ['stuck', 'integration'], situation: 'Projet bloqué.', focus: 'Débloquer.' } };
    const { body } = await call({ messages: turn }, { answer: done });
    assert.deepEqual(body.choices, ['a', 'b', 'c', 'd']);
    assert.deepEqual(body.summary, done.summary);
    const notDone = await call({ messages: turn }, { answer: { ...done, done: false } });
    assert.equal(notDone.body.summary, null);
});
