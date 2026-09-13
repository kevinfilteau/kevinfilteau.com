// Outbound messages: email through Gmail SMTP (worker-mailer over Cloudflare sockets),
// texts through Twilio. Every function throws on failure with a status only.
export const KEVIN = { name: 'Kevin Filteau', email: 'info@kevinfilteau.com', phone: '+1 418 254-7193' };

export async function sendMail(env, { to, subject, text }) {
    const { WorkerMailer } = await import('worker-mailer');
    const mailer = await WorkerMailer.connect({
        host: 'smtp.gmail.com', port: 587, startTls: true, authType: 'plain',
        credentials: { username: env.SMTP_USER, password: env.SMTP_PASS }
    });
    try {
        await mailer.send({ from: { name: KEVIN.name, email: env.SMTP_USER }, to: { email: to }, subject, text });
    } finally {
        await mailer.close();
    }
}

export async function sendSms(env, to, body) {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: to, From: env.TWILIO_FROM, Body: body })
    });
    if (!res.ok) throw new Error('twilio status ' + res.status);
}

// ---- Message texts (French, vous). The lead is the object the checkout stored. ----
const SIZE = { solo: 'Moi seulement', '2-10': '2 à 10 personnes', '11-50': '11 à 50 personnes', '51-200': '51 à 200 personnes', '200+': 'Plus de 200 personnes' };
const channelWord = (c) => (c === 'sms' ? 'par texto' : 'par courriel');

const recap = (l) => [
    `Votre entreprise : ${l.business}`,
    `Taille : ${SIZE[l.size] || l.size}`,
    `La situation : ${l.situation}`,
    l.focus ? `L’heure devrait porter sur : ${l.focus}` : ''
].filter(Boolean).join('\n');

export const confirmation = (l) => ({
    subject: 'C’est réservé : votre heure avec Kevin Filteau',
    text: `Bonjour ${l.name},

Merci. Votre heure de consultation est réservée. Je vous joins dans un jour ouvrable, ${channelWord(l.channel)}, pour planifier la rencontre.

Ce que l’assistant a retenu :
${recap(l)}

Remboursable à 100 %. Si après 30 minutes vous ne voyez pas comment je peux vous aider, on arrête et je vous rembourse. Si vous estimez que je ne vous ai pas aidé, dites-le-moi dans les 7 jours suivant la rencontre et je vous rembourse en entier.

${KEVIN.name}
${KEVIN.email} · ${KEVIN.phone}`
});

export const notice = (l) => ({
    subject: `Nouvelle réservation : ${l.name}, ${l.company}`,
    text: `${l.name} — ${l.company}
${l.email} · ${l.phone} · à joindre ${channelWord(l.channel)}
Session Stripe : ${l.sessionId}

${recap(l)}`
});

export const reminder = (l, origin) => {
    const link = `${origin}/reserver/?resume=${l.sessionId}`;
    return {
        subject: 'Votre réservation n’est pas terminée',
        text: `Bonjour ${l.name},

Vous avez décrit votre situation, il ne reste que le paiement. Reprenez où vous étiez :
${link}

Si ce n’est plus d’actualité, ignorez ce message.

${KEVIN.name}
${KEVIN.email} · ${KEVIN.phone}`,
        sms: `Kevin Filteau : votre réservation n’est pas terminée, il ne reste que le paiement. Reprenez ici : ${link}`
    };
};
