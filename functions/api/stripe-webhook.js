// Stripe calls this for checkout.session.completed and checkout.session.expired.
// Paid: confirmation email to the visitor, a copy to Kevin, the lead marked paid.
// Expired unpaid: one reminder, by text or email as the visitor chose, with a resume link.
// The lead comes from KV (stored by /api/checkout); a paid session without one falls
// back to the session's metadata. Needs STRIPE_WEBHOOK_SECRET, SMTP_USER, SMTP_PASS,
// TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM and the LEADS binding.
import { verifyStripeSignature } from '../../lib/stripe-signature.js';
import { sendMail, sendSms, confirmation, notice, reminder, KEVIN } from '../../lib/notify.js';

const TTL = 7 * 24 * 3600;
const ORIGIN = 'https://kevinfilteau.com';

const fromSession = (s) => {
    const m = s.metadata || {};
    return { sessionId: s.id, name: m.name, company: m.company, email: (s.customer_details || {}).email, phone: m.phone, channel: m.channel,
        business: m.business, size: m.size, challenges: (m.challenges || '').split(', ').filter(Boolean), situation: m.situation, focus: m.focus || '' };
};

export const handler = ({ sendMail, sendSms }) => async ({ request, env }) => {
    const payload = await request.text();
    if (!(await verifyStripeSignature(payload, request.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET))) return new Response('bad signature', { status: 400 });

    const event = JSON.parse(payload);
    const session = event.data.object;
    const stored = await env.LEADS.get(session.id);
    let lead = stored ? JSON.parse(stored) : null;

    try {
        if (event.type === 'checkout.session.completed') {
            if (lead && lead.paid) return new Response('ok');
            lead = lead || fromSession(session);
            await sendMail(env, { to: lead.email, ...confirmation(lead) });
            await sendMail(env, { to: KEVIN.email, ...notice(lead) });
            await env.LEADS.put(session.id, JSON.stringify({ ...lead, paid: true }), { expirationTtl: TTL });
        } else if (event.type === 'checkout.session.expired') {
            if (!lead || lead.paid || lead.reminded) return new Response('ok');
            const r = reminder(lead, ORIGIN);
            if (lead.channel === 'sms') await sendSms(env, lead.phone, r.sms);
            else await sendMail(env, { to: lead.email, subject: r.subject, text: r.text });
            await env.LEADS.put(session.id, JSON.stringify({ ...lead, reminded: true }), { expirationTtl: TTL });
        }
    } catch (err) {
        console.error('webhook ' + event.type + ' failed: ' + (err && err.message ? err.message.replace(/\S+@\S+/g, '[email]') : err));
        return new Response('retry', { status: 500 });
    }
    return new Response('ok');
};

export const onRequestPost = handler({ sendMail, sendSms });
