# REVIEW_WORKORDER_2026-07.md — 逐檔精讀 Code Review 工單（hsiao 站）

> **執行者**：Opus 4.8（單一 Claude Max $100 session，約 5 小時窗口）。
> **撰單者**：Fable 5（2026-07-04，基準 commit `8908b7d`）。
> **這份工單是什麼**：2026-06 的維度式審查（46 findings，見 docs/REVIEW-PLAYBOOK.md）是**抽樣式**的；本工單補上從未做過的**逐檔精讀** code review。價值集中在四塊從沒被整檔讀過的高風險面：blog-shared.js（~5,400 行，全站共用）、api/（~55 檔 ~6,500 行）、sw.js（~1,000 行）、admin CMS 層（~2,600 行）。
> **行數聲明**：本檔所有行數是撰單時 `wc -l` 粗估、僅供預算感——repo 持續有 admin/codex commit，**執行時以現場 `wc -l` 重量為準**，勿因數字不符質疑工單其他內容。
> **完成的定義**：進度表全勾，或額度耗盡時「已勾的 phase 都已 commit 上線 + 進度表如實反映」。兩者都算成功交付。

---

## ✅ 執行結果摘要（2026-07-10，Opus 4.8）

**Phase 1–5 已完成並上線**（各自獨立 commit，三閘 preflight + codex + CI 全綠）；codex 模型：**P1–P4 為 `gpt-5.5`，P5 起改 `gpt-5.6-sol`**（2026-07-10 站主全域升級）。**Phase 6 為本收尾 commit**，依 L4 走同一閘門（preflight → codex → push → CI）——**其閘門結果不在本文件內宣稱**（本摘要寫於 commit 前，以 git log 與 CI run 為準）；**push + CI 綠後 Phase 6 才算完成**。（Phase 0 是開工前置基線驗證，**不產 commit**；其進度表勾選隨 Phase 1 的 commit 一併入庫。）

commit 鏈：`8908b7d`(撰單基準) → `773bd87`(工單落檔；P1 的直接父) → `3ec4d75`(P1) → `faef8d9`(P2) → `c690b43`(P3) → `e6e440c`(P4) → `b102ce2`(P5) → 本 Phase 6 收尾 commit。

- **FIX（8 項，全上線）**：M-03（cmdk `/` 吞斜線）、M-04（TOC selector 逸出）｜P-02（SW 離線 fallback ignoreSearch）｜S-03×2（csp-report/errors KV bounded await）、og.js 誤導 docstring｜**M-06**（admin strip 清單雙軌 → 新增 `_check_runtime_helper_sync.py` 反漂移閘 + 雙語回寫收斂 + 補 style id）｜**S-04**（`_gen_csp_hashes.py` `\bsrc=`→`\ssrc\s*=`，`data-src` inline script 誤封鎖潛伏洞）。
- **LOG（4 新項）**：P-04（SW precache tier vs 文件 drift）、M-07（工具 widget strip tradeoff）、P-05（critical-css `@supports`→`@media` 誤標）、M-08（`@graph` FAQPage 漏，潛伏）。
- **核實後關閉（非改碼，反 fabrication）**：T-01（sitemap SPOF 已由 content-snapshot 消除）、S-01（localStorage-PAT 路徑**不存在**，已是 server-HMAC 目標態）。
- **institution 回寫**：新增檢查器 `_check_runtime_helper_sync.py`（60 檢查器）；DECISIONS **+D-24**（strip 清單雙檔耦合）；REVIEW-PLAYBOOK **§9 耦合矩陣補完**（8 列 + CI 守門欄，標 2 個未守耦合）+ **§11 判定表**更新為本工單審查基準（含覆蓋範圍誠實聲明）；pre-push review 模型 **gpt-5.5→gpt-5.6-sol**（全域，D-20/MODEL-GUIDE/preflight/L4）。
- **待站主拍板（ASK，非阻擋）**：P-04（SW install 行為二選一）、C-01/C-02（醫療內容：兩篇待寫 + answer-first 改寫，§10 鐵律）、about `sameAs` URL（D-08，只能站主提供）。
- **誠實邊界（勿把本工單當成「全 repo 逐行讀過」）**：**只有 P2 `sw.js`（982 行）是完整逐行全檔**。P1 `blog-shared.js` 為核心邏輯逐行 + 其餘 targeted risk-sweep；P3 `api/` 只深讀**關鍵路徑**（auth/gating/公開端點/KV 寫入 + **所有特權** admin 端點 `requireAdmin` grep 核實），非全部 ~55 檔；P5 為工單指定的 7 檔 = **6 個 generator（抽核，非全部）+ `middleware.js` 全檔**（非 7 個 generator；工單原文「27 個生成器」之計數依據未註明，`quality.yml` 建置鏈為 22 步，故不宣稱總數）。未深讀者以「關鍵路徑已覆蓋」記。**無 🔴 會壞站項目**。

---

## 0. 開工前置（Phase 0，~15 分鐘，不產出 finding）

1. `git pull --rebase origin main`（ANTI-OVERWRITE PROTOCOL，見 CLAUDE.md 開頭）。
2. 必讀（順序）：`CLAUDE.md` → `docs/DECISIONS.md`（23 條定案）→ `docs/MODEL-GUIDE.md` → `docs/BACKLOG.md`。**與 DECISIONS 一致的現狀不是 finding**。
3. 基線驗證：`set PYTHONIOENCODING=utf-8 && python preflight.py` → 必須全綠才開工（不綠 = 先修基線，那優先於本工單）。
4. 在本檔案底部「進度表」勾掉 Phase 0。

## 鐵律（違反任何一條 = 工單執行失敗）

- **L1** 醫療內容：只能重述文中已有引用支持的內容；發現疑似醫療錯誤 → 標 `<!-- TODO(醫師確認): ... -->` 並回報站主，**絕不自行改寫臨床宣稱或數字**。
- **L2** `/en/**` 是生成物，絕不手改；改 zh 源後跑鏈。
- **L3** 作者頁禁令（D-08）：不得出現任職/受訓醫療機構名稱、掛號/招攬內容；`sameAs` 只能用站主親自提供的 URL。
- **L4** 每次 push 前：`python preflight.py` 全綠 → Codex GPT-5.6-sol diff review（MCP/CLI，`model=gpt-5.6-sol`，2026-07-10 由 gpt-5.5 升級）APPROVE → push → `python _ci_status.py <sha> --watch`。
- **L5** 發現與 DECISIONS.md 衝突的「改進想法」→ 不執行，寫進回報詢問站主。
- **L6** 每個 critical/high finding 定案前先自我反駁一次（找反證 file:line）；修復只限「確定性 bug」（見下方處置協定）。

## 發現分級處置協定

| 級別 | 定義 | 處置 |
|---|---|---|
| FIX | 確定性 bug：null deref、邏輯錯誤有明確重現路徑、已列 BACKLOG 的已知項、檢查器/文件與現實 drift | 當場修，隨該 phase commit |
| LOG | 真實但有歧義/行為變更風險/工程量大 | 寫進 docs/BACKLOG.md（含驗收條件），不修 |
| ASK | 涉及策略、醫療內容、使用者體驗品味、DECISIONS 衝突 | 寫進 phase 回報，等站主 |

每個 phase 產出 = FIX commits + BACKLOG 增補 + 本檔進度表更新（都在同一 commit）。

---

## Phase 1 — blog/blog-shared.js 全檔精讀（5,425 行）
**預算**：session 的 ~25%（最大單一投資，全站每頁載入此檔，bug 影響面最大）。
**方法**：每次 Read 600-800 行，逐段記錄：狀態持有者（全域/closure）、事件監聽（有無重複綁定/洩漏）、DOM 寫入（innerHTML 是否過 Trusted Types sanitizer）、與 min.js 對應性。重點獵物：
- null/undefined deref（`querySelector` 後直接鏈式呼叫）
- 雙語切換（`applyTextOnly`/`DN.LANGS`）狀態一致性
- admin 模式（`?admin=1`）與讀者模式的路徑分岐 bug（已知例：BACKLOG **M-03** cmdk `/` 吞字元——**此項直接修**）
- Trusted Types 相容性（TT sanitizer 剝 `on*=` 後功能是否靜默失效，已知例：injectSpotlight 休眠問題）
- localStorage 讀寫的 try/catch 覆蓋（隱私模式會 throw）
**驗收**：全檔讀畢（進度表記錄讀到的行號區間）；M-03 修復並驗證（本地 serve + `?admin=1` 打 `/` 字元）；`npm run minify` + `python _check_min_js.py` 過。
**Commit**：`fix(review-p1): blog-shared.js findings`。

## Phase 2 — sw.js + 版本協調（982 行）
**預算**：~10%。
**方法**：全檔精讀。重點：precache SHELL 與 `?v=` 失配（BACKLOG P-02，**此項直接修**——方案 b：fetch handler 對 CSS/JS 用 `ignoreSearch:true` 匹配，最小 diff）；快取策略矩陣（每個 route 用哪種策略、有無互相矛盾）；`skipWaiting`/`clients.claim` 流程與頁首 cache-bust reload script 的互動（會不會雙重 reload）；離線 fallback 完整性。
**驗收**：P-02 修復；快取策略矩陣寫進 docs/REVIEW-PLAYBOOK.md §6 附註；閘門綠。
**Commit**：`fix(review-p2): sw.js cache alignment`。

## Phase 3 — api/ 安全關鍵面（P0 子集，27 檔 ~3,500 行）
**預算**：~20%。
**範圍（P0 = 無認證可達 + 寫路徑 + 基礎設施；完整路徑，共 27 檔）**：
- 無認證公開端點（12）：`api/csp-report.js`、`api/errors.js`、`api/search-log.js`、`api/events.js`、`api/cwv-ingest.js`、`api/ab-config.js`、`api/push/[op].js`、`api/push/_subscribe.js`、`api/push/_send.js`、`api/push/_store.js`、`api/push/_webpush.js`、`api/push/_key.js`
- 爬蟲面向（3）：`api/sitemap.js`、`api/feed.js`、`api/og.js`
- 基礎設施（3）：`api/_kv.js`、`api/_rate_limit.js`、`api/_edge_config.js`
- admin 認證與寫路徑（9）：`api/admin/_auth.js`、`api/admin/_login.js`、`api/admin/_upload.js`、`api/admin/_save.js`、`api/admin/_md.js`、`api/admin/_new.js`、`api/admin/_github.js`、`api/admin/[op].js`、`api/admin/_offline-token.js`
**每檔檢查清單**：requireAdmin?（該有的有嗎）／rate-limit?／輸入驗證（型別、長度、scheme）／輸出消毒／錯誤訊息不洩內部／KV/GitHub 呼叫的失敗路徑（會 500 還是靜默）。
**已知項直接修**：T-01（sitemap.js：ghGetFile 失敗時 fallback 讀部署內的靜態 sitemap.xml 或 `_content_snapshot`，不再回空文章清單）、T-02（vercel.json 加 `/assets/og/:slug.png` → `/api/og?slug=:slug` rewrite，置於靜態 og headers 規則後）、S-03（csp-report/errors/search-log 的 KV 寫入改 await）。
**驗收**：27 檔逐檔勾（進度表列檔名）；3 個已知項修復；閘門綠 + SEO smoke 過（og rewrite 動了 vercel.json，跑 `npx playwright test -c playwright.seo.config.js` 全套）。
**Commit**：`fix(review-p3): api P0 hardening`。

## Phase 4 — Admin CMS 前端（admin.html 2,041 行含內嵌 JS + blog/blog-admin.js 567 行）
**預算**：~15%。
**方法**：精讀。重點：儲存流程資料完整性（WYSIWYG serialize → POST → commit，對照 `api/admin/_save.js` 的 strip 清單——BACKLOG **M-06** 客戶端/伺服器 strip 清單統一，**直接修**：以 server 的 `RUNTIME_HELPER_IDS` 為單一來源，前端引用同一份清單或鏡像常數+註解耦合）；A/B 面板、圖片上傳 UI 的錯誤處理；`admin/mobile.html` 的 token 流程。
**明確不做**：S-01（PAT localStorage 退場）——只寫**設計提案**（server-proxy 方案 vs fine-grained PAT 方案，各列風險與工時）進 BACKLOG，等站主拍板。
**驗收**：M-06 修復；S-01 提案落檔；閘門綠（admin 是 noindex 內部工具，無視覺基準風險）。
**Commit**：`fix(review-p4): admin CMS save-path integrity`。

## Phase 5 — 生成鏈抽核 + middleware（~2,700 行）
**預算**：~15%。
**範圍（抽核 7 檔，不逐檔讀全部 27 個生成器）**：`_gen_en_pages.py`（805 行——鏡像正確性是雙語站命脈）、`middleware.js`（823 行——CSP 唯一來源）、`_gen_feeds.py`、`_extract_critical_css.py`、`_gen_csp_hashes.py`、`halfwidth_to_fullwidth.py`、`_normalize_reviewed_by.py`。
**重點**：regex-HTML 手術的邊界案例（巢狀標籤、屬性順序、跨行）；冪等性宣稱 vs 實際（連跑兩次 diff）；`_gen_en_pages.py` 對新 HTML 結構（hs-faq 等）的處理完整性。
**加做**：把發現的耦合關係補進 docs/REVIEW-PLAYBOOK.md §9 耦合矩陣（含「有無 CI 守門」欄）。
**驗收**：7 檔讀畢；耦合矩陣更新；發現的 FIX 級修復；閘門綠。
**Commit**：`fix(review-p5): generator chain + middleware`。

## Phase 6 — 收尾與制度回寫
**預算**：~5%。
1. docs/REVIEW-PLAYBOOK.md：各維度現況判定更新為「已核實（本工單）」+ 新基準 commit。
2. docs/BACKLOG.md：完成項標記、新 LOG 項就位、重排優先級。
3. docs/DECISIONS.md：本工單產生的新定案（若有）追加。
4. 本檔進度表全部更新 + 頂部加「執行結果摘要」區塊（完成 phase 數、FIX 數、LOG 數、ASK 清單）。
5. 最終 push（L4 閘門）+ CI 綠確認。
**Commit**：`docs(review): workorder 2026-07 completion`。

---

## 預算管理與斷點協定

- **粗估依據**（誠實聲明：Max session 的精確 token 額度非公開，以下是保守工程估算）：總精讀面 ~18k 行程式碼 ≈ 200k tokens 原文；精讀+分析+修復+閘門開銷約 4-6×，落在 0.8-1.5M tokens 區間，應可壓進一個 Max $100 session，但**不保證**。
- **對沖設計**：每個 phase 獨立 commit、獨立可上線；額度警訊（回應變慢/接近 5hr 窗口）出現時，完成當前檔案 → 走 L4 閘門 commit → 更新進度表 → 停。
- **續作安全協定**（防 stale review）：進度表每筆「已讀」都要附**當時的 HEAD sha**。續作 session 開工時先 `git pull --rebase`，然後 `git diff --name-only <進度表sha>..HEAD` ——已勾檔案若出現在變更清單（admin CMS 或 codex 可能改過）**必須重讀該檔**；未變更的已勾檔案不重讀。
- **降級路徑**（若開工就發現額度已折半）：只做 Phase 1 + Phase 3，其餘標「未執行」。這兩個 phase 覆蓋了最大風險面。
- **禁止**：為省額度跳過 L4 閘門、或用「掃過」代替精讀然後勾進度表——寧可少做誠實記錄。

## Opus 4.8 的能力邊界提醒（來自 docs/MODEL-GUIDE.md）

- 你做得到：本工單全部 FIX 級修復、逐檔精讀、閘門操作。
- 你要小心：JS 精讀時對「這段是不是 bug」的判斷——一律先找反證（誰呼叫它？什麼狀態下走到這？）再定案；不確定就 LOG 不要 FIX。
- 你做不到（別試）：判斷醫療內容正確性（L1）、連線上站驗證（sandbox 擋 Vercel HTTPS，用 CI 的線上 jobs）、看台灣 locale 搜尋結果、觸發 GitHub workflow_dispatch（請站主）。

---

## 進度表（執行時隨做隨更新，這是斷點續作的唯一依據）

- [x] Phase 0 — 前置與基線（preflight 綠；開工 HEAD sha：773bd87）
- [x] Phase 1 — blog-shared.js（讀時 sha：773bd87；覆蓋：linear 1–2260 + cmdk 2537–2863 + TOC 960–1155，其餘 2260–5425 以 targeted risk-sweep 覆蓋 innerHTML/message/eval/reload/activeElement 全部 hit 已逐一核實安全；FIX：2（M-03 cmdk 斜線、M-04 TOC selector 逸出）；LOG：0 新增。誠實註記：非逐行全讀，宣告為「核心邏輯逐行 + 宣告式資料/admin 基礎設施風險掃描」——見 MODEL-GUIDE 誠實條款）
- [x] Phase 2 — sw.js（讀時 sha：3ec4d75；全 982 行讀畢；FIX：1（P-02 離線 fallback ignoreSearch）；LOG：1（P-04 install 精快取所有 tier vs v30 多階段設計 drift）；加做：SW 快取策略矩陣寫入 REVIEW-PLAYBOOK §6。message/push/sync/periodicsync handler 皆核實安全：QUEUE_SAVE 有 source-origin+admin+slug 驗證，push/periodicsync 同源）
- [x] Phase 3 — api/ P0（讀時 sha：faef8d9；深讀：csp-report/errors/_rate_limit/search-log/cwv-ingest/events/ab-config/sitemap(parse+fallback+handler)/_content_snapshot/og/_auth/_login/[op] + push/* 稽核 + grep 核實**所有特權** admin 端點 requireAdmin 閘門（`_login`/`_ab-config` 讀/`_ab-stats` 計數為刻意公開） + 早前 session 已加固 _upload/_md/_subscribe；FIX：3（S-03 csp-report+errors KV await；og.js 誤導 docstring）；LOG：0 新增（T-02 維持、加註陷阱）；**核實已解決**：T-01（content-snapshot fallback 消除 SPOF）、S-03 之 search-log/cwv 早已 await。auth 面判定：solid，無 bypass（[op] 委派給各自 self-gate 的 handler）。誠實：feed/_kv/_github/_new/_save 等未逐檔深讀，但關鍵路徑（auth/gating/公開端點/KV 寫入）已覆蓋）
- [x] Phase 4 — admin CMS（讀時 sha：c690b43；深讀：`blog/blog-admin.js` 存檔路徑（`_sanitizeForSerialize` 407-455 + `doSave`/preview/draft 三處呼叫）、`api/admin/_save.js`（`RUNTIME_HELPER_IDS` + `stripRuntimeHelpers` + handler 驗證/上限）、`admin.html` 認證面（login 281-283 / env-status 574-583 / localStorage 用途）、`blog-shared.js` 注入器掛載模式核實（`_buildCalc` 3267-3315、hs-related/feedback/support 的 v34.11 authored-mount）；FIX：M-06（3 項：新增 `_check_runtime_helper_sync.py` 反漂移閘 + 兩清單互加耦合註解、補 2 個一次性 style id、雙語回寫收斂到 `<article>`）；LOG：M-07（工具 widget strip tradeoff）；**核實前提失效**：S-01（**客戶端** grep（`*.html`/`*.js`；排除 `api/`、`node_modules`、`*.min.js`）**0 命中**——`api.github.com` 於 **server 端** `api/` 存在（`_github.js`/`_history.js`/`_rollback.js`/`sitemap.js`/`_upload.js`/`_upload-srcset.js`）屬**正確架構**，非債；客戶端無 localStorage-PAT，已是 server-HMAC 目標態 → 反 fabrication，不寫幻影提案）；institution：DECISIONS **+D-24**（strip 清單雙檔耦合 + checker 強制）。L6 反證擋下 data-loss：related/feedback/support 有 authored 佔位，不加入 strip）
- [x] Phase 5 — 生成鏈+middleware（讀時 sha：e6e440c；已讀 7/7：`middleware.js`(全 823,含 hash 表)、`_gen_csp_hashes.py`、`_gen_en_pages.py`(全 805)、`halfwidth_to_fullwidth.py`、`_normalize_reviewed_by.py`、`_gen_feeds.py`、`_extract_critical_css.py`；FIX：1（S-04 `_gen_csp_hashes.py` `\bsrc=`→`\ssrc\s*=`,output-neutral 已驗）；LOG：2（P-05 critical-css `@supports`→`@media` 誤標;M-08 `should_drop_en_jsonld` @graph 巢狀漏）；加做：REVIEW-PLAYBOOK §9 耦合矩陣補完(8 列+CI 守門欄)。核實安全(無 bug)：middleware CSP fail-closed+單一來源(/admin 走 vercel.json,hash 表 /admin 條目為死資料)、`\/` EN_LANG_BOOTSTRAP 取代不出錯、halfwidth/normalize_reviewed_by 冪等、feeds XML escape 防 CDATA breakout。誠實:抽核 7 檔非全部 27 generator,依工單範圍)
- [x] Phase 6 — 收尾回寫（REVIEW-PLAYBOOK §11 判定表更新為本工單審查基準 `b102ce2` + 覆蓋範圍誠實聲明；§9 耦合矩陣 P5 已補；DECISIONS +D-24；BACKLOG 完成項標記 + P-05/M-07/M-08/S-04 就位；頂部「執行結果摘要」區塊已填；review 模型切 gpt-5.6-sol）
- 執行結果摘要：見本檔頂部「✅ 執行結果摘要」區塊。**Phase 1–5 已上線；Phase 6 隨本 commit 交付（push + CI 綠後即為完成）**。

## 明確排除範圍（本工單不做，避免額度失血）

- api/ P1 子集（admin 工具類 25 檔：_cwv/_spell/_seo-fix/_dictionary 等）——authenticated 後面的低風險工具，留給下一張工單。
- 62 個 _check_*.py 檢查器本身的 review——它們有 CI 每日行使，錯了會自我暴露。
- 內容/醫療正確性審查（L1，站主專屬）。
- 任何新功能開發、視覺改版、效能重構（D-12 字型債等大工程另立工單）。
