# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository

Static site for kevinfilteau.com. No build step and no dependencies.

Layout is global and lives in `assets/`:

- `assets/site.css` — the layout every page uses: rays background, language switcher, glass panel (`main`), `.hero`, `.prose`, `.quote`, `.contact`.
- `assets/site.js` — reveals the obfuscated email and phone, remembers the language choice. Loaded with `defer`.
- `assets/rays.svg` — the animated background, embedded with `<object>`. Chrome freezes an SVG used as a CSS `background-image` or in an `<img>` on its first frame; `<object>` gives it a document, so the sweep runs and the `prefers-reduced-motion` rule inside the file is honoured.

Pages hold only their own content and metadata. English pages live at the root (`index.html`, `prepaid-code/`), French under `fr/`.

To add a page, copy the shell of `index.html`: link `/assets/site.css`, defer `/assets/site.js`, copy the `.rays` div and the language switcher into the body, then write sections inside `<main>`. Do not restyle the layout in the page. The language auto-redirect is inline in the root `index.html` on purpose — it is per page and must run before the paint.

The `prepaid-code/` pages keep their own article layout and inline CSS; they do not use `assets/site.css`.

Every page needs `link rel="canonical"`, `hreflang` alternates for both languages, and an entry in `sitemap.xml`.

## Deploy

Auto-deploys to Cloudflare Pages on push to `main` via `.github/workflows/` (uses `cloudflare/wrangler-action@v3`, `pages deploy . --project-name=kevinfilteau-com`). Requires repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. No staging — `main` is production.

## Local preview

Use `npx wrangler pages dev .` (writes to `.wrangler/`, which is gitignored). Opening `index.html` over `file://` no longer works: the shared assets are referenced root-absolute (`/assets/…`).
