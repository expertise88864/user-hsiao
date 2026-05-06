# HsiaoEye Admin Mode — Setup Guide

A WYSIWYG editor for HsiaoEye that commits straight to GitHub via the
Contents API. Edits made in `/admin` survive `git push` because **the edits
ARE the git commits** — not stored separately. Local devs must `git pull`
before editing locally.

## Required Vercel Environment Variables

Set these in **Vercel Dashboard → Project (user-hsiao) → Settings →
Environment Variables**. Apply to **Production** + **Preview** environments.

| Variable | Value | Notes |
|---|---|---|
| `ADMIN_PASSWORD` | A strong password (≥16 chars) | Used to login at `/admin`. **Don't reuse anywhere else.** |
| `GITHUB_TOKEN` | A GitHub Personal Access Token (PAT) with `repo` scope | Generate at <https://github.com/settings/tokens?type=beta> → "Fine-grained" → repo `expertise88864/user-hsiao` → permissions: **Contents: Read & write** |
| `GITHUB_OWNER` | `expertise88864` | (default if unset) |
| `GITHUB_REPO` | `user-hsiao` | (default if unset) |
| `GITHUB_BRANCH` | `main` | (default if unset) |

After setting env vars, **redeploy** the project (Vercel does this
automatically when env vars change, but you may want to trigger manually).

## How to Use

### Login

1. Browse to `https://hsiao.chendermatologist.com/admin`
2. Enter the `ADMIN_PASSWORD` you set in Vercel
3. You stay logged in for 8 hours via httpOnly cookie

### Edit an Existing Article

1. From the dashboard, click **編輯** next to any article
2. The article opens with `?admin=1` — the body becomes contenteditable
   (dashed outline appears around editable blocks)
3. Click anywhere in a heading / paragraph / list item to edit text
4. Select text → use the floating bottom toolbar:
   - **字型** (Font) — Noto Serif TC / Inter / JetBrains Mono / etc.
   - **字級** (Size) — 13 / 14 / 15.5 / 17 / 20 / 24 / 32 px
   - **B** Bold (Cmd/Ctrl+B), *I* Italic (Cmd/Ctrl+I), <u>U</u> Underline
   - **• 項目** Unordered list, **1. 編號** Ordered list
   - **🔗 連結** Insert link (prompts for URL)
   - **⨯ 清除** Remove formatting
5. Click **💾 儲存** (or press Cmd/Ctrl+S) — auto-commits to GitHub
6. Vercel detects the commit and re-deploys (~30 sec)

### Create a New Article

1. Click **+ 新文章** on the dashboard
2. Fill in: slug, Chinese title, English title, Chinese tag, English tag, category
3. Click **建立** — creates `blog/<slug>.html` from a minimal template +
   adds entry to `DN.ARTICLES` in `blog-shared.js`
4. You're auto-redirected to `/blog/<slug>?admin=1` — start editing

### Logout

Click **登出** in the dashboard header. Clears the session cookie.

## Architecture

```
Browser (admin.html)
   │ POST /api/admin/login {password}
   ▼
/api/admin/login.js
   │ if password matches ADMIN_PASSWORD:
   │   set hs_admin_session cookie (HMAC-signed, 8 hr)
   ▼
Browser → article page with ?admin=1
   │ blog-shared.js DN.initAdminMode()
   │   - makes article body contenteditable
   │   - shows floating toolbar
   ▼ (on Save)
/api/admin/save.js
   │ verify session cookie
   │ call GitHub Contents API (PUT /repos/.../contents/blog/<slug>.html)
   ▼
GitHub commits → Vercel webhook → re-deploy → site updated
```

## Security Notes

- **Session cookie**: HMAC-signed with `ADMIN_PASSWORD` as secret, 8-hour expiry,
  `HttpOnly` + `Secure` + `SameSite=Strict`.
- **Password**: never stored — verified via constant-time `crypto.timingSafeEqual`.
- **GitHub PAT**: stored only as Vercel env var, never sent to client.
- **Robots / sitemap**: `/admin` + `/api/admin/*` excluded from indexing
  (`X-Robots-Tag: noindex,nofollow` header + `robots.txt` Disallow).
- **CSP**: existing site CSP is `'self'`-based, so `/api/admin/*` calls are
  allowed by default.
- **Rate limiting**: relies on Vercel's default DDoS protection. For more
  aggressive throttling, deploy via Vercel Edge Middleware.

## Limitations

- **Single admin only** — no multi-user / role-based access.
- **No revision history beyond git** — every save is a git commit, so
  `git log blog/<slug>.html` shows full history.
- **No media upload** — to add images, commit them to `assets/` via local
  git first. Future enhancement: `POST /api/admin/upload` to handle WebP
  uploads via GitHub blob API.
- **/en/ mirror not auto-updated** — after editing a zh article, run
  `_gen_en_pages.py` locally + commit, OR build `/api/admin/regen-en` route
  (TODO).
- **No "draft" mode** — saves go straight to production. For drafts, edit
  on a Vercel preview branch instead.

## Troubleshooting

### "ADMIN_PASSWORD env var not configured"
Set the env var in Vercel Dashboard, then redeploy.

### "Invalid password" when password is correct
Check that `ADMIN_PASSWORD` env var doesn't have leading/trailing whitespace.

### "GitHub PUT failed: 401"
Your `GITHUB_TOKEN` is invalid or expired. Generate a new fine-grained PAT
with **Contents: Read & write** permission.

### "GitHub PUT failed: 403"
The PAT doesn't have access to the repo. Check the PAT's repository scope
includes `expertise88864/user-hsiao`.

### Save succeeds but site doesn't update
Vercel deploy webhook may have failed. Check **Vercel Dashboard → Deployments**
for the latest commit. If "Failed", click "Redeploy".

### I edited locally but lost the admin's changes
Always `git pull origin main` before editing locally. The admin's edits
are real git commits on `main`.
