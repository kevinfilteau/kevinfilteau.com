# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository

Static site for kevinfilteau.com plus two Cloudflare Pages Functions. No build step. One runtime dependency, the Anthropic SDK, installed with `npm ci` before deploy (the Functions are bundled by wrangler).

The site is French only, at the root. `_redirects` sends the old `/fr/` to `/`.

Layout is global and lives in `assets/`:

- `assets/site.css` — the layout every page uses: rays background, glass panel (`main`), `.hero`, `.prose`, `.quote`, `.book` form, `.contact`.
- `assets/site.js` — reveals the obfuscated email and phone, drives the booking form. Loaded with `defer`.
- `assets/rays.svg` — the animated background, embedded with `<object>`. Chrome freezes an SVG used as a CSS `background-image` or in an `<img>` on its first frame; `<object>` gives it a document, so the sweep runs and the `prefers-reduced-motion` rule inside the file is honoured.

**Bump `?v=<date>` on the asset links in every page whenever you change a file in `assets/`.** Cloudflare
caches `/assets/*` for 4 hours and kept doing so when the policy was set in `_headers`, so a deploy without
a bump serves new HTML with the old stylesheet. The query string is the only thing that invalidates it.

Pages hold only their own content and metadata.

To add a page, copy the shell of `index.html`: link `/assets/site.css`, defer `/assets/site.js`, copy the `.rays` div into the body, then write sections inside `<main>`. Do not restyle the layout in the page.

The `prepaid-code/` pages keep their own article layout and inline CSS; they do not use `assets/site.css`.

## Booking flow

The offer is a paid one-hour consultation. `reserver/` holds a three-step form driven by `assets/site.js`
(one `.step` visible at a time, state including the current step in `sessionStorage`, so a refresh or a
visit to the privacy page comes back to the same step):

1. What you get, price, guarantee, plus name and company ("who will I talk to"). `lib/contact.js`
   `validateWho` checks them; the chat Function refuses a call without them.
2. A chat with an automated assistant. The page sends the whole transcript to `functions/api/chat.js` on
   every turn; the Function calls Claude Opus 5 through the Anthropic SDK with a frozen French system
   prompt and a JSON output schema (`reply`, `choices`, `done`, `summary`). Server-side refusal fallbacks
   are on (`fallbacks: "default"`). The visitor gets at most 8 turns; from the 6th the model is told to
   conclude. When `done`, the summary (business, size, challenges, situation, focus) is shown on a card
   the visitor accepts or refines. No fallback form: if the model is down, the visitor sees an error.
3. Review, then email, mobile (texts only) and the preferred channel, SMS or email, then pay.
   `validateContact` checks the full contact. The summary and the contact go to `functions/api/checkout.js`, which creates a Stripe
   Checkout Session over the REST API with the summary and the contact as metadata on the session and on
   the payment, then returns the Checkout URL. Stripe sends the visitor back to `reserver/merci/` (`noindex`,
   not in the sitemap).

On `localhost` the page adds a "Remplir (test)" button that fills every contact field; it never appears
in production.

Both Functions cost money to call, so each requires a Cloudflare Turnstile token
in `X-Turnstile-Token`, checked by `lib/turnstile.js`. The widget's site key sits in `reserver/index.html`
(`.turnstile[data-sitekey]`); the secret is `TURNSTILE_SECRET_KEY`. Tokens are single-use, so the page
resets the widget after each call. Cloudflare's test pair (`1x00000000000000000000AA` /
`1x0000000000000000000000000000000AA`) always passes and is what `.dev.vars` uses locally.

Price, tax behaviour, refund text and the return URLs live at the top of `functions/api/checkout.js`.
Encrypted variables on the Pages project (Production and Preview), mirrored in the gitignored `.dev.vars`
for local preview: `STRIPE_SECRET_KEY`, `ANTHROPIC_API_KEY`, `TURNSTILE_SECRET_KEY`. `ANTHROPIC_BASE_URL` is optional and only for pointing the chat at a mock.
Stripe Tax must be enabled on the account: the session asks for `automatic_tax`. Refunds are done in the
Stripe dashboard.

Tests: `npm test` (Node 22+). They mock every network call; no key needed.

Every page needs `link rel="canonical"` and an entry in `sitemap.xml`.

## Deploy

Auto-deploys to Cloudflare Pages on push to `main` via `.github/workflows/` (uses `cloudflare/wrangler-action@v3`, `pages deploy . --project-name=kevinfilteau-com`). Requires repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. No staging — `main` is production.

## Local preview

Use `npx wrangler pages dev .` (writes to `.wrangler/`, which is gitignored). Opening `index.html` over `file://` no longer works: the shared assets are referenced root-absolute (`/assets/…`).
