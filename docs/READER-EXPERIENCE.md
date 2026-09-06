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

先記錄確實上線的 SHA／日期及統計定義改版日，排除預覽、管理者與測試流量；核對 GA4 收件，缺資料不是零互動。以完整 28 天比較台灣非指名曝光、文章點擊與相近排名條件下 CTR，樣本少則延長。分別觀察一般衛教與研究入口的使用，不事先宣稱流量增加。

尚待實測決定：將閱讀路線擴展到其餘文章、長摘要的逐段醫療編輯、更多按需載入拆分。依實測與站主內容核可推進，不能把本輪導覽調整當成全站正文重寫完成。
