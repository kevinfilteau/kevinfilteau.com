import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateContact } from '../lib/contact.js';

const good = { name: ' Anne Tremblay ', company: 'Pneus Tremblay inc.', email: 'anne@example.com', phone: '(418) 555-0199', channel: 'sms' };

test('cleans a valid contact and normalizes the mobile number', () => {
    assert.deepEqual(validateContact(good), { name: 'Anne Tremblay', company: 'Pneus Tremblay inc.', email: 'anne@example.com', phone: '+14185550199', channel: 'sms' });
});

test('accepts a number with the country code and the email channel', () => {
    assert.equal(validateContact({ ...good, phone: '+1 418 555 0199', channel: 'email' }).phone, '+14185550199');
    assert.equal(validateContact({ ...good, phone: '14185550199' }).phone, '+14185550199');
});

for (const [name, patch] of Object.entries({
    'no name': { name: '' },
    'name too long': { name: 'x'.repeat(101) },
    'no company': { company: '  ' },
    'company too long': { company: 'x'.repeat(201) },
    'malformed email': { email: 'anne' },
    'a phone with too few digits': { phone: '555-0199' },
    'a phone with a foreign country code': { phone: '+33 6 12 34 56 78' },
    'an unknown channel': { channel: 'phone' },
    'no channel': { channel: '' },
})) {
    test(`rejects ${name}`, () => {
        assert.equal(validateContact({ ...good, ...patch }), null);
    });
}

test('rejects anything that is not an object', () => {
    assert.equal(validateContact(null), null);
    assert.equal(validateContact('x'), null);
});
