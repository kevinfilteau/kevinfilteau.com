import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendSms } from '../lib/notify.js';

test('sends a text through Twilio with basic auth and the account sender', async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response('{"sid":"SM1"}', { status: 201 }); };
    await sendSms({ TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM: '+15145550000' }, '+14185550199', 'Bonjour');
    assert.equal(calls[0].url, 'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');
    assert.equal(calls[0].init.headers.Authorization, 'Basic ' + btoa('AC1:tok'));
    const p = new URLSearchParams(calls[0].init.body);
    assert.equal(p.get('To'), '+14185550199');
    assert.equal(p.get('From'), '+15145550000');
    assert.equal(p.get('Body'), 'Bonjour');
});

test('throws on a Twilio error with the status only', async () => {
    globalThis.fetch = async () => new Response('{"message":"bad number +14185550199"}', { status: 400 });
    await assert.rejects(sendSms({ TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM: '+15145550000' }, '+14185550199', 'x'), (e) => e.message === 'twilio status 400');
});
