# HsiaoEye — 眼科衛教筆記

A static bilingual (zh-Hant-TW / en) ophthalmology patient-education website by **蕭閔謙 醫師** (Dr. Min-Chien Hsiao).

🌐 https://hsiao.chendermatologist.com/

## What's in this repo

- **Static HTML site** — every page is a real `.html` file under repo root, `blog/`, and `en/blog/`
- **Bilingual via `data-zh` / `data-en` attributes** — the build step (`_gen_en_pages.py`) materializes each EN page with English in the visible DOM; the runtime toggle (`DN.applyTextOnly()` in `blog/blog-shared.js`) swaps both ways without reload
- **Admin CMS in browser** — visit `/admin`, log in with GitHub PAT, edit articles WYSIWYG, saves commit to `main` via `/api/admin/save`. Vercel auto-deploys
- **22 quality checks** — `_check_*.py` scripts run in CI (`.github/workflows/quality.yml`) to catch SEO, a11y, link, schema, security regressions before merge

## Quick start (local development)

No build step required — open any HTML file directly in a browser to view.

To regenerate auto-built artifacts (after editing articles, CSS, or scripts):

```bash
# Order matters — halfwidth fix must run before EN mirror generation
python halfwidth_to_fullwidth.py     # ZH punctuation normalization
python _gen_feeds.py                  # sitemap.xml + RSS/Atom
python _gen_og_images.py              # Open Graph cards (--only-changed for fast)
python _gen_en_pages.py               # /en/ mirror with content swap
python _gen_csp_hashes.py             # CSP hash allowlist in middleware.js
python _extract_critical_css.py       # inline above-the-fold CSS
```

Or in one go (sequential, ~30 sec):

```bash
python halfwidth_to_fullwidth.py && python _gen_feeds.py && \
python _gen_og_images.py && python _gen_en_pages.py && \
python _gen_csp_hashes.py && python _extract_critical_css.py
```

## Quality gates (CI runs all of these)

| Check | What it catches |
|---|---|
| `_check_meta.py` | title / description length, canonical, OG tags |
| `_check_sitemap.py` | URL consistency, noindex leak into sitemap |
| `_check_metadata_uniqueness.py` | duplicate title / description across pages |
| `_check_internal_links.py` | 404 internal links |
| `_check_en_internal_links.py` | /en/ pages linking back to ZH side |
| `_check_articles.py` | DN.ARTICLES catalog structural integrity |
| `_check_article_listings.py` | every article appears on homepage + blog/index + topics |
| `_check_bilingual_attrs.py` | data-zh / data-en consistency |
| `_check_secrets.py` | accidentally committed PAT / private key |
| `_check_text_integrity.py` | mojibake / replacement-char audit |
| `_check_balance.py` | blog-shared.js delimiter balance |
| `_check_button_types.py` | `<button>` missing type=button |
| `_check_external_links.py` | target=_blank without rel=noopener |
| `_check_index_boundaries.py` | indexable / private page boundary |
| `_check_static_a11y.py` | heading hierarchy, form-control labels, target=_blank rel |
| `_check_inline_events.py` | inline onclick/onload (CSP risk) |
| `_check_inline_scripts.py` | inline `<script>` delimiter balance |
| `_check_js_syntax.py` | JS parse errors across all .js files |
| `_check_syntax_residue.py` | duplicated-key residue from automated edits |
| `_check_performance_budget.py` | first-paint / CWV guardrails |
| `_check_third_party.py` | analytics / ads lazy-loading policy |
| `_check_pwa.py` | manifest.json + offline.html + sw.js coverage |
| `_check_robots.py` | robots.txt vs sitemap consistency |

## Site architecture

```
hsiao.chendermatologist.com/
├── /                       index.html (home)
├── /about, /tools, /notes, /privacy
├── /blog/                  blog/index.html (article index)
├── /blog/topics            blog/topics.html (topic map)
├── /blog/<slug>            blog/<slug>.html (articles)
├── /en/                    en/index.html (EN mirror)
├── /en/blog/...            en/blog/<slug>.html (EN articles)
├── /admin                  admin.html (in-browser CMS, gated by /api/admin/auth)
├── /pagefind/              PageFind search index (built via npx pagefind)
├── /assets/                CSS, JS, OG images, AVIF/WebP
└── /api/                   Vercel serverless functions
    ├── /api/admin/[op]     admin operations dispatcher
    ├── /api/push/[op]      Web Push dispatcher
    ├── /api/og             dynamic Open Graph
    └── /api/sitemap, /api/feed, /api/csp-report, etc.
```

## Tech stack

- **Hosting**: Vercel (static + serverless functions)
- **Build**: pure Python scripts (no bundler, no node_modules at runtime)
- **CSS**: hand-curated `assets/app.css` (804 lines) + per-article inline `<style>`; critical CSS inlined via `_extract_critical_css.py`
- **JS**: `blog/blog-shared.js` (~4800 lines, vanilla, no framework) + lazy `blog/blog-admin.js` only when `?admin=1`
- **Search**: PageFind (Rust → WASM, ~45 KB), lazy-loaded
- **Security**: hash-based CSP via `_gen_csp_hashes.py` + `middleware.js`, Trusted Types policy in blog-shared.js
- **i18n**: data-zh / data-en attribute pattern; client toggle + build-time materialization

## Documentation

- **[CLAUDE.md](CLAUDE.md)** — Claude Code agent instructions for this repo
- **[AGENTS.md](AGENTS.md)** — generic agent automation guide
- **[WRITING_NEW_ARTICLE.md](WRITING_NEW_ARTICLE.md)** — article structure / bilingual conventions for content authors
- **[api/admin/README.md](api/admin/README.md)** — admin endpoint setup and security notes
- **[SEARCH_CONSOLE_TODO.md](SEARCH_CONSOLE_TODO.md)** — Google Search Console action items (if present)

## License & contributions

Content (text, images): © 蕭閔謙 醫師 — for personal, non-commercial educational reading only. Re-use requires permission.

Code (scripts, build tooling, blog-shared.js): MIT-style — feel free to adapt. Attribution appreciated.

For issues / suggestions, open a GitHub issue or email via `/about`.
