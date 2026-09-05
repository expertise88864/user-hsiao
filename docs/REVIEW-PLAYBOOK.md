# REVIEW-PLAYBOOK.md — 全站審查手冊（含現況判定）

> **讀者**：未來執行審查/健檢的 AI session（任何模型等級）。
> **這份檔案是什麼**：每個維度 = ①這個站「好」的具體判準 ②怎麼檢查（指令級）③**現況判定**（含證據錨）④刻意偏差（引 DECISIONS.md）⑤何時需要重審。
> **怎麼用**：被要求「做 review」時，先跑各維度的檢查指令、對照現況判定——只回報「與記錄現況不同」的新發現。與 docs/DECISIONS.md 一致的狀態不是 finding。
> **審查方法論**（弱模型也能執行的品質保證）：一次只審一個維度；每個 critical/high 發現先用「懷疑者視角」自我反駁一次（找反證的 file:line）再回報；量化宣稱必須有指令輸出佐證。
>
> 現況判定基準：commit `66745a6`（2026-06，cache-bust `v=20260664`），閘門 `_check_all.py --quick` = **59 pass / 0 warn / 0 fail**。

## 2026-09-05 修正覆核

本次以 `433ce06` 為修正基準，對完整 review 的 R01–R11 落實修正：

- 視覺編輯器以 authenticated GET 取得原始 HTML 與 blob SHA；視覺、Markdown、離線重送均須送出原版本，過期回 409。舊版本本地草稿另存備份並提供下載。
- 含 `data-zh` / `data-en` 的文章禁止 Markdown 儲存，使用視覺編輯器保留翻譯；尚未提供無損雙語 Markdown round-trip。
- 推播 migration 以單次 Redis Lua 補齊所有 legacy 訂閱，HSETNX 保留較新資料，完成後才寫 marker。
- 搜尋在 idle 前綁定；每個計算器初始化各自隔離例外。
- live API 使用共用 literal catalog parser，安全處理跳脫引號與字串中的大括號；字數欄位按 token 更新，重算無差異回 noop。
- Python catalog consumers 共用跳脫感知的欄位／record 擷取；JSON-LD 錯誤訊息顯示檔名。
- CMS regen 使用 `preflight.py --run-chain` 執行 quality.yml 的 24 步權威链；skip-link prune 在 injection 後，文件檢查核對真正命令與順序。

驗證：完整 preflight 固定點與 64 項靜態檢查通過；新增 API、Python、瀏覽器回歸案例涵蓋上述失敗路徑。外審結果以審查證據與 commit trailers 為準，不據此小節宣稱 Claude 通過。cache epoch `20260669`。歷史 pending 清單仍保留，不能以本次修正取代未完成的歷史覆核。

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
**已知未修（低優先、記錄在 BACKLOG A-01~A-03）**：**25 個**非文章頁的 skip-link 指向不存在的 `#hs-related`（Sweep B 親自 grep 更正,非原記的 ~15;`#dn-newsletter` 的 id 確實存在,見 A-01）；~~`404.html` 遺留無 :focus 的舊 skip-link~~ → **A-02 ✅ 已修(2026-07-27)**:實際殘留處是 `tools/eye-3d.html` 不是 `404.html`,已移除該隱形連結(該頁另有 `.hs-skiplinks` 與 `.skip-to-main` 兩個可見機制)；搜尋 modal aria-label 固定中文；全域 placeholder 色 #9ca3af 對比不足（主要影響 admin/tools 表單）。
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
- ~~已知債：install 精快取所有 tier~~ → **P-04 已修（2026-07-26）**：install 只精快取 `SHELL`；`POPULAR` 改由**第一個 fetch 事件**的 `e.waitUntil` 預熱（放在 activate 會 gate activating→activated,讓受控 client 在更新後卡住);`LAZY` 走 runtime handler。本次同時 bump `CACHE` v71→v72(內容形狀改變)。

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

**判準**（內容可讀性與可抽取性；不預設搜尋或引用增幅）：
- **可抽取性**：H2/H3 有穩定 id；每個標題下第一段先給直接結論（answer-first；以 40-60 字為編輯參考，不省略醫療限制）；段落自包含；結構化事實用表格/清單。
- **來源可驗證性**：現有統計數字與適當引述附來源、提供 DOI 或原始指引連結，便於讀者核對；不能把研究環境的引用增幅套用本站，也不為追求引用而新增未核可數字。
- **表面檔案**：robots 對 AI 開放（D-01 ✅）；llms.txt + llms-full.txt 存在即可，**不再投資**（本站尚無可驗證的新增流量效益，不以檔案存在推定成效）。
- **誠實預期**：AI 引用與搜尋點擊應分開量測，不能保證固定時程或幅度；成長優先序需依當期 GSC 與線上資料判斷（見 GROWTH-PLAYBOOK）。

**檢查指令**：
```bash
grep -c "data-faq-auto" blog/*.html | grep -v ":0"   # FAQPage 覆蓋
grep -l "doi.org" blog/*.html | wc -l                 # 引用密度
# answer-first 抽查：逐頁看前 3 個 H2 是否先回答問題；40-60 字僅為編輯參考，必須保留醫療限制
# AI 引用與搜尋成效分開量測：docs/GROWTH-PLAYBOOK.md §4
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

**耦合矩陣的「✅ 有守門」已用變異測試逐條實證（R2-3，2026-07-11）**——宣稱有守但實際不響，和永遠綠的檢查器是同一類假保證，所以宣稱本身也要被驗。結果：
- **列 2（vercel.json 資產 headers）✅ 屬實**，但**只涵蓋 `EXPECTED` 字典裡的路徑**。我第一次變異打到 `/icon.svg`（不在字典內）沒被抓，差點誤判文件說謊——**是測試錯，不是文件錯**。改打 `/assets/app.css` 立刻抓到。教訓：測耦合前先確認「守門實際涵蓋哪些鍵」。
- **列 5（CSP inline-script hashes）✅ 屬實，但機制要看清楚**：`preflight.py` **不會報告**已 commit 的 drift——它重跑生成鏈把竄改值**直接覆蓋修好**，然後固定點檢查當然通過。真正報警的是 **CI 的 drift step**（重跑後 `git diff` 比對**已 commit** 的樹）。所以「本機 preflight 綠」**不等於**「committed 檔案沒 drift」——**現行 preflight 證明不了後者**；能證明的是 CI 的 drift step，**或**本機自己跑完生成鏈後下 `git diff HEAD --exit-code`。
- **列 6/7（halfwidth admin 鏡像、reviewedBy Person 內容）確認未守**，與文件標註的 ⚠ 一致（變異後 0 個檢查器響）。
- **新修（屬 policy 正確性，非傳播修復——codex 校正了我原本過頭的說法）**：`/icon.svg`、`/favicon.ico` 標 `immutable` 卻無版本參數。`immutable` 是告訴瀏覽器「在此回應的**新鮮期內**不必再驗證」(RFC 8246)，用在未版本化資產是不當宣告，違反 D-11。已移除 `immutable`、保留 `max-age=2592000`，並**首次把兩者納入 `_check_static_asset_headers.py`**（原本都不在涵蓋內，policy 可無聲漂移）。**但這不代表換圖示就會快速傳播**：(a) `max-age` 仍是 30 天，`immutable` 主要只是抑制「重新整理時的再驗證」；(b) **更關鍵**——兩個圖示都在 `sw.js` 的 SHELL 精快取（`sw.js:405-406`）且通用 handler 是 **cache-first**（`sw.js:~718`），所以受 SW 控制的回訪者會續用舊圖示。**注意:連「bump SW 快取版本」也不保證即時**——bump 只是換一個 CacheStorage 世代，而精快取用的 `c.add()` 是**預設 cache mode 的 fetch**，可能直接重用瀏覽器 HTTP 快取中仍新鮮(30 天內)的回應，把**舊位元組**裝進新的 SW 快取。此處可靠的兩個選項是:**把圖示 URL 本身版本化**(本站有明確的 `<link rel="icon" href="/favicon.ico">`，`href` 可改成帶版本的 URL;只有在**沒有**明確 link、瀏覽器退回隱含 `/favicon.ico` 路徑時才無法版本化)，或**讓精快取的 fetch 繞過/強制再驗證 HTTP 快取**(例如 `new Request(u, { cache: 'reload' })`)。此外 `trimCache()` 的 30 天 TTL 淘汰或瀏覽器儲存回收也可能更早移除它，但不可依賴。

**Phase 5 新發現（LOG，見 BACKLOG）**：`_extract_critical_css.py` 把 `@supports` 區塊誤標成 `@media`（P-05，perf-completeness）；`_gen_en_pages.py` `should_drop_en_jsonld` 只看 top-level `@type`，`@graph` 巢狀 FAQPage 會漏（M-08，潛伏，現行全站無 @graph）。**已修**：`_gen_csp_hashes.py` `\bsrc=`→`\ssrc\s*=`（避免 `data-src` 內嵌 inline script 被誤判外部而 CSP 封鎖；output-neutral）。

**檢查器本身也要被審——而且要用變異測試（R2-1 教訓，2026-07-11）**：
歷來把 63 個 `_check_*.py` 排除在審查外，理由是「CI 每日行使，錯了會自我暴露」。**這個理由對假陰性是錯的**：一個**永遠不會失敗**的檢查器永遠不自曝，卻讓整條「CI 綠 = 沒問題」的信任鏈變成空頭支票。實測抓到 **3 支永遠綠**（`_check_inline_scripts`、`_check_balance`、`_check_articles` 的真檢查路徑）＋ 3 個綁定不到的斷點。
- **審檢查器的正確方法 = 變異測試**：故意破壞一個真實不變量（拿掉 canonical／把已發布頁改 noindex／弄壞 JSON-LD／拿掉 img alt／讓兩頁標題撞號／弄壞 inline script）→ 跑 `_check_all.py --quick` → **確認它變紅** → `git checkout --` 還原。靜態閱讀會漏掉「有 `exit(1)` 但診斷路徑通不到它」這類問題（我第一版探針就漏了 `_check_articles`）。
- **驗收新檢查器的最低標準**：不只證明「現況通過」，必須證明**它會失敗**。
- 現有 6 項變異的基準結果記在 BACKLOG「Round 2 批次 1」。

**核心原則**（單人醫師 + 輪替 AI session 的維護模型）：
1. **權威優先序**：CI（quality.yml）>檢查器（_check_*）>文件（*.md）>記憶。文件與 CI 打架時，CI 是對的，然後修文件。**但 CI 的權威取決於檢查器真的會失敗**——見上一段。
2. **每個耦合都要有 CI 守門**——發現「改 A 必須同步改 B」而沒有檢查器守著時，優先補檢查器而不是補文件。
3. **禁止新增 regex-HTML 手術**除非：(a) 現有 generator 無法做 (b) 寫成冪等 + sentinel (c) 加對應 _check_*。
4. 新 generator 必須同時更新：quality.yml drift 清單 + WRITING_NEW_ARTICLE.md 鏈文件（歷史教訓：兩者 drift 是常態，preflight.py 因此**動態解析 quality.yml**）。

**已確認死碼**（66745a6）：~~`assets/components.js`~~ **已刪(M-01 ✅,2026-07-27:檔案 + vercel.json header + checker EXPECTED 三處同刪;`blog-admin.js` 兩個吐 `<hs-redflag>`／`<hs-tldr>` 的指令一併改成文章實際使用的 class 標記)**；~~`apply_magazine_template.py` 內嵌過時 footer CSS~~ **M-02 ✅ 已修(2026-07-27)**——更正原判定:那份 CSS 的 `.mag-foot-cols h5` **在範本自己的輸出裡是有效的**,真正的問題是範本吐 `<h5>` 而全站慣例與 app.css 都是 `<h4>`;已先對齊標記再移除重複 CSS。

---

## 10. 內容品質（醫療正確性）— **機器不可替代區**

**判準**：每個臨床宣稱可溯源到文內引用（指引/RCT/官方）；數字（發生率、%、劑量、時程）**只能**來自已引用來源；《醫療法》衛教框架（D-08）。

**AI session 的鐵律**：
- 只能**重述**文章已有引用支持的內容；不得新增未溯源的臨床宣稱。
- 需要新事實時：標 `<!-- TODO(醫師確認): ... -->` 並在回報中明列，**不要**自行搜尋補「大概正確」的醫療數字。
- 醫療內容的最終判定者是站主本人（執業醫師）。這不是模型能力問題，是責任結構——**任何模型等級都一樣**。

---

## 11. 現況判定總表（基準 commit `892b6a5`；工單 2026-07 Phases 1–6 + Sweep A/B/C + Round 2 審查後更新）

> **可信度標記**：機器可驗部分由 `_check_all.py --quick` = **59/0/0** 佐證（高信心）。倉庫共 **62 個** `_check_*.py`，`--quick` 收其中 59 個。（原表寫「60 個檢查器」，是把 Round 2 刪除的恆真檢查器 `_check_balance.py` 計入；已更正。）每個 commit 走三閘（`preflight.py` → codex 外審 → CI）全綠才上線；codex 模型 P1–P4 為 `gpt-5.5`，P5 起為 `gpt-5.6-sol`。
>
> **覆蓋範圍（誠實聲明）**——分「逐行全檔」與「關鍵路徑」兩級。下表 ★ 僅代表該維度**有被審查觸及**，不等於該面 100% 逐行。
>
> **已逐行全檔讀畢**
> - `sw.js`（982 行）—— P2。
> - `blog/blog-shared.js`（5,473 行）—— P1 讀前半（linear 1–2260 + cmdk + TOC 區段），**R2-2 補完後半 2260–5436**。原表記的「後半僅 targeted risk-sweep、非逐行全讀」缺口**已關閉**。
> - `middleware.js` —— P5 全檔。
> - **28 個生成器**（`_gen_*` / `_apply_*` / `_inject_*` / `_normalize_*` / `_extract_*`）—— P5 抽核 6 個 + **Sweep B 補完其餘 23 個**。（原表對 generator 總數不作宣稱；實測為 28，權威建置鏈 `quality.yml` 為 22 步。）
> - **62 個 `_check_*.py` 驗證器** —— **R2-1**。這批是 CI 的**信任層**，卻在 Round 2 之前**從未被審查過**；該輪以變異測試逐檔驗證，抓出 6 個偽陰性、刪除 1 個恆真檢查器（`_check_balance.py`）。
> - `assets/trusted-types.js` —— Sweep A。
>
> **關鍵路徑覆蓋（不宣稱逐檔逐行）**
> - `api/`（54 檔）—— P3 深讀 27 檔（auth / gating / 公開端點 / KV 寫入，且**所有特權端點**的 `requireAdmin` 逐一 grep 核實）＋ Sweep A 再掃 25 個 admin 工具端點。兩批有重疊，故**不宣稱 54/54 逐行**。
> - admin CMS（`admin.html` + `blog/blog-admin.js`）—— P4 存檔路徑與認證面深讀，其餘由 Sweep C 覆蓋。
> - 生成的文章 HTML 與 `/en/` —— 生成物，屬內容面（見 §10），不計入程式審查覆蓋率。

| # | 維度 | 判定 | 依據（★=審查觸及） | 開放債（BACKLOG） |
|---|---|---|---|---|
| 1 | 技術 SEO | ✅ PASS | 閘門綠；sitemap 48 URLs；noindex/redirect 邊界依 D-02/03/04；★feeds/sitemap 生成器 P5 核實（XML escape 防 CDATA breakout）；T-01 已核實關閉 | T-02（新文 OG 404） |
| 2 | 內部連結 | ✅ PASS | 0 孤兒；三叢集全互連（`4aded2b` 審計） | 無（維持 D-23 紀律） |
| 3 | 無障礙 | ✅ PASS | CI axe-core 綠；★R2-1 `_check_static_a11y` 的 `<img>` 缺 alt 偽陰性已補 | A-01（A-02 ✅、A-03） |
| 4 | 安全 | ✅ PASS（★深度審查） | ★P3 api/ auth 面無 bypass、KV await（S-03✅）；★P4 admin CMS（M-06✅ + 反漂移閘）、S-01✅核實不存在；★P5 CSP fail-closed + 單一來源、S-04✅；★**R2-1 CI 信任層**（`_check_inline_scripts` 舊版只掃 index.html 且恆 exit 0，現覆蓋 66 檔 158 個 block） | 剩 **S-02**（既有 SVG 無 CSP） |
| 5 | schema.org | ✅ PASS（★深度審查） | 全 `_check_*schema*` 綠；reviewedBy inline（@id 對齊 /about#person）；★P5 `_gen_en_pages` JSON-LD 在地化/FAQPage drop 核實；★Sweep `_schema-helper` 逐 block strip 修正 | **M-08**（@graph FAQPage 漏，潛伏）；sameAs 待站主 URL（D-08） |
| 6 | Core Web Vitals | ✅ PASS（★深度審查） | CI Lighthouse 綠；★P2 sw.js 全檔（P-02✅ ignoreSearch fallback）；★P5 critical-css 生成器；★**R2-3** `/icon.svg` `/favicon.ico` 誤標 `immutable` 已依 D-11 修正並納入 checker（14 條規則） | P-01（字型）P-03 ✅（speculationrules 已合併）**P-04 ✅、P-05 ✅ |
| 7 | Metadata | ✅ PASS（★深度審查） | `_check_metadata_uniqueness`/`_check_social_locale` 綠（★R2-1 修正前者只在重複 >2 時才報的偽陰性）；★P5 `_gen_en_pages` head 手術核實（title/desc/OG/canonical/hreflang） | T-02（新文 OG 404） |
| 8 | RAG / AI 搜尋 | 🟠 PARTIAL | robots 已開放（D-01）、FAQ×20、llms-full.txt 有；answer-first 需逐頁確認是否已有摘要及改善必要 | C-02（answer-first 可讀性改善，需量測效果）；量測見 GROWTH-PLAYBOOK |
| 9 | 可維護性 | 🟠 PARTIAL（改善） | 建置鏈由 preflight 動態解析；★§9 耦合矩陣 P5 補完、**R2-3 逐列變異測試複驗**並加上「CI 守門」欄；★M-06✅ 以 checker 強制（D-24）；★R2-2 補上 `blog-shared.js` 內硬寫 `?v=` 的未守耦合；M-03/M-04 已修 | **M-05**（M-01 ✅、M-02 ✅、M-07 ✅）；2 個未守耦合見 §9（halfwidth admin 路徑、reviewedBy Person） |
| 10 | 內容正確性 | ⛔ 不可機器判定 | 見 §10 | C-01（兩篇待寫，站主定案） |

**歷史評估（2026-07；當期診斷請依 GROWTH-PLAYBOOK 重新核對）**：當時技術面評估為頂標、**59 個檢查器**（`--quick`）守著，且工單 2026-07 五大高風險面深度審查 + Sweep A/B/C 補完未讀面 + Round 2 三批（驗證器 / `blog-shared.js` 後半 / 架構橫向）皆三閘全綠上線；**覆蓋範圍見上方誠實聲明**。Round 2 最大的發現不是功能 bug，而是**假保證**——恆真的檢查器、文件宣稱有守但實際沒守的耦合、把「我不知道」render 成「沒問題」的 CI 工具；對策已寫成制度（§9 CI 守門欄 + 「檢查器本身也要用變異測試審」）。**真正的成長瓶頸仍在站外**（權威/外鏈/分發/作者身分）與**內容端**（answer-first 改寫、招募審閱者）——見 docs/GROWTH-PLAYBOOK.md。程式端剩的都是 BACKLOG 裡分級好的 polish/中度債 + 少數潛伏項（M-07 ✅／M-08 ✅／P-04 ✅／P-05 ✅ 皆已修並上線;剩 M-05／M-09／M-12～M-15,新開 M-16／M-17），**無 🔴 會壞站的項目**。

---

## 審查完成後的義務
1. 新發現 → 寫進 docs/BACKLOG.md（含驗收條件 + 模型等級）。
2. 定案的新決策 → 追加 docs/DECISIONS.md（含重開條件）。
3. 修了東西 → 走 docs/MODEL-GUIDE.md §5 的 pre-push 閘門（`preflight.py` → codex → push → `_ci_status.py`）。
4. 本表「現況判定」過時了 → 重跑各維度檢查指令、更新判定與基準 commit。
