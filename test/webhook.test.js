import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../functions/api/stripe-webhook.js';

const secret = 'whsec_test';
const lead = { sessionId: 'cs_live_1', name: 'Anne', company: 'Pneus inc.', email: 'anne@example.com', phone: '+14185550199', channel: 'sms',
    business: 'Pneus.', size: '11-50', challenges: ['stuck'], situation: 'Projet en retard.', focus: 'Débloquer.' };

function kv(initial = {}) {
    const store = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
    return { store, get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); } };
}

async function deliver(type, object, env, deps, opts = {}) {
    const body = JSON.stringify({ id: 'evt_1', type, data: { object } });
    const t = Math.floor(Date.now() / 1000);
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(opts.secret || secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${t}.${body}`)))).map((b) => b.toString(16).padStart(2, '0')).join('');
    const request = new Request('https://kevinfilteau.com/api/stripe-webhook', { method: 'POST', headers: { 'Stripe-Signature': `t=${t},v1=${sig}` }, body });
    return handler(deps)({ request, env: { STRIPE_WEBHOOK_SECRET: secret, ...env } });
}

function fakes() {
    const sent = { mail: [], sms: [] };
    return { sent, deps: { sendMail: async (env, m) => { sent.mail.push(m); }, sendSms: async (env, to, text) => { sent.sms.push({ to, text }); } } };
}

test('a paid session sends the confirmation to the visitor and a copy to Kevin, then marks the lead paid', async () => {
    const { sent, deps } = fakes();
    const LEADS = kv({ cs_live_1: lead });
    const res = await deliver('checkout.session.completed', { id: 'cs_live_1' }, { LEADS }, deps);
    assert.equal(res.status, 200);
    assert.equal(sent.mail.length, 2);
    const [visitor, kevin] = sent.mail;
    assert.equal(visitor.to, 'anne@example.com');
    assert.match(visitor.subject, /réservé/i);
    // Same words as the booking page: a meeting, not an hour sold.
    assert.match(visitor.subject, /votre rencontre avec Kevin Filteau/);
    assert.match(visitor.text, /Votre rencontre d’une heure est réservée/);
    assert.doesNotMatch(visitor.text, /L’heure devrait/);
    assert.match(visitor.text, /Anne/);
    assert.match(visitor.text, /texto/);
    assert.match(visitor.text, /Projet en retard/);
    assert.equal(kevin.to, 'info@kevinfilteau.com');
    assert.match(kevin.subject, /Paiement reçu/);
    assert.match(kevin.text, /Pneus inc\./);
    assert.match(kevin.text, /cs_live_1/);
    assert.match(kevin.text, /\+14185550199/);
    assert.equal(JSON.parse(LEADS.store.get('cs_live_1')).paid, true);
});

test('a second delivery of the same paid session sends nothing', async () => {
    const { sent, deps } = fakes();
    const LEADS = kv({ cs_live_1: { ...lead, paid: true } });
    const res = await deliver('checkout.session.completed', { id: 'cs_live_1' }, { LEADS }, deps);
    assert.equal(res.status, 200);
    assert.equal(sent.mail.length, 0);
});

test('a paid session without a stored lead only tells Kevin, since Stripe holds no answers', async () => {
    const { sent, deps } = fakes();
    const session = { id: 'cs_live_9', customer_details: { email: 'bob@example.com' } };
    const res = await deliver('checkout.session.completed', session, { LEADS: kv() }, deps);
    assert.equal(res.status, 200);
    assert.equal(sent.mail.length, 1);
    assert.equal(sent.mail[0].to, 'info@kevinfilteau.com');
    assert.match(sent.mail[0].text, /cs_live_9|bob@example\.com/);
});

test('an expired unpaid session sends the reminder by text when the visitor chose sms', async () => {
    const { sent, deps } = fakes();
    const LEADS = kv({ cs_live_1: lead });
    const res = await deliver('checkout.session.expired', { id: 'cs_live_1' }, { LEADS }, deps);
    assert.equal(res.status, 200);
    assert.equal(sent.mail.length, 0);
    assert.equal(sent.sms.length, 1);
    assert.equal(sent.sms[0].to, '+14185550199');
    assert.match(sent.sms[0].text, /https:\/\/kevinfilteau\.com\/reserver\/\?resume=cs_live_1/);
    assert.equal(JSON.parse(LEADS.store.get('cs_live_1')).reminded, true);
});

test('an expired unpaid session sends the reminder by email when the visitor chose email', async () => {
    const { sent, deps } = fakes();
    const res = await deliver('checkout.session.expired', { id: 'cs_live_1' }, { LEADS: kv({ cs_live_1: { ...lead, channel: 'email' } }) }, deps);
    assert.equal(res.status, 200);
    assert.equal(sent.sms.length, 0);
    assert.equal(sent.mail.length, 1);
    assert.equal(sent.mail[0].to, 'anne@example.com');
    assert.match(sent.mail[0].text, /resume=cs_live_1/);
});

test('an expired session that was paid, already reminded or unknown sends nothing', async () => {
    for (const store of [{ cs_live_1: { ...lead, paid: true } }, { cs_live_1: { ...lead, reminded: true } }, {}]) {
        const { sent, deps } = fakes();
        const res = await deliver('checkout.session.expired', { id: 'cs_live_1' }, { LEADS: kv(store) }, deps);
        assert.equal(res.status, 200);
        assert.equal(sent.mail.length + sent.sms.length, 0);
    }
});

test('a bad signature is refused without touching anything', async () => {
    const { sent, deps } = fakes();
    const res = await deliver('checkout.session.completed', { id: 'cs_live_1' }, { LEADS: kv({ cs_live_1: lead }) }, deps, { secret: 'whsec_other' });
    assert.equal(res.status, 400);
    assert.equal(sent.mail.length, 0);
});

test('a send failure answers 500 so Stripe retries, logging no personal data', async () => {
    const logged = [];
    const original = console.error;
    console.error = (...a) => logged.push(a.join(' '));
    try {
        const deps = { sendMail: async () => { throw new Error('smtp down anne@example.com'); }, sendSms: async () => {} };
        const res = await deliver('checkout.session.completed', { id: 'cs_live_1' }, { LEADS: kv({ cs_live_1: lead }) }, deps);
        assert.equal(res.status, 500);
        assert.ok(logged.length >= 1);
        assert.doesNotMatch(logged.join(' '), /anne@example\.com/);
    } finally { console.error = original; }
});
