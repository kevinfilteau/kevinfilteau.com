// The visitor's contact, collected before the chat and sent with every call.
// Returns the cleaned contact, or null when anything is missing or malformed.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const CHANNELS = ['sms', 'email'];

const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max ? v.trim() : null;

// North American mobile only, stored as +1XXXXXXXXXX.
function mobile(v) {
    const digits = typeof v === 'string' ? v.replace(/\D/g, '') : '';
    if (digits.length === 10) return '+1' + digits;
    if (digits.length === 11 && digits[0] === '1') return '+' + digits;
    return null;
}

// Enough to open the chat: who I will talk to.
export function validateWho(c) {
    if (!c || typeof c !== 'object') return null;
    const name = text(c.name, 100);
    const company = text(c.company, 200);
    return name && company ? { name, company } : null;
}

export function validateContact(c) {
    if (!c || typeof c !== 'object') return null;
    const name = text(c.name, 100);
    const company = text(c.company, 200);
    const email = text(c.email, 254);
    const phone = mobile(c.phone);
    const channel = CHANNELS.includes(c.channel) ? c.channel : null;
    if (!name || !company || !email || !EMAIL.test(email) || !phone || !channel) return null;
    return { name, company, email, phone, channel };
}
