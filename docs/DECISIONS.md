# DECISIONS.md — 已定案決策帳本（Decision Ledger）

### D-28 候選 CI 與 Preview 驗證後才正式發佈（2026-09-06）

- 決策：使用者核可候選分支遠端完整 CI → PR/Preview 瀏覽器與視覺回歸 → 同一 SHA 正常快轉 main → 核對正式 CI/部署。
- SUPERSEDED：D-20 的「候選 push 前完整本機 CI」與直接 main 發佈順序，以及 D-13 基準更新後的舊發佈順序；模型審查、生成固定點、Ubuntu 基準及醫療核可不變。
- 耦合：`_delivery.py`、policy、`.githooks/pre-push`、Vercel ignored-build gate、`REMOTE_CI_DELIVERY.md`。不得使用其他 push helper 避開。
- CMS 新 commit 必須納入候選祖先；整合後 SHA 改變就重驗，不 force-push。存檔與正式發佈分開。
- 視覺基準：只能在 codex/* 的已部署 Preview 上產生 Ubuntu artifact；HTTP 錯誤、登入導向、空主內容不得成為新基準，必須人工確認且另走候選 CI。
- Codex 使用既有 `scripts/codex_review.sh deep`（gpt-5.6-sol/high/read-only），不使用舊文中的 MCP／貼 diff 範例。Claude 仍為 claude-opus-5/high。
- 範圍：本機 hook 與 Git 自動部署防護，不宣稱已設定 GitHub server rules 或能阻止管理員手動繞過 Vercel ignored-build。
- 錨：本次 delivery 設定 commit；重開條件：使用者另行定案。

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
- **決策**：全站 `?v=2026xxxx` 單調遞增版本（**目前 `v=20260670`**，以 `grep -oE "v=2026[0-9]{4}" index.html | head -1` 為準）；改了 CSS/JS 內容就全站 bump（純字串取代，涵蓋 *.html + admin/admin.js 等）。
- **⚠ 有兩個版本紀元，bump 必須同時動**（2026-07-26 round-3 外審發現：只 bump 了 `?v=`，21 個檔的 `hs:siteVer` 還停在舊值）：
  1. 資產 URL 的 `?v=NNNNNNNN`；
  2. `hs:siteVer` 強制重置戳記——內容頁寫成 `var T='NNNNNNNN'`、`admin.html` 寫成 `TARGET = 'NNNNNNNN'`。這個戳記與 localStorage 比對，不一致才觸發 SW/快取強制重置。**只 bump `?v=` 的話戳記仍相符 → 重置不會發生**，回訪的 admin 會帶著舊 editor bundle 對上新伺服器（實際發生過，見 BACKLOG Round 3）。
  最省事的做法是直接取代裸數字(例如 `20260665` → `20260666`,涵蓋兩個紀元),再跑 `npm run minify`。**⚠ 這個「目前值」本身就漂移過兩次**——2026-07-27 連續兩批(M-07 entity-link 批、Batch A)都是先 bump 了全站才發現本條沒跟著改。改版號時請把這一行當成 checklist 的一部分,或直接以 `grep -oE "v=2026[0-9]{4}" index.html | head -1` 為準。
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
- **決策**：正式頁的 authored `.mag-footer` 排版樣式集中於 `app.css`；`article.css` 只留指標註解。生成的 critical CSS 與編輯模式的透明度提示不是第二份 authored 排版來源。
- **現況（2026-09-06）**：六個非文章頁的 authored footer CSS 已移入 app.css，以低 specificity 的頁型範圍保留原差異。英文由生成器產生；18 個 viewport 對照的頁尾像素與 computed style 相同。generated critical CSS 不算第二份 authored 來源。驗收見 BACKLOG M-17。
- **歷史教訓**：曾把 footer CSS 抽到 article.css 導致首頁/about/privacy 等非文章頁頁尾全裸跑版（回歸 commit `918dae6`，修復 `e69526d`）。**不要**再把它搬回 article.css 或 inline。

### D-11 版本化資產 = immutable 快取
- **決策**：`/assets/app.css`、`/assets/article.css`、`/blog/blog-shared.min.js` 的 Cache-Control = `public, max-age=31536000, immutable`（`?v=` bump 即失效機制）。
- **耦合**：`vercel.json` headers ↔ `_check_static_asset_headers.py` 的 `EXPECTED` dict——**兩處必須同改**，只改一處 CI 紅。
- **錨**：`9303014`。

### D-12 Google Fonts 的歷史同步載入決策（已由 D-27 取代）
- 早期曾接受同步載入的效能債；2026-07-27 站主改採 D-27 的非阻塞方案，現行 HTML 與 CMS scaffold 均已實作。
- 不得重加 inline onload handler；CSP 相容 loader 與 noscript 後備由 performance guard 驗證。

### D-13 視覺回歸基準圖只能由 CI 產生
- **決策**：`tests/visual/snapshots/` 的 21 張 PNG 基準只能來自 GitHub Actions（Ubuntu/Chromium 對線上站截圖）。**絕不**提交本機（尤其 Windows）產生的截圖——字型光柵化不同，必定 mismatch。
- **視覺測試涵蓋 7 個 URL**（改這些頁的可見內容，視覺測試**應該**紅）：`/`、`/en/`、`/blog/dry-eye-myths`、`/blog/floaters-retinal-detachment`、`/blog/pediatric-myopia-control`，另含 `/tools`、`/blog/`（各 desktop/tablet/mobile）。
- **基準更新程序**：manual force_update 僅產生 Ubuntu 候選基準 artifact，不再自動 commit／push。下載後先確認可見變化符合預期，再以完整本機 CI 等效檢查、外審與新 SHA GitHub CI 流程交付。本輪沒有更新任何 PNG 基準。
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
1. 完整適用的本機 CI 等效檢查全過：API、Python、瀏覽器、size budget 及 `python preflight.py`（跑完整產生器鏈 ×2 驗證固定點 + validate + `_check_all.py --quick`；鏈的步驟清單**動態解析自 `.github/workflows/quality.yml`**，所以 codex 加新 generator 也不會過時）。
2. **Codex GPT-5.6-sol diff review**（站主全域規則，2026-07-10 由 gpt-5.5 升級）：把 staged diff 交給 codex MCP（`model=gpt-5.6-sol`；需 codex CLI **`0.145.0-alpha.2`+**——stable 0.144.1 仍 400，見 memory），列 blocking issues，**APPROVE 才 push**。
3. push 後用 `python _ci_status.py <sha> --watch` 盯 CI（本環境無 `gh` CLI）。
- **錨**：本 session 全程實踐；工具見 repo 根目錄。

### D-21 CI drift 也必須核對最終 SHA
- 歷史的「看到自動 regen commit 就忽略紅燈」規則已由最新使用者 CI 定案取代。先診斷 drift 或真缺陷；任何新 commit 都需要重新驗證，舊 SHA 紅燈不能算作新 SHA 綠燈。
- 不得加 skip-ci 或使用會跳過必要 CI 的更新流程；修正後必須保存最終 SHA 與所有適用 checks 的成功證據。

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


### D-25 實體連結（entity linking）政策：`sameAs` 只給「同一個實體」
- **決策**：文章 `about` 的每個 `MedicalCondition` 節點加 `sameAs: [Wikidata, en.wikipedia]`，**但只有在該節點的 `name` 恰好就是該實體時才加**。手術/治療決策主題（「白內障手術選擇」「青光眼治療」）、複合主題（「白內障合併散光」）、比實體更窄的亞型（「非感染性葡萄膜炎」「兒童近視」「帶狀疱疹眼疾合併角膜基質炎」）、部位限定疾病（「淚腺腺樣囊狀癌」）、以及無對應實體者（「近視性黃斑部病變」——`Degenerative myopia` 只是 `Myopia#Types` 的轉址）**一律不加**，改列入 `UNMAPPED` 並寫明理由。目前 **16 個 condition 對應、9 個明確豁免 = 25 個全數決定**。
- **為什麼**：schema.org 定義 `sameAs` 是「明確指出該項目**身分**的 URL」。近似連結等於宣稱文章講的是**另一種病**，比不標更糟。
- **表以 `(slug, condition name)` 為鍵,不以 slug 為鍵**（外審第 3 點）：slug 鍵表達不了兩件本 repo 實際需要的事——(a) 一篇文章可有**多個** condition（`floaters-retinal-detachment` 的 飛蚊症／視網膜剝離 是兩個獨立節點、各有身分,slug 鍵會把它們併成一個連結）；(b) **身分屬於名稱**：slug 鍵之下,把 condition 改名成更窄或複合的病名仍會蓋上舊 URI,守衛看不出來。改名現在會讓建置失敗。
- **Q-id 來源紀律**：只能經 Wikipedia API（`action=query&prop=pageprops&ppprop=wikibase_item&redirects=1`）解析——它回傳轉址後的正規標題與對應 Wikidata item。**禁止憑記憶手加 Q-id。** 曾試過用既有 ICD-10 碼經 Wikidata P494 批次解析,回傳 `H16 → Q4393309 = dextran-40`(一種多醣,不是角膜炎),因為 Wikidata 該項目帶有錯誤陳述。其中 5 項另經該 ICD-10 查詢交叉驗證且一致(結膜炎/乾眼/甲狀腺眼疾/飛蚊/近視)。
- **守門**：`_check_entity_links.py` **fail-closed**——每個 about-MedicalCondition 必須恰好落在兩表之一;**沒有 condition 的文章也是錯誤**(只有 `index`/`topics` 這類列表頁在 `NO_CONDITION_OK` 白名單,且它們若宣告 MedicalWebPage 也會報錯);另檢查 Q-id 格式、殘留鍵(改名/改檔後對不到任何 condition)、兩表重複、豁免理由不得是佔位字串、URI 前綴不得被改指他處。JSON-LD 解析走**任意深度、任意屬性**——不只 top-level 與 `@graph`,連 `mainEntity`／`subjectOf` 這類節點值屬性底下的 condition 也看得到(外審 round-2:原本只遞迴 `@graph`,藏在 `mainEntity` 底下的第二個 condition 兩邊都看不到,而同層既有的 condition 又讓頁面看起來已被清點——**docstring 宣稱的覆蓋大於實作**,正是本守衛要抓的那一類缺陷);單／雙引號的 script tag 都接受。變異測試 12/12。checker **import** normalizer 的表與解析器而非各自維護（同 D-24 的耦合紀律）。
- **順帶修正的內容錯誤**：`飛蚊症` 的 `alternateName` 原列「後玻璃體剝離」——PVD 是飛蚊症的**成因**不是同義詞,與 `sameAs: Floater` 的身分宣告自相矛盾。已從 `_inject_medicalwebpage.py` 的 metadata 與文章 HTML 兩處移除。
- **鏈位置**：排在 `_normalize_reviewed_by.py` 之後、`_gen_en_pages.py` **之前**,讓 `/en/` 鏡像繼承。**更正一個曾寫錯的理由**：ld+json 的改動**不影響** CSP hash——`_gen_csp_hashes.py` 的 `is_executable_script()` 明確把 `application/ld+json` 視為 inert 並排除。
- **重開條件**：若 Wikidata 日後為上述豁免主題建立精確項目,逐案移入 `ENTITY_BY_CONDITION`（仍須經 Wikipedia API 核實）。
- **錨**：本次 commit。**關聯**：D-08（`sameAs` 只能用站主提供的 URL——那條規範**人物**身分；本條是**疾病**實體,屬公開事實,不受該限制）、D-24。


### D-26 SW 生命週期檢查器維持文字比對,不引入 JS parser
- **決策(站主定案 2026-07-27)**:`_check_pwa.py` 對 install／`warmPopular` 的斷言**維持正則 + 括號配對 + 值位置判定**,**不**引入 acorn 之類的 JS parser 改寫成 AST 查詢。BACKLOG `R-01` 標為 ⛔ 不修。
- **理由**:codex GPT-5.6-sol 在 P-04 補審第 8 輪明確判定,剩下的規避「需要刻意寫誤導性的結構改寫,不是普通的未來修改會無聲重新引入的缺陷」。為一個已判定夠用的迴歸守衛增加供應鏈依賴與 CI 複雜度,投報率為負。
- **仍然成立的前提**:該檢查器在程式碼裡**自述**它是文字比對而非資料流證明,且對合理重構 **fail-closed**(大聲失敗優於假綠)。變異矩陣 15/15 涵蓋每一輪外審提出的繞過。
- **重開條件(已收窄)**:只有在專案**因其他理由**引入 JS parser 時,才順手把那些斷言改寫成 AST 查詢。**在那之前不要重開。**
- **錨**:本次 commit。**關聯**:P-04、BACKLOG R-01、REVIEW-PLAYBOOK §6。


### D-27 P-01 字型載入償還方案 = 非阻塞 + CSP 相容 bootstrap
- **決策(站主定案 2026-07-27)**:償還 D-12 接受的字型債,採 **(b) 非阻塞載入並讓它相容 CSP**;不採 (a) 自架 woff2、不採 (c) 砍裝飾字型。
- **關鍵限制(定案時已知)**:**不得**使用 `onload="this.media='all'"`。`_gen_csp_hashes.py` 只對 `<script>`／`<style>` **內容**算 hash,**不涵蓋屬性上的 inline event handler**,而 D-16 的 CSP 是 fail-closed 且無 `'unsafe-hashes'` → 該 handler 會被擋,字型永不載入。必須改用 `rel="preload" as="style"` + `<script>` 內的 `addEventListener`,並保留 `<noscript>` 後備。
- **狀態**：已施作。現行 HTML 與 `api/admin/_new.js` 均非阻塞，`_check_performance_budget.py` 同時檢查產物與 scaffold。歷史漏改 scaffold 已在 `433ce06` 修復。
- **錨**:本次 commit。**關聯**:D-12(原始接受)、D-16(fail-closed CSP)、BACKLOG P-01。
