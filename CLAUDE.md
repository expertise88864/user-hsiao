# Claude Code instructions for HsiaoEye

## 📚 START HERE — institutional docs (read before non-trivial work)

This repo is maintained by rotating AI sessions (often smaller models). The
`docs/` folder is the **durable institution** — read the ones relevant to your
task first; they encode decisions already made so you don't re-litigate them:

- **docs/DECISIONS.md** — 23 settled decisions (robots/schema/security/content
  policy) with "reopen conditions". If your idea matches one, it's already
  done; if it reverses one, only proceed under its reopen condition.
- **docs/MODEL-GUIDE.md** — which tasks need which model level, escalation
  paths, harness limits, the honesty clause, and the pre-push ritual.
- **docs/REVIEW-PLAYBOOK.md** — 10-dimension review handbook + current-state
  verdicts (SEO/schema/CWV/metadata/internal-linking/RAG/AI-search/a11y/
  security/maintainability). Use its check commands before claiming a finding.
- **docs/BACKLOG.md** — open tech debt, each with acceptance criteria + model level.
- **docs/GROWTH-PLAYBOOK.md** — verified traffic-growth plan (don't re-run the
  research; don't chase SEO hype it already debunked).
- **docs/ARTICLE-STANDARDS.md** — content rules (FAQ pattern, answer-first,
  medical sourcing, stub lifecycle, cluster linking). Pairs with WRITING_NEW_ARTICLE.md.

**Tools** (run, don't reinvent): `python preflight.py` (pre-push gate — runs
the chain, proves a fixed point, validates) · `python _ci_status.py <sha> --watch`
(CI status without `gh`). The pre-push ritual is DECISIONS.md D-20.

## 🛑 ANTI-OVERWRITE PROTOCOL — read this before any edit

The site owner uses an in-browser CMS at `/admin/` that commits **directly
to `main`** via the GitHub Contents API. Those commits land in the repo
without going through your local working tree. **If you don't pull first,
your push will overwrite the owner's work.**

### Required workflow at the start of any editing session

```bash
# 1. ALWAYS pull before any edit
git pull --rebase origin main

# 2. Note the latest commit
git log -1 --format='%h %ai %an %s'

# 3. If the latest commit author is "HsiaoEye Admin" and you're about to
#    edit the same file, READ THE FILE FROM DISK before editing (your
#    in-context version may be stale).
```

### Required workflow before any commit

```bash
# 1. Check git status
git status

# 2. Pull again right before push (rebase any new admin commits)
git pull --rebase origin main

# 3. Push
git push origin main
```

If `git pull --rebase` produces a conflict:
- **Stop**. Do not attempt to auto-resolve.
- Show the conflicting hunks to the user.
- Ask which side wins.

### Why this matters

The user spends time hand-editing in the admin (typo fixes, content
tweaks, image uploads). Those edits are stored only in `main`. If you:
- Edit a file based on stale in-context content
- Skip `git pull`
- Force push or use `--no-verify`

… you will silently undo their work, with no easy recovery without
spelunking through `git reflog`. **Never do this.**

## 🤖 CI auto-regen behavior — when a "drift failure" is NOT yours to fix

After every push to `main`, the `quality / HTML validation + SEO check` job
re-runs the full generator chain on Linux. If the generated output differs
from what you pushed (typically by **a few lines** in `/en/` mirror pages or
`middleware.js`), CI does **two** things:

1. **Marks the workflow run as failed** and sends you the alarming red email
   (`Run failed: quality - main (<sha>)`).
2. **Auto-commits a fixup** with the message
   `ci: regen /en/ mirror and dependents [skip ci]` — directly to `main`.

**The auto-commit means CI has already self-healed.** You do NOT need to
re-run the chain, re-commit, or push again. The next CI run skips itself
(via `[skip ci]`), so nothing further runs.

### When to actually intervene

Only act if **both** are true:
- CI shows the workflow **failed**, AND
- There is **no** subsequent `ci: regen ...` auto-commit on `origin/main`
  within ~2 minutes of the failure.

That combination indicates a real validator-script error (e.g. broken
internal link, malformed bilingual attribute, `_check_*` actually failed) —
not a drift the bot can patch. In that case:
1. `git pull --rebase origin main` (pick up any unrelated commits)
2. Run the full chain in WRITING_NEW_ARTICLE.md locally
3. Inspect what the validator actually complained about
4. Fix the underlying issue, commit, push

### Why drift happens at all

The generator scripts produce slightly different byte output on Windows vs
Linux CI (likely from `html.escape` defaults, attribute ordering inside
`<img />` self-close, or trailing whitespace handling). This is a known
property of the build chain, not a bug introduced by your changes.

**Bottom line:** see one red "drift" email → check `git log origin/main`. If
the next commit is `ci: regen ...`, the system has already fixed itself.
Don't push three more times trying to "fix" it; you'll just chase the
Windows↔Linux byte-difference loop.

## Site overview

- Static HTML site, no build step required for content
- Hosted at `hsiao.chendermatologist.com` (auto-deploy from `main`)
- Owner: 蕭閔謙 醫師 (ophthalmology resident, Taiwan)
- Wife of the dermatology-site owner; this is her personal patient-ed site
- Content is **bilingual** (Chinese primary, English secondary), encoded
  via paired `data-zh` / `data-en` attributes on every meaningful element
- All blog articles live in `/blog/{slug}.html`
- English mirror is auto-generated by `_gen_en_pages.py` into `/en/blog/`

## File / folder conventions

- `/blog/{slug}.html` — Chinese article (canonical)
- `/en/blog/{slug}.html` — auto-generated English mirror (DO NOT edit by hand)
- `/blog/blog-shared.js` — shared JS, contains the `DN.ARTICLES` catalog
- `/blog/topics.html` — topic index
- `/assets/uploads/` — admin-uploaded images (WebP, auto-compressed)
- `/admin/` — in-browser CMS (do not modify unless asked)

## Build pipeline

When you make content edits, the typical pipeline is:

```bash
# Optional for new or updated share cards:
python _gen_og_images.py
# build-chain:start
python halfwidth_to_fullwidth.py
python _normalize_reviewed_by.py
python _normalize_entity_links.py
python _inject_speed_insights.py
python _gen_feeds.py
python _gen_related.py
python _gen_serp_meta.py
python _gen_faqpage_jsonld.py
python _gen_en_pages.py
python _gen_search_index.py
python _gen_api_content_snapshot.py
python _gen_llms_txt.py
python _gen_llms_full_txt.py
python _gen_opensearch.py
python _gen_profile_schema.py
python _gen_site_graph.py
python _gen_route_canonicals.py
python _apply_i_series.py
python _apply_a11y_vt.py
python _apply_trusted_types.py
python _apply_f10_image_priority.py
python _normalize_skiplinks.py
python _extract_critical_css.py
python _gen_csp_hashes.py
# build-chain:end
python validate.py
```

Set `PYTHONIOENCODING=utf-8` if `validate.py` errors on Unicode.

## Editing guidelines

- **Never** touch files in `/en/blog/` directly — they are regenerated.
- **Never** use `--no-verify`, `--force`, or amend old commits.
- **Always** prefer creating a new commit over rewriting history.
- Commit message format: `<type>(<scope>): <imperative summary>`
  - `type` ∈ feat / fix / docs / refactor / chore
  - `scope` is usually `hsiaoeye` or the article slug
- After significant changes, bump the cache-bust version (`v=20260641` →
  next number) site-wide; this forces browsers to re-fetch CSS/JS.

## Article catalog format (`DN.ARTICLES`)

```js
{ slug:'glaucoma-comprehensive-guide',
  title:'青光眼完整衛教',
  title_en:'Glaucoma — Patient Education',
  cat:'alert',           // alert | rx | myth | notes | research
  tag:'青光眼',
  tag_en:'Glaucoma',
  date:'2026-05-09' }
```

Categories:
- `alert`  (red, 警訊辨識) — disease red flags / acute presentations
- `rx`     (purple, 衛教) — general patient education
- `myth`   (yellow, 迷思澄清) — myth-busting
- `notes`  (teal, 學習筆記) — deeper academic / learning notes for the author
- `research` (green, 最新研究) — paper summaries / new evidence

## Style / formatting principles

- Tone: professional but accessible to general public; never alarmist;
  never commercialized
- For medical acronyms, always provide the Chinese name on first mention
- Use `.myth-card` / `.myth` / `.truth` pattern for Q&A or myth sections
- Use `.hs-redflag-box` for danger callouts, `.hs-warn-box` for cautions,
  `.hs-tip-box` for tips/recommendations, `.keypoint` for key takeaways
- Every meaningful element must have paired `data-zh` and `data-en`
- Tables: `class="ted-table"`

## Full rebuild — when you've touched articles, CSS, or scripts

**You must run the entire chain below — not a subset.** The CI quality workflow
runs all generators in lockstep and fails on any drift. The chain that previously
shipped in this doc was incomplete and produced false "OK" locally while CI
flagged drift in `_gen_serp_meta`, `_gen_related`, `_gen_faqpage_jsonld`,
`_gen_search_index`, `_gen_llms_txt`, `_gen_profile_schema`, `_gen_site_graph`,
`_gen_route_canonicals`, and the `_apply_*` injectors.

Order matters. Run as a single chain (sequential, no `&`):

```bash
# Optional for new or updated share cards:
python _gen_og_images.py
# build-chain:start
python halfwidth_to_fullwidth.py
python _normalize_reviewed_by.py
python _normalize_entity_links.py
python _inject_speed_insights.py
python _gen_feeds.py
python _gen_related.py
python _gen_serp_meta.py
python _gen_faqpage_jsonld.py
python _gen_en_pages.py
python _gen_search_index.py
python _gen_api_content_snapshot.py
python _gen_llms_txt.py
python _gen_llms_full_txt.py
python _gen_opensearch.py
python _gen_profile_schema.py
python _gen_site_graph.py
python _gen_route_canonicals.py
python _apply_i_series.py
python _apply_a11y_vt.py
python _apply_trusted_types.py
python _apply_f10_image_priority.py
python _normalize_skiplinks.py
python _extract_critical_css.py
python _gen_csp_hashes.py
# build-chain:end
python validate.py
```

### ⚠️ `_gen_csp_hashes.py` MUST be the last build step

`_extract_critical_css.py` injects an inline `<style data-critical-css>` block
into every page. Its SHA-256 has to be in the CSP allowlist in `middleware.js`,
which `_gen_csp_hashes.py` writes. **If csp_hashes runs first**, middleware.js
lists the hash of the *previous* build's critical-CSS block. This is normally
invisible because the extracted critical CSS is a fixed point (build N's hash
already matches build N+1's content) — but the instant you change `app.css` or
`article.css`, the extracted critical CSS changes too, the stale hash no longer
matches, and CI's drift check fails on a 1-line `middleware.js` diff. Fixed
permanently in `quality.yml` + this doc 2026-05: **extract_critical_css → csp_hashes**.
If you ever reorder the build chain, keep csp_hashes dead last.

### Two-pass convergence

`_gen_serp_meta.py` is **not idempotent on the first run** when `og:image:alt`
changes (it propagates the new alt into inner JSON-LD `image.name`/`image.caption`
on a *subsequent* pass). If CI flags drift right after a push, re-run steps 3 →
9 above, then commit + push again. See WRITING_NEW_ARTICLE.md for full details.
