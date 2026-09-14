// Turns the booking form answers into a Stripe Checkout session.
// Stripe sees only the billing contact it collects itself; the answers go to KV
// for the webhook and the reminder, and reach Kevin by email once paid.
// Calls the Stripe REST API directly: no dependency, no build step.
// Needs STRIPE_SECRET_KEY and TURNSTILE_SECRET_KEY as encrypted variables on the
// Pages project (and in .dev.vars for `wrangler pages dev`). With STRIPE_TEST_SECRET_KEY
// set, a body with `test: true` runs Checkout in Stripe test mode: the page sends it when
// the visitor opened the site with ?dev=1. Test cards pay, no money moves.

import { human } from '../../lib/turnstile.js';
import { SIZES, CHALLENGES } from './chat.js';
import { validateContact } from '../../lib/contact.js';
import { sendMail, notice, KEVIN } from '../../lib/notify.js';

const PRICE = { currency: 'cad', unit_amount: 25000 };
const TEXT_MAX = 500; // Stripe caps a metadata value at 500 characters.

const CHECKOUT = {
    locale: 'fr-CA',
    product: 'Consultation d’une heure avec Kevin Filteau',
    success: '/reserver/merci/',
    cancel: '/reserver/',
    refund: 'Remboursable à 100 %. Si après 30 minutes vous ne voyez pas comment je peux vous aider, on arrête et je vous rembourse. Si vous estimez que je ne vous ai pas aidé, dites-le-moi dans les 7 jours suivant la rencontre et je vous rembourse en entier. Sans question.'
};

const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max ? v.trim() : null;

// Returns the cleaned answers, or null when anything is missing or out of range.
// The summary is what the assistant produced at the end of the chat.
function validate(b) {
    const s = b && typeof b === 'object' && b.summary && typeof b.summary === 'object' ? b.summary : null;
    if (!s) return null;
    const business = text(s.business, TEXT_MAX);
    const size = SIZES.includes(s.size) ? s.size : null;
    const challenges = Array.isArray(s.challenges) && s.challenges.length > 0 && s.challenges.every((c) => CHALLENGES.includes(c)) ? s.challenges : null;
    const situation = text(s.situation, TEXT_MAX);
    const focus = s.focus === '' || s.focus == null ? '' : text(s.focus, TEXT_MAX);
    const contact = validateContact(b.contact);
    if (!business || !size || !challenges || !situation || focus === null || !contact) return null;
    return { business, size, challenges, situation, focus, ...contact };
}

function sessionParams(a, origin) {
    const l = CHECKOUT;
    const p = new URLSearchParams({
        mode: 'payment',
        locale: l.locale,
        customer_email: a.email,
        success_url: origin + l.success,
        cancel_url: origin + l.cancel,
        'automatic_tax[enabled]': 'true',
        'invoice_creation[enabled]': 'true',
        'custom_text[submit][message]': l.refund,
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': PRICE.currency,
        'line_items[0][price_data][unit_amount]': String(PRICE.unit_amount),
        'line_items[0][price_data][tax_behavior]': 'exclusive',
        'line_items[0][price_data][product_data][name]': l.product
    });
    // Stripe keeps only its own billing contact: the summary and the rest stay in KV for 7 days.
    return p;
}

const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const testRequested = (b) => Boolean(b && b.test === true);

export const handler = ({ sendMail }) => async ({ request, env, waitUntil }) => {
    let answers = null, body = null;
    try { body = await request.json(); answers = validate(body); } catch (err) { answers = null; }
    if (!answers) return json({ error: 'invalid' }, 400);
    if (!(await human(request, env))) return json({ error: 'verification' }, 403);

    // Dev mode without a test key must not fall back to a real charge.
    if (testRequested(body) && !env.STRIPE_TEST_SECRET_KEY) return json({ error: 'unavailable' }, 503);
    const key = testRequested(body) ? env.STRIPE_TEST_SECRET_KEY : env.STRIPE_SECRET_KEY;
    try {
        const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: sessionParams(answers, new URL(request.url).origin)
        });
        if (!res.ok) {
            console.error('stripe checkout session failed: status ' + res.status);
            return json({ error: 'unavailable' }, 502);
        }
        const session = await res.json();
        // The webhook confirms from this lead, and the reminder brings the visitor back to it.
        const lead = { ...answers, sessionId: session.id, test: key !== env.STRIPE_SECRET_KEY, paid: false, createdAt: Date.now() };
        if (env.LEADS) await env.LEADS.put(session.id, JSON.stringify(lead), { expirationTtl: 7 * 24 * 3600 });
        // Kevin hears about the request now, with the session id, whether or not the payment follows.
        const tell = sendMail(env, { to: KEVIN.email, ...notice(lead) }).catch((err) => console.error('checkout notice failed: ' + (err && err.name)));
        if (waitUntil) waitUntil(tell); else await tell;
        return json({ url: session.url }, 200);
    } catch (err) {
        console.error('stripe checkout session unreachable: ' + (err && err.name));
        return json({ error: 'unavailable' }, 502);
    }
};

export const onRequestPost = handler({ sendMail });
