// Turns a voice clip from the booking form into text through NaraMachine.
// Contract with NaraMachine (the endpoint is being built in the NaraMachine repo):
//   POST {NARAMACHINE_TRANSCRIBE_URL}
//   Authorization: Bearer {NARAMACHINE_API_KEY}
//   Content-Type: the clip's audio type, body: the raw clip
//   200 {"text": "..."}
// Both variables live as encrypted variables on the Pages project (and in
// .dev.vars locally). Until they are set, GET answers 404 and the form keeps
// the voice control hidden, so the visitor only ever sees a working control.

const TYPES = /^audio\/(webm|mp4|ogg|mpeg|wav|x-m4a|flac)(;.*)?$/;
const MIN_BYTES = 2048;          // below this there is no speech to hear
const MAX_BYTES = 10 * 1024 * 1024;

const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const configured = (env) => Boolean(env.NARAMACHINE_TRANSCRIBE_URL && env.NARAMACHINE_API_KEY);

export async function onRequestGet({ env }) {
    return new Response(null, { status: configured(env) ? 204 : 404 });
}

export async function onRequestPost({ request, env }) {
    if (!configured(env)) return json({ error: 'unavailable' }, 503);

    const type = request.headers.get('Content-Type') || '';
    if (!TYPES.test(type)) return json({ error: 'invalid' }, 400);
    if (Number(request.headers.get('Content-Length')) > MAX_BYTES) return json({ error: 'invalid' }, 413);
    const clip = await request.arrayBuffer();
    if (clip.byteLength > MAX_BYTES) return json({ error: 'invalid' }, 413);
    if (clip.byteLength < MIN_BYTES) return json({ error: 'invalid' }, 400);

    try {
        const res = await fetch(env.NARAMACHINE_TRANSCRIBE_URL, {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + env.NARAMACHINE_API_KEY, 'Content-Type': type },
            body: clip
        });
        if (!res.ok) {
            console.error('naramachine transcribe failed: status ' + res.status);
            return json({ error: 'unavailable' }, 502);
        }
        const body = await res.json();
        if (typeof body.text !== 'string') {
            console.error('naramachine transcribe answered without text');
            return json({ error: 'unavailable' }, 502);
        }
        return json({ text: body.text.trim() }, 200);
    } catch (err) {
        console.error('naramachine transcribe unreachable: ' + (err && err.name));
        return json({ error: 'unavailable' }, 502);
    }
}
