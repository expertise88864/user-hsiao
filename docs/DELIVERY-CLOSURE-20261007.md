# 第二輪工程與累積補審結案 — 2026-10-07

本紀錄描述已正式交付的 `916f177441d44c770a64c1389c2716dec997c782`，來源 tree `ac4abf51753431ef98c0eac38b3a552463431d61`。它不核可承載本文件的新 SHA 或未來修改；新批次仍遵守 D-20／D-28 與 `REMOTE_CI_DELIVERY.md`。

## 第三輪已交付增量 — 2026-10-07

`1455dd5b07764a2cfa065e1f7678abf5a78450f9`（tree `f8c92067fa13e014b538399ff3298d7272c6e62d`）已由 [PR27](https://github.com/expertise88864/user-hsiao/pull/27) 正常快轉 main：fresh 空快取不再多一次重載，舊快取仍完成清除；A/B 設定成功請求共用、晚回應重新檢查編輯狀態。84 路徑修正後獨立 Codex／精確 Claude 5.5 high 完整核可。該 audit 精確結案 07e71d7、398fbaa、7bbc066 三個 fullSHA，合計 71 筆歷史 pending、未結案 0 筆；新的修改另計。

該 SHA 完整 10 候選與 5 正式 workflows／jobs／steps 及各 gate 成功，Preview／正式身份、54 canonical／49 sitemap smoke 通過。正式公開證據：[Quality 37644366629](https://github.com/expertise88864/user-hsiao/actions/runs/37644366629)、[Visual 37644366669](https://github.com/expertise88864/user-hsiao/actions/runs/37644366669)、[Delivery 37644366659](https://github.com/expertise88864/user-hsiao/actions/runs/37644366659)、[Drift 37644366611](https://github.com/expertise88864/user-hsiao/actions/runs/37644366611)、[Size 37644366605](https://github.com/expertise88864/user-hsiao/actions/runs/37644366605)。保留原有三個使用者整檔修改；沒有新增 Desktop 專案副本或 Production CMS 測試寫入。

390px 隔離重複實驗確認 fresh 文件由 2 次導覽降到 1 次，首頁／索引最後觀察到的 LCP paint 代理中位數較基準少約 395／458ms；三次樣本與乾眼控制結果不當標準 CWV、field、統計因果或 CTR 證據。第三輪的搜尋入口、必要 CWV context 與兩項寫作障礙仍另批交付，完整 Goal 未結案。

## 第三輪可信量測增量 — 2026-10-08

`c344ff815ac6c6fa31b7291facf37e0cf27d9ae1`（tree `78e7cdcdc87073edf79c37523b9693c80930e27a`）已由 [PR28](https://github.com/expertise88864/user-hsiao/pull/28) 正常快轉 main，完整 10 候選、5 正式 workflows／jobs／steps 與 gate、exact Production 身份、54 canonical／49 sitemap smoke 通過。正式證據：[Delivery](https://github.com/expertise88864/user-hsiao/actions/runs/37658574555)、[Quality](https://github.com/expertise88864/user-hsiao/actions/runs/37658574612)、[Size](https://github.com/expertise88864/user-hsiao/actions/runs/37658574424)、[Drift](https://github.com/expertise88864/user-hsiao/actions/runs/37658574748)、[Visual](https://github.com/expertise88864/user-hsiao/actions/runs/37658574679)。

第一方 CWV context v1 僅記錄首次 eligible 綁定的粗粒度 CSS 寬度與執行中資產 epoch，先做原有全域 metric-ID 去重及量測選擇，再分群；舊資料保持 unknown。方法、期間、樣本與省略群數見 [CWV 定義](CWV-CONTEXT.md)。GA4 值／事件次數與既有整體 p75 語意保留，沒有新增識別資訊或把回報當訪客數。

該 85 路徑獨立 Codex 完整 APPROVE；Claude 5.5 的真實 provider quota 後仍 pending，須補審與 exact fullSHA audit。已正式發布與來源完整補審是兩個不同狀態；71 筆已結案歷史不重開。本輪搜尋入口與 [寫作任務](WRITING-TASKS.md) 另批驗證，整個第三輪 Goal 尚未完成，不宣稱 field CWV、Google 排名或 CTR 已改善。

## 第二輪交付與審查

- 從 `a559a756b4610a65f1c9e5dbc34db768556bc08b` 正常快轉 main，[PR26](https://github.com/expertise88864/user-hsiao/pull/26) 已合併關閉；無 force 或歷史改寫。
- 最終版本 10 個候選與 5 個正式 workflows 的適用 jobs／steps 成功，candidate／main／production gate exit 0；Preview／正式公開身份核對 repository、environment 與 exact SHA。54 canonical smoke 路由與 49 sitemap URL 通過。
- 完整累積 `d37aa48d4f663db2b543be095de0e4e40f2518c4..916f177441d44c770a64c1389c2716dec997c782` 共 249 路徑，修正後 Claude Code 精確 `claude-opus-5-5/high`、Read/Glob/Grep 與独立 Codex `gpt-5.6-sol/high/read-only` 最終 APPROVE。實際新回合模型證據、全文／差異／圖片覆蓋及限制另保存；準備分段或 quota 不算核可。
- 最新 57 筆與歷史 11 筆 pending 均由後續 audit 逐筆列 exact fullSHA 結案，該基準未結案 0 筆。歷史 Opus 5 的真實模型不改標 5.5。原失敗、缺陷與 quota 保留歷史。
- 站主核可的 14 張 Ubuntu 原圖於 `c981e78e4bced59c062713c73ff7226935e3268f` 納入，13 張既有基準保留，共 27 張；完整候選視覺通過既定容差。通過不代表每張重繪圖片逐 byte 相同，不授權未來新圖。

## 已交付範圍

- 首頁雙讀者入口、疾病優先推薦、五篇問題捷徑與醫師核可中英文短開頭；研究深度、急性警訊、現有 URL 與作者限制保留。
- 原生圖表放大、靜態目錄／篩選／閱讀資訊、双語標點啟動修正、索引三行螢幕摘要與列印全文、英文閱讀時間單字邊界修正。既定產品字型與 CSP 保持。
- 核可研究比較對象、分母、引用、劑量表述與急性飛蚊警訊同步；六題乾眼工具明示自訂症狀整理，不冒充正式 12 題 OSDI。新事件語意版本化，舊事件不改寫。
- 編輯器常用／進階操作、持續保存狀態、真實保存回執、斷線與 stale baseSha 保護、雙語與作者 HTML round-trip。196 隔離閱讀案例、129 API 與 698 hosted browser 案例通過；七組編輯任務是 fixture 回歸，不是 Production CMS 實寫或人類完成時間研究。
- 正式 8 路由 axe 無自動違規；incomplete 規則及人工無障礙項目仍需判斷。正式 15 個 desktop Lighthouse SEO checklist 為 1，不能當 Google 排名或手機／field 成效。

## 可攜證據入口

以下是該已交付 SHA 的正式執行，不能替代新 SHA：

| 工作 | 正式 CI |
|---|---|
| Quality | [37608845700](https://github.com/expertise88864/user-hsiao/actions/runs/37608845700) |
| Visual | [37608845698](https://github.com/expertise88864/user-hsiao/actions/runs/37608845698) |
| Delivery | [37608845787](https://github.com/expertise88864/user-hsiao/actions/runs/37608845787) |
| Generated drift | [37608845699](https://github.com/expertise88864/user-hsiao/actions/runs/37608845699) |
| Size budget | [37608845759](https://github.com/expertise88864/user-hsiao/actions/runs/37608845759) |

Git commit 的 `Claude-Opus-5-Reviewed-Commit` fullSHA trailers 是逐筆 audit 入口；實際模型以保存的審查 metadata 為準，不從 trailer 舊名稱猜測。站主本機最終證據包含 version ledger、來源／audit review proof、候選／正式 CI、部署／smoke、閱讀／編輯驗收及保護檔案雜湊。公開 repo 僅保存本摘要及公開連結，私人查詢、帳號、分析值、Cookie 或憑證不進 Git／review packet。

## 仍開放的觀察與限制

GSC 點擊、GA4 行為事件、第一方 CWV 回報與不重複訪客分別解讀。第一方確已讀回；metric ID 去重、nearest-rank p75、每指標最多 1000 筆且最多 30 天。收件時間不是造訪时间；GA4 平均與第一方 p75 不能混為同一分布，少量 INP 不能支持廣泛結論。

`related_click` 在已核對報表沒有正數列；去重程式回歸通過，等待真實讀者觀察，沒有為驗收製造正式點擊。P-07 仍有 field LCP／CLS 與環境差異待定位；Ubuntu 字型控制與三行摘要診斷保留負向結果，不當正式訪客或 CTR 效果。S-05 sanitizer 方案及大型重構另案決策；舊圖表未完整英文化等具名限制保留，不稱全站未改醫療內容全部核實。

前輪正式觀察排除部分發布日：2026-10-08–11-04 對 2026-09-09–10-06，8–12 週於 2026-12-02–12-30 看趨勢。這只是前輪期間；第三輪的新發布批次須另記日期、版本與比較限制，不把流量必定成長當工程完成條件。
