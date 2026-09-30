# 一般衛教與醫師研究筆記：閱讀與成效

使用者於 2026-09-06 選定兩類內容並重。首頁提供同等入口；文章保留完整醫療與研究內容，讓讀者自行選擇閱讀深度。不以停留更久或點擊更多頁，單獨判定讀者是否得到幫助。

## 本輪實作

- 首頁：一般衛教與醫師研究筆記各有入口、說明與三個起讀連結；純 HTML 即可操作。
- 青光眼指南、白內障手術選擇、DREAM 研究：標題後提供四個靜態段落捷徑；保留原摘要、警訊、正文、引文及發布日期。
- 推薦：同疾病 → 同臨床主題群 → 同內容分類 → 日期 → slug。固定排序不依賴亂數，不改既有雙向文內連結。
- 搜尋：詞彙正規化、繁簡常見字形及中英文同義詞；多詞查詢須同時符合各詞。無結果時提供主題地圖、量表入口。搜尋詞不代表診斷。
- 閱讀統計：累計前景時間，隱藏及預先渲染期間不累計；30 秒與 2 分鐘事件各一次。article_read 使用同一時間來源。
- 效能：鎖定 web-vitals 版本、獨立產生並延後載入 assets/vitals.min.js。維持既有 CLS ×1000 儲存單位；新舊算法的數值不宜直接作前後改善比較。第一方統計有新版樣本時只計新版，依 metric ID 去重；回應 method 區分新舊來源。
- 維護：reader-metrics、reader-search、reader-navigation、vitals 各自管理單一責任；npm run minify 建置兩個產物，檢查器驗證兩者位元組一致性。

## 搜尋問題與主要承接頁

下表是內容責任分工，不代表查詢量、排名預測或醫療建議。私人 GSC 數據不進公開 Git。

| 問題方向 | 主要承接頁 | 深入閱讀方向 |
|---|---|---|
| 青光眼的症狀、如何檢查 | glaucoma-comprehensive-guide | glaucoma-treatment-selection 的藥物／手術比較 |
| 白內障何時手術、術後恢復 | cataract-comprehensive-guide | cataract-surgery-selection 的術式、水晶體、費用取捨 |
| 散光人工水晶體 | toric-iol-astigmatism-cataract-review | 白內障選擇指南提供整體決策背景 |
| 兒童近視控制 | pediatric-myopia-control | DIMS 鏡片、度數與眼軸追蹤研究 |
| 乾眼與人工淚液 | dry-eye-myths | DREAM 症狀與徵象不一致研究 |
| 淚腺腫瘤、淚腺癌 | lacrimal-gland-tumor | 原文檢查、治療與常見問題 |
| logMAR 換算 | /tools | 原有視力量表與使用說明 |

不為每個詞新增近似薄頁，不重複改動剛調整的五頁 meta。後續新增內容與醫療宣稱仍依 ARTICLE-STANDARDS 由站主核可。

## 事件與驗收

| 事件 | 定義／用途 |
|---|---|
| time_30s、time_2min | 前景時間累積里程碑；背景計時不算閱讀 |
| reading_shortcut | 首頁閱讀路線或文章段落連結點擊；placement 區分 patient/research/article |
| related_view | 該推薦卡片至少一半進入可見分頁的畫面，每頁每卡一次 |
| related_click | 點擊推薦卡片，依 destination 與 view 配對觀察；事件比值不是獨立訪客 CTR |
| search_query | query_len、result_count（本機索引命中數，不含後續 Pagefind 擴充結果）；不向 GA4 傳送原始查詢詞 |
| LCP／CLS／INP／FCP／TTFB | 使用標準 Web Vitals；GA4 與既有第一方儲存接收，部署環境是否啟用仍需核對 |

測試涵蓋前景／背景切換、累計門檻、同義詞、多詞無結果、疾病優先推薦、無 JavaScript 雙語入口及手機段落跳轉。

## 上線後觀察

### 後台效能指標的資料限制

`/api/admin/cwv` 優先使用第一方原始樣本，p75 採排序後的 nearest-rank（第 ceil(0.75 × N) 筆）。每項指標最多讀取最近 1,000 筆回報，僅保留所選滾動期間內、最多 30 天的樣本；標準量測依 metric ID 去重，樣本數不是不重複訪客數。90 天選項不會把第一方儲存擴充成 90 天完整分布。

GA4 備援僅能提供事件總值／事件數的平均值，p75 保留 `null`，不以平均值乘係數推估百分位或判定 Core Web Vitals 通過。GA4 所選曆日包含尚未結束的今天，與第一方滾動期間不同。第一方樣本判讀也不等於 Google CrUX 或 Search Console 結果。

已確認沒有可用樣本時，`status` 為 `no_samples`、樣本數為零、平均值與 p75 為 `null`；設定缺失或讀取失敗時為 `unavailable`、樣本數亦為 `null`。實測為零仍顯示零。單一來源或指標失敗保留其他有效結果，`issues` 與 `collection` 說明來源狀態；環境設定存在不代表已確認正式收件。快速切換期間時只呈現最後一次請求的結果。

先記錄確實上線的 SHA／日期及統計定義改版日，排除預覽、管理者與測試流量；核對 GA4 收件，缺資料不是零互動。以完整 28 天比較台灣非指名曝光、文章點擊與相近排名條件下 CTR，樣本少則延長。分別觀察一般衛教與研究入口的使用，不事先宣稱流量增加。

### 公開量測的資格與收件

既有頁面及兩種新文章範本共用 `assets/telemetry.js`。只有正式 HTTPS 網域的一般讀者啟用 GA4、Vercel Web Analytics／Speed Insights 及第一方 Web Vitals、搜尋、A/B 計數；Preview、localhost、已知機器人／webdriver、管理頁及 `?admin=1` 排除。DNT 或 Global Privacy Control 開啟時不蒐集。預先渲染期間不啟用，啟用頁面後才註冊一次。

成功登入會保留原 HttpOnly HMAC session，另設八小時的 `hs_telemetry_optout=1` 匿名標記；它不含訪客識別資訊、不能登入或授權。登出僅清除 session，標記在剩餘有效期間仍排除編輯者瀏覽。送出時重查標記；GA4 的 `ga-disable` 與 Vercel 的 `beforeSend` 也排除已開啟分頁後來產生的事件。第一方端點另查正式環境、來源及有效管理者 session，不以客戶端判斷代替伺服器檢查。這些是資料品質篩選，不能辨認所有偽裝成人類的流量。

`sendBeacon` 回傳成功只代表浏览器接受排隊。CWV／A/B 回應的 `stored: true` 才代表儲存呼叫成功；未設定或排除是 `stored: false`，CWV 儲存失敗回傳錯誤。搜尋紀錄仍採原本明確啟用的匿名彙總政策，204 不證明寫入。正式 GA4 與 KV 收件必須於部署後另行核對，不以模擬測試、設定存在或候選 Preview 證明正式收到。

送出阻擋依據：[Google tag 的 ga-disable](https://developers.google.com/tag-platform/security/guides/privacy)、[Vercel Web Analytics beforeSend](https://vercel.com/docs/analytics/package)、[Speed Insights 官方載入程式](https://github.com/vercel/speed-insights/blob/main/packages/web/src/generic.ts)。診斷用錯誤紀錄與公開成效統計用途不同，不由本次篩選變更其既有錯誤蒐集政策。

尚待實測決定：將閱讀路線擴展到其餘文章、長摘要的逐段醫療編輯、更多按需載入拆分。依實測與站主內容核可推進，不能把本輪導覽調整當成全站正文重寫完成。

### 編輯草稿與安全離開

重新開啟時會比較 OPFS 與 localStorage 兩份可讀草稿的時間，選取較新的快照，保留另一份。OPFS 可讀但不能寫入時，不能優先恢復舊 OPFS 而忽略已確認寫入的新 localStorage 備援。同分頁寫入使用單調遞增時間，避免同一毫秒的備援快照排序相同；重新讀取會延續已知草稿時間。舊版缺時間或相同時間的草稿保留 OPFS 優先，不自動刪另一份；尚不代表完成所有多分頁衝突隔離。

同一瀏覽器、同一網站中的同篇文章，視覺編輯器在讀取來源、恢復草稿及開啟輸入前取得 Web Locks 排他鎖，並持有到編輯文件關閉。第二分頁顯示原因及「重新開啟編輯」，不讀取、覆寫或清除該文章草稿；不同文章仍可同時編輯。正常離開先保存最新草稿，離開失敗則繼續保有編輯權；GitHub 保存成功本身不釋放編輯權。初始化失敗會釋放，文件關閉／終止由瀏覽器釋放；不在可以取消的 beforeunload 事件提前釋放。

瀏覽器缺少 Web Locks 或拒絕請求時，保留原草稿且不開啟可寫編輯模式，顯示失敗原因與重試入口。這項保護適用使用此新版編輯器的分頁，舊版已開啟分頁需重新開啟；不同瀏覽器／裝置的公開保存衝突仍由 baseSha 處理。實測覆蓋 Chromium 的 OPFS／localStorage、正常離開、已確認草稿後的強制關閉、初始化與保存失敗及不同文章；不據此宣稱所有瀏覽器、未確認輸入的崩潰復原或 IME／Undo／Redo 已驗收。[Web Locks 規範](https://www.w3.org/TR/web-locks/#motivating-use-cases)

視覺編輯器的「回到後台」與「離開編輯」會先寫入最新本機草稿；寫入失敗時保留編輯器與內容，GitHub 儲存尚在執行時請等候結果。草稿寫入與刪除依序執行，保存期間的新輸入仍須保留。重新整理或直接關閉分頁會在有未儲存修改時顯示瀏覽器離開提醒；瀏覽器強制終止、使用者仍選擇離開或儲存不可用時，不能保證最後一次輸入已保存。

保存狀態持續顯示，分別說明尚未儲存、本機草稿、GitHub 已保存及正式上線尚未確認。GitHub 成功後若又有新輸入，顯示上一版已保存但新修改仍未儲存；不把先前成功訊息當成最新內容或正式部署完成。「丟棄」需明確確認、清除本機草稿並重新讀取來源，清除期間的新輸入保留在編輯器。

刪除草稿須確認 OPFS 與 localStorage 中皆不存在；刪除或驗證讀取失敗時不回報已清除，也不因讀取失敗得到 `null` 就允許丟棄。GitHub 已保存但本機清理失敗會持續顯示錯誤，禁止把已保存的 commit 再排入離線重送。環境頁使用 API 的 `configured` 判斷設定存在與否，回應快慢不代表 KV 設定或收件；A/B 計數與 Builder 設定的儲存路徑不同，Builder 的 GitHub 備援仍保留。

HTTP 成功狀態仍須有可解析、有效的文章 SHA 與 commit 回執；無改動的回執可明確使用 `noop` 與空 commit。成功狀態但回執损壞時，保留原 baseSha 與草稿、顯示版本未確認並阻止重複送出，不刪除草稿、不排離線重送；需重新開啟取得新來源與版本。這項保護不等於能證明未收到任何回應的網路失敗是否已由伺服器寫入，既有離線路徑仍依原版 SHA 防止覆寫。

本輪實測已證明原先的立即關閉會在五秒自動保存前遺失內容，OPFS 與 localStorage 備援皆適用。雙語草稿復原原本已保留整個 article：CSS 選擇器清單按文件順序選到 article，而非優先選 proseZh；未為此改寫復原路徑。此狀態改善尚不包含真正的候選／正式部署狀態查詢、完整雙語標題編輯、IME／Undo／Redo 或所有 CMS 工作流程驗收。

### 中文組字與快捷鍵

中文組字期間，編輯器讓 Enter、Escape、Backspace 與快捷鍵由輸入法處理，不將候選字確認誤作斜線區塊選取或 GitHub 保存。開始組字時關閉區塊選單；以 compositionstart／compositionend、isComposing 與舊式 229 標記辨識，組字結束後正常快捷鍵仍可使用。

回歸測試涵蓋真實 Chromium 編輯器內的三種事件標記、原生 CDP 中文組字與草稿保存，以及普通文字單次輸入的鍵盤 Undo／Redo。合成事件與 CDP 不代表實體 Windows／macOS／手機輸入法全矩陣驗收，也不代表圖片、表格或直接 DOM 插入的區塊已支援完整 Undo／Redo。[KeyboardEvent.isComposing](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/isComposing)

### 完整來源與本機內容預覽

正式 CSP 下，通用 Trusted Types UI 清理器會剝除 script，不能用來解析要重新保存的整份文章。本輪在尚未正式發佈的候選中重現：保存後頁面 bootstrap 與 JSON-LD 都消失。新版使用編輯器閉包私有的 `hs-editor-document` policy，僅供完整文件的惰性 DOMParser 解析；不公開 policy 或將完整文件直接注入編輯器。CSP 只在文章路由的 `?admin=1` 允許此名稱，一般頁面仍只允許原 policy，hash-based script-src、Trusted Types 要求與通用 HTML 清理不變。

啟動及恢復草稿只匯入文章區域，匯入前移除可執行 script、事件屬性、srcdoc 與 javascript URL，保留 JSON-LD／JSON 資料。完整來源在編輯區之外保持原內容，保存前再清理文章區；恢復使用 DOM 節點複製，避免將非執行資料交给 UI innerHTML 清理器而遺失。此處的解析能力不代表任意 HTML 可以安全執行。[DOMParser 與惰性文件](https://developer.mozilla.org/en-US/docs/Web/API/DOMParser/parseFromString)

「本機預覽」包含目前尚未保存的內容，不送出 Git 保存或部署請求，也不代表候選部署或正式上線。預覽副本以原文章網址解析資產，段落與 FAQ 連結保持在該 blob 副本內；重新建立閱讀控制項與相關文章，移除編輯屬性並顯示雙語狀態說明。語言切換僅作用於預覽，不修改作者在編輯器中的偏好。預覽不啟用公開量測；彈窗被封鎖時顯示可重試的錯誤並保留作者內容。

預覽網址在預覽關閉後才釋放，避免原本固定三十秒後不能重新載入；編輯文件被關閉／重新載入或瀏覽器終止後，不能保證舊 blob 網址仍可重新載入，請重新開啟編輯器並建立預覽。副本存在本機瀏覽器，不是可分享的 Vercel Preview，也不以 noindex 宣称公開 Git 草稿是私人內容。真正的候選／正式部署狀態查詢仍待完成。

預覽的語言狀態會隨切換更新，延後產生的控制項沿用目前語言；不寫入作者的 Cookie 或 localStorage 偏好。此本機副本另停用 `/api/errors` 診斷送出，避免錯誤報告攜帶未保存副本的網址／錯誤細節；一般正式頁面的既有錯誤診斷政策不變。預覽測試同時監看實際 CWV、A/B、搜尋及錯誤端點。

瀏覽器的原生 CSP 報告不經過 JavaScript 錯誤處理器；blob 又繼承建立它的編輯文件 CSP。因此文章的 `?admin=1` 編輯文件另省略 `report-uri` 與 Reporting-Endpoints，讓其本機預覽不把被阻擋的未保存資源網址送到 `/api/csp-report`。此範圍也不再上報編輯文件自身的原生 CSP 違規；一般公开頁仍保留報告。資源來源、script hashes、Trusted Types 與其他 CSP 阻擋規則完全保留；測試刻意放入未核可圖片，確認資源確實遭阻擋、沒有網路圖片請求或原生報告。
