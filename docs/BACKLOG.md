# BACKLOG — 逐項驗收帳本

本輪基準 `4b741f6dd2aaa033f9950a0bcd580333ad8df413`；2026-09-06 對照現行來源、生成物及測試重整。原始問題與歷次反證保留在此基準的 Git 歷史：`git show 4b741f6:docs/BACKLOG.md`。本表取代舊文中「標題已勾選、內文仍待修」的矛盾狀態。

「技術驗收通過」只表示表列範圍成立；外審、最終 SHA、本機與 GitHub CI 證據另見 [本輪紀錄](REVIEW-CLOSURE-20260906.md)，不以本表冒充交付完成。

## 最新結案基準（2026-10-07）

第二輪工程與累積補審清帳已隨 `916f177441d44c770a64c1389c2716dec997c782` 正式交付，完整摘要與公開 CI 入口見 [交付結案紀錄](DELIVERY-CLOSURE-20261007.md)。最新 57 筆與歷史 11 筆 pending 均有 exact fullSHA audit，該基準未結案 0 筆；完整累積 249 路徑的 Claude 5.5/high 與獨立 Codex 審查通過。這不核可之後的新修改，也不代表所有未改醫療內容已逐字核實。

下方 10/5 的 quota、52 筆 pending、後台待登入及 Goal 未完成均保留為歷史時點。後續已完成第一方收件讀回、索引三行摘要的產品實作、英文閱讀時間及站主核可的醫療／警訊同步；第三輪不重做未變且已完整核可的範圍。P-07 的正式訪客成效、低樣本搜尋觀察及 S-05 方案仍開放；`related_click` 尚無正數報表列，不据此判定故障或製造正式事件。

第三輪依站主 Goal：先證明最多兩個手機效能主要原因、選兩篇有資料依據的既有文章、驗證完整寫作任務並改善两項主要障礙。新文章最多先提出一篇方案，醫療含義仍需精確站主核可。私人分析只留本機；新分群或事件定義須版本化，保留舊資料未知、回報與訪客數的差別。各批完成狀態以自己的最終 SHA、獨立審查及候選／正式交付證據為準。

## 歷史第二輪正式交付快照（2026-10-05）

正式版本 `d1f535e892815a691c08d159f5a140946b747de4` 已由 `9b8f18e1e15a7eae054ccce4abe162138b12b8d6` 正常快轉；[PR24](https://github.com/expertise88864/user-hsiao/pull/24) 隨之關閉。該版本完整 10 候選及 5 正式 workflows 的適用 jobs/steps 成功，兩份 Preview/browser 與公開 Production 身份均核對 exact SHA／repo／環境；17 canonical smoke、10 中英文臨床來源对照與 49 sitemap URL 通過。候選與正式證據各自保存，不能互換 SHA。

站主已核可 15 張原始 Ubuntu 臨床圖並恰納入；12 張原樣保留，候選 push／PR 及正式 main 各 27/27 通過（D-13）。五篇核可短開頭、青光眼四處措辭、索引主題收合、雙語標點啟動、離線回執、CWV 方法／期間呈現與編輯工具分層均已正式發布。最新候選實際 119 API／685 browser 案例成功，七組編輯任務有隔離 fixture 證據；push／PR 各 8 路由 axe 均 0 自動違規、涵蓋五篇試點，不把自動掃描稱為完整人工驗收。真實 196 Windows 閱讀案例只重用未變來源，含字型延後／失敗、無 JS 與 200% 放大，不冒稱重新執行或正式訪客資料。

截至此正式 SHA，52 個 actual fullSHA pending 已在 main，Claude 完整累積補審／精確 audit 尚未結案；真實 Codex 完整核可不替代 Claude。provider weekly quota 當時最早為 2026-10-07 00:01 台灣時間。歷史 Opus 5 核可保留真實模型，新補審固定精確 Opus 5.5/high；之後每個 audit 仍須列各 fullSHA 並走新 SHA 完整交付流程。第一方正式後台方法／收件讀回仍待站主重新登入；GSC／GA4／第一方聚合收件、事件字典與五頁意圖表只留本機。內部流量、時區、品牌未知、缺失與零等比較限制保留，不宣稱已證明乾淨一般讀者、CTR 或流量成長。第二輪 Goal 尚未完成。

可核對的正式執行：[quality](https://github.com/expertise88864/user-hsiao/actions/runs/37279516333)、[visual](https://github.com/expertise88864/user-hsiao/actions/runs/37279516486)、[delivery](https://github.com/expertise88864/user-hsiao/actions/runs/37279516481)、[regen](https://github.com/expertise88864/user-hsiao/actions/runs/37279516404)、[size](https://github.com/expertise88864/user-hsiao/actions/runs/37279516531)。這些只證明 `d1f535e`，不核可本文件或之後新 SHA。

## 尚待決定或持續追蹤

五篇代表文章的中英文短開頭已由站主核可（2026-10-04），並隨上列正式版本發布。這批文字與原生「完整摘要與研究重點」收合入口保留原完整摘要、研究數字、引用及急性警訊。青光眼原開頭的急性閉角型急症句另逐字放在收合區外，飛蚊症短開頭亦保留當天就醫條件；原警訊區塊持續直接可見。站主另核可青光眼摘要、正文、FAQ 與索引卡片的四處排名用語，僅將「全球失明第一大原因」改成「全球失明的重要原因之一」及對應英文，其餘作者文字不改。兩批文字、Ubuntu 核可與正式交付各有独立證據；均不代表搜尋成效已提升。

| ID | 本輪核對結果 | 結案條件 |
|---|---|---|
| S-05 | `assets/trusted-types.js` 仍是正則清理，主防線為 `middleware.js` hash-CSP；`api/admin/_ab-config.js` 同属作者輸入邊界。不能宣稱正則是完整 sanitizer，也不能從未見利用推論絕對安全。 | 原驗收明訂「屬 ASK／站主拍板」：接受已記錄限制、引入 DOMPurify，或全面改安全 DOM。已提出選擇，未獲定案前保留開放；不得再疊正則補丁。 |
| C-01 | `contact-lens-safety`、`red-eye-conjunctivitis` 中英文仍是 noindex 佔位，符合 D-04。不是誤設索引；先前「高搜尋量／白白損失流量」缺乏本網站查詢證據，撤回量化暗示。 | 站主核可完整醫療內容後，才解除 stub、重建 listings／sitemap／英文鏡像。技術審查不能替代臨床核可。 |
| C-02 | 五篇試點的有界短開頭與四處青光眼措辭已核可並正式交付；原研究與警訊保留，已有 meta／捷徑不重做。這是具名五篇範圍，不是全站逐字臨床審閱或一律 40–60 字模板。 | 長期內容工作依實際查詢／頁面表現選段，資料不足標假設，新增醫療含義仍由站主核可；不把此批工程或 code review 當成全站內容完成或流量成長。 |
| P-07 | 歷史 `a502162` 正式桌面索引 CLS 中位約 0.377，保留其三次原始樣本。`d1f535e` 正式 Ubuntu Chrome 154／Lighthouse 12.6.1、1350×940 desktop、每路由三次：首頁／索引／乾眼／兒童近視／飛蚊症 CLS 中位約 0.0196／0.0547／0.0311／0.0268／0.0310；LCP 中位約 594–616ms，15 個 SEO checklist 均 1。這是具名 lab 快照，不能把不同版本樣本當因果效果、手機或 field RUM。 | 殘餘位移仍開放；依同環境對照確認原因後做最小修正，保留作者內容、語言偏好、D-27／CSP／門檻。preload 早完成、雙語標點與晚插閱讀資訊已各自修正／驗收；不以較低 lab CLS、準備頁字型資料或 SEO 分數結案 P-07／宣稱排名或 CTR 提升。 |

## 已定案的限制（不是待修 bug）

編輯工具列已隨上列版本正式交付，以既有控制項分成六個常用操作及原生可展開的格式／版本區，保存狀態仍持續顯示；GitHub 保存與本機預覽名稱保持可區分，放棄修改仍有原有確認與草稿保護。控制項最小 44px，展開保留原生鍵盤操作；滑鼠展開時保留作者選取範圍，以免接著調整字級或粗體作用到工具標籤。沒有改寫編輯器、保存協定、Undo／Redo、IME 或序列化路徑。360／390px 的同環境 Windows 任務對照顯示預設工具列較短；此為本機操作證據，完整回歸與正式 gate 另有證據，不等於人類完成任務時間或讀者效能改善。

第一方 CWV 後台方法／期間呈現已正式交付，補上 API 既有的量測／p75 方法，以及保留樣本最早與最新收件時間（固定台灣時間）。標準 web-vitals 6、舊量測與 GA4 事件平均分開說明；GA4、缺少或無效的時間不生成日期。收件範圍不是訪客數、造訪時間或每天都有資料的證明，INP 樣本亦只包含有可量測互動的頁面。此為量測資訊呈現，不新增收件欄位或改寫歷史事件語意，不因此結案 P-07；正式後台實際讀回仍待重新登入。

P-07 另重現並交付雙語標點的載入位移修正：初始 HTML 為全形問號，但 `data-zh` 的半形問號在共享腳本啟動時寫回，導致手機標題重新折行。正規化修正涵蓋雙語屬性的引號邊界；程式、URL 與技術屬性的保護不變。驗收分開檢查無 JavaScript 初始標題、延後載入、英文切換及回切中文；上列 exact-SHA Ubuntu 視覺與正式部署已通過，來源補審仍 pending，不因此結案 P-07 或宣稱流量改善。

P-07 的字型診斷另保存準備頁啟動時的標題、摘要、文章與首張卡片幾何，以及瀏覽器提供的位移來源前後矩形；最多 48 筆事件，溢位筆數明示。事件時間與幾何取樣時間分列，不把稍後送達的 paint 通知當成當時的精確畫面。這是 `before-lighthouse-navigation` 的獨立準備頁資料，保留實際 viewport；不替代 Lighthouse 測量、Ubuntu 畫面或真實使用者指標。診斷不讀正文、Cookie、storage、請求標頭或完整 trace，不等待字型、不改載入策略或評分門檻；P-07 仍開放。

候選另在 Lighthouse 完成後，以獨立瀏覽器做文章索引的字型 CSS 暫停／釋放對照：390×844、800×600、1350×940，各測原樣、標題 CJK 字寬、Latin 後備與兩者組合。每次使用新的隔離 context，核對公開 runtime 的 exact SHA／repository／Preview，再保存前三張卡片與開頭的數值幾何、字型選用；不保存作者文字、Cookie、storage 或 trace。實驗樣式及 CSP bypass 僅存在診斷 context，正式 CSP／載入策略／PNG 基準均不變。實際樣式修改仍須由對照證據支持；此實驗不是 Lighthouse CLS、真實訪客指標或 CTR 改善，也不替代 Ubuntu 人工確認。兩個診斷步驟在候選為必要驗收，main 依既有條件跳過；P-07 尚未結案。

第二輪診斷 schema 2 沿用同一環境與三個 viewport，保留 schema 1 的真實結果，改測原樣與「開頭／卡片摘要 CJK 字寬」各兩次，共 12 次。先前標題／Latin 原型未消除開頭與摘要折行，不再無故重跑。CDP 的 glyphCount 不能證明字元都有字形，因此另以七個固定公開漢字檢查系統後備的字寬與不同字元是否呈現相同 raster；僅輸出數值，不輸出像素或作者文字，也不把 raster 相同說成完整 cmap 檢查。這是 Linux／Windows 測試環境差異的診斷，不新增訪客資料、不改正式 CSS、字型／CSP 決策或 Lighthouse 門檻。兩版實驗需依具名 control 與環境比較，不能混合為同一樣本；正式修正及 P-07 結案仍待原因與效果證據。

`605e45b` 的兩個 Ubuntu 候選各 12 次對照中，七個不同中文字的系統後備 raster 僅一種，開頭／摘要字寬原型未消除折行；Windows 的同類測試有七種不同字形。後續同一暫時 runner 在 Lighthouse 評分及首組探測後安裝 `fonts-noto-cjk`，以相同 Preview／Chrome／尺寸與重複次數再測，保存原報告與套件版本。`7ea01cb` 及 `d1f535e` 的前後對照中 raster 1→7，索引開頭 26.8125px 位移消失，仍有卡片摘要一行 23.625px 變化；安裝後实际選用 Noto Sans／Serif CJK TC，不能歸因於選到日文字型。這是受控環境原因證據，不合併為訪客樣本，不改評分前環境、產品字型／CSS／CSP 或 PNG，P-07 仍開放。

下一個有界候選診斷採 schema 3：三尺寸、原樣／三行摘要預览、各兩次。原 schema 1／2 的負向結果保留，不重跑已無效的標題／Latin／CJK 字寬原型。三行樣式只在 Lighthouse 完成後的隔離 context，作者文字、完整文章及連結不變，產品索引尚未套用。Windows 的十二次本機源攔截試驗只顯示其原樣與原型卡片高度在字型換載時均穩定；不是 Ubuntu 殘餘位移已修正的證據，後續仍需同一 Ubuntu 對照。若產品樣式值得採用，須另走新 diff／exact-SHA CI、實際 Preview 與新的 Ubuntu 人工畫面核可，不使用既有批准代替。

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
