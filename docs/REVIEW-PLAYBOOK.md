# REVIEW-PLAYBOOK.md — 全站審查手冊（含現況判定）

> **讀者**：未來執行審查/健檢的 AI session（任何模型等級）。
> **這份檔案是什麼**：每個維度 = ①這個站「好」的具體判準 ②怎麼檢查（指令級）③**現況判定**（含證據錨）④刻意偏差（引 DECISIONS.md）⑤何時需要重審。
> **怎麼用**：被要求「做 review」時，先跑各維度的檢查指令、對照現況判定——只回報「與記錄現況不同」的新發現。與 docs/DECISIONS.md 一致的狀態不是 finding。
> **審查方法論**（弱模型也能執行的品質保證）：一次只審一個維度；每個 critical/high 發現先用「懷疑者視角」自我反駁一次（找反證的 file:line）再回報；量化宣稱必須有指令輸出佐證。
>
> 現況判定基準：commit `66745a6`（2026-06，cache-bust `v=20260664`），閘門 `_check_all.py --quick` = **59 pass / 0 warn / 0 fail**。

---

## 0. 架構總覽（30 秒理解這個站）

```
內容層   blog/{slug}.html（zh 正典）--[_gen_en_pages.py]--> en/blog/{slug}.html（自動鏡像，勿手改）
目錄層   blog/blog-shared.js 的 DN.ARTICLES（唯一文章目錄）+ DN.STUB_SLUGS / DN.EN_STUB_SLUGS
生成層   ~20 個 _gen_*.py / _apply_*.py / _normalize_*.py（順序敏感鏈；權威清單=quality.yml drift 步驟）
檢查層   ~35 個 _check_*.py，由 _check_all.py --quick 聚合（pre-push 閘門）
部署層   Vercel：靜態檔 + middleware.js（CSP hash，edge）+ api/*（serverless：sitemap/feed/admin/push）
CMS 層   /admin（瀏覽器內 CMS，直接 commit main）→ 這是 ANTI-OVERWRITE PROTOCOL 存在的原因
PWA 層   sw.js（precache SHELL + runtime 快取）+ manifest
CI 層    quality（drift+驗證+SEO smoke+線上 Lighthouse/axe/indexability）/ visual-regression / size-budget / regen-en
```
三個「改一處必動多處」的重心：**robots.txt**（D-01 三處耦合）、**vercel.json headers**（D-11 兩處耦合）、**DN.ARTICLES**（listings 四處，CI 有守）。完整耦合矩陣見 §9。

---

## 1. 技術 SEO

**判準**（此站語境）：
- 每個公開頁：自我 canonical（絕對 URL）、`robots` meta = index,follow（除 D-02/D-04 的刻意 noindex 清單）、zh↔en hreflang 互指 + x-default、出現在 sitemap。
- noindex 頁絕不進 sitemap、絕不被 indexable 頁直鏈（stub 除外機制）。
- 轉址：唯一合法清單在 `vercel.json` redirects（含 D-03 的 4 條 stub 轉址）；爬蟲面向工件（sitemap/feed/canonical）不得出現會轉址的 URL 形式（`_check_route_canonicals.py` 守）。

**檢查指令**：
```bash
set PYTHONIOENCODING=utf-8
python _check_all.py --quick          # 59 個檢查的聚合閘門（唯一權威）
python _check_index_boundaries.py     # noindex/sitemap/robots 邊界
python _check_hreflang.py             # 雙語互指
python _check_robots.py               # robots 群組完整性（注意 D-01 的註解陷阱）
```
線上索引狀態：**本環境無法查**（sandbox 擋 Vercel HTTPS、WebSearch 僅美國 locale）→ 請站主看 GSC（台灣）。

**現況判定（66745a6）**：✅ PASS — 閘門 59/0/0；sitemap 48 URLs；20 篇已發布文章 + 16 篇可發布 EN 鏡像全數收錄；`/notes`、4 篇 stub 依 D-02/D-03/D-04 刻意排除。
**已知殘餘風險**：~~動態 sitemap 對 GitHub token 的 SPOF~~ → **已解決**：`api/sitemap.js` 的 **`parseArticles()` 內容來源／解析失敗路徑**（`ghGetFile` throw/回 null、regex 不 match、解析出空陣列）皆退回 `api/_content_snapshot.js` 的 `FALLBACK_ARTICLES`（凍結全量快照）→ 原「token 失效 ⇒ sitemap 只剩靜態頁」的 SPOF 已消除。**範圍註**：handler 最外層 `catch` 仍回 HTTP 500（`api/sitemap.js:303`），那不是 snapshot 路徑。review Phase 3 核實，**BACKLOG T-01 ✅ 關閉**（D-05 同步更新）。
**重審觸發**：新增頁面類型、改 vercel.json redirects/rewrites、GSC 出現新的覆蓋率錯誤類別。

---

## 2. 內部連結（Internal Linking）

**判準**：
- 每篇已發布文章 ≥1 條靜態入鏈（`_check_link_orphans.py` 守）。
- 三大叢集（兒童近視控制、乾眼症、飛蚊症-視網膜剝離）：叢集內文章雙向互連（文內「延伸閱讀」+ `.hs-related-pill` + 靜態 related 區塊三層）。
- 錨點文字 = 描述性中文（「兒童近視控制總覽」），禁止「點此」。
- **反向判準：不要過度加鏈**（D-23）。同頁對同目標 >2 條文內鏈 = 過度。

**檢查指令**：
```bash
python _check_link_orphans.py
python _check_internal_links.py
python _check_en_internal_links.py    # en 鏈不得逃出 /en/（EN-stub 目標例外，指回 zh 是刻意的）
# 單篇出鏈盤點：
grep -oE "href=\"/blog/[a-z0-9-]+\"" blog/<slug>.html | sort | uniq -c
```

**現況判定（66745a6）**：✅ PASS — 0 孤兒；三叢集互連完整（抽驗 5-6 條唯一出鏈/篇）；本 session 審計後唯一真實缺口（floaters→high-myopia-maculopathy）已補（`4aded2b`）。
**新文章的義務**：發布時把新文接進所屬叢集（新文→支柱、支柱→新文，各一條，用文內情境句），其餘交給 `_gen_related.py` 自動層。
**重審觸發**：每 +5 篇新文章跑一次孤兒/叢集盤點。

---

## 3. 無障礙（a11y）

**判準**：WCAG 2.1 AA。此站特別點：skip-link 目標必須存在（`#main-content`）；小字對比 ≥4.5:1（米色底 `#faf7f2` 上的灰字是慣性違規點——`--muted` #6e6759 過、舊 token #64748b 不過）；雙語切換後 `lang` 正確；`<details>` FAQ 鍵盤可操作。

**檢查指令**：
```bash
python _check_static_a11y.py     # 注意：SKIP_LINK_RE 屬性順序敏感（class 在 href 前才匹配）——它沒抓到不等於沒問題
python _check_svg_a11y.py
python _check_button_types.py
# 線上權威：CI quality 的 axe-core job（每次 push 自動跑）
```

**現況判定（66745a6）**：✅ PASS（CI axe 綠）。已修：eye-3d landmark id、`.text-ink-500` 對比加深（`9303014`）。
**已知未修（低優先、記錄在 BACKLOG A-01~A-03）**：~15 個非文章頁的 skip-link 指向不存在的 `#hs-related`/`#dn-newsletter`；`404.html` 遺留無 :focus 的舊 skip-link；搜尋 modal aria-label 固定中文；全域 placeholder 色 #9ca3af 對比不足（主要影響 admin/tools 表單）。
**重審觸發**：改 header/footer/skip-link 注入腳本（`_apply_i_series.py`、`_apply_a11y_vt.py`）時。

---

## 4. 安全

**判準**（此站威脅模型：單管理員、公開醫療內容站，最大風險=內容被竄改/信任損毀）：
- 所有 admin 寫路徑過 `requireAdmin`（HMAC cookie）；上傳副檔名 allowlist（**無 svg**，D-15）；任何內容→HTML 路徑過消毒（D-18）。
- CSP：hash 模式 fail-closed（D-16）；/admin 有獨立 CSP（D-17）；無認證端點必須有 rate-limit + 上限（D-19）。
- 機密只在 server env（`_check_secrets.py` 守；.gitignore 擋 .env/.pem/.key）。

**檢查指令**：
```bash
python _check_secrets.py
python _check_inline_events.py && python _check_inline_scripts.py
python _check_third_party.py
# 新端點審查清單：requireAdmin? rate-limit? 輸入驗證? 輸出消毒? 錯誤不洩內部資訊?
```

**現況判定（review Phase 3 **關鍵路徑**核實，非全部 ~55 檔逐檔深讀，faef8d9）**：✅ PASS — auth 核心穩固：`_auth.js` HMAC-SHA256 + `timingSafeEqual` + 到期檢查；`_login.js` rate-limit 6/min + timing-safe + HttpOnly/Secure/SameSite=Strict；**所有特權** admin 端點以 `requireAdmin` 把關——例外皆為**刻意公開**：`_login.js` 本就是發證端點、`_ab-config` 讀取與 `_ab-stats` 計數是公開路徑（其特權操作仍 gate）；`admin/[op].js` dispatcher 自身不 gate 但**委派給各自 self-gate 的 handler**（無 bypass）+ 30/min rate-limit；公開端點**多數**有 rate-limit + 輸入驗證，**例外**：`csp-report.js` **無** per-IP rate limiter（edge runtime 無共享狀態），改以 Origin 允許清單 + 8KB body cap 防護。已修 S-03（csp-report/errors KV 寫入 await）。（先前強化：`9303014` + codex `4434ab5`/`6fdf2fb`/`2e6fb2c`）。
**已知殘債**：**只剩 S-02**（middleware CSP matcher 仍排除 `.svg`，repo 既有 SVG 無 CSP 保護）。｜**S-01 已核實不存在**（review Phase 4：**客戶端** grep（`*.html`/`*.js`；排除 `api/`、`node_modules`、`*.min.js`）**0 命中**——`api.github.com` 於 **server 端** `api/` 存在（`_github.js`/`_history.js`/`_rollback.js`/`sitemap.js`/`_upload.js`/`_upload-srcset.js`）屬**正確架構**，非債；`/admin` 是密碼→HMAC cookie→server `GITHUB_TOKEN`，本就是目標態）。｜**S-03 已修**（review Phase 3：csp-report/errors 的 KV 寫入 await + `AbortSignal.timeout`；原描述指控 search-log 為 fire-and-forget **已推翻**，它自始即 await）。｜**S-04 已修**（review Phase 5：`_gen_csp_hashes.py` 排除式誤判 `data-src` inline script）。
**`/admin` 的 XSS 防線很薄（Sweep C 核實，institutional 警示）**：`/admin` 的 CSP 是 `script-src 'self' 'unsafe-inline'`（D-17）**且** `admin.html` 的 Trusted Types default policy 是 pass-through（`createHTML: s=>String(s)`，零消毒）。故 **`escapeHTML()` 是 admin dashboard 唯一的 XSS 防線**——公開訪客可影響的資料（CSP report 的 blocked-uri、JS error message/stack、公開站的搜尋詞）若未 escape 就 innerHTML，會在 admin 已認證 session 內執行 → 站主帳號/token 遭竊、全站可被 commit 接管。**現況 clean**：那些 dashboard 的每個動態值都 `escapeHTML()` 了（含 `escapeHTML(JSON.stringify(r))` 原始 dump）。**鐵律**：任何未來 admin dashboard 新程式碼把 fetch 來的資料塞進 innerHTML 前**必須 escapeHTML**；別依賴 TT 或 CSP（在 /admin 兩者都不擋 inline handler）。CSRF 已由 `SameSite=Strict` cookie 擋（`_login.js:92`）。Markdown 預覽 mini-renderer 有小缺口但屬 admin-self（BACKLOG S-07）。

**重審觸發**：任何新 api/ 端點、admin 功能、第三方 script 加入時（逐條過上面清單）。

---

## 5. schema.org 結構化資料
<!-- 現況判定由審查代理補完 —— 若你讀到這行且下方標記為佔位，表示該次 session 中斷於此；請依「檢查指令」自行重跑判定 -->

**判準**：
- 實體圖：`WebSite ↔ Organization ↔ Person(/about#person) ↔ MedicalWebPage(每文) ↔ BreadcrumbList ↔ FAQPage`，@id 全部可解析互指。
- 每篇文章：`MedicalWebPage`（含 `lastReviewed`、`reviewedBy` = **inline Person/Physician 物件**（D-07，`_normalize_reviewed_by.py` 維護）、`about`→MedicalCondition）。
- FAQPage 只能來自 `_gen_faqpage_jsonld.py`（D-09），`data-faq-auto` 標記。
- 站主未提供前，Person **不得**有 sameAs（D-08：絕不編造外部檔案 URL）。

**檢查指令**：
```bash
python _check_medical_webpage_schema.py
python _check_faq_schema.py
python _check_home_schema.py && python _check_profile_schema.py && python _check_site_graph.py
python _check_en_jsonld.py
# 外部驗證（需站主/有網環境）：Google Rich Results Test 貼 URL
```

**現況判定（66745a6）**：（見下方代理補充；聚合閘門含上列檢查器全綠 = 機器可驗部分 PASS）

---

## 6. Core Web Vitals / 效能
<!-- 現況判定由審查代理補完 -->

**判準**：
- 渲染路徑：critical CSS inline（`_extract_critical_css.py`，只讀 app.css）+ 阻塞資源清單只允許：app.css(/article.css)、Google Fonts（D-12 已接受的債）、trusted-types.js（≤5KB，必要同步——Trusted Types 政策須先於一切 script 註冊）。
- LCP 元素禁 `loading="lazy"`；`fetchpriority="high"` 只給真 LCP 候選。
- 版本化資產 immutable（D-11）；HTML 短快取。
- 量測權威：**CI 的 Lighthouse job + Vercel Speed Insights 後台**（本地環境連不上線上站，不要嘗試本地 Lighthouse 線上 URL）。

**檢查指令**：
```bash
python _check_performance_budget.py
python _check_static_asset_headers.py
python _check_image_sizes.py
npm run minify && python _check_min_js.py   # 動過 blog-shared.js 才需要
```

**SW 快取策略矩陣**（`sw.js` fetch handler，review Phase 2 逐檔核實；改 SW 前先看這張，別重讀 982 行）：
| 請求 | 策略 | 備註 |
|---|---|---|
| `/admin`、`/api/*`、`/reset-sw` | **不攔截**（直連網路）| auth/save 必須新鮮 |
| `?v=` 版本化資產（css/js）| **network-first** → RUNTIME；離線 fallback `ignoreSearch:true`（P-02 修）| 線上永遠最新；離線用 SHELL 精快取的裸 URL 後備 |
| `/pagefind/`、`GENERATED_JSON` | network-first → RUNTIME | search/related/i18n/dict |
| navigate / `text/html` | cached-first + **900ms 網路賽跑**（逾時給 cache）；無 cache 則等網路→favourites bucket→`offline.html`→`/` | HTML 存 CACHE，50 筆軟上限 + 30d/1d TTL 自癒 |
| `.css`（**無** `?v=`）| stale-while-revalidate → RUNTIME | 現況近乎 dead code：CSS 都帶 `?v=`，會先被上面攔截 |
| 其他同源 GET | cache-first → RUNTIME（`RUNTIME_MAX_ENTRIES=60`）| 圖片等 |
- 快取版本常數：`CACHE='hs-vNN'` / `RUNTIME='hs-runtime-vNN'`（activate 時清非當前版本）。改 SW 快取「內容形狀」才需 bump CACHE；改 fetch 邏輯不需要。
- 已知債：install 精快取所有 tier（見 BACKLOG P-04）。

**現況判定（66745a6）**：（見下方代理補充；閘門綠 + CI Lighthouse 上次 push 綠）

---

## 7. Metadata（title/description/OG/Twitter）
<!-- 現況判定由審查代理補完 -->

**判準**：每頁唯一 title+description（`_check_metadata_uniqueness.py` 守）；OG/Twitter 完整含存在的 og:image（靜態 PNG，`_gen_og_images.py`）；社群卡雙語 locale（`_check_social_locale.py` 守）。
**已知缺口**：新文章在 `_gen_og_images.py` 跑之前 og:image 404（og.js 文件宣稱的 rewrite 不存在於 vercel.json——BACKLOG T-02）。

**檢查指令**：
```bash
python _check_meta.py && python _check_metadata_uniqueness.py
python _check_serp_snippets.py && python _check_serp_fallbacks.py
python _check_og_images.py
```

---

## 8. RAG-ready 架構 + AI 搜尋優化（GEO/AEO）
<!-- 現況判定由審查代理補完 -->

**判準**（依 Princeton GEO 研究 + session 成長研究的已驗證結論）：
- **可抽取性**：H2/H3 有穩定 id；每個標題下第一段 40-60 字內給直接結論（answer-first——AI 引用最大單一槓桿）；段落自包含；結構化事實用表格/清單。
- **權威訊號**：統計數字附來源、引述指引原文、DOI 連結（低權威站的 AI 引用槓桿 +30~40%）。
- **表面檔案**：robots 對 AI 開放（D-01 ✅）；llms.txt + llms-full.txt 存在即可，**不再投資**（外部審計顯示 AI bot 實際讀取率近零——session 研究結論）。
- **誠實預期**：低權威 YMYL 站近期拿不到 AI 引用（模型偏好政府/大機構來源）；這是 12-24 個月的底層工程，近期贏面在長尾排名與人為分享。

**檢查指令**：
```bash
grep -c "data-faq-auto" blog/*.html | grep -v ":0"   # FAQPage 覆蓋
grep -l "doi.org" blog/*.html | wc -l                 # 引用密度
# answer-first 抽查：開一篇文，看前 3 個 H2 的第一段是否 60 字內給結論
# AI 引用量測：docs/GROWTH-PLAYBOOK.md 的 15 題月度 prompt 協定
```

---

## 9. 可維護性 + 技術債

### 耦合矩陣（「改一處必動多處」；工單 2026-07 Phase 5 核實補完）
| 改一處 | 必須同步的其他處 | CI 守門？ |
|---|---|---|
| `robots.txt`（D-01） | `tests/seo/head.spec.js` + `_check_robots.py` | ✅ head.spec + `_check_robots` |
| `vercel.json` 靜態資產 headers（D-11） | `_check_static_asset_headers.py` | ✅ `_check_static_asset_headers` |
| `DN.ARTICLES`（blog-shared.js） | sitemap / feeds / en_pages / listings 四處 | ✅ `_check_sitemap` / `_check_search_index` / `_check_listing_schema` |
| runtime-helper strip 清單（D-24） | `blog/blog-admin.js` ↔ `api/admin/_save.js` | ✅ `_check_runtime_helper_sync`（Phase 4 新增） |
| CSP inline-script hashes | `_gen_csp_hashes.py` → `middleware.js` `INLINE_SCRIPT_HASHES_BY_ROUTE` | ✅ quality.yml **drift**（改 inline `<script>` 忘了重跑 → committed middleware ≠ 重生 → 紅）。⚠ 注意：middleware matcher **排除 `/admin`**，`/admin` CSP 來自 **vercel.json** `/admin(.*)` header（D-17），故 hash 表裡的 `/admin` 條目是**死資料**（永不被讀） |
| halfwidth 全形化規則 | `halfwidth_to_fullwidth.py` ↔ `api/admin/_halfwidth.js`（server 存檔鏡像，`_save.js` 用） | ⚠ **半守**：CI halfwidth gate 守建置產物；但 admin 直 commit 路徑要**下次 push** 才驗到 |
| `reviewedBy` Person 內容 | `_normalize_reviewed_by.py` 硬編 name/jobTitle/specialty ↔ `about.html` `#person` | ⚠ **只守 @id**（`_check_medical_webpage_schema.py`）；name/jobTitle/specialty 漂移**不會被抓** |
| stash 的 data-zh/en 例外 | `halfwidth` `ATTR_RE`（不 stash data-zh/en） ↔ `_gen_en_pages.py`（BeautifulSoup 單引號序列化） | ✅ CI halfwidth gate（v37.29 已修單引號漏網） |

**Phase 5 新發現（LOG，見 BACKLOG）**：`_extract_critical_css.py` 把 `@supports` 區塊誤標成 `@media`（P-05，perf-completeness）；`_gen_en_pages.py` `should_drop_en_jsonld` 只看 top-level `@type`，`@graph` 巢狀 FAQPage 會漏（M-08，潛伏，現行全站無 @graph）。**已修**：`_gen_csp_hashes.py` `\bsrc=`→`\ssrc\s*=`（避免 `data-src` 內嵌 inline script 被誤判外部而 CSP 封鎖；output-neutral）。

**核心原則**（單人醫師 + 輪替 AI session 的維護模型）：
1. **權威優先序**：CI（quality.yml）>檢查器（_check_*）>文件（*.md）>記憶。文件與 CI 打架時，CI 是對的，然後修文件。
2. **每個耦合都要有 CI 守門**——發現「改 A 必須同步改 B」而沒有檢查器守著時，優先補檢查器而不是補文件。
3. **禁止新增 regex-HTML 手術**除非：(a) 現有 generator 無法做 (b) 寫成冪等 + sentinel (c) 加對應 _check_*。
4. 新 generator 必須同時更新：quality.yml drift 清單 + WRITING_NEW_ARTICLE.md 鏈文件（歷史教訓：兩者 drift 是常態，preflight.py 因此**動態解析 quality.yml**）。

**已確認死碼**（66745a6）：`assets/components.js`（0 引用，仍有 vercel.json header 規則 + 檢查器期望——BACKLOG M-01）；`apply_magazine_template.py` 內嵌過時 footer CSS（BACKLOG M-02）。

---

## 10. 內容品質（醫療正確性）— **機器不可替代區**

**判準**：每個臨床宣稱可溯源到文內引用（指引/RCT/官方）；數字（發生率、%、劑量、時程）**只能**來自已引用來源；《醫療法》衛教框架（D-08）。

**AI session 的鐵律**：
- 只能**重述**文章已有引用支持的內容；不得新增未溯源的臨床宣稱。
- 需要新事實時：標 `<!-- TODO(醫師確認): ... -->` 並在回報中明列，**不要**自行搜尋補「大概正確」的醫療數字。
- 醫療內容的最終判定者是站主本人（執業醫師）。這不是模型能力問題，是責任結構——**任何模型等級都一樣**。

---

## 11. 現況判定總表（基準 commit b102ce2；工單 2026-07 Phases 1–5 審查後更新）

> **可信度標記**：機器可驗部分由 `_check_all.py --quick` = **60/0/0** 佐證（高信心）。原「⚠自評」是因**第一輪 4 個審查代理撞到 session limit**未回完整證據；**工單 2026-07（Opus 4.8）已補上深度審查**——**Phase 1–5 各走 preflight + codex + CI 三閘且全綠上線**（codex 模型：P1–P4 為 `gpt-5.5`，P5 起為 `gpt-5.6-sol`）；Phase 6（收尾 commit）走同一閘門（Phase 0 為前置基線驗證，不產 commit）。
>
> **覆蓋範圍（誠實聲明，勿當成「全 repo 逐行讀過」）**：
> - **P2 `sw.js`**：全 982 行逐行讀畢（本工單唯一的完整逐行全檔）。
> - **P1 `blog-shared.js`**：核心邏輯逐行（linear 1–2260 + cmdk + TOC 區段），其餘 ~2260–5425 以 **targeted risk-sweep**（innerHTML/message/eval/reload/activeElement 全 hit 逐一核實）覆蓋——**非逐行全讀**。
> - **P3 `api/`**：深讀**關鍵路徑**（auth/gating/公開端點/KV 寫入 + **所有特權**端點 `requireAdmin` grep 核實），**非全部 ~55 檔**逐檔深讀。
> - **P4 admin CMS**：存檔路徑 + 認證面深讀。
> - **P5 生成鏈**：工單指定的 7 檔 = **6 個 generator（抽核，非全部）** + `middleware.js` 全檔。**不是** 7 個 generator。（工單原文的「27 個生成器」計數依據未註明；權威建置鏈 `quality.yml` 為 22 步，故此處不對 generator 總數作宣稱。）
>
> 未深讀的面以「關鍵路徑已覆蓋」記；下表 ★ 僅代表該維度**有被本工單審查觸及**，不等於該面 100% 逐行。

| # | 維度 | 判定 | 依據（★=本工單審查觸及） | 開放債（BACKLOG） |
|---|---|---|---|---|
| 1 | 技術 SEO | ✅ PASS | 閘門綠；sitemap 48 URLs；noindex/redirect 邊界依 D-02/03/04；★feeds/sitemap 生成器 P5 核實（XML escape 防 CDATA breakout）；T-01 已核實關閉 | T-02（新文 OG 404） |
| 2 | 內部連結 | ✅ PASS | 0 孤兒；三叢集全互連（`4aded2b` 審計） | 無（維持 D-23 紀律） |
| 3 | 無障礙 | ✅ PASS | CI axe-core 綠 | A-01/02/03 |
| 4 | 安全 | ✅ PASS（★本工單審查） | ★P3 api/ auth 面無 bypass、KV await(S-03✅)；★P4 admin CMS（M-06✅ + 反漂移閘）、S-01✅核實不存在；★P5 CSP fail-closed+單一來源、S-04✅ | 剩 **S-02**（既有 SVG 無 CSP） |
| 5 | schema.org | ✅ PASS（★本工單審查） | 全 `_check_*schema*` 綠；reviewedBy inline（@id 對齊 /about#person）；★P5 `_gen_en_pages` JSON-LD 在地化/FAQPage drop 核實 | **M-08**（@graph FAQPage 漏,潛伏）；sameAs 待站主 URL（D-08） |
| 6 | Core Web Vitals | ✅ PASS（★本工單審查） | CI Lighthouse 綠；★P2 sw.js 全檔（P-02✅ ignoreSearch fallback）；★P5 critical-css 生成器 | P-01（字型）P-03（speculationrules）**P-04**（SW precache tier）**P-05**（critical-css @supports 誤標） |
| 7 | Metadata | ✅ PASS（★本工單審查） | `_check_metadata_uniqueness`/`_check_social_locale` 綠；★P5 `_gen_en_pages` head 手術核實（title/desc/OG/canonical/hreflang） | T-02（新文 OG 404） |
| 8 | RAG / AI 搜尋 | 🟠 PARTIAL | robots 已開放（D-01）、FAQ×20、llms-full.txt 有；但多數文章非 answer-first | C-02（answer-first 改寫，最大槓桿）；量測見 GROWTH-PLAYBOOK |
| 9 | 可維護性 | 🟠 PARTIAL（改善） | 建置鏈由 preflight 動態解析；★**§9 耦合矩陣 P5 補完**（8 列+CI 守門欄）；★M-06✅ 用 checker 強制（D-24）；M-03/M-04 已修 | **M-01、M-02、M-05、M-07**；2 個未守耦合見 §9（halfwidth admin 路徑、reviewedBy Person） |
| 10 | 內容正確性 | ⛔ 不可機器判定 | 見 §10 | C-01（兩篇待寫，站主定案） |

**一句話總結**：技術面已是頂標、**60 個檢查器**守著，且工單 2026-07 對五大高風險面做了深度審查（Phase 1–5 三閘全綠上線，Phase 6 收尾同流程；**覆蓋範圍見上方誠實聲明，非全 repo 逐行**）；**真正的成長瓶頸仍在站外**（權威/外鏈/分發/作者身分）與**內容端**（answer-first 改寫、招募審閱者）——見 docs/GROWTH-PLAYBOOK.md。程式端剩的都是 BACKLOG 裡分級好的 polish/中度債 + 幾個潛伏項（M-07/M-08/P-04/P-05），**無 🔴 會壞站的項目**。

---

## 審查完成後的義務
1. 新發現 → 寫進 docs/BACKLOG.md（含驗收條件 + 模型等級）。
2. 定案的新決策 → 追加 docs/DECISIONS.md（含重開條件）。
3. 修了東西 → 走 docs/MODEL-GUIDE.md §5 的 pre-push 閘門（`preflight.py` → codex → push → `_ci_status.py`）。
4. 本表「現況判定」過時了 → 重跑各維度檢查指令、更新判定與基準 commit。
