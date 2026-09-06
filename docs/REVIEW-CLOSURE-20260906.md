# 2026-09-06 歷史審查結案紀錄

對照基準：`4b741f6dd2aaa033f9950a0bcd580333ad8df413`。本輪完整交付版本以最後 commit 及外部驗證紀錄為準；本檔內容不能替代 CI 結果。

## 歷史累積審查的 13 項發現

原審查範圍 `cad9d80..HEAD`，原 session `019fbb67-afc7-76c0-b2fa-3a9f236136b0`。保留原 session 複審；原文可從 `git show 4b741f6:docs/PENDING-CODEX-REVIEW.md` 取回。

| # | 原發現 | 最終程式對照與驗證 |
|---|---|---|
| 1 | A-02 CMS scaffold 重長隱形 skip-link | `_new.js` 正確 nav／main；`_check_skiplinks.py` 拒絕空 scaffold nav。433ce06 已修。 |
| 2 | M-13 JSON-LD 診斷變布林值 | `_check_jsonld_escaping.py` 顯示檔名，Python 負向測試。1e6c301 已修。 |
| 3 | M-15 五個計算器缺逐一隔離 | `safeCall('calculator:' + name, ...)`；第一個拋錯後仍呼叫其餘四個的瀏覽器案例。1e6c301 已修。 |
| 4 | M-09 metadata 無差異仍寫入 | `_precompute-meta.js` noop；API 真 handler 重複執行案例。1e6c301 已修。 |
| 5 | M-09 字串大括號導致欄位錯寫 | `_articles.js:patchCatalogFields` token 更新、跳脫與不相干文字保留測試。1e6c301 已修。 |
| 6 | M-12 三個漏改 Python parser | `_gen_serp_meta`／`_check_listing_schema`／`_check_en_jsonld` 共用 `_articles_field`；實際 consumer fixture。1e6c301 已修。 |
| 7 | M-12 live API 漏改 parser | OG／feed／sitemap／admin list 使用 `catalogRecords`；API tests。本輪另補 T-01 parser 失敗後備。 |
| 8 | M-05 文件生成鏈次序錯 | 三份指引與 quality.yml 的真正命令一致；`_check_chain_docs`。1e6c301 已修。 |
| 9 | M-05 checker 只比 script 集合 | checker 核對順序，Python mutation 移動 prune 後須失敗。1e6c301 已修。 |
| 10 | A-01 hs／dn 守衛範圍不全 | 正規化與檢查涵蓋兩種 nav、實際 id；433ce06 已修。 |
| 11 | A-01 CI prune 早於 injection | quality 與 CMS regen 統一 `preflight --run-chain`，prune 在 injection 後；固定點／次序負測。1e6c301 已修。 |
| 12 | T-02 OG 註解與路由／cache 相反 | 現行 Node GET、rewrite、bounded cache、API package 依賴互相一致；PNG 測試及 4b741f6 Production 證據。 |
| 13 | P-01 scaffold 字型仍阻塞、guard 漏源頭 | `_new.js` preload／listener／noscript，performance checker 覆蓋 scaffold。433ce06 已修。 |

原字型 load-event race 指控已撤回；不重新列為缺陷。Backlog M-14、R-01 的既定限制仍有效。

## 本輪新增修正與界限

- M-16：六種區塊插入使用正文頂層邊界，插入後可編輯，保存原文與存檔結構；也移除斜線選單不當刪字。
- M-11：舊 raw slug 計數無法阻止引號內大括號截斷。改以 literal record 原文範圍重排，完整欄位驗證後才寫入；API 測試保留引號、括號、`];` 與陣列外原文。
- M-17：六頁頁尾規則集中至 app.css，18 個同平台對照的像素及 computed style 完全相同。這些是本機對照證據，不是新的 Ubuntu 基準。
- T-01：不支援的 live catalog literal 不再令 sitemap／feed／OG 失去後備。四種文字輸出保留快照，OG 與指定同篇文章標題的 PNG 完全相同。
- 修正 D-12／D-27 字型過期狀態及 D-21 舊 CI 豁免指引。regen 與 manual force_update 改為只讀產物檢查／artifact，移除自動 push 與 skip-ci；保留全部既有正常品質與視覺檢查。本輪未變更基準。若 CMS 改動造成生成差異，CI 會輸出修正 patch 並失敗，必須透過完整審查／CI 流程交付修正，不再讓 bot 靜默直接更新 main。
- S-05 待站主架構選擇；C-01 待臨床內容核可；C-02 為逐頁編輯候選。不得為了清空帳本擅自核可或宣稱流量改善。

## 證據與外審狀態

本輪證據目錄：`C:/Users/User/.codex/reviews/hsiaoeye-backlog-20260906/`。包含完整累積 diff、18 組頁尾前後圖與樣式、測試日誌、外審輸出及最終 SHA／CI 紀錄。

Claude Code 使用 `claude-opus-5`、effort `high`、只讀 Read／Glob／Grep。session `e075d6f8-ee8e-4722-bd72-b608f20616d1` 的 `modelUsage` 證實 Opus 5 實際執行，但結束於 quota 429，沒有 APPROVE；重置 2026-09-06 16:40 Asia/Taipei。四個歷史 pending SHA 仍未結案，新修正亦須獨立補審。不能把有消耗 token 當成審查通過。

Codex `gpt-5.6-sol`、effort `high` 在原 session 的第三輪取得 **APPROVE**。第一、二輪的阻擋項均已修正並覆核；完整輸出保留在 `codex-pass1.txt`、`codex-pass2.txt`、`codex-pass3.txt`。依歷史清單的明訂規則，取得 APPROVE 後移除 `PENDING-CODEX-REVIEW.md`，13 項發現與原始檔的 Git 取回方式保留於本紀錄。這是 Codex 歷史清單結案，不能混同 Claude Opus 補審完成。

最終提交的本機結果見證據目錄 `delivery-checks.json`（SHA／tree、平台、各命令 exit code）；推送後的 GitHub run／job／step 結果見 `github-ci-runs.json`／`github-ci-jobs.json`。若任一必要檢查未成功，不能宣稱交付完成。Opus 仍依額度例外保留 pending trailers 與 16:45 補審排程。
