// The assistant behind step 2 of the booking form. The browser sends the whole
// transcript each turn; nothing is stored here. The model answers in a fixed JSON
// shape: a reply, optional quick choices, a done flag and, when done, the summary
// that becomes the Stripe metadata. Needs ANTHROPIC_API_KEY and
// TURNSTILE_SECRET_KEY as encrypted variables on the Pages project.
import Anthropic from '@anthropic-ai/sdk';
import { human } from '../../lib/turnstile.js';
import { validateWho } from '../../lib/contact.js';

export const SIZES = ['solo', '2-10', '11-50', '51-200', '200+'];
export const CHALLENGES = ['fit', 'stuck', 'integration', 'build-buy', 'choice', 'cloud', 'no-tech-lead', 'other'];
const MAX_TURNS = 8;        // hard cap on visitor messages per conversation
const CONCLUDE_AT = 6;      // from here the model must close and summarize
const MAX_CHARS = 500;

const SYSTEM = `Tu es l’assistant automatisé de Kevin Filteau, programmeur d’applications d’entreprise depuis 1996. Un visiteur veut réserver une heure de consultation avec Kevin (250 $ CA, visioconférence). Ton seul rôle: comprendre sa situation pour que Kevin prépare l’heure. Tu ne donnes aucun conseil, aucune solution, aucun diagnostic: c’est le travail de Kevin pendant l’heure. Tu ne parles pas de prix ni de disponibilités.

Tu as déjà dit: « Bonjour. Je suis l’assistant automatisé de Kevin. Quelques questions pour préparer votre rencontre avec lui. D’abord, que fait votre entreprise? » Le visiteur répond maintenant.

Règles:
- Une seule question par message, courte, en français, vouvoiement. Pas de liste, pas de gras. Apostrophe typographique (’) et orthographe rectifiée (couts, connaitre).
- Adapte la question suivante à ce qui vient d’être dit. Cherche dans l’ordre: ce que fait l’entreprise, sa taille, le problème concret (quoi, depuis quand, qui le porte, ce qui a été essayé), ce qui est en jeu.
- Quand une question a des réponses fermées évidentes, propose jusqu’à quatre choix courts dans "choices". Sinon "choices" est vide.
- La question sur le problème se pose ainsi, sans choix: « À quoi faites-vous face en ce moment? Décrivez le problème concret en quelques phrases: ce qui bloque, depuis quand, et ce que vous avez déjà essayé. » Ne propose jamais de catégories de problèmes; c’est au visiteur de le dire dans ses mots.
- Reste sur la situation du visiteur. Si on te demande autre chose, réponds en une phrase que c’est pour Kevin pendant l’heure, puis reviens à ta question.
- Ne demande jamais de renseignements personnels: nom, courriel, téléphone, adresse. Le formulaire les a déjà.
- Termine dès que tu as l’entreprise, la taille, le problème concret et ce qui est en jeu, en général après trois à cinq réponses. Termine aussi si le visiteur le demande.
- Pour terminer: "done" vrai, "reply" remercie en une phrase et dit que Kevin lira ce résumé, "choices" vide, et "summary" complet.
- Tant que tu n’as pas terminé: "done" faux et "summary" avec des chaines vides et une liste vide.

Le résumé:
- "business": ce que fait l’entreprise, une ou deux phrases, au plus 300 caractères.
- "size": une valeur parmi solo, 2-10, 11-50, 51-200, 200+.
- "challenges": une ou plusieurs valeurs parmi fit (le logiciel ne suit plus la façon de travailler), stuck (projet bloqué ou en retard), integration (systèmes qui ne se parlent pas), build-buy (bâtir ou acheter), choice (choisir une technologie ou un fournisseur), cloud (couts, sécurité ou fiabilité du nuage), no-tech-lead (personne de technique pour décider), other.
- "situation": le problème concret dans les mots du visiteur, au plus 500 caractères.
- "focus": ce sur quoi l’heure devrait porter, une phrase, au plus 300 caractères.`;

const FORMAT = {
    type: 'json_schema',
    schema: {
        type: 'object', additionalProperties: false,
        required: ['reply', 'choices', 'done', 'summary'],
        properties: {
            reply: { type: 'string' },
            choices: { type: 'array', items: { type: 'string' } },
            done: { type: 'boolean' },
            summary: {
                type: 'object', additionalProperties: false,
                required: ['business', 'size', 'challenges', 'situation', 'focus'],
                properties: {
                    business: { type: 'string' },
                    size: { type: 'string', enum: SIZES.concat('') },
                    challenges: { type: 'array', items: { type: 'string', enum: CHALLENGES } },
                    situation: { type: 'string' },
                    focus: { type: 'string' }
                }
            }
        }
    }
};

const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// The transcript as the browser keeps it: user and assistant alternate, user first and last.
// The name and the company are collected before the chat; without them the model is not called.
function validate(b) {
    if (!validateWho(b && b.contact)) return null;
    const m = b && Array.isArray(b.messages) ? b.messages : null;
    if (!m || m.length === 0 || m.length % 2 === 0 || m.length > MAX_TURNS * 2 - 1) return null;
    const out = [];
    for (let i = 0; i < m.length; i++) {
        const role = i % 2 === 0 ? 'user' : 'assistant';
        const content = m[i] && typeof m[i].content === 'string' ? m[i].content.trim() : '';
        if (!m[i] || m[i].role !== role || !content || content.length > (role === 'user' ? MAX_CHARS : MAX_CHARS * 3)) return null;
        out.push({ role, content });
    }
    return out;
}

// Trims the model's answer to the contract the page expects; null when it does not fit.
export function shape(a) {
    if (!a || typeof a.reply !== 'string' || typeof a.done !== 'boolean' || !Array.isArray(a.choices) || !a.summary) return null;
    const s = a.summary;
    const clean = (v, max) => (typeof v === 'string' ? v.trim() : '').slice(0, max);
    const summary = a.done ? {
        business: clean(s.business, 500), size: SIZES.includes(s.size) ? s.size : '',
        challenges: Array.isArray(s.challenges) ? s.challenges.filter((c) => CHALLENGES.includes(c)) : [],
        situation: clean(s.situation, 500), focus: clean(s.focus, 500)
    } : null;
    if (summary && (!summary.business || !summary.size || summary.challenges.length === 0 || !summary.situation)) return null;
    return { reply: a.reply.trim(), choices: a.choices.filter((c) => typeof c === 'string' && c.trim()).slice(0, 4), done: a.done, summary };
}

export async function onRequestPost({ request, env }) {
    let messages = null;
    try { messages = validate(await request.json()); } catch (err) { messages = null; }
    if (!messages) return json({ error: 'invalid' }, 400);
    if (!(await human(request, env))) return json({ error: 'verification' }, 403);

    const turns = (messages.length + 1) / 2;
    if (turns >= CONCLUDE_AT) messages.push({ role: 'system', content: 'Vous avez assez d’information. Terminez maintenant: "done" vrai et résumé complet.' });

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL || undefined, fetch: (...a) => globalThis.fetch(...a), maxRetries: 1 });
    try {
        const res = await client.beta.messages.create({
            model: 'claude-opus-5',
            max_tokens: 1024,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            system: SYSTEM,
            messages,
            output_config: { effort: 'low', format: FORMAT }
        });
        if (res.stop_reason === 'refusal') {
            console.error('chat model refused');
            return json({ error: 'unavailable' }, 502);
        }
        const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
        const answer = shape(JSON.parse(text));
        if (!answer) {
            console.error('chat model answered outside the contract');
            return json({ error: 'unavailable' }, 502);
        }
        return json(answer, 200);
    } catch (err) {
        console.error('chat model failed: ' + (err && err.status ? 'status ' + err.status : (err && err.name)));
        return json({ error: 'unavailable' }, 502);
    }
}
