# BACKLOG.md — 開放技術債 / 待辦帳本

> **讀者**：未來的 AI session。這裡每一項都是**已診斷、已定驗收條件、但刻意還沒做**的項目。
> **怎麼用**：站主說「挑點事做」或你有餘裕時，從這裡照「影響÷投入」挑。**動手前**先讀該項的「驗收條件」與「模型等級」——低於你等級才自己做，否則走 MODEL-GUIDE §2 升級。做完後：勾掉 + 在 commit message 註 `docs: BACKLOG close X-nn`。
> **不在這裡的東西**：已定案的刻意狀態在 docs/DECISIONS.md（那些**不是**待辦，別去「修」）。審查判準與現況在 docs/REVIEW-PLAYBOOK.md。
> 事實基準 commit `b102ce2`（工單 2026-07 Phase 5 上線）。每項附 file:line 供查證；行號可能因後續 commit 位移，以符號/字串搜尋為準。

**嚴重度**：🔴 高（安全/會壞/明顯損失流量）｜🟠 中｜🟢 低（polish）。
**未親驗標記**：標「⚠️未親驗」= 源自制度建置 session 的多代理審查但那批代理撞到 session limit 未回完整證據。**工單 2026-07（Opus 4.8）已對五大高風險面做深度審查**——但**覆蓋範圍非「全 repo 逐行」**（僅 `sw.js` 完整逐行；blog-shared.js 核心逐行+風險掃描；api/ 只深讀關鍵路徑；生成鏈抽核 **6 個 generator（非全部）** + `middleware.js`）：詳見 REVIEW-PLAYBOOK §11 的「覆蓋範圍誠實聲明」與工單進度表。期間**改碼修復並上線**：M-03 / M-04 / P-02 / **S-03** / M-06 / S-04；**核實關閉（前提失效，未改碼）**：T-01 / S-01；**新增潛伏項**：P-04 / P-05 / M-07 / M-08。其餘未親驗項做之前先自行用該項指令覆核。

---

## 技術 SEO / 索引（T）

### T-01 ✅ 已解決（review Phase 3 核實，非本次修）動態 sitemap 對 GitHub token 的單點故障
> 親驗結論：codex 已建立 `api/_content_snapshot.js`（`_gen_api_content_snapshot.py` 於建置鏈產生、`Object.freeze` 的**完整**文章快照含 description）。`sitemap.js`/`feed.js`/`og.js` 在**每一條**失敗路徑（ghGetFile throw / null / regex 不match / 解析出空陣列）都 fallback 到 `FALLBACK_ARTICLES`——token 失效只會退回快照、不會空。SPOF 已消除。原始描述保留於下。
- **問題**：`api/sitemap.js` `parseArticles()` 靠 `ghGetFile('blog/blog-shared.js')`；token 缺失/rate-limit 時回 `[]` → 線上 `/sitemap.xml` 可能只剩 7 個靜態頁，Google 看不到多數文章。
- **證據**：`api/sitemap.js` parseArticles / ghGetFile 呼叫。
- **驗收**：token 失效情境下，sitemap 仍能從一個 committed 後備（例如 `_gen_api_content_snapshot.py` 產物，或 committed `sitemap.xml`）列出全部文章；或在 GSC 確認線上 sitemap 回 200 且含全部 URL。
- **模型等級**：Sonnet。**關聯**：DECISIONS D-05。

### T-02 🟠 新文章 OG 圖在靜態 PNG 生成前 404
- **問題**：`api/og.js` docstring 宣稱有 `/assets/og/<slug>.png → /api/og` 的 rewrite，但 `vercel.json` rewrites 只有 sitemap/feed。新文章在 `_gen_og_images.py` 跑並 commit PNG 之前，og:image 指向不存在檔案 → 社群分享卡空白。
- **證據**：`api/og.js:9`（docstring）vs `vercel.json` rewrites（無此條）。
- **驗收**：二選一——(a) 在 vercel.json 加 `{"source":"/assets/og/:slug.png","destination":"/api/og?slug=:slug"}`（Vercel filesystem 優先於 rewrites，既有靜態 PNG 仍勝）；或 (b) 把 `_gen_og_images.py` 納入新文章的必跑步驟。
- **review Phase 3 更新**：(1) og.js 誤導 docstring **已修**（原宣稱 rewrite 存在）。(2) 選 (a) 前須解決一個**互動陷阱**：`vercel.json` 的 `/assets/og/(.*)` header 設 `immutable`，會套到動態 fallback 回應上（header 依請求路徑匹配），把「佔位動態卡」immutable 快取一年、靜態 PNG 上線後 CDN 仍供舊的（外觀性、影響低但存在）。og.js 自身雖設短快取（1h/1d），但 vercel.json header 可能覆蓋。因此 (a) 不是無腦加 rewrite——需一併處理該 path 的快取策略。**故本項維持 LOG，不在 Phase 3 盲改。**
- **模型等級**：Opus（快取互動需判斷；非 Sonnet 無腦加）。

---

## 效能 / CWV（P）

### P-01 🟠 Google Fonts render-blocking（6 家族含 2 個 CJK）
- **問題**：每頁 `<link rel="stylesheet">` 同步載 Fraunces/Inter/JetBrains Mono/Noto Sans TC(2 weights)/Noto Serif TC，是行動裝置首屏最大 RTT 成本。**這是 DECISIONS D-12 已接受的債**，此處只記錄「若要償還」的驗收條件。
- **驗收**（三選一，且不得破壞 CSP）：(a) 自架用到的 woff2、只 preload H1 的單一 CJK weight、`font-display:swap`；(b) 非阻塞 `media="print" onload` 模式——**但**該 onload 是 inline event，需先讓它相容 CSP（hash 或改用 addEventListener bootstrap），否則會被 D-16 的 fail-closed CSP 擋；(c) 砍裝飾字型（Fraunces/JetBrains Mono）出關鍵路徑。完成後 CI Lighthouse 的 FCP/LCP 應改善且 CSP 無 violation。
- **模型等級**：Opus 級（CSP 交互 + 需量測驗證）。**關聯**：D-12、D-16。

### P-02 ✅ 已修（review Phase 2）Service Worker precache 沒帶 `?v=`
> 修法：親驗確認 `?v=` 分支是 **network-first**，fallback `caches.match(req)` query-sensitive → SHELL 裸 URL 精快取「完全用不到」（primary 走網路、fallback 也對不上）。改 fallback 為 `caches.match(req, { ignoreSearch: true })`——只影響離線 fallback（primary 仍 network-first，線上永遠最新），讓 SHELL 精快取變成有用的離線後備。錨：sw.js fetch handler `?v=` 分支。原始描述保留於下。

### P-03 🟢 首頁兩個 speculationrules 區塊範圍重疊
- **問題**：`index.html` 有兩個 `<script type="speculationrules">`，`/blog/*` 被兩者涵蓋，第一個 `moderate` eagerness 會 hover 就 prerender 整個文章命名空間 → 浪費使用者流量/CPU。
- **驗收**：合併為單一區塊；廣泛 `/blog/*` 降為 `conservative`；保留 7 篇 hero 的 list-rule。
- **模型等級**：Sonnet。⚠️未親驗（codex 可能已調整）。

### P-04 🟢 SW install 精快取所有 tier，與 v30「多階段」設計文件不符（review Phase 2 發現）
- **問題**：`sw.js` install handler 用 `PRECACHE.map(c.add)` 精快取 **SHELL + POPULAR + LAZY 全部**（~30 URL），但檔頭 v30 註解宣稱「install 只阻塞 SHELL ~10 個、POPULAR 於 activate 後、LAZY 走 runtime」，且 `LAZY` 陣列註解寫「don't pre-cache」。activate 又再精快取一次 POPULAR（重複）。因 `allSettled` 不阻塞失敗、install 在背景進行，故非正確性 bug，但 install 網路量比文件宣稱多、且 POPULAR 做兩次。
- **證據**：`sw.js` `install` 的 `PRECACHE.map`（PRECACHE = SHELL+POPULAR+LAZY）vs 檔頭 v30 註解 + LAZY 註解。
- **驗收**（二選一，需站主定調）：(a) 改 install 只 `SHELL.map(c.add)`，POPULAR/LAZY 交給既有 activate/runtime；或 (b) 更新註解與 `LAZY` 命名以符現況。行為變更走 Opus。
- **模型等級**：Opus（install 行為變更需先反證）。

### P-05 🟢 critical-CSS 抽取把 `@supports` 誤標成 `@media`（review Phase 5 發現，perf-completeness）
- **問題**：`_extract_critical_css.py` line 102 同時吃 `@media` 與 `@supports`，但 line 111 重建時**寫死 `@media {cond}`**。於是 `@supports (…)` 內的 critical 規則會被輸出成 `@media (…)`——無效 media query，瀏覽器整塊丟棄。`assets/app.css` **現有 4 個 `@supports` 區塊**（line 690/756/801/902），故若其中含 critical 選擇器（`.flex`/`header` 等），該批規則就沒進 inline critical CSS。另 `@layer`（若日後 Tailwind v4 採用）會被整塊丟棄（含內部 critical 規則）。
- **影響**：**僅 perf**（完整 `assets/app.css` 仍以 `<link>` 載入並套用），非正確性 bug。故 review 時判 LOG 非 FIX。
- **驗收**：line 111 依實際 at-rule 關鍵字輸出（`@supports`/`@media` 各自保留），或明確跳過 `@supports`。**注意**：修完會改動全站 ~67 個 HTML 的 inline critical CSS（大 diff，需跑 visual-regression `force_update` 對照 + 確認 <14KB 預算）。
- **模型等級**：Sonnet（機械但輸出面廣，需固定點 + 視覺回歸驗證）。**關聯**：REVIEW-PLAYBOOK §6/§9。

---

## 安全（S）

### S-01 ✅ 已核實：前提失效（review Phase 4，非本次修）— 客戶端 localStorage-PAT 路徑不存在
> Phase 4 原訂寫「退役 localStorage-PAT」的設計提案。動手前先核實前提，結論是**此漏洞在現行碼中不存在**——寫退役提案等於為幻影漏洞產出文件，違反誠實條款，故改為記錄已驗證的實際模型。
> **核實證據（**客戶端** grep + 讀 admin.html）**：
> - **客戶端** `.html`/`.js`（**排除 `api/`**、node_modules、`*.min.js`）**grep `hs:admin:gh-pat` / `api.github.com` / `gh-pat` / `githubToken` = 0 命中**。（`api.github.com` **確實**存在於 **server 端** `api/`——`_github.js`/`_history.js`/`_rollback.js`/`sitemap.js`/`_upload*.js`——那是正確架構：GitHub 呼叫在 server 用 env token。）
> - `admin.html` 的 `localStorage` **只存 `hs:siteVer`**（快取版本號），無任何 token。
> - 認證流：密碼輸入（`admin.html:281-283`）→ `POST /api/admin/login`（server 比對 `ADMIN_PASSWORD` env）→ 簽發 HMAC cookie → 後續全部 `fetch(..., {credentials:'include'})` 打 `/api/admin/*` → **`GITHUB_TOKEN` 只在 Vercel server env**（`admin.html:574-583` 的「環境變數狀態」卡只是顯示 server 端是否設定，非客戶端持有）。
> - HMAC cookie 本身於 Phase 3 已核實穩固（`_auth.js`：HMAC-SHA256 + `timingSafeEqual` + 到期；login 限流 6/min）。
> 即：S-01 想要的 target state（GITHUB_TOKEN 只在 server、客戶端無 PAT）**已是現況**。
- **殘留（可選、屬 ops 非碼）**：若要再加防禦縱深 → 把 `GITHUB_TOKEN` 換 fine-grained 低權限 PAT + 設輪替提醒（純 Vercel env 操作）。非阻擋、非本 backlog 追蹤範圍。
- **模型等級**：—（已關閉）。**關聯**：D-17。

### S-02 🟢 middleware CSP matcher 仍排除 `.svg`
- **問題**：新 SVG 上傳已禁（D-15），但 repo 內**既有** SVG 仍以無 CSP 同源渲染。
- **驗收**：上傳資產回應加 `Content-Security-Policy: default-src 'none'; sandbox` 與/或 `Content-Disposition: attachment`；並把 `.svg` 移出 middleware.js matcher 的排除清單。驗證既有 SVG 圖仍正常顯示（`<img>`/`<use>` 情境不受 sandbox 影響）。
- **模型等級**：Sonnet。**關聯**：D-15。

### S-03 ✅ 已修（review Phase 3）Edge KV 寫入無 `waitUntil`（觀測資料可能漏記）
> 修法：`api/csp-report.js`、`api/errors.js` 的 `persistToKv()` 改為 **await**，且兩支 KV fetch 各加 `signal: AbortSignal.timeout(1200)`——codex 首審抓到「只 await 不設界」會讓兩個串行 fetch 拖住 204 回應，故補逾時。`api/search-log.js`（與 `api/cwv-ingest.js`）經核實**早已 await**，未動。三支具名端點現皆滿足驗收條件。
- **原問題（已收斂為僅 2 支端點）**：`api/csp-report.js`、`api/errors.js` 的 KV 寫入是 fire-and-forget（`.catch(()=>{})` 未 await/未 `event.waitUntil`）→ Edge runtime 可能在 response 回傳後凍結未完成的寫入。純觀測性，非安全洞。
- ⚠ **原始描述有一項不實**：本項最初也指控 `api/search-log.js` 是 fire-and-forget——**經 review Phase 3 核實為誤**（git 歷史顯示它自始即 `await`，`api/cwv-ingest.js` 同）。該指控**已推翻**，不要據此去「修」這兩支。
- **模型等級**：—（已關閉）。

### S-04 ✅ 已修（review Phase 5）CSP hash 產生器 `\bsrc=` 排除式會誤判 `data-src` inline script
- **問題**：`_gen_csp_hashes.py` 的 inline-script 正則用負向前瞻 `(?![^>]*\bsrc=)` 排除外部 `<script src>`。但 `\b` 也會在 `data-src=` 的 `-`↔`s` 邊界成立 → 一個**帶 `data-src`（或任何 `-src=`）屬性的 inline 可執行 script 會被誤判成外部**、不算 hash → production 被 fail-closed CSP **封鎖**。
- **修法**：`\bsrc=` → `\ssrc\s*=`（要求 `src` 前面是屬性分隔空白，`\s*=` 也涵蓋 `src = "…"`）。已核實 **output-neutral**（現行無任何 inline script 帶 src-like 屬性，重跑 `_gen_csp_hashes.py` 後 middleware.js 不變）→ 純潛伏加固。codex GPT-5.6-sol 已審。
- **模型等級**：—（已關閉）。**關聯**：D-16、REVIEW-PLAYBOOK §4/§9。

### S-07 🟢 `/admin` 的 Markdown 預覽 mini-renderer 不逸出屬性引號 / 不擋 `javascript:`（Sweep C，admin-self）
- **問題**：`admin.html` `renderMdPreview()`（~1133-1150）把 `[x](url)`→`<a href="url">`、`![x](url)`→`<img src="url">`，url **未逸出 `"`**、也不擋 `javascript:`。`/admin` CSP 是 `script-src 'unsafe-inline'` + TT default policy 是 pass-through（`createHTML: s=>String(s)`），故注入的 `on*=`/`javascript:` **會執行**。
- **為何 🟢（不修）**：來源是**站主自己**在 md 編輯器打的字 / 自己 repo 的文章 markdown（經 `/api/admin/md`），**非公開訪客資料** → 頂多 admin 自我 XSS 於預覽窗；且預覽是即時丟棄、存檔時由 server 正規 render。無外部攻擊路徑。
- **驗收**（若要順手加固）：mini-renderer 的 url 過 `escapeAttr` + 擋 `^\s*javascript:`。低優先。
- **模型等級**：Sonnet。**關聯**：S-05（同族：admin escapeHTML 是唯一防線，見 REVIEW-PLAYBOOK §4）。

### S-05 🟢 Trusted Types 的 `sanitizeHTML` 是 regex 洗白，非權威（Sweep A 發現；加固嘗試已撤回，僅文件化）
- **問題**：`assets/trusted-types.js` 的 `hs-policy`/`default` TT policy 用 regex 洗 innerHTML。regex 無法完整 parse HTML，已核實**多個繞過**：(1) `/`-分隔的事件處理器 `<img src=x/onerror=…>`、`<svg/onload=…>`（`\son` 只認空白）；(2) `javascript:` scheme 被空白/HTML entity 混淆——`href="java&#9;script:…"`、`href="java\nscript:…"`（瀏覽器解析前會去掉這些，regex 認不出）。
- **嘗試後撤回（Sweep A + codex GPT-5.6-sol）**：一度把 `\son` 改 `[\s/]on` 想關掉 `/`-分隔繞過，但 codex 反證此 global regex 會**誤傷合法內容**——`href="/online=appointments"`、文字 `/onboarding=yes` 都被吃掉。這正印證本項主旨：**這層 regex 無法安全加固**（關掉一個 false-negative 就開一個 false-positive）。故**撤回、保留原 `\son`**（零回歸），`/`-分隔繞過交給 CSP 主防線（已擋）。
- **為何仍只是 🟢（已核實全棧）**：**主防線是 hash-CSP（D-16）不是這支**。`middleware.js` 的 `script-src` **無 `'unsafe-inline'`/`'unsafe-hashes'`**，故即使 inline `on*=` 或 `javascript:` 洗白漏掉、進了 DOM 也**不會執行**（CSP 擋）。且唯一可能把不可信輸入送進 innerHTML 的 `blog/pagefind-search.js` **自帶 `escapeHtml` 且逐欄逃逸**。**無現行可利用路徑**。
- **同族（Sweep A）**：`api/admin/_ab-config.js` 的 A/B variant HTML 也是「regex 黑名單洗白 → 存進 config → 前端 `DN.applyAbConfig` 對所有訪客 `innerHTML` 換入」。同屬 admin-authored（信任邊界內）+ CSP 主防線 backstop，同 🟢。真正的修法與本項 (a)/(b)/(c) 相同，一併處置。
- **驗收（真正的修，屬 ASK/站主拍板）**：三選一——(a) 接受現狀（CSP 主防線 + 已文件化，成本零；本層 regex 不再嘗試加固）；(b) 換 DOMPurify（SVG profile；需評估 bundle + CSP）；(c) 把 `createHTML` 改成**拒絕**（throw）而非洗白，強迫所有 innerHTML sink 改用安全 DOM API——但會擋掉現行 data-en 的 `<strong>`/`<a>` 合法用法，工程量大。**別再往 regex 洗白疊補丁**（whack-a-mole + 假安全，違反 D-15/D-16 精神）。
- **模型等級**：Opus（安全架構 + 威脅模型判斷）；(a) 已可由站主一句話定案。**關聯**：D-16。

---

## 無障礙（A）

### A-01 🟠 25 個頁面的 skip-link `#hs-related` 指向不存在的目標
- **問題**：`_apply_i_series.py` 對所有頁注入固定 skip-nav，含 `#hs-related`，但 `#hs-related` 只存在於文章頁 → 首頁/about/privacy/notes/tools 等按了跳空。
- **Sweep B 核實（2026-07-11，親自 grep）**：`href="#hs-related"` 但同頁**無** `id="hs-related"` 的頁面**共 25 個**（非原記的 ~15）；且 `#hs-related` 被 `_check_dead_anchors.py:34` **白名單放行 → 無檢查器守**。注入的 skip-nav 逐頁不同（tools=2 連結、about=3），各頁是不同 generator 版本 SENTINEL-凍結的。
- **`#dn-newsletter` 子項（更正一則我先前的誤述）**：`id="dn-newsletter"` **確實存在**（`blog/index.html`、`en/blog/index.html`），且有 5 頁 link `#dn-newsletter`；另 `id="dn-subscribe"` 在 60 頁。故 subscribe/newsletter 兩個 id 都在用——**是否每個 `#dn-newsletter`/`#dn-subscribe` 連結在其所在頁都有對應 id，尚未逐頁核（本次只確認 id 存在、`#hs-related` 那 25 頁死掉）**。（先前一版誤稱「無 id=dn-newsletter、子項 stale」，來自 sub-agent 未經我親驗即引用——已更正。）
- **驗收**：改 `_apply_i_series.py` 讓 skip-nav 依頁面實際存在的 id 條件輸出（只在有該目標時才放對應連結），然後**重跑** `_apply_i_series.py`——注意 sentinel 問題：現行是 sentinel-gated insert，要讓它能**取代**既有 nav 才會更新既有頁；改完全站 ~67 檔的 skip-nav 會變動（大 diff 但機械、CI 可驗固定點）。同時擴充 `_check_static_a11y.py` 的 SKIP_LINK_RE 使其屬性順序不敏感且涵蓋 `.hs-skiplinks` 錨點。
- **模型等級**：Sonnet（機械但需固定點驗證 + generator sentinel 邏輯）。**關聯**：REVIEW-PLAYBOOK §3。

### A-02 🟢 遺留無 :focus 的舊 skip-link
- **問題**：`404.html`（可能還有他頁）有 `<a class="skip-link" style="left:-999px">` 但 app.css 無對應 `:focus` 揭示規則 → 鍵盤 focus 時看不見（WCAG 2.4.7）。eye-3d 的已於本 session 一併處理。
- **驗收**：移除冗餘 legacy skip-link（`.hs-skiplinks`/`.skip-to-main` 已覆蓋），或加 `:focus` 上螢幕規則。
- **模型等級**：Haiku~Sonnet。

### A-03 🟢 幾個雜項對比/語言 a11y
- 搜尋 modal `aria-label="搜尋"` 在 en 頁仍中文（`blog-shared.js` cmdk modal）；in-page 語言切換未對混語片段設 `lang`；全域 placeholder 色 `#9ca3af`（2.54:1，主要影響 admin/tools 表單）。
- **驗收**：modal aria-label 依 `DN.detectLang()` 切換；placeholder 色加深到 ≥ `--muted`。
- **模型等級**：Sonnet。

---

## 正確性 / 維護（M）

### M-01 🟢 `assets/components.js` 死碼
- **問題**：0 個 HTML 引用（已驗：`grep -rl components.js --include=*.html` = 0），卻仍有 `vercel.json` header 規則 + `_check_static_asset_headers.py` 期望項。
- **驗收**：確認 admin/動態注入也無引用後，刪 `assets/components.js` + 其 vercel.json header + checker EXPECTED 項（三處同刪，否則 checker 紅）。
- **模型等級**：Sonnet。**關聯**：REVIEW-PLAYBOOK §9。

### M-02 🟢 `apply_magazine_template.py` 內嵌過時 footer CSS
- **問題**：新文章範本產生器仍內嵌一份過時的 mag-footer CSS（用從未生效的 `h5` 選擇器；且與 D-10 的 app.css 單一來源重複）。非 CI 流程、只在手動 scaffold 新文章時生效。
- **驗收**：移除該內嵌 `<style>` footer 區塊，讓 scaffold 出的文章靠 app.css。驗證 scaffold 一篇測試文，footer 正常且無 `.mag-foot-cols h5`。
- **模型等級**：Sonnet。**關聯**：D-10。

### M-03 ✅ 已修（review Phase 1）admin WYSIWYG 的 `/` 快捷鍵吞斜線（真實編輯 bug）
> 修法：cmdk `/` 分支加 `!activeElement.isContentEditable && !DN.isAdminMode()` + null guard（blog/blog-shared.js initCmdK keydown）。原始問題描述保留於下供對照。
- **問題**：`blog/blog-shared.js` 的 cmdK handler 對裸 `/` 開搜尋，只排除 INPUT/TEXTAREA，未排除 `contenteditable` → admin 編輯器裡打「and/or」、日期、比值、URL 都被搶去開搜尋。
- **證據**：`blog/blog-shared.js` initCmdK 的 `/` 分支（審查標為 ~2849 行，以字串搜尋 `e.key === '/'` 為準）。
- **驗收**：`/` 分支加 `&& !(document.activeElement && document.activeElement.isContentEditable)`（並考慮 admin mode 時整個 bail）；改 `blog-shared.js` 後 `npm run minify` 重生 min.js；`_check_min_js.py` 驗 parity。
- **模型等級**：Sonnet。**影響**：直接壞站主的編輯流程，值得優先。

### M-04 ✅ 已修（review Phase 1）in-page TOC 用字串拼 selector（潛在拋錯）
> 修法：addInlineTOC / addFloatingTOC 的 `proseEn.querySelector('#'+id+'-en')` 改 `document.getElementById(id+'-en')`（id 唯一，免逸出）。原始問題描述保留於下供對照。
- **問題**：`blog/blog-shared.js` 的 addInlineTOC/addFloatingTOC 用 `querySelector('#'+id+'-en')`；若未來 h2 id 以數字開頭或含非 ASCII，`querySelector` 會 SyntaxError 中斷該篇 TOC。現有文章無此 id，屬潛伏。
- **驗收**：改用 `getElementById(id+'-en')`（不需 selector 逸出），或用 `CSS.escape`。
- **模型等級**：Sonnet。

### M-05 🟠 文件 ↔ CI 建置鏈可能 drift
- **問題**：權威建置鏈是 `.github/workflows/quality.yml` 的 drift 步驟；`WRITING_NEW_ARTICLE.md`、`AGENTS.md`、`CLAUDE.md` 各有一份鏈文件，容易與 CI 實際清單脫節（codex 近期新增了 `_normalize_reviewed_by`、`_inject_speed_insights`、`_gen_api_content_snapshot`、`_gen_llms_full_txt`、`_apply_trusted_types`）。
- **緩解已做**：`preflight.py` **動態解析 quality.yml** 取步驟，不依賴文件，所以「跑鏈」這件事不會因文件過時而錯。
- **驗收**：定期（或每次有人加 generator 時）比對三份文件的鏈 vs quality.yml，補齊。或更進一步：讓三份文件都改為「見 quality.yml / preflight.py」單一指向，消除多份副本。
- **模型等級**：Sonnet。

### M-06 ✅ 已修（review Phase 4，部分 + 反漂移閘）admin 儲存路徑的 strip 清單雙軌
> 修法（Phase 4，Opus 4.8）：
> 1. **反漂移閘（真正的「單一來源」機制）**：新增 `_check_runtime_helper_sync.py`（`glob` 自動納入 `_check_all.py --quick`），強制 `blog/blog-admin.js` `_sanitizeForSerialize` 的 runtime-helper 清單 ≡ `api/admin/_save.js` 的 `RUNTIME_HELPER_IDS`（client 僅多 3 個 admin-chrome id）。兩檔互加耦合註解、server 為 canonical。兩個 runtime（瀏覽器 IIFE vs Node ESM）無法共用 module，所以「改單邊 → CI 紅」就是這裡能做到的單一來源。已負向測試（雙向 drift 皆被抓）。
> 2. **一次性 style id 補齊**：兩清單各補 `hs-related-css`、`hs-blog-filter-css`（純 `createElement('style')`、無 authored mount，逐一核實安全）。
> 3. **雙語回寫收斂**：`data-zh/data-en` mirror 從掃「整份 document」改為只掃 `<article>`（`#proseZh`/`#proseEn` + article 內可編輯 title/figcaption）。原本會把 nav/footer/breadcrumb/hero 的 innerHTML **每次存檔都烤進屬性**（單篇 59 個 data-zh，多數在 article 外，站主從未編輯它們）。
>
> **刻意未做（L6 反證擋下 data-loss）**：`hs-related`／`hs-feedback`／`hs-support` **不加**入 strip 清單——它們在文章原始碼有 authored 佔位 `<div id="…">`（blog-shared.js「v34.11: prefer pre-existing mount」），若 strip 會刪掉掛載點 → 回退 legacy 插入 + 永久移除 authored mount = 真 data-loss。互動工具 widget 另見 **M-07**。**關聯**：D-24。
- **原問題**（保留對照）：WYSIWYG 儲存前，客戶端 `_sanitizeForSerialize` 與伺服器 `RUNTIME_HELPER_IDS` 兩邊各自維護且未涵蓋全部一次性 style id。注入器多用 `if (getElementById(...)) return` 防重複 → 一旦過時副本被序列化入庫，執行時就不再重建，過時 chrome 永久化。
- **模型等級**：Opus（多檔行為變更，需先反證再改）。

### M-07 🟢 五個互動工具 widget id 未納入 strip 清單（tradeoff，非 bug）
- **問題**：`hs-osdi`／`hs-deq5`／`hs-snellen`／`hs-se`／`hs-floater-rf`（`DN._buildCalc` 生成的計算器）目前**刻意**不在 M-06 strip 清單。它們是純 runtime 生成內容，但 `_buildCalc` 有兩種掛載：(a) authored 佔位（`cfg.mountSel` → `mountInto.innerHTML`）、(b) fallback `<section>` 插在 `article.max-w-3xl` 後；且有 `if (getElementById(cfg.id)) return null` 重複防護。
- **tradeoff**：不 strip → 過時 calc 內容被烤進原始碼、reload 因 guard 不重建（凍結快照，非重複，輕）。若 strip → authored-佔位情境乾淨（清空佔位、reload 重建）；但 fallback 情境會留下空的 `<section class="max-w-3xl…">` 孤兒、reload 再插一個 → 空 section 累積。兩害皆輕、皆非 authored 內容遺失。
- **驗收**：先查有無文章走 fallback（無 `mountSel`）路徑。若全走 authored 佔位 → 安全加入兩清單（checker 自動涵蓋）。若有 fallback → 先讓 `_buildCalc` fallback 也包一層帶 id 的 wrapper、strip wrapper id，避免空 section 累積。
- **模型等級**：Sonnet（需先查 `mountSel` 使用面）。**關聯**：M-06、D-24。

### M-08 🟢 `should_drop_en_jsonld` 只看 top-level `@type`，`@graph` 巢狀 FAQPage 會漏（review Phase 5，潛伏）
- **問題**：`_gen_en_pages.py` 的 `should_drop_en_jsonld`（line 386-399）判斷是否把 ZH FAQPage schema 從 /en/ 頁移除時，只讀 `data['@type']`。若 FAQPage 是包在 `@graph:[…]` 陣列裡（`data['@type']` 不存在），就**偵測不到 → 不移除 → 中文 Q&A 以英文頁 rich result 出現**（GSC 語言不符）。
- **現況（已核實，codex GPT-5.6-sol 校正計數）**：**潛伏，非活躍**。`blog/*.html` 共 **19 個 FAQPage，全部是頂層獨立 `<script>` 區塊**——其中 **7 個**由 `_gen_faqpage_jsonld.py` 產（帶 `data-faq-auto`），**另 12 個為手寫/legacy 獨立區塊**（如 dry-eye-myths.html:93，無 marker）。關鍵是**兩類都無 `@graph` 巢狀**（grep 核實 =0），故 `should_drop` 的 top-level `@type` 檢查目前 100% 覆蓋（全 `en/` 頁 FAQPage=0）。只有日後有人**手寫** @graph-巢狀 FAQPage 才會咬到。
- **驗收**：`should_drop_en_jsonld` 也遞迴檢查 `@graph` 成員（或改用 `_jsonld_type_names` 對每個 graph node 判定）。低優先（現行慣例是獨立區塊）。
- **模型等級**：Sonnet。**關聯**：D-09、REVIEW-PLAYBOOK §5。

### M-09 🟢 `api/admin/_precompute-meta.js` 的 DN.ARTICLES 回寫 regex 脆弱（Sweep A，潛伏）
- **問題**：`_precompute-meta.js`（~line 86-92）用 `[^}]*?` + 只逸出 slug 的 `-` 來就地改寫 DN.ARTICLES 的 `words:`/`minutes:` 欄位。若某 entry 的欄位值含 `}` 或 regex metachar，`[^}]` 會提早終止 / slug metachar 會 mis-anchor，把欄位注到錯位置。**與 M-11（`_reorder`）同一類 regex-on-JS 脆弱**，但影響較輕（改欄位 vs 整篇消失）。
- **現況**：**潛伏**——輸入是建置產生的 `blog-shared.js`，slug 皆 `[a-z0-9-]`、欄位值無 `}`。寫入面本身安全（有 `sha` 樂觀鎖 + noop guard）。
- **驗收**：比照 M-11 加「parse 數 ≠ 實際 entry 數就 refuse」的 fail-safe，或改用逐-entry 解析。低優先。
- **模型等級**：Sonnet。**關聯**：M-11、REVIEW-PLAYBOOK §9。

### M-12 🟠 DN.ARTICLES 的 `'([^']*)'` 欄位解析遇標題含單引號會截斷（Sweep B，跨多生成器）
- **問題**：多個生成器用同一種 `field()` regex `key:\s*'([^']*)'` 解析 `DN.ARTICLES` 欄位。若某欄位值含**單引號/撇號**（在 JS 源以 `\'` 逸出），`[^']*` 會在逸出的 `'` 處截斷 → 標題/標籤損毀。**眼科站很可能踩到**：`Sjögren's`（修格蘭氏症，乾眼主因）、`Don't`、`Behçet's`。
- **影響面（同一 bug 散在多檔）**：`_gen_search_index.py`、`_gen_related.py`、`_gen_llms_txt.py`、`_gen_og_images.py`、`_gen_feeds.py`、`_gen_en_pages.py`（`parse_articles`）——一個撇號會同時污染搜尋索引、related、llms、OG 卡、feeds、/en/ meta。
- **現況**：潛伏（現行標題皆無撇號）。
- **驗收**：把所有 `DN.ARTICLES` 的 `field()` 解析**一次改成支援逸出**（`'((?:[^'\\]|\\.)*)'` 再 `.replace("\\'","'")`），或改用共用 helper。**必須一致改全部 parser**（否則各檔各截）。
- **模型等級**：Sonnet（機械但跨檔一致性）。**關聯**：REVIEW-PLAYBOOK §9。

### M-13 🟢 多個生成器把文章文字塞進 `<script type="ld+json">` 未逸出 `<`/`</script>`（Sweep B，潛伏）
- **問題**：`_gen_related.py`（LD `name`）、`_gen_profile_schema.py`、`_gen_serp_meta.py`、`_gen_faqpage_jsonld.py` 等用 `json.dumps` 產 JSON-LD 塞進 `<script>` 區塊，但 `json.dumps` **不逸出 `<`**，故若文章標題/描述含字面 `</script>` 會提早關閉 script 標籤並注入標記。可見文字（卡片）已用 `esc()` 逸出，只有 JSON-LD 路徑生。
- **現況**：潛伏——內容是站主自撰醫療文，非不可信輸入，不會有字面 `</script>`。屬防禦縱深最佳實務缺口。
- **驗收**：JSON-LD 輸出統一過 `.replace('<','\\u003c')`（JSON-LD 慣例），或包一個 `dump_jsonld()` helper。低優先。
- **模型等級**：Sonnet。**關聯**：REVIEW-PLAYBOOK §5。

### M-14 🟢 檢查器的 HTML/JS 解析對「畸形或異形標記」仍非 100% 嚴謹（R2-1 已接受之殘餘風險）
- **背景**：R2-1 把 `_check_inline_scripts`（改用 `HTMLParser`）、`_check_static_a11y`（引號感知 `parse_attrs` + 引號感知 `IMG_RE`）、`_check_articles`（剝字串/註解/regex literal）都硬化過 **5 輪對抗式審查**，逐輪修掉:`data-type=`/`data-alt=` 誤判、屬性值內的 `type=`/`alt=`/`>`、實體編碼的 MIME、重複屬性 first-wins、未加引號值的尾端 `/`、regex literal 內的 `//`。
- **殘餘**：codex GPT-5.6-sol 第 5 輪判定 **無阻擋級缺陷**，剩下的只是**本 repo 的 generator 產出不可能出現的畸形/異形標記**（手寫破格 HTML、DN.ARTICLES 內放 regex 常值等）。**已接受為殘餘風險，不再迭代**。
- **何時該重開**：若日後改成手寫 HTML、引入第三方模板、或 admin CMS 允許貼入任意標記——屆時這些解析器要改用完整 HTML 剖析（或直接以 `validate.py` 的剖析結果為輸入）。
- **模型等級**：Sonnet（真要做時）。**關聯**：REVIEW-PLAYBOOK §9。

---

## 內容（C）— 需要站主參與（醫療正確性，MODEL-GUIDE §4）

### C-01 🟠 兩個高搜尋量主題目前是 noindex 佔位（隱形眼鏡、紅眼/結膜炎）
- **狀態**：`contact-lens-safety`、`red-eye-conjunctivitis`（+en）依 DECISIONS D-04 維持 noindex 佔位，站上**無**同主題完整文章 → 白白損失「結膜炎/紅眼」「隱形眼鏡」自然入口。
- **驗收**：站主決定寫完整內容後，AI 可**協助**起草（重述已有引用支持的內容 + 標 TODO 讓醫師確認臨床細節），完成後：解除 STUB_SLUGS、robots 改 index、進 DN.ARTICLES + 3 處卡片、進 sitemap、走建置鏈。**臨床正確性由站主定案**。
- **模型等級**：起草 Sonnet；正確性 = 站主。**關聯**：D-04。

### C-02 🟠 answer-first 改寫（AI 引用最大槓桿）
- **問題**：多數文章的 H2/H3 下第一段不是「先給結論」。研究顯示這是低權威站被 AI 引用的最大單一槓桿。
- **驗收**：逐篇（趁日常更新順手）把每個標題下第一段改成 40-60 字內先給直接答案再展開。**不改臨床事實、只改語序**。優先 5 篇見 docs/GROWTH-PLAYBOOK.md。
- **模型等級**：Sonnet（語序重排，不碰醫療數字）。**關聯**：REVIEW-PLAYBOOK §8。

---

## 已關閉（供對照，勿重開）

**制度建置 session（2026-07-04 前後）**：footer 跑版修復 · /notes noindex · 4 stub 處置（2 轉址 2 維持）· FAQPage×7 · 安全強化（svg/md/csp/push/admin-csp）· about LCP · immutable 快取 · eye-3d landmark · 對比度 · robots 對 AI 開放 · floaters→high-myopia 內鏈 · reviewedBy inline 化(codex)。

**工單 2026-07 code review（Opus 4.8；Phase 1–5 已上線、交付 `b102ce2`；Phase 6 為本收尾 commit）**：
- **修復上線**：`M-03`（cmdk `/` 吞斜線，真實編輯 bug）· `M-04`（TOC selector 逸出）· `P-02`（SW 離線 fallback `ignoreSearch`）· `S-03`（csp-report/errors KV bounded await，含 codex 抓到的無界 fetch → 加 `AbortSignal.timeout`）· og.js 誤導 docstring · **`M-06`**（admin strip 清單雙軌 → 新增 `_check_runtime_helper_sync.py` 反漂移閘 + 雙語回寫收斂到 `<article>` + 補 2 個一次性 style id）· **`S-04`**（`_gen_csp_hashes.py` `\bsrc=`→`\ssrc\s*=`，`data-src` inline script 被誤封鎖的潛伏洞）。
- **核實後關閉（前提失效／早已解決，非改碼）**：`T-01`（sitemap 對 GitHub token 的 SPOF 已被 `_content_snapshot.js` 的 frozen fallback 消除）· `S-01`（`/admin` **無** localStorage GitHub PAT；**客戶端** grep（`*.html`/`*.js`；排除 `api/`、`node_modules`、`*.min.js`）**0 命中**——`api.github.com` 於 **server 端** `api/` 存在（`_github.js`/`_history.js`/`_rollback.js`/`sitemap.js`/`_upload.js`/`_upload-srcset.js`）屬**正確架構**，非債；早已是 password→HMAC cookie→server `GITHUB_TOKEN` 目標態）。
- **新開項（本工單 LOG，尚未做）**：`P-04` `P-05` `M-07` `M-08` — 皆為潛伏／perf-completeness，無 🔴。

詳見 `REVIEW_WORKORDER_2026-07.md` 頂部「執行結果摘要」、git log 與 DECISIONS.md（D-24）。

**Sweep A — 未審面補審：`assets/trusted-types.js` + 25 個已認證 admin 工具端點（2026-07-11，Fable 5）**：工單當初把這批列「留給下一張工單」。全數 `requireAdmin` 前置無 bypass（`_article-commit`/`_halfwidth` 是內部模組非路由）；slug 皆 `/^[a-z0-9-]+$/` 驗證。**修復上線**：
- **`M-10` 🔴→✅ `_schema-helper.js` strip regex 連坐刪 JSON-LD**（**最嚴重**）：原 `\{[^]*?"@type":"(FAQPage|HowTo)"[^]*?\}` 跨 `</script>` 邊界，對任何「FAQPage 前面有 MedicalWebPage/Article 區塊」的文章（=全部）會從第一個 ld+json 一路刪到 FAQPage。實測 dry-eye-myths **5 個 ld+json 刪掉 4 個**。改成**逐-block 判定**（只刪 FAQPage/HowTo）。
- **`M-11` ✅ `_reorder.js` 靜默掉文章**：整塊 DN.ARTICLES 用 `[^{}]*?` regex 重建，parse 漏掉的 entry 會消失（listings+sitemap）。加「parse 數≠slug 鍵數就 409 refuse」fail-safe（現行 20==20 不受影響）。
- **`S-06` 🟠→✅ `_sri.js` SSRF**：原只驗 `^https?://` 就 `fetch(redirect:'follow')`，可打 `169.254.169.254`/`localhost`/內網（回 size+hash 當 oracle）。加**host 允許清單**（own domain + CSP script-src 主機）+ `redirect:'error'` + 5MB 上限。
- **`S-05` 🟢 `trusted-types.js`**：`/`-分隔 handler 繞過的 regex 加固**嘗試後撤回**（codex 證實會誤傷 `/online=` 類 href）；保留原 `\son`、交 CSP 主防線，只加了誠實註解。詳見 S-05。
- 小修：`_history.js` GitHub 錯誤訊息 `.slice(0,200)`（比照其他 handler）。
- **新開 LOG**：`M-09`（`_precompute-meta` 同類 regex 脆弱，潛伏）；`S-05` 註記 `_ab-config` variant HTML 同族。
- **判定 clean（無 bug）**：`_build-related`/`_seo-fix`（自我反證擋下一個假 bug：真文章有 `MedicalScholarlyArticle`，guard 正確 no-op）/`_dictionary`（escaping+prototype guard 俱佳）/`_rollback`/其餘 read-only 端點。

**Sweep B — 23 個未讀生成器（2026-07-11，Fable 5）**：整條建置鏈的**集體冪等**已由 preflight 固定點守著（故本批低產）；但發現 **5 個 `_inject_*` 是 one-off、不在 quality.yml 鏈內**，其冪等不被 preflight 守。**修復上線**：
- **`_inject_medical_guideline.py` 冪等 guard 格式錯配**（實測 7 檔全中）：guard 查 `"@type":"MedicalGuideline"`（無空格）但 `json.dumps` 預設 separators 產出**有空格**形式 → guard 永不命中 → 重跑會對既有 7 篇**注入重複** MedicalGuideline JSON-LD。改成 format-agnostic `re.search(r'"@type":\s*"MedicalGuideline"')`。（其餘 4 個 one-off guard 查 bare name/attr，安全。）
- **`_gen_llms_txt.py` 未 guard 的 `/en/` 讀取**：`title_text(en_path)` 無 `.exists()`（不像 `desc` 與姊妹檔 `_gen_llms_full_txt`），stub/新 slug 尚無 en 頁時會 `FileNotFoundError` 崩掉整個 llms.txt build。加 `.exists()` fallback。
- **新開 LOG**：`M-12`（`'([^']*)'` 撇號截斷，跨 6 個 DN.ARTICLES parser，眼科站 `Sjögren's` 很可能踩）；`M-13`（多生成器 JSON-LD 未逸出 `</script>`，潛伏）；`A-01` 更新（`#hs-related` 死連結**核實為 25 頁**、無檢查器守；更正一則我先前經 sub-agent 誤引的敘述——`id="dn-newsletter"` **確實存在**於兩個 index 頁，非 stale）。
- **核實 refuted / 不修**：F10 「logo 搶 LCP、hero 被 lazy」——about.html 的 hero（profile 照）其實是 `eager+high`，claim 不成立（僅 logo 也 high，微小冗餘）；其餘多為 `</script>`-breakout / 屬性順序 / 單引號 類**潛伏且自我反證**項（見 M-12/M-13）。`_gen_api_content_snapshot`（T-01 fallback 來源）、`_gen_route_canonicals`、`_gen_search_index` 判定 clean。

詳見 git log；本兩批（Sweep A/B）由 Fable 5 補審工單當初 deferred 的面。

**Sweep C — admin.html 其餘 + blog-shared 後半 + 雜項（2026-07-11，Fable 5）**：**無改碼 bug**（本批價值在核實 + institutional 警示）。
- **admin.html dashboard（2041 行）clean**：最該擔心的「公開訪客資料（CSP report/JS error/搜尋詞）→ innerHTML stored-XSS」**不存在**——每個動態值都 `escapeHTML()`（含原始 record 的 `escapeHTML(JSON.stringify(r))`）。CSRF 由 `SameSite=Strict` cookie 擋。**institutional 警示寫入 REVIEW-PLAYBOOK §4**：/admin 是 `unsafe-inline` CSP + TT pass-through，故 escapeHTML 是唯一防線，未來 admin 新碼必守。唯一殘留：Markdown 預覽 mini-renderer（S-07，admin-self，低）。
- **blog-shared.js 後半（2260-5436）**：P1 已 risk-swept，本次再 targeted 掃 `applyAbConfig`/計算器/offline-queue/message handler——`DN.applyAbConfig` 的 `innerHTML=v.html` 屬 admin-authored A/B 變體（同 S-05 家族、主站 hash-CSP backstop）；計算器分母皆常數（無除零）；offline-queue 僅 admin + SW 端已驗（P2）；cmdk excerpt 是站內 Pagefind 內容。無新高風險。**誠實**：後半是「P1 risk-sweep + Sweep C targeted 抽掃」，**非逐行全讀**（負責逐行的 sub-agent 撞 session limit）。
- **`tools/eye-3d-worker.js`（218）clean**：無 `eval`/`Function`/`importScripts`；worker `onmessage` 只收同源父頁訊息。`blog/pagefind-search.js` 已於 Sweep A 核實（`escapeHtml` 逐欄）。

**三批（Sweep A/B/C）合計**：修 **6 個真 bug**（schema-helper 連坐刪 / reorder 靜默掉文章 / sri SSRF / medical_guideline 重複注入 / llms_txt crash / history slice）+ 新開 S-05/S-07/M-09/M-12/M-13 LOG + A-01 更正 + REVIEW-PLAYBOOK §4 admin-XSS 警示。工單 deferred 的未審面已補完。

**Round 2 批次 1 — 63 個 `_check_*.py` 檢查器本身（2026-07-11，Opus 5）**：這是**所有「CI 綠」的信任基礎**，而歷來被刻意排除，理由是「CI 每日行使，錯了會自我暴露」——**這個理由對假陰性是錯的**：一個永遠不會失敗的檢查器永遠不自曝。改用**實證**（靜態 vacuity 探針 + 變異測試：故意破壞不變量→確認套件變紅→git 還原）。**修 6 項**：
- **`_check_inline_scripts.py`**（🔴 最嚴重之一）：印 `** UNBALANCED **` 卻**從不 exit(1)**，且只看 `index.html`、數括號還不懂 regex literal → **完全無法擋任何東西**。改用 node 真解析器（`vm.Script`，只編譯不執行）＋ `HTMLParser` 讀屬性；覆蓋從「1 檔 11 個未強制區塊」→ **66 檔 158 個強制區塊**。
- **`_check_articles.py`**：真正的檢查（`,,`、`}{`）只 print，唯一的 `exit(1)` 給的是別的條件 → 結構破損照樣過。改成會擋。**證明不可取代**：`[{a},,{b}]` 是合法 JS 陣列空洞，`node --check` 抓不到（實測 exit 0），但會讓每個消費端 runtime 爆、Python 生成器又靜默略過。
- **`_check_metadata_uniqueness.py`**：`len(paths) > 2` → **剛好 2 頁共用同一標題被靜默放行**，正是它存在要防的重複內容問題。收緊為 `> 1`（實測全站 0 組重複 → output-neutral）。
- **`_check_static_a11y.py`**：`<img>` 迴圈只檢查 width/height 與 fetchpriority（**兩個都是效能**），獨漏 `alt`。補上（接受 `alt=""` 與 presentational role）。順帶修好 `has_attr` 的 `\b` bug（`data-alt=`/`data-width=` 會被誤認），**這連帶修正了既有的 width/height 檢查**。
- **`_check_min_js.py` + `quality.yml`**（🔴 最嚴重）：頁面載入的是 `.min.js`，但 `minify` 不在生成鏈、且 `_check_all.py`（yml L134）跑在 `npm ci`（L213）**之前**沒有 esbuild → **純邏輯修改忘了 `npm run minify`，CI 全綠但線上仍供舊 bundle**（「原始碼修好了、線上沒生效」；我們 Phase 1 修 M-03/M-04 就靠人工記得）。新增本機 esbuild **位元組精確**比對（正向識別 `node_modules/esbuild`，已安裝就 fail-closed）＋ CI 在 `npm ci` 後的 `min.js freshness` drift step。
- **退役 `_check_balance.py`**：同樣永遠綠，且與 `node --check` 完全冗餘（實測證明）。**同時清掉 5 處死引用**（`quality.yml`／`CLAUDE.md`／`README.md`／`WRITING_NEW_ARTICLE.md`×2，其中一處在 `&&` 鏈中會中斷後續檢查）——刪檔沒先 grep 引用是 codex 抓到的。

**變異測試現況（可重跑驗證）**：移除 canonical／已發布改 noindex／JSON-LD 無效／移除 img alt／標題撞號／inline script 語法錯 —— **6 項全部被抓**。經 **5 輪** codex GPT-5.6-sol 對抗式審查收斂；殘餘見 **M-14**（已接受）。
