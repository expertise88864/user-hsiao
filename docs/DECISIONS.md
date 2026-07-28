# DECISIONS.md — 已定案決策帳本（Decision Ledger）

> **讀者**：未來在此 repo 工作的每一個 AI session（任何模型等級）與站主本人。
> **用途**：這裡的每一條都是「已經審查過、討論過、定案」的決策。
> **鐵律**：在提出任何 SEO / 架構 / 安全 / 內容政策變更之前，先讀完本檔。
> 若你的建議與某條決策相同 → 不必重提，那是已知狀態。
> 若你的建議要**推翻**某條決策 → 只有滿足該條「重開條件」才可提出，且必須明說「這會推翻 D-xx」。
> 審查工具（自動或人工）重複標記這些項目時，回覆「intentional, see docs/DECISIONS.md D-xx」即可，不要修。
>
> 事實基準：commit `66745a6`（cache-bust `v=20260664`）。每條附錨定 commit，可用 `git show <sha>` 查證。

---

## A. SEO / 索引政策

### D-01 robots.txt 對所有 AI/LLM 爬蟲開放（v35 政策）
- **決策**：移除 GPTBot/CCBot/anthropic-ai/cohere-ai/Amazonbot/FacebookBot/Bytespider/ImagesiftBot/Diffbot 的 `Disallow: /` 群組；它們落入萬用 `*` 群組（可爬公開內容；`/admin`、`/api/`、`/reset-sw` 仍擋）。查詢型引用爬蟲（ChatGPT-User、OAI-SearchBot、PerplexityBot、Claude-User、ClaudeBot）保留顯式放行群組。
- **理由**：新站需要最大化 AI 語料存在感；訓練爬蟲不帶直接點擊，但長期讓 LLM「認識」本站。站主明示決定。
- **錨**：`4aded2b`（robots.txt）＋ `03e1577`（測試同步）。
- **耦合**（改 robots 政策必須同步改，缺一 CI 就紅）：
  1. `robots.txt` 本體
  2. `tests/seo/head.spec.js` 的 robots 測試（斷言 GPTBot **沒有**自己的 Disallow 群組）
  3. `_check_robots.py` — 注意陷阱：它把 `\n\n` 分隔的**註解區塊**也當群組解析；robots.txt 的註解裡不要同時出現字面 `User-agent:` 與 `Allow: /`（會誤判成缺 internal disallows 的群組）。
- **重開條件**：站主要求，或出現爬蟲濫用（頻寬/成本異常）證據。

### D-02 `/notes`（+`/en/notes`）= noindex,follow 且不在 sitemap
- **決策**：`/notes` 是「籌備中」薄頁，設 `noindex,follow`、從兩份 sitemap（`_gen_feeds.py` 靜態 + `api/sitemap.js` 動態）的 STATIC_PAGES 移除，並登記於 `_check_index_boundaries.py` 的 `PRIVATE_PAGES`。
- **理由**：薄頁被索引是年輕 YMYL 站的品質負債。
- **錨**：`9303014`。
- **重開條件**：/notes 寫出實質內容後 → 反向操作全部三處 + 恢復 sitemap，一次做完。

### D-03 兩篇佔位文 301 轉址到完整指南
- **決策**：`/blog/cataract-surgery-faq` → `/blog/cataract-comprehensive-guide`、`/blog/glaucoma-warnings` → `/blog/glaucoma-comprehensive-guide`（含 `/en/` 鏡像，共 4 條，`vercel.json` redirects，301）。
- **重要**：這兩篇的 `.html` 檔**仍在 repo**（noindex），但路由層被轉址攔截、線上到不了。這不是 bug。**不要**「清理孤兒 HTML」，也**不要**移除轉址——除非文章真的寫成完整內容（屆時：移除轉址 + 解除 stub + 進目錄，見 docs/ARTICLE-STANDARDS.md 的 stub 生命週期）。
- **理由**：解 GSC「遭 noindex 排除」驗證失敗 + 把信號導給活頁。
- **錨**：`9f9beba`。

### D-04 `contact-lens-safety`、`red-eye-conjunctivitis` 維持 noindex 佔位
- **決策**：這兩篇（+en）是刻意未發布的「預告」佔位頁，維持 noindex、留在 `DN.STUB_SLUGS`、不在 sitemap。GSC 把它們列在「遭 noindex 排除」是**預期且無害**——那是資訊性分類，不是錯誤。
- **給站主**：不要對這兩頁按 GSC 的「驗證修正」，會永遠失敗。
- **重開條件**：寫成完整文章時（高搜尋量主題，值得寫；見 docs/BACKLOG.md C-01）。

### D-05 動態 sitemap 的 lastmod 後備 = 目錄 `updated` 欄位
- **決策**：`api/sitemap.js` 的文章 lastmod：GitHub commits API 優先，失敗時退回 `a.updated || a.date`（不是只有 date）。
- **殘餘風險 → 已解決（2026-07 工單 Phase 3 核實，非本次修）**：原記「`parseArticles()` 靠 `ghGetFile('blog/blog-shared.js')`，token 失效時回 `[]` → 線上 sitemap 可能只剩靜態頁」。現況：`api/sitemap.js` 的 **`parseArticles()` 內容來源／解析失敗路徑**（`ghGetFile` throw/回 null、regex 不 match、解析出空陣列）皆退回 `api/_content_snapshot.js` 的 `FALLBACK_ARTICLES`（凍結全量快照，`_gen_api_content_snapshot.py` 產）→ 原「token 失效 ⇒ 只剩靜態頁」的 SPOF 消除。**範圍註**：handler 最外層 `catch` 仍回 HTTP 500（`api/sitemap.js:303`），非 snapshot 路徑。**BACKLOG T-01 ✅ 關閉**，勿重開。
- **錨**：`9303014`。

### D-06 快取破壞（cache-bust）政策
- **決策**：全站 `?v=2026xxxx` 單調遞增版本（**目前 `v=20260665`**，以 `grep -oE "v=2026[0-9]{4}" index.html | head -1` 為準）；改了 CSS/JS 內容就全站 bump（純字串取代，涵蓋 *.html + admin/admin.js 等）。
- **⚠ 有兩個版本紀元，bump 必須同時動**（2026-07-26 round-3 外審發現：只 bump 了 `?v=`，21 個檔的 `hs:siteVer` 還停在舊值）：
  1. 資產 URL 的 `?v=NNNNNNNN`；
  2. `hs:siteVer` 強制重置戳記——內容頁寫成 `var T='NNNNNNNN'`、`admin.html` 寫成 `TARGET = 'NNNNNNNN'`。這個戳記與 localStorage 比對，不一致才觸發 SW/快取強制重置。**只 bump `?v=` 的話戳記仍相符 → 重置不會發生**，回訪的 admin 會帶著舊 editor bundle 對上新伺服器（實際發生過，見 BACKLOG Round 3）。
  最省事的做法是直接取代裸數字 `20260664` → `20260665`（涵蓋兩者），再跑 `npm run minify`。
- **釐清（原文易誤讀）**：`v=20260520`／`v=20260525` **不是**活的釘選 URL——它們現在只存在於 `sw.js` 的變更日誌註解裡，不會被字串取代影響。
- **耦合**：`sw.js` 的 SHELL precache 也含版本概念；`_check_performance_budget.py` 查**兩個紀元**的一致性（`?v=` 對首頁、`hs:siteVer` 對 `?v=`），變異測試已驗證會轉紅。

---

## B. Schema / E-E-A-T

### D-07 reviewedBy = inline Person/Physician（codex 升級版），且可見徽章 =「最後更新」
- **現狀（兩個互補決策並存）**：
  1. 文章 JSON-LD 的 `reviewedBy` 已從 bare `@id` 升級為**完整 inline Person/Physician 物件**（含姓名、學位、專科；保留 `@id` 供實體對齊），由 `_normalize_reviewed_by.py` 維護、冪等（錨：`e760b1c`）。
  2. 文章可見徽章文字是「**最後更新 / Last updated**」不是「最後審閱」——因為該日期值 = `meta.updated||meta.date`（更新/發布日），不是獨立編輯審查事件；YMYL 不可暗示不存在的審查（錨：`9303014`，`blog/blog-shared.js` 的 `addReadingMeta`）。
- **仍然事實**：作者＝審閱者（自我審閱）。schema 誠實揭露 Resident 身分，所以是「冗餘但誠實」訊號，非欺騙。
- **重開條件**：招募到真正的獨立專科審閱醫師時 → 新增獨立 reviewer Person 節點（含其真實外部檔案 URL）、`reviewedBy` 指向該節點、徽章可改回「最後審閱」並顯示審閱者名。這是內容端最大的 E-E-A-T 槓桿（見 docs/GROWTH-PLAYBOOK.md）。

### D-08 作者頁（about）硬性內容限制 — 站主明令，**絕對優先於任何 SEO 建議**
- **禁止**：作者頁與全站不得出現作者任職/受訓**醫療機構名稱**；不得出現掛號、門診時間、預約連結等任何招攬/廣告性內容。
- **允許的 E-E-A-T 補強方向**：教育宗旨、引用/編輯方針、更正政策、衛教免責立場、學歷（高雄醫學大學已公開使用）、`sameAs` 外部檔案（ORCID/LinkedIn/衛福部醫事查詢——**僅限站主親自提供的 URL，AI 絕不可自行編造或搜尋填入**）。
- **法規框架**：所有內容以《醫療法》衛教框架撰寫——病人視角、不宣稱療效、不用最高級形容。
- **重開條件**：僅站主本人可修改此條。

### D-09 FAQPage 產生方式 = on-page `<details>` → 自動 JSON-LD，不手寫
- **決策**：文章 FAQ 一律用 `<section class="hs-faq">` + `<details><summary>` 標記寫在頁面上（樣式在 `assets/article.css`），FAQPage JSON-LD 由 `_gen_faqpage_jsonld.py` 掃描自動產生（`data-faq-auto` 屬性標記）。**不要**在文章手寫 FAQPage JSON-LD（產生器看到手寫版會跳過，造成雙軌）。
- **產生器的門檻**（寫 FAQ 時必須滿足，否則默默不收錄）：zh 問題須含問號/迷思等 hint、≤140 字；答案 ≥20 中文字（實務用 ≥30）；CJK 比例 ≥0.18；每頁 ≤15 題；noindex 頁跳過；只處理 zh 源（EN 鏡像繼承）。
- **錨**：`9303014`（7 篇文章的 FAQ 即此模式）。

---

## C. 前端 / 效能

### D-10 mag-footer 樣式單一來源 = `assets/app.css`
- **決策**：全站頁尾 `.mag-footer` 的 CSS 只存在於 `app.css`（所有頁面都載入）；`article.css` 只留指標註解。顏色用**字面值**（`#2a2620`/`#faf7f2`/`#a4c4dd`）因為 `--ink`/`--bg` 變數只在 article.css 定義、非文章頁拿不到。
- **歷史教訓**：曾把 footer CSS 抽到 article.css 導致首頁/about/privacy 等非文章頁頁尾全裸跑版（回歸 commit `918dae6`，修復 `e69526d`）。**不要**再把它搬回 article.css 或 inline。

### D-11 版本化資產 = immutable 快取
- **決策**：`/assets/app.css`、`/assets/article.css`、`/blog/blog-shared.min.js` 的 Cache-Control = `public, max-age=31536000, immutable`（`?v=` bump 即失效機制）。
- **耦合**：`vercel.json` headers ↔ `_check_static_asset_headers.py` 的 `EXPECTED` dict——**兩處必須同改**，只改一處 CI 紅。
- **錨**：`9303014`。

### D-12 Google Fonts render-blocking = 已知且暫時接受的債
- **決策**：每頁 `<link rel="stylesheet">` 載 6 個字型家族（含兩個大型 CJK）目前**保留原樣**。已評估：非阻塞化需要 CSP-hash 相容的 loader 或自架字型，工程量大；且 body 有本機 CJK fallback + `display=swap`，實際傷害是 FOUT 與一個第三方 RTT，不是文字全阻塞。
- **不要**：在沒有處理 CSP inline-event hash 的情況下貿然套 `media="print" onload` 模式（會被 CSP 擋或需要重生 hash 鏈）。
- **重開條件**：見 docs/BACKLOG.md P-01（完整驗收條件）。

### D-13 視覺回歸基準圖只能由 CI 產生
- **決策**：`tests/visual/snapshots/` 的 21 張 PNG 基準只能來自 GitHub Actions（Ubuntu/Chromium 對線上站截圖）。**絕不**提交本機（尤其 Windows）產生的截圖——字型光柵化不同，必定 mismatch。
- **視覺測試涵蓋 5 個 URL**（改這些頁的可見內容，視覺測試**應該**紅）：`/`、`/en/`、`/blog/dry-eye-myths`、`/blog/floaters-retinal-detachment`、`/blog/pediatric-myopia-control`（各 desktop/tablet/mobile）。
- **變綠程序**（需要有 GitHub 權限的人／站主）：GitHub → Actions → Visual regression → Run workflow → `force_update: true`。CI 會重截、自動 commit `[skip ci]` 基準。之後本機 `git pull`。
- **錨**：`.github/workflows/visual-regression.yml`。

### D-14 Playwright 產物永不入庫
- **決策**：`playwright-report/`、`test-results/`、`blob-report/` 已入 `.gitignore`。曾發生 `git add -A` 誤收（`03e1577`，`2abef07` 清除）。commit 前看一眼 `git status -s` 的清單。

---

## D. 安全

### D-15 SVG 上傳全面禁止
- **決策**：`api/admin/_upload.js` 的 `ALLOWED_EXT` 不含 svg，另有 base64 頭部嗅探擋改名混入。理由：SVG 是活性 XML 文件，regex 消毒可繞過（`<svg:script>`、`/onclick=` 等），且上傳資產無 per-file CSP。
- **重開條件**：同時做到三件事才可解禁：allowlist 解析式消毒（DOMPurify SVG profile 級）+ 上傳資產回應加 `Content-Security-Policy: default-src 'none'; sandbox` + middleware CSP matcher 不再排除 `.svg`。

### D-16 CSP fail-closed
- **決策**：`middleware.js` 的 `buildCsp()` **永遠**用 hash 模式；`INLINE_SCRIPT_HASHES` 為空時寧可 inline script 大聲壞掉，也不退回 `'unsafe-inline'`。
- **不要**：任何「hash 空就放寬」的 fallback。那會讓建置滑跤靜默移除全站最重要的 XSS 防線。
- **錨**：`9303014`。

### D-17 /admin 有自己的 CSP（vercel.json）
- **決策**：`/admin(.*)` 回應帶顯式 CSP：`connect-src 'self' https://api.github.com https://*.githubusercontent.com`（限制 PAT 外洩面）、`object-src 'none'`、`frame-ancestors 'none'` 等。
- **若 admin 功能壞掉**：最小幅度放寬對應指令（多半是 connect-src 或 img-src），**不要**刪整條 header。
- **原記「已知殘債」→ 已核實不存在（2026-07 工單 Phase 4）**：曾記為「admin 用 localStorage 存 GitHub PAT 的雙軌認證模式」。**現行碼中無此路徑**：**客戶端** grep（`*.html`/`*.js`，**排除 `api/`**、`node_modules`、`*.min.js`）對 `hs:admin:gh-pat` / `gh-pat` / `githubToken` / `api.github.com` **0 命中**；`admin.html` 的 `localStorage` 只存 `hs:siteVer`；認證是密碼（`ADMIN_PASSWORD` env）→ `/api/admin/login` → HMAC cookie → **所有特權 admin 呼叫**帶 `credentials:'include'`（公開的 A/B 端點不帶），`GITHUB_TOKEN` **只在 server env**。（註：`api.github.com` **確實**出現在 **server 端** 6 支：`api/admin/_github.js`、`_history.js`、`_rollback.js`、`_upload.js`、`_upload-srcset.js`、`api/sitemap.js`——那正是正確架構：GitHub 呼叫本就該在 server 用 env token，不是客戶端 PAT。）即 S-01 想要的目標態**已是現況**。**BACKLOG S-01 ✅ 關閉**，勿重開。

### D-18 Markdown 渲染輸出必經消毒
- **決策**：`api/admin/_md.js` 對連結/圖片 URL 做 scheme allowlist（http/https/mailto/tel、data:image 僅圖片）、raw-HTML passthrough 剝除 `<script>`/`on*=`/`javascript:`。任何新的「內容→提交 HTML」路徑都必須套同等消毒。
- **錨**：`9303014`。

### D-19 push 訂閱防濫用
- **決策**：`api/push/_subscribe.js`：`MAX_SUBS=5000` 上限 + endpoint host 白名單（googleapis/apple/windows/mozilla push 網域）。放寬前先想清楚無認證端點的存儲膨脹與 SSRF 放大。

---

## E. 流程 / 工作方式

### D-20 Pre-push 閘門（每次 push 前，無例外）
1. `python preflight.py`（跑完整產生器鏈 ×2 驗證固定點 + validate + `_check_all.py --quick`；鏈的步驟清單**動態解析自 `.github/workflows/quality.yml`**，所以 codex 加新 generator 也不會過時）。
2. **Codex GPT-5.6-sol diff review**（站主全域規則，2026-07-10 由 gpt-5.5 升級）：把 staged diff 交給 codex MCP（`model=gpt-5.6-sol`；需 codex CLI **`0.145.0-alpha.2`+**——stable 0.144.1 仍 400，見 memory），列 blocking issues，**APPROVE 才 push**。
3. push 後用 `python _ci_status.py <sha> --watch` 盯 CI（本環境無 `gh` CLI）。
- **錨**：本 session 全程實踐；工具見 repo 根目錄。

### D-21 「quality 紅了先看是不是 drift 自癒」
- CLAUDE.md 已載：紅信 + 2 分鐘內出現 `ci: regen ... [skip ci]` 自動 commit = 系統已自癒，**不要**再推「修正」。只有紅了且無自癒 commit 才介入。
- 本 session 補充的兩個真實非-drift 紅燈案例（供辨識模式）：
  a. robots.txt 政策改動 → `tests/seo/head.spec.js` 斷言舊政策（修測試，見 D-01 耦合）。
  b. 視覺基準過期 → 見 D-13 程序。

### D-22 內部文件（docs/、*.md）不進搜尋索引
- **決策**：`vercel.json` 對 `/docs/(.*)` 回 `X-Robots-Tag: noindex,nofollow`。內部流程文件是薄的非醫療內容，不該進 YMYL 站的索引。
- **錨**：本檔所屬 commit。

### D-23 三大主題叢集的內鏈已完整，不要過度加鏈
- **事實（審計結論，錨 `4aded2b`）**：兒童近視控制、乾眼症、飛蚊症-視網膜剝離三個叢集的文章間**已全數雙向互連**（文內「延伸閱讀」清單 + `.hs-related-pill` + 靜態 related 區塊三層）。當時唯一缺口（floaters → high-myopia-maculopathy）已補。
- **規則**：新文章發布時把它接進所屬叢集（雙向、描述性錨點）即可；**不要**對既有文章批量「補內鏈」——審查工具若建議大量加鏈，先跑 `grep -oE 'href="/blog/[a-z0-9-]+"' blog/<slug>.html | sort | uniq -c` 驗證是否真缺。

### D-24 admin 儲存的 runtime-helper strip 清單是「雙檔耦合、由 checker 強制同步」
- **決策**：WYSIWYG 存檔要剝除 blog-shared.js 注入的 runtime helper，此清單**必存在兩處**——客戶端 `blog/blog-admin.js` 的 `_sanitizeForSerialize`（preview/draft/save 前跑）與伺服器端 `api/admin/_save.js` 的 `RUNTIME_HELPER_IDS`（commit 前的 defense-in-depth）。兩個 runtime 無法共用 module，所以**不追求「一份檔案」，改用 `_check_runtime_helper_sync.py` 強制兩份等價**（client = server ∪ {hs-admin-bar, hs-admin-status, hs-admin-css}）。
- **理由**：server 剝而 client 沒剝 → admin preview 顯示的與入庫的不一致（preview 說謊）；client 剝而 server 沒剝 → 過時 helper 混入 commit（reload 時因注入器 `if(getElementById)return` 不重建 → 永久化）。等價才能同時避免兩者。
- **耦合（三處，改一處要改三處）**：`blog/blog-admin.js` 的 strip 陣列 ↔ `api/admin/_save.js` 的 `RUNTIME_HELPER_IDS` ↔ `_check_runtime_helper_sync.py`（在 `_check_all.py --quick` 內，pre-push 會擋）。**server 為 canonical**。
- **陷阱**：新增/移除任一 runtime helper（`DN.inject*`/`add*`/一次性 `<style id="hs-*-css">`）時，兩清單都要同步；checker 會擋 drift。但**有 authored 佔位的 id 不可加入**（`hs-related`/`hs-feedback`/`hs-support`——見 BACKLOG M-06/M-07：strip 它們＝刪文章原始碼裡的掛載點＝data-loss）。判斷準則：純 `createElement` 且無對應 authored `<div id>` 才可 strip。
- **重開條件**：若日後把 admin 前端改成 ESM 並能與 server 共用一份 `RUNTIME_HELPER_IDS`（例如 build 期注入或共用 config JSON），可退役 checker、改真單一來源。

---

## 附：本帳本的維護規則
- 新決策定案時**立即**追加一條（格式照舊：決策/理由/錨/耦合/重開條件），並在 commit message 註明 `docs: DECISIONS +D-xx`。
- 決策被正式推翻時**不要刪除**，改為 `~~刪除線~~ + SUPERSEDED by D-yy (commit)`——歷史脈絡本身是資產。
- 本檔與現實衝突時：以 repo 現狀 + git log 為準，並修正本檔（先查證，再改文件）。
