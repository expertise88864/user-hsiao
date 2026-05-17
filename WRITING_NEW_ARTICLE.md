# Writing a new article for HsiaoEye

Quick reference for adding a new patient-education article.

## Checklist

When you add a new article, **four** places need updating:

1. ✅ Create `blog/<slug>.html` (the article itself)
2. ✅ Add an entry to `DN.ARTICLES` in `blog/blog-shared.js`
3. ✅ Add a card to `index.html` (homepage "最新文章" list)
4. ✅ Add a card to `blog/index.html` and a tile to `blog/topics.html`

CI check `_check_article_listings.py` enforces (2)–(4) — any drift fails the build.

Then run the build scripts (in this order):

```bash
python halfwidth_to_fullwidth.py     # zh punctuation normalization
python _gen_og_images.py              # OG card for the new article
python _gen_en_pages.py               # /en/ mirror with content swap
python _gen_csp_hashes.py             # CSP hash refresh
python _extract_critical_css.py       # critical CSS re-inline
```

---

## Article HTML structure

Use an existing article as a template — `blog/toric-iol-astigmatism-cataract-review.html` is the current reference (2026-05 patterns).

### Head section (essential)

```html
<head>
<script>
  // Auto cache-bust on stale SW. Copy from any existing article.
</script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>… | HsiaoEye · 蕭閔謙醫師</title>
<meta name="description" content="…">   <!-- 100–170 chars -->
<meta name="theme-color" content="#3a5a7c">
<meta name="keywords" content="…">

<link rel="canonical" href="https://hsiao.chendermatologist.com/blog/<slug>">
<link rel="alternate" hreflang="x-default" href="…">
<link rel="alternate" hreflang="zh-Hant-TW" href="…">
<link rel="alternate" hreflang="en" href="…/en/…">

<!-- Open Graph + Twitter cards -->
<!-- JSON-LD: MedicalScholarlyArticle + BreadcrumbList + FAQPage (if Q&A present) -->
</head>
```

### Body sections

- **Hero figure**: `<figure class="article-fig">` with inline SVG. Must have `viewBox` AND `aspect-ratio` (set by `_apply_a11y_vt.py`). First `<img>` gets `fetchpriority="high"` auto-applied.
- **Section H2s**: numbered `一、`, `二、` …. Conventional order: 開場 → Q&A → 重點總整 → 背景 → 適應症 → 細節 → 進階 → 結語 → 系列文章 → 參考文獻
- **Disclaimer block**: every article opens with `<div class="disclaimer">⚠️ 免責聲明：…</div>`

### Bilingual content pattern

Every visible text element should pair `data-zh` and `data-en`:

```html
<p data-zh="醫師，我覺得眼睛超乾，但檢查說沒事…"
   data-en="Doctor, my eyes feel terrible but the exam looks fine…">
  醫師，我覺得眼睛超乾，但檢查說沒事…
</p>
```

The visible text inside the tags is the ZH default. At build time, `_gen_en_pages.py` swaps `data-en` value into the inner HTML for `/en/` pages (so Google sees real English). At runtime, `DN.applyTextOnly()` swaps based on the lang toggle.

**Important — when you edit the visible text, also update `data-zh`** (the admin WYSIWYG does this automatically via `_sanitizeForSerialize()` in `blog/blog-admin.js`, but manual edits need manual sync).

## Reusable CSS components

All defined in `assets/article.css` (defensive inline copies in each article too):

| Class | Use case |
|---|---|
| `.disclaimer` | Top medical disclaimer banner |
| `.hs-redflag-box` + `.hs-redflag-title` + `.hs-redflag-list` | 🚨 急診紅旗 — clinical "see doctor now" warning |
| `.hs-warn-box` + `.hs-warn-title` | ⚠️ 警示框 — yellow advisory |
| `.hs-tip-box` + `.hs-tip-title` | 💡 提示框 — green tip / suggestion |
| `.hs-related-box` + `.hs-related-pills` + `.hs-related-pill` | Topic silo cross-link box at bottom |
| `.ted-table` | Clinical comparison tables (used in TED article, generic) |
| `.hs-paper-badge` | 📑 「最新研究解析」 badge |
| `.myth-card` + `.myth` + `.truth` | Q&A pattern for myths / misconceptions |
| `.keypoint` + `<h3>` 30秒重點 + `<ul>` | TL;DR keypoint box near top |
| `.references` + `<ol>` | Vancouver-style reference list at end |

## Adding a Topic Silo Cross-Link Box

Use the established pattern in `blog/toric-iol-astigmatism-cataract-review.html`:

```html
<div class="hs-tip-box">
  <p class="hs-tip-title">📚 <span data-zh="HsiaoEye「白內障」系列文章" data-en="HsiaoEye Cataract Series">HsiaoEye「白內障」系列文章</span></p>
  <ul>
    <li><a href="/blog/cataract-comprehensive-guide" style="color:var(--blue-deep);text-decoration:underline">
      <strong data-zh="白內障手術完整衛教" data-en="Cataract Surgery — Patient Education">白內障手術完整衛教</strong>
    </a> <span data-zh="— 基礎知識…" data-en="— Basics…">— 基礎知識…</span></li>
    ...
  </ul>
</div>
```

Always place at the bottom of the article, just before references.

## 健保條文引用

HsiaoEye 採嚴格規則：**只寫衛福部「全民健康保險藥品給付規定」實際有列的條文**。

如果該藥物沒在 docx 內，文章要明寫「健保未收載 → 全自費」並用 `.hs-warn-box` 突顯。

完整速查表見 user memory `hsiao_eye_nhi_reference.md`：
- §1.5.1 Pilocarpine
- §14.1 青光眼
- §14.4.1 quinolones (cataract postop)
- §14.5 人工淚液
- §14.8 Ketorolac
- §14.9.3 Cyclosporine
- §14.9.6 0.01% atropine (兒童近視 since 112/5/1)
- ❌ 未收載：Teprotumumab、Lifitegrast、0.05% atropine、Toric IOL、OK 鏡、近視雷射

**IOL（含 toric / multifocal）不在「藥品給付規定」內，屬「特殊材料給付規定」 — 文章要明寫此區別。**

## Categories (DN.ARTICLES `cat` field)

| `cat` value | Chinese label | English label | Usage |
|---|---|---|---|
| `alert` | 警訊辨識 | Red Flags | "急性發作" / "急診紅旗" articles |
| `rx` | 衛教 | Patient Ed | Standard treatment / disease-overview articles |
| `myth` | 迷思澄清 | Myth-busting | "X 大迷思" structured myth-card articles |
| `notes` | 學習筆記 | Notes | Internal / residency-oriented deep-dives |
| `research` | 最新研究 | Latest Research | "2026 X study" digest articles |

## Date conventions

- `date:` field in DN.ARTICLES = 西元 YYYY-MM-DD (e.g., `'2026-05-17'`)
- Article visible date can be Republic of China year (民國) — e.g., 「115/4/23 公告版本」
- Last updated badge in head: `更新日期 · 2026-05-17`

## Service Worker version

After adding any new article, no manual SW bump needed unless you also changed `blog/blog-shared.js` structure. Cache-bust stamp (`T='20260643x'` near top of every HTML) only needs bumping when structural JS changes occur.

## Testing locally

After saving, run:

```bash
python validate.py                    # title / description / OG / a11y
python _check_meta.py                 # SEO meta
python _check_internal_links.py       # 404 detection
python _check_bilingual_attrs.py      # data-zh / data-en pairs
python _check_article_listings.py     # all 4 places updated?
```

If any fail, fix and re-run. CI runs the same checks.

## Common pitfalls

1. **Forgot to add to `blog/index.html` or `topics.html`** — `_check_article_listings.py` catches this.
2. **`data-en` attribute contains escaped `\"` instead of `&quot;`** — breaks both client toggle AND `_gen_en_pages.py` swap. Use `&quot;` for inner quotes.
3. **Description >170 chars** — Google truncates; CI warns.
4. **First `<img>` missing `fetchpriority="high"`** — `_apply_f10_image_priority.py` adds it but only after a clean run.
5. **NHI claims without docx verification** — easy to make up plausible-sounding rules. Always cross-reference the user memory NHI reference file before publishing.

## See also

- `blog/blog-shared.js` — runtime behaviour reference
- `_gen_en_pages.py` — how EN mirror is built (content swap algorithm)
- `_apply_a11y_vt.py` / `_apply_i_series.py` / `_apply_f10_image_priority.py` — post-write transforms
