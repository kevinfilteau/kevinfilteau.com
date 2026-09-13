import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/lead.js';

const lead = { sessionId: 'cs_live_1', name: 'Anne', company: 'Pneus inc.', email: 'anne@example.com', phone: '+14185550199', channel: 'sms',
    business: 'Pneus.', size: '11-50', challenges: ['stuck'], situation: 'Projet en retard.', focus: 'Débloquer.', test: false };
const kv = (o) => ({ get: async (k) => (k in o ? JSON.stringify(o[k]) : null) });
const get = (id, store) => onRequestGet({ request: new Request('https://kevinfilteau.com/api/lead?id=' + id), env: { LEADS: kv(store) } });

test('returns the contact and the summary of an unpaid lead, nothing else', async () => {
    const res = await get('cs_live_1', { cs_live_1: lead });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
        contact: { name: 'Anne', company: 'Pneus inc.', email: 'anne@example.com', phone: '+14185550199', channel: 'sms' },
        summary: { business: 'Pneus.', size: '11-50', challenges: ['stuck'], situation: 'Projet en retard.', focus: 'Débloquer.' }
    });
});

test('answers 404 for a paid lead, an unknown id or a malformed id', async () => {
    assert.equal((await get('cs_live_1', { cs_live_1: { ...lead, paid: true } })).status, 404);
    assert.equal((await get('cs_live_2', { cs_live_1: lead })).status, 404);
    assert.equal((await get('../x', { cs_live_1: lead })).status, 404);
});
