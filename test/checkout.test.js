import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/checkout.js';

const answers = {
    summary: { business: 'We sell tires.', size: '11-50', challenges: ['stuck', 'integration'], situation: 'A project is late.', focus: 'Unblock it.' },
    contact: { name: 'Ann', company: 'Tires inc.', email: 'ann@example.com', phone: '418-555-0199', channel: 'sms' }
};

function call(body, fetchImpl, human = true) {
    const calls = [];
    const stripe = fetchImpl || (async (url, init) => {
        calls.push({ url, params: new URLSearchParams(init.body), headers: init.headers });
        return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_test' }), { status: 200 });
    });
    globalThis.fetch = async (url, init) => String(url).includes('turnstile') ? new Response(JSON.stringify({ success: human }), { status: 200 }) : stripe(url, init);
    const request = new Request('https://kevinfilteau.com/api/checkout', {
        method: 'POST', headers: { 'X-Turnstile-Token': 'tok' }, body: typeof body === 'string' ? body : JSON.stringify(body)
    });
    return onRequestPost({ request, env: { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_TEST_SECRET_KEY: 'rk_test_y', TURNSTILE_SECRET_KEY: 'ts' } }).then(async (res) => ({ res, body: await res.json(), calls }));
}

test('creates a Stripe Checkout session and returns its URL', async () => {
    const { res, body, calls } = await call(answers);
    assert.equal(res.status, 200);
    assert.equal(body.url, 'https://checkout.stripe.com/c/pay/cs_test');
    assert.equal(calls[0].url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(calls[0].headers.Authorization, 'Bearer sk_test_x');
    const p = calls[0].params;
    assert.equal(p.get('mode'), 'payment');
    assert.equal(p.get('line_items[0][price_data][unit_amount]'), '25000');
    assert.equal(p.get('line_items[0][price_data][currency]'), 'cad');
    assert.equal(p.get('line_items[0][price_data][tax_behavior]'), 'exclusive');
    assert.equal(p.get('automatic_tax[enabled]'), 'true');
    assert.equal(p.get('allow_promotion_codes'), null);
    assert.equal(p.get('locale'), 'fr-CA');
    assert.equal(p.get('customer_email'), 'ann@example.com');
    assert.equal(p.get('success_url'), 'https://kevinfilteau.com/reserver/merci/');
    assert.equal(p.get('cancel_url'), 'https://kevinfilteau.com/reserver/');
    assert.match(p.get('line_items[0][price_data][product_data][name]'), /Consultation/);
    assert.match(p.get('custom_text[submit][message]'), /30 minutes/);
});

test('sends nothing but the billing email to Stripe: no metadata on the session or the payment', async () => {
    const { calls } = await call(answers);
    const keys = Array.from(calls[0].params.keys());
    assert.equal(keys.some((k) => k.startsWith('metadata') || k.includes('metadata')), false);
    assert.equal(calls[0].params.get('customer_email'), 'ann@example.com');
});

test('rejects a body that is not JSON', async () => {
    const { res, body, calls } = await call('not json');
    assert.equal(res.status, 400);
    assert.equal(body.error, 'invalid');
    assert.equal(calls.length, 0);
});

for (const [name, patch] of Object.entries({
    'no contact': { contact: null },
    'missing email': { contact: { ...answers.contact, email: '' } },
    'malformed email': { contact: { ...answers.contact, email: 'ann' } },
    'bad phone': { contact: { ...answers.contact, phone: '123' } },
    'unknown channel': { contact: { ...answers.contact, channel: 'fax' } },
    'no summary': { summary: null },
    'unknown size': { summary: { ...answers.summary, size: 'huge' } },
    'unknown challenge': { summary: { ...answers.summary, challenges: ['stuck', 'aliens'] } },
    'empty business': { summary: { ...answers.summary, business: '  ' } },
    'business too long': { summary: { ...answers.summary, business: 'x'.repeat(501) } },
    'situation too long': { summary: { ...answers.summary, situation: 'x'.repeat(501) } },
    'focus too long': { summary: { ...answers.summary, focus: 'x'.repeat(501) } },
    'name too long': { contact: { ...answers.contact, name: 'x'.repeat(101) } },
    'no challenge picked': { summary: { ...answers.summary, challenges: [] } },
    'challenges not a list': { summary: { ...answers.summary, challenges: 'stuck' } },
})) {
    test(`rejects ${name} without calling Stripe`, async () => {
        const { res, body, calls } = await call({ ...answers, ...patch });
        assert.equal(res.status, 400, name);
        assert.equal(body.error, 'invalid');
        assert.equal(calls.length, 0);
    });
}

test('keeps the lead in KV under the session id for the webhook and the reminder', async () => {
    const store = new Map();
    globalThis.fetch = async (url, init) => String(url).includes('turnstile') ? new Response('{"success":true}', { status: 200 })
        : new Response(JSON.stringify({ id: 'cs_live_42', url: 'https://checkout.stripe.com/c/pay/cs_live_42' }), { status: 200 });
    const request = new Request('https://kevinfilteau.com/api/checkout', { method: 'POST', headers: { 'X-Turnstile-Token': 'tok' }, body: JSON.stringify(answers) });
    const res = await onRequestPost({ request, env: { STRIPE_SECRET_KEY: 'sk', TURNSTILE_SECRET_KEY: 'ts', LEADS: { put: async (k, v, o) => { store.set(k, { v: JSON.parse(v), o }); } } } });
    assert.equal(res.status, 200);
    const saved = store.get('cs_live_42');
    assert.equal(saved.v.sessionId, 'cs_live_42');
    assert.equal(saved.v.email, 'ann@example.com');
    assert.equal(saved.v.phone, '+14185550199');
    assert.equal(saved.v.situation, 'A project is late.');
    assert.equal(saved.v.paid, false);
    assert.equal(saved.o.expirationTtl, 7 * 24 * 3600);
});

test('uses the Stripe test key when the page asks for test mode, the live key otherwise', async () => {
    assert.equal((await call({ ...answers, test: true })).calls[0].headers.Authorization, 'Bearer rk_test_y');
    assert.equal((await call({ ...answers, test: 'yes' })).calls[0].headers.Authorization, 'Bearer sk_test_x');
    assert.equal((await call(answers)).calls[0].headers.Authorization, 'Bearer sk_test_x');
});

test('refuses test mode when no test key is configured, instead of charging for real', async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => { if (String(url).includes('turnstile')) return new Response('{"success":true}', { status: 200 }); calls.push(url); return new Response('{}', { status: 200 }); };
    const request = new Request('https://kevinfilteau.com/api/checkout', { method: 'POST', headers: { 'X-Turnstile-Token': 'tok' }, body: JSON.stringify({ ...answers, test: true }) });
    const res = await onRequestPost({ request, env: { STRIPE_SECRET_KEY: 'sk_live', TURNSTILE_SECRET_KEY: 'ts' } });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: 'unavailable' });
    assert.equal(calls.length, 0);
});

test('refuses a visitor Turnstile does not confirm, without calling Stripe', async () => {
    const { res, body, calls } = await call(answers, null, false);
    assert.equal(res.status, 403);
    assert.deepEqual(body, { error: 'verification' });
    assert.equal(calls.length, 0);
});

test('reports a Stripe failure without exposing details or personal data', async () => {
    const logged = [];
    const original = console.error;
    console.error = (...args) => logged.push(args.join(' '));
    try {
        const { res, body } = await call(answers, async () => new Response('{"error":{"message":"bad key ann@example.com"}}', { status: 401 }));
        assert.equal(res.status, 502);
        assert.deepEqual(body, { error: 'unavailable' });
        assert.equal(logged.length, 1);
        assert.match(logged[0], /401/);
        assert.doesNotMatch(logged.join(' '), /ann@example\.com|Ann/);
    } finally {
        console.error = original;
    }
});

test('reports a network failure the same way', async () => {
    const original = console.error;
    console.error = () => {};
    try {
        const { res, body } = await call(answers, async () => { throw new Error('boom ann@example.com'); });
        assert.equal(res.status, 502);
        assert.deepEqual(body, { error: 'unavailable' });
    } finally {
        console.error = original;
    }
});
