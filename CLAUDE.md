# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository

Static site for kevinfilteau.com plus one Cloudflare Pages Function. No build step and no dependencies.

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

The offer is a paid one-hour consultation. `reserver/` holds the four-step form; `assets/site.js` drives it (one `.step` visible at a time, answers in `sessionStorage`). Step 4 POSTs
the answers to `functions/api/checkout.js`, which creates a Stripe Checkout Session over the REST API (no
SDK) with the answers as metadata on the session and on the payment, then returns the Checkout URL. Stripe
sends the visitor back to `reserver/merci/` (`noindex`, not in the sitemap).

Price, tax behaviour, refund text and the return URLs live at the top of `functions/api/checkout.js`.
The Function needs `STRIPE_SECRET_KEY` as an encrypted variable on the Pages project (Production and
Preview) and, for local preview, in a gitignored `.dev.vars` file. Stripe Tax must be enabled on the
account: the session asks for `automatic_tax`. Refunds are done in the Stripe dashboard.

### Voice input

Step 2 offers "Parler plutôt": `assets/site.js` records with `MediaRecorder` (3 minutes max), POSTs the clip
to `functions/api/transcribe.js`, and puts the returned text in the business field. The Function forwards the
raw clip to NaraMachine: `POST $NARAMACHINE_TRANSCRIBE_URL` with `Authorization: Bearer $NARAMACHINE_API_KEY`
and the clip's `Content-Type`, expecting `200 {"text": "..."}`. That endpoint is being built in the
NaraMachine repo; until both variables are set on the Pages project, `GET /api/transcribe` answers 404 and
the form keeps the control hidden. Clips are capped at 10 MB and must be at least 2 KB.

Tests: `node --test 'test/*.test.js'` (Node 22+, no install).

Every page needs `link rel="canonical"` and an entry in `sitemap.xml`.

## Deploy

Auto-deploys to Cloudflare Pages on push to `main` via `.github/workflows/` (uses `cloudflare/wrangler-action@v3`, `pages deploy . --project-name=kevinfilteau-com`). Requires repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. No staging — `main` is production.

## Local preview

Use `npx wrangler pages dev .` (writes to `.wrangler/`, which is gitignored). Opening `index.html` over `file://` no longer works: the shared assets are referenced root-absolute (`/assets/…`).
