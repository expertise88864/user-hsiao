# BACKLOG.md — 開放技術債 / 待辦帳本

> **讀者**：未來的 AI session。這裡每一項都是**已診斷、已定驗收條件、但刻意還沒做**的項目。
> **怎麼用**：站主說「挑點事做」或你有餘裕時，從這裡照「影響÷投入」挑。**動手前**先讀該項的「驗收條件」與「模型等級」——低於你等級才自己做，否則走 MODEL-GUIDE §2 升級。做完後：勾掉 + 在 commit message 註 `docs: BACKLOG close X-nn`。
> **不在這裡的東西**：已定案的刻意狀態在 docs/DECISIONS.md（那些**不是**待辦，別去「修」）。審查判準與現況在 docs/REVIEW-PLAYBOOK.md。
> 事實基準 commit `66745a6`。每項附 file:line 供查證；行號可能因後續 commit 位移，以符號/字串搜尋為準。

**嚴重度**：🔴 高（安全/會壞/明顯損失流量）｜🟠 中｜🟢 低（polish）。
**未親驗標記**：標「⚠️未親驗」= 源自本 session 的多代理審查但那批代理撞到 session limit 未回完整證據；做之前先自行用該項指令覆核。

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

---

## 安全（S）

### S-01 ✅ 已核實：前提失效（review Phase 4，非本次修）— 客戶端 localStorage-PAT 路徑不存在
> Phase 4 原訂寫「退役 localStorage-PAT」的設計提案。動手前先核實前提，結論是**此漏洞在現行碼中不存在**——寫退役提案等於為幻影漏洞產出文件，違反誠實條款，故改為記錄已驗證的實際模型。
> **核實證據（repo-wide grep + 讀 admin.html）**：
> - 全 repo（`.html`/`.js`，排除 node_modules/api/min）**grep `hs:admin:gh-pat` / `api.github.com` / `gh-pat` / `githubToken` = 0 命中**。
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

### S-03 🟢 Edge KV 寫入無 `waitUntil`（觀測資料可能漏記）
- **問題**：`api/csp-report.js`、`api/errors.js`、`api/search-log.js` 的 KV 寫入是 fire-and-forget（`.catch(()=>{})` 未 await/未 `event.waitUntil`）→ Edge runtime 可能在 response 回傳後凍結未完成的寫入。純觀測性，非安全洞。
- **驗收**：await 這些小寫入，或接 FetchEvent 用 `event.waitUntil(persist(...))`。
- **模型等級**：Sonnet。

---

## 無障礙（A）

### A-01 🟠 ~15 個非文章頁的 skip-link 指向不存在的目標
- **問題**：`_apply_i_series.py` 對所有頁注入固定三連結 skip-nav（`#main-content`/`#hs-related`/`#dn-subscribe`），但 `#hs-related`/`#dn-subscribe` 只存在於文章頁 → 首頁/about/privacy/notes/tools 等按了跳空。另有 `#dn-newsletter` vs `#dn-subscribe` id 不一致。
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

## 已在本 session 關閉（供對照，勿重開）
footer 跑版修復 · /notes noindex · 4 stub 處置（2 轉址 2 維持）· FAQPage×7 · 安全強化（svg/md/csp/push/admin-csp）· about LCP · immutable 快取 · eye-3d landmark · 對比度 · robots 對 AI 開放 · floaters→high-myopia 內鏈 · reviewedBy inline 化(codex)。詳見 git log 與 DECISIONS.md。
