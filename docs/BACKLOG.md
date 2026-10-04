# BACKLOG — 逐項驗收帳本

本輪基準 `4b741f6dd2aaa033f9950a0bcd580333ad8df413`；2026-09-06 對照現行來源、生成物及測試重整。原始問題與歷次反證保留在此基準的 Git 歷史：`git show 4b741f6:docs/BACKLOG.md`。本表取代舊文中「標題已勾選、內文仍待修」的矛盾狀態。

「技術驗收通過」只表示表列範圍成立；外審、最終 SHA、本機與 GitHub CI 證據另見 [本輪紀錄](REVIEW-CLOSURE-20260906.md)，不以本表冒充交付完成。

## 尚待決定或持續追蹤

| ID | 本輪核對結果 | 結案條件 |
|---|---|---|
| S-05 | `assets/trusted-types.js` 仍是正則清理，主防線為 `middleware.js` hash-CSP；`api/admin/_ab-config.js` 同属作者輸入邊界。不能宣稱正則是完整 sanitizer，也不能從未見利用推論絕對安全。 | 原驗收明訂「屬 ASK／站主拍板」：接受已記錄限制、引入 DOMPurify，或全面改安全 DOM。已提出選擇，未獲定案前保留開放；不得再疊正則補丁。 |
| C-01 | `contact-lens-safety`、`red-eye-conjunctivitis` 中英文仍是 noindex 佔位，符合 D-04。不是誤設索引；先前「高搜尋量／白白損失流量」缺乏本網站查詢證據，撤回量化暗示。 | 站主核可完整醫療內容後，才解除 stub、重建 listings／sitemap／英文鏡像。技術審查不能替代臨床核可。 |
| C-02 | 已檢視現有文章開頭；部分直接解釋問題，部分以病人情境開場。五個 SEO 優先頁不能一律套用 40–60 字模板，先前 meta 優化也不等於正文重寫。 | 隨實際查詢／頁面表現選定需要改寫的段落，保留醫療限制；修改後驗證可讀性。持續編輯候選，不以本輪 code review 宣稱內容工作完成或流量已提升。 |
| P-07 | `a502162` 的正式桌面 Lighthouse 三次測量中，文章索引 CLS 中位數約 0.377；篩選列提前產生只解決一種晚載入位移。Windows 同版本桌面測試仍未重現全部 Ubuntu 位移，不能以較低的本機結果代替正式結果。 | 以同版本瀏覽器、路由、字型選用及載入時序重現具體來源後修正；保留作者內容、語言偏好、D-27 與既有檢查門檻。`font-environment` artifact 提供字型診斷，不構成效能改善或流量成長證據。已重現並修正 preload CSS 先完成、載入腳本後抵達時錯過 load 的缺陷；實際跨來源 HTTP／CSP 回歸覆蓋早晚完成、失敗及 noscript。這是載入正確性修正，未以此結案 CLS 或宣稱 RUM 改善。 |

## 已定案的限制（不是待修 bug）

第一方 CWV 後台候選補上 API 既有的量測／p75 方法，以及保留樣本最早與最新收件時間（固定台灣時間）。標準 web-vitals 6、舊量測與 GA4 事件平均分開說明；GA4、缺少或無效的時間不生成日期。收件範圍不是訪客數、造訪時間或每天都有資料的證明，INP 樣本亦只包含有可量測互動的頁面。此為量測資訊呈現，不新增收件欄位或改寫歷史事件語意，不因此結案 P-07；正式交付與實際後台讀回另驗。

P-07 另重現雙語標點的載入位移：初始 HTML 為全形問號，但 `data-zh` 的半形問號在共享腳本啟動時寫回，導致手機標題重新折行。正規化修正涵蓋雙語屬性的引號邊界；程式、URL 與技術屬性的保護不變。驗收分開檢查無 JavaScript 初始標題、延後載入、英文切換及回切中文；仍須同一候選的 Ubuntu 視覺與正式部署驗證，不因此結案 P-07 或宣稱流量改善。

P-07 的字型診斷另保存準備頁啟動時的標題、摘要、文章與首張卡片幾何，以及瀏覽器提供的位移來源前後矩形；最多 48 筆事件，溢位筆數明示。事件時間與幾何取樣時間分列，不把稍後送達的 paint 通知當成當時的精確畫面。這是 `before-lighthouse-navigation` 的獨立準備頁資料，保留實際 viewport；不替代 Lighthouse 測量、Ubuntu 畫面或真實使用者指標。診斷不讀正文、Cookie、storage、請求標頭或完整 trace，不等待字型、不改載入策略或評分門檻；P-07 仍開放。

候選另在 Lighthouse 完成後，以獨立瀏覽器做文章索引的字型 CSS 暫停／釋放對照：390×844、800×600、1350×940，各測原樣、標題 CJK 字寬、Latin 後備與兩者組合。每次使用新的隔離 context，核對公開 runtime 的 exact SHA／repository／Preview，再保存前三張卡片與開頭的數值幾何、字型選用；不保存作者文字、Cookie、storage 或 trace。實驗樣式及 CSP bypass 僅存在診斷 context，正式 CSP／載入策略／PNG 基準均不變。實際樣式修改仍須由對照證據支持；此實驗不是 Lighthouse CLS、真實訪客指標或 CTR 改善，也不替代 Ubuntu 人工確認。兩個診斷步驟在候選為必要驗收，main 依既有條件跳過；P-07 尚未結案。

索引的主題列改為原生收合區塊，分類與搜尋維持直接可用；它改善初次看到文章所需的畫面空間，沒有改動字型載入或作者摘要。主題網址沿用別名正規化並自動展開，收合後仍顯示選取項目。亮暗色、鍵盤與瀏覽器 200% 放大另驗證，不能以較短的篩選區推論已解決 Ubuntu CLS、正式訪客體驗或搜尋 CTR；P-07 保持開放。

既有閱讀時間／更新日期／作者資訊列改由 `_gen_reader_navigation.py` 在英文鏡像前生成，沿用 `hs-reading-meta`、CMS 兩端剝除及 runtime 備援。生成只插入有界區塊，不重寫作者 HTML；日期仍是更新或發布日，不能標成獨立醫療審閱。正值 catalog `minutes` 優先；缺少時沿用既有估算法，依中英文實際正文計算，雙正文英文取 `proseEn`，語言切換同步其對應估值。未登錄草稿及 noindex 中文來源頁不新增生成資訊列。英文鏡像沿用來源生成的閱讀資訊；尚待核可的英文翻譯仍依既有政策維持 noindex，閱讀資訊不因此移除，也不改翻譯發布／hreflang／索引界限。CMS 完整文件重組後也剝除 helper，保留作者內文及標題區外的雙語原文；正文匯出、編輯健檢與字數預算不計生成資訊列。受控本機對照證實晚插入此列會推動內文，其他標題／字型位移仍須獨立追查；最終 Ubuntu／正式 CI、來源補審與實際訪客成效另驗，不以此宣稱 P-07 結案或 CTR 提升。

| ID | 對照結果與重開條件 |
|---|---|
| M-14 | `_check_inline_scripts.py`、`_check_static_a11y.py`、`_check_articles.py` 維持已接受的剖析範圍。未引入新第三方模板或擴大任意標記入口，沒有本輪重開觸發。若來源規格改變，再評估完整 parser。 |
| R-01 | `_check_pwa.py` 仍用文字／括號／值位置守衛，並非資料流證明。遵守 D-26：除非因其他需求引入 JS parser，不重開。 |

## 技術驗收矩陣

以下逐項核對的是原工單具體缺陷，不代表全 repo 任意輸入、所有瀏覽器或醫療事實皆已證明正確。`_check_*` 指本輪完整 preflight 中實際執行的同名檢查；API／瀏覽器測試指 `tests/api`／`tests/seo`。

| ID | 現行實作／驗收證據 | 判定 |
|---|---|---|
| T-01 | `api/_content_snapshot.js`、sitemap/feed/OG 的已提交快照後備。本輪補上 sitemap/feed/OG 的 `catalogRecords` 拋錯後備；新增真實 handler 測試，畸形目錄下 sitemap、RSS、Atom、JSON feed 皆保留快照文章，OG 圖像與指定同一文章標題的 PNG 相同。 | 技術驗收通過；不再宣稱任意未預期例外均不可能 500。 |
| T-02 | `vercel.json` OG rewrite 與可重新驗證的快取；`api/og.js` Node GET、獨立 API 依賴及真 PNG 測試。4b741f6 已有 Production Ready 與線上 PNG 證據。 | 技術驗收通過。 |
| P-01 | HTML 與 `api/admin/_new.js` 均輸出 preload + addEventListener + noscript；`_check_performance_budget.py` 包含 scaffold。 | 技術驗收通過；D-12／D-27 過期狀態已同步。 |
| P-02 | `sw.js` 版本化請求 network-first，離線 fallback `ignoreSearch:true`；`_check_pwa.py`。 | 技術驗收通過。 |
| P-03 | 首頁單一 speculationrules、廣泛規則 conservative；`_check_performance_budget.py`。 | 技術驗收通過。 |
| P-04 | install 僅 `SHELL.map`，POPULAR 由第一次 fetch 的 waitUntil 暖機（不阻塞 activate）；`_check_pwa.py` 同時守等待關係。 | 技術驗收通過；保留 R-01 範圍限制。 |
| P-05 | `_extract_critical_css.py:parse_css_rules` 保留實際 media／supports 關鍵字（目前 CSS 所用的帶空白語法）；preflight 固定點及 critical CSS 預算。 | 技術驗收通過；不延伸宣稱支援未採用的所有 at-rule。 |
| P-06 | `sw.js` 歷史 changelog 已移出，現有體積由 Size budget 驗證。 | 技術驗收通過。 |
| S-01 | 客戶端使用 cookie 驗證的 `/api/admin/*`，GitHub token 留在 server；API 合約測試涵蓋 legacy PAT 入口退役。 | 原缺陷前提失效，核實結案；不代表查證了線上 PAT 權限設定。 |
| S-02 | SVG 回應的 CSP／sandbox 與 middleware matcher；`_check_csp_routes.py`、API CSP 合約。 | 技術驗收通過。 |
| S-03 | `api/csp-report.js`／`api/errors.js` await 寫入，每次 KV fetch 1200ms 上限；API telemetry 合約。 | 技術驗收通過；search-log 原先即 await。 |
| S-04 | `_gen_csp_hashes.py` 真正 src 屬性辨識；`_check_csp_routes.py`／hash 生成固定點。 | 技術驗收通過。 |
| S-06 | `_sri.js` HTTPS host allowlist、redirect:error、宣告及實際回應長度上限。 | 原任意 URL／重新導向 SSRF 缺陷已收斂；非所有資源耗用或 DNS 信任的證明。 |
| S-07 | `api/admin/_md.js` 預覽屬性／scheme 防護；API 測試的 stored-XSS payload 與雙語拒寫。 | 技術驗收通過。 |
| S-08 | `.vercelignore` 排除 docs、工具、測試；`_check_deploy_exposure.py`。 | 技術驗收通過。 |
| A-01 | `_apply_i_series.py` 注入後 `_normalize_skiplinks.py` 依實際目標裁剪；`_check_skiplinks.py` 涵蓋 hs／dn 與 scaffold。 | 技術驗收通過。 |
| A-02 | `tools/eye-3d.html` 移除隱形 legacy link，`_new.js` 保留具真實 main 目標的 skip nav；空 nav 也會被 guard 拒絕。 | 技術驗收通過。 |
| A-03 | cmdk 標籤依語言切換、全域 placeholder 加深為 #6b7280；`_check_static_a11y.py` 與搜尋瀏覽器測試。 | 原兩項驗收通過；混語片段逐元素 lang 並未由此測試證明，不能宣稱全站語言標記完美。 |
| M-01 | `assets/components.js` 已刪，header 與 EXPECTED 同步；scaffold 改用現有 class。`_check_static_asset_headers.py`。 | 技術驗收通過。 |
| M-02 | `apply_magazine_template.py` 用 h4 與共用 footer CSS；`_check_article_footer.py`。 | 技術驗收通過。 |
| M-03 | `blog-shared.js:initCmdK` 排除 contenteditable／admin 的斜線攔截。 | 技術驗收通過；本輪另修編輯器斜線選單不當刪字。 |
| M-04 | TOC 查找使用 `getElementById(id + '-en')`，不拼接 CSS selector。 | 技術驗收通過。 |
| M-05 | 2026-09-06 的 quality 權威 24 步與三份指引、regen 入口一致。2026-10-01 納入圖表、文章目錄與索引篩選後為 27 命令，實際鏈仍由 quality.yml 動態解析；`_check_chain_docs.py` 及次序變異 Python 測試守順序。重建 job 只讀生成檢查，drift 輸出 patch 並失敗；不繞過完整驗證自動推送。 | 歷史技術驗收通過；新 SHA 另經候選及正式交付驗證。 |
| M-06 | client/server runtime helper 清單由 `_check_runtime_helper_sync.py` 守同步；API／瀏覽器存檔回歸保留 authored mounts、footer、雙語與版本。 | 技術驗收通過；刻意雙檔耦合符合 D-24。 |
| M-07 | 計算器本體與 fallback wrapper 都有 strip ID；authored mount 保留；runtime helper guard／API serialization 測試。 | 技術驗收通過。 |
| M-08 | `_gen_en_pages.py:prune_en_jsonld` 遞迴處理 graph／array；`_check_en_jsonld.py`、英文生成固定點。 | 技術驗收通過。 |
| M-09 | `_articles.js:patchCatalogFields` 按 literal token 改欄位，未變回 noop；API 實際 precompute 重複呼叫與含括號／跳脫字串測試。 | 技術驗收通過。 |
| M-10 | `_schema-helper.js:injectJsonLd` 逐一 script 決定 FAQ／HowTo 替換，不跨 script 刪除其間醫療 schema。 | 原跨區塊刪除缺陷核實結案；不是任意 graph 編輯器。 |
| M-11 | 本輪負測證實舊計數 guard 仍會截斷含大括號的值；改用 `catalogRecords` 的完整原文範圍重排，保留陣列外文字、逐項驗證欄位，未知 constructor 不會變成繼承屬性。API 真 handler 測試涵蓋引號／大括號／字面 `];`、noop 與不支援語法拒寫。 | 本輪修正，技術驗收通過。 |
| M-12 | Python 共用 `_articles_field`，live API 共用 `_articles.js`；實際三個 Python consumers 與 API 引號／大括號測試。 | 技術驗收通過。 |
| M-13 | `_jsonld.py` 統一生成器輸出，`_check_jsonld_escaping.py` 掃結果及來源；負向案例確認錯誤顯示檔名。 | 技術驗收通過；範圍為所列生成器，不泛稱所有任意 HTML 入口。 |
| M-15 | idle 內逐一 `safeCall`，五個 calculator 各自隔離；瀏覽器刻意令第一個 calculator 拋錯，後四個仍執行。 | 技術驗收通過。 |
| M-16 | 本輪 `insertArticleBlock` 將六種區塊指令置於正文頂層區塊之後，再註冊可編輯元素；移除未輸入字元的 delete。六種真實選單／存檔 round-trip 測試。 | 本輪修正，技術驗收通過；插入位置是目前正文區塊之後，非拆開既有雙語段落。 |
| M-17 | 本輪六頁 authored footer 規則移至 app.css 的低 specificity 頁型範圍，保留 notes 的差異；英文由生成器產生。六頁 × 三 viewport 的 footer 截圖與全部 computed style 相同。 | 本輪修正，技術驗收通過；不把本機畫面當成 Ubuntu CI 基準。 |

## 無編號的歷史尾項

`_inject_medical_guideline.py` 格式無關冪等、`_gen_llms_txt.py` 的缺英文路徑 fallback、`_history.js` 錯誤截長，以及 inline JS／catalog holes／重複 metadata／alt 屬性／minified parity 的檢查器硬化，均隨來源核對與完整檢查保留。歷史數字（例如 26 篇、59 個檢查）只描述當時快照，不能當作現行數量。新增內容或改動剖析規格時仍需重新驗證。
