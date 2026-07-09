# BACKLOG.md — 開放技術債 / 待辦帳本

> **讀者**：未來的 AI session。這裡每一項都是**已診斷、已定驗收條件、但刻意還沒做**的項目。
> **怎麼用**：站主說「挑點事做」或你有餘裕時，從這裡照「影響÷投入」挑。**動手前**先讀該項的「驗收條件」與「模型等級」——低於你等級才自己做，否則走 MODEL-GUIDE §2 升級。做完後：勾掉 + 在 commit message 註 `docs: BACKLOG close X-nn`。
> **不在這裡的東西**：已定案的刻意狀態在 docs/DECISIONS.md（那些**不是**待辦，別去「修」）。審查判準與現況在 docs/REVIEW-PLAYBOOK.md。
> 事實基準 commit `66745a6`。每項附 file:line 供查證；行號可能因後續 commit 位移，以符號/字串搜尋為準。

**嚴重度**：🔴 高（安全/會壞/明顯損失流量）｜🟠 中｜🟢 低（polish）。
**未親驗標記**：標「⚠️未親驗」= 源自本 session 的多代理審查但那批代理撞到 session limit 未回完整證據；做之前先自行用該項指令覆核。

---

## 技術 SEO / 索引（T）

### T-01 🟠 動態 sitemap 對 GitHub token 的單點故障
- **問題**：`api/sitemap.js` `parseArticles()` 靠 `ghGetFile('blog/blog-shared.js')`；token 缺失/rate-limit 時回 `[]` → 線上 `/sitemap.xml` 可能只剩 7 個靜態頁，Google 看不到多數文章。
- **證據**：`api/sitemap.js` parseArticles / ghGetFile 呼叫。
- **驗收**：token 失效情境下，sitemap 仍能從一個 committed 後備（例如 `_gen_api_content_snapshot.py` 產物，或 committed `sitemap.xml`）列出全部文章；或在 GSC 確認線上 sitemap 回 200 且含全部 URL。
- **模型等級**：Sonnet。**關聯**：DECISIONS D-05。

### T-02 🟠 新文章 OG 圖在靜態 PNG 生成前 404
- **問題**：`api/og.js` docstring 宣稱有 `/assets/og/<slug>.png → /api/og` 的 rewrite，但 `vercel.json` rewrites 只有 sitemap/feed。新文章在 `_gen_og_images.py` 跑並 commit PNG 之前，og:image 指向不存在檔案 → 社群分享卡空白。
- **證據**：`api/og.js:9`（docstring）vs `vercel.json` rewrites（無此條）。
- **驗收**：二選一——(a) 在 vercel.json 加 `{"source":"/assets/og/:slug.png","destination":"/api/og?slug=:slug"}`（排在靜態 /assets/og header 之後，讓磁碟檔優先）；或 (b) 把 `_gen_og_images.py` 納入新文章的必跑步驟並更新 og.js docstring。做 (a) 後驗證既有 27 張靜態 PNG 仍優先於動態端點。
- **模型等級**：Sonnet。

---

## 效能 / CWV（P）

### P-01 🟠 Google Fonts render-blocking（6 家族含 2 個 CJK）
- **問題**：每頁 `<link rel="stylesheet">` 同步載 Fraunces/Inter/JetBrains Mono/Noto Sans TC(2 weights)/Noto Serif TC，是行動裝置首屏最大 RTT 成本。**這是 DECISIONS D-12 已接受的債**，此處只記錄「若要償還」的驗收條件。
- **驗收**（三選一，且不得破壞 CSP）：(a) 自架用到的 woff2、只 preload H1 的單一 CJK weight、`font-display:swap`；(b) 非阻塞 `media="print" onload` 模式——**但**該 onload 是 inline event，需先讓它相容 CSP（hash 或改用 addEventListener bootstrap），否則會被 D-16 的 fail-closed CSP 擋；(c) 砍裝飾字型（Fraunces/JetBrains Mono）出關鍵路徑。完成後 CI Lighthouse 的 FCP/LCP 應改善且 CSP 無 violation。
- **模型等級**：Opus 級（CSP 交互 + 需量測驗證）。**關聯**：D-12、D-16。

### P-02 🟠 Service Worker precache 沒帶 `?v=`
- **問題**：`sw.js` 的 SHELL precache 列 `/assets/app.css` 等**無** `?v=`，但頁面請求的是 `/assets/app.css?v=20260664`（query-sensitive `caches.match`）→ install 時 precache 的裸 URL 從不被命中，還在 runtime 存第二份。
- **證據**：`sw.js` SHELL 陣列 vs 頁面 `<link>` 的 `?v=`。⚠️未親驗 codex 近期是否已順手修——先 `grep -n "app.css" sw.js` 看 SHELL 是否已含版本。
- **驗收**：SHELL 用 build 時模板注入 `?v=`；或 fetch handler 對這些靜態資產用 `ignoreSearch:true`。驗證離線可載入 + 無重複快取。
- **模型等級**：Sonnet。

### P-03 🟢 首頁兩個 speculationrules 區塊範圍重疊
- **問題**：`index.html` 有兩個 `<script type="speculationrules">`，`/blog/*` 被兩者涵蓋，第一個 `moderate` eagerness 會 hover 就 prerender 整個文章命名空間 → 浪費使用者流量/CPU。
- **驗收**：合併為單一區塊；廣泛 `/blog/*` 降為 `conservative`；保留 7 篇 hero 的 list-rule。
- **模型等級**：Sonnet。⚠️未親驗（codex 可能已調整）。

---

## 安全（S）

### S-01 🟠 /admin 用 localStorage 存 GitHub PAT（雙軌認證債）
- **問題**：`/admin` 的 CMS 用使用者貼上的 GitHub PAT 存 localStorage（`hs:admin:gh-pat`）直打 api.github.com；與 `/api/admin/*` 的 server-side HMAC 模型並存。任何 /admin 上的 script 注入都能讀走可改全站的 token。**已部分緩解**（DECISIONS D-17 的 /admin CSP 限制 connect-src + 無 unsafe 外流面）。
- **驗收**：退役 localStorage-PAT，統一到 server-side password/HMAC（GITHUB_TOKEN 只在 server env）；或至少改用 fine-grained 低權限 token + 到期提醒。**此改動會動 CMS 登入流程 → 必須站主本人在線上測過才 merge**（MODEL-GUIDE §4：牽涉站主工作流的拍板）。
- **模型等級**：Opus 級 + 站主測試。**關聯**：D-17。

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

### M-06 🟠 admin 儲存路徑的 strip 清單雙軌（client vs server 不一致）
- **問題**：WYSIWYG 儲存前，客戶端 `blog/blog-admin.js` 的 `_sanitizeForSerialize` 只剝除部分 runtime 注入元素；伺服器端 `api/admin/_save.js` 的 `RUNTIME_HELPER_IDS` 清單較全但兩邊各自維護，且都未涵蓋全部 JS 注入區塊（hs-breadcrumb、hs-article-hero、hs-inline-toc、hs-prevnext、一次性 `<style id="hs-*-css">` 等）。注入器多用 `if (getElementById(...)) return` 防重複 → 一旦過時副本被序列化入庫，執行時就不再重建，**過時 chrome 永久化**。
- **驗收**：單一來源清單（server 的 `RUNTIME_HELPER_IDS` 為準，前端引用同一份或鏡像常數並以註解標明耦合）；清單擴充涵蓋全部 `DN.inject*`/`add*` 輸出 id 與一次性 style id；`data-zh/data-en` 回寫只作用於可編輯 prose 區域。
- **模型等級**：Opus（多檔行為變更，需先反證再改）。

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
