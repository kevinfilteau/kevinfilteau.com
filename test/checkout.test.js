import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/checkout.js';

const answers = {
    business: 'We sell tires.', size: '11-50',
    challenges: ['stuck', 'integration'], other: '', name: 'Ann', email: 'ann@example.com'
};

function call(body, fetchImpl) {
    const calls = [];
    globalThis.fetch = fetchImpl || (async (url, init) => {
        calls.push({ url, params: new URLSearchParams(init.body), headers: init.headers });
        return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_test' }), { status: 200 });
    });
    const request = new Request('https://kevinfilteau.com/api/checkout', {
        method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body)
    });
    return onRequestPost({ request, env: { STRIPE_SECRET_KEY: 'sk_test_x' } }).then(async (res) => ({ res, body: await res.json(), calls }));
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
    assert.equal(p.get('locale'), 'fr-CA');
    assert.equal(p.get('customer_email'), 'ann@example.com');
    assert.equal(p.get('success_url'), 'https://kevinfilteau.com/reserver/merci/');
    assert.equal(p.get('cancel_url'), 'https://kevinfilteau.com/reserver/');
    assert.match(p.get('line_items[0][price_data][product_data][name]'), /Consultation/);
    assert.match(p.get('custom_text[submit][message]'), /30 minutes/);
});

test('puts every answer in the metadata of the session and of the payment', async () => {
    const { calls } = await call(answers);
    const p = calls[0].params;
    for (const scope of ['metadata', 'payment_intent_data[metadata]']) {
        assert.equal(p.get(`${scope}[business]`), 'We sell tires.');
        assert.equal(p.get(`${scope}[size]`), '11-50');
        assert.equal(p.get(`${scope}[challenges]`), 'stuck, integration');
        assert.equal(p.get(`${scope}[name]`), 'Ann');
    }
});

test('rejects a body that is not JSON', async () => {
    const { res, body, calls } = await call('not json');
    assert.equal(res.status, 400);
    assert.equal(body.error, 'invalid');
    assert.equal(calls.length, 0);
});

for (const [name, patch] of Object.entries({
    'missing email': { email: '' },
    'malformed email': { email: 'ann' },
    'unknown size': { size: 'huge' },
    'unknown challenge': { challenges: ['stuck', 'aliens'] },
    'empty business': { business: '  ' },
    'business too long': { business: 'x'.repeat(501) },
    'other too long': { other: 'x'.repeat(501) },
    'name too long': { name: 'x'.repeat(101) },
    'no challenge picked': { challenges: [] },
    'challenges not a list': { challenges: 'stuck' },
})) {
    test(`rejects ${name} without calling Stripe`, async () => {
        const { res, body, calls } = await call({ ...answers, ...patch });
        assert.equal(res.status, 400, name);
        assert.equal(body.error, 'invalid');
        assert.equal(calls.length, 0);
    });
}

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
