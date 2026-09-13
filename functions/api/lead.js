// Gives back the contact and the summary of an unpaid lead, so a reminder link
// (/reserver/?resume=<session id>) lands on the payment step with everything filled.
const ID = /^cs_(live|test)_[A-Za-z0-9]+$/;
const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function onRequestGet({ request, env }) {
    const id = new URL(request.url).searchParams.get('id') || '';
    const stored = ID.test(id) ? await env.LEADS.get(id) : null;
    const l = stored ? JSON.parse(stored) : null;
    if (!l || l.paid) return json({ error: 'not_found' }, 404);
    return json({
        contact: { name: l.name, company: l.company, email: l.email, phone: l.phone, channel: l.channel },
        summary: { business: l.business, size: l.size, challenges: l.challenges, situation: l.situation, focus: l.focus }
    }, 200);
}
