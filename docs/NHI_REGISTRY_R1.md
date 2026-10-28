# 健保規定登錄 第一階段（R1）報告

日期：2026-10-28　分支：`codex/nhi-registry-r1`

## 結論

- **已登錄規定（`rules`）：0 條。** 本次工作環境的網路政策封鎖 `www.nhi.gov.tw` 與 `info.nhi.gov.tw`（curl 經 proxy 回 403；WebFetch 無法解析主機）。依站主規則「沒有實際開啟並確認原始官方來源，就不寫條目」，任何規定摘要、生效日、公告文號、網址或指紋都沒有寫入。
- **候選規定（`pending`）：27 條。** 每條只記錄網站自己引用的出處（例如「藥品給付規定第 14.9.6 節，網站標示 115.9.22 更新版」）與受影響的文章，不含任何規定內容。checker 把 pending 一律回報為「待查證」，結束碼非 0，不會被當成「未變更」。
- **網站現行文字與現行官方規定的差異：本次無法判定。** 沒有開啟原文，就無法比對；本報告不宣稱任何一處「相符」或「不符」。下方〈需優先對照原文的地方〉列出網站內部說法不一致、或寫法可能被誤讀的地方，供站主決定，文章未修改。
- **考題：** `data/exam/questions.json`、`explanations.json`、`doubts.json` 沒有任何一處陳述健保規定（「健保、給付、事前審查、自費、特材、差額、健保署、NHI」皆 0 筆）。藥名只出現在藥理與臨床試驗內容（explanations 148、1046、1463；doubts 578），與健保無關，所以所有條目的 `affects.questions` 都是空的。

## 開放網路後的補登步驟

1. 在環境設定的 Network access 允許 `www.nhi.gov.tw`、`info.nhi.gov.tw`（若要查 teprotumumab 許可證，另加 `www.fda.gov.tw`）。
2. 由人開啟原文，逐條確認後，把該條從 `pending` 移到 `rules`，填入 `rule_zh`（照原文、不加推論）、`effective`、`version`、`source`（title／url／retrieved／format）、`section.start`／`section.end`（原文中該節的開頭與下一節開頭），`fingerprint` 先填 `null`。
3. 執行 `python tools/nhi_check.py --record <id>`：抓取原文、擷取該節、寫入指紋與 `data/nhi/snapshots/<id>.txt`。
4. 之後 `python tools/nhi_check.py` 會回報 changed／unchanged／unknown／pending，changed 會附與快照的差異與受影響文章。

## 工具說明

- `data/nhi/registry.json`：`rules`（已確認）與 `pending`（待查證）。pending 若帶有 `rule_zh`、`effective`、`version`、`source` 或 `fingerprint`，驗證直接失敗。
- `tools/nhi_check.py`：重新抓取來源（HTML、PDF 用 pypdf、純文字），NFKC 正規化並去除所有空白後擷取 `section.start`～`section.end`，計算 SHA-256。
  - 結束碼：0 全部 unchanged 且無 pending；1 有 changed；2 有 unknown 或 pending；3 registry 本身不合格。
  - 抓不到、PDF 讀不出、找不到節標記、尚未 `--record`，都是 unknown，絕不算 unchanged。
  - `--affects blog/xxx.html`、`--question N`：離線反查某篇文章或某題受哪些規定影響。
- `tests/python/test_nhi_check.py`：20 個離線測試，fixture 為自編文字，不連網。

## 盤點：網站陳述健保規定的位置

「網站引用」欄位是文章自己寫的出處，**不是**本次確認過的官方內容。

| 候選 id | 主題 | 網站引用 | 文章 |
|---|---|---|---|
| glaucoma-drops-14-1 | 青光眼眼用製劑（單方、複方、無防腐劑支數上限、慢箋限眼科並附眼壓） | 藥品給付規定 14.1（14.1.1、14.1.2） | glaucoma-comprehensive-guide、glaucoma-treatment-selection |
| ophthalmic-acyclovir-14-2 | 眼用 acyclovir 限三種情形 | 14.2 | hzo-stromal-keratitis-zeds-lessons |
| steroid-antibiotic-ointment-14-3 | Maxitrol、Pimafucin 眼膏門診處方限一支 | 14.3 | cataract-surgery-selection |
| ophthalmic-quinolone-14-4-1 | Quinolone 眼藥限角膜潰瘍／嚴重角膜炎，其他為第二線需附細菌敏感試驗 | 14.4.1 | cataract-comprehensive-guide、cataract-surgery-selection、pterygium-surgery-fixation-methods-2026-nma、toric-iol-astigmatism-cataract-review |
| section-14-topical-steroid-no-limit | 第 14 節未對一般類固醇眼藥水另訂限制（「未列」陳述） | 第 14 節 | cataract-comprehensive-guide、cataract-surgery-selection、hzo-stromal-keratitis-zeds-lessons、pterygium-surgery-fixation-methods-2026-nma、toric-iol-astigmatism-cataract-review |
| artificial-tears-14-5 | 人工淚液初次使用條件（Schirmer、TBUT、角膜病變）與瓶數上限 | 14.5（網站稱最近修訂 113/7/1） | dry-eye-myths、dry-eye-symptom-sign-discordance-dream、lacrimal-gland-tumor、thyroid-eye-disease |
| ophthalmic-ketorolac-14-8 | Ketorolac 眼藥限白內障術後發炎 | 14.8 | cataract-comprehensive-guide、cataract-surgery-selection、toric-iol-astigmatism-cataract-review |
| anti-vegf-indications-14-9-2 | anti-VEGF 給付適應症清單、事前審查 | 14.9.2 | lacrimal-gland-tumor |
| anti-vegf-nAMD-14-9-2 | 濕性 AMD：50 歲以上、BCVA 0.05～0.5、檢附眼底彩色照片／FAG／OCT | 14.9.2 | osa-amd-systematic-review-2026 |
| anti-vegf-DME-14-9-2 | DME：5＋5＋4 支、每眼 14 支、續用條件（CRT ≥ 300 μm、HbA1c ≤ 8.0%） | 14.9.2 | diabetic-retinopathy-dementia-trinetx-cohort |
| anti-vegf-mCNV-14-9-2 | 病理性近視 CNV：> 600 度、眼軸 > 26 mm、一次申請每眼 3 支 | 14.9.2 第（5）項 | pediatric-high-myopia-maculopathy-progression |
| cyclosporine-eye-14-9-3 | Cyclosporine 眼藥限 Level 3 以上嚴重乾眼、事前審查、6 個月續審 | 14.9.3、附表二十七 | dry-eye-myths、dry-eye-symptom-sign-discordance-dream、thyroid-eye-disease |
| dexamethasone-implant-14-9-4 | Dexamethasone 植入劑：DME、事前審查、首次 3 支、每眼 5 支、青光眼不得申請 | 14.9.4 | diabetic-retinopathy-dementia-trinetx-cohort |
| low-dose-atropine-14-9-6 | 低濃度 atropine：18 歲以下、3.5 mL 以上、每 4 週 1 瓶、免事前審查 | 14.9.6（網站稱 112/5/1、113/10/1、115/8/1） | dims-pediatric-myopia-control、monitoring-myopia-ser-vs-axial-length、pediatric-high-myopia-maculopathy-progression、pediatric-myopia-control |
| rop-anti-vegf-14-9-7 | 早產兒視網膜病變（只提節次） | 14.9.7 | lacrimal-gland-tumor |
| systemic-antiherpetic-10-7-1-1 | 全身性抗疱疹病毒劑限列舉病況、療程原則 10 天 | 10.7.1.1 | hzo-stromal-keratitis-zeds-lessons |
| oral-pilocarpine-1-5-1 | 口服 pilocarpine（修格蘭氏症候群診斷標準） | 1.5.1 | dry-eye-myths、thyroid-eye-disease |
| neuropathic-pain-1-1-6-to-1-1-8 | Gabapentin 等止痛適應症未列眼痛 | 1.1.6–1.1.8 | dry-eye-symptom-sign-discordance-dream |
| smoking-cessation-1-2-1-1 | Bupropion 戒菸不給付；varenicline、尼古丁替代品未列 | 1.2.1.1 | thyroid-eye-disease |
| dementia-drugs-1-3-3 | 失智症用藥限神經科／精神科、MMSE／CDR | 1.3.3 | diabetic-retinopathy-dementia-trinetx-cohort |
| biologics-uveitis-8-2-4-10 | 兒童葡萄膜炎 adalimumab；成人未列 | 8.2.4.10、8.2.4.2 | refractory-noninfectious-uveitis-biologics-rubi-trial |
| immunomodulators-ted-8-2 | Rituximab、tocilizumab、口服 cyclosporine 未列甲狀腺眼疾 | 8.2.1、8.2.4、8.2.7 | thyroid-eye-disease |
| teprotumumab-not-listed | Teprotumumab 許可證與未列給付 | 食藥署許可證、健保用藥品項開放資料（網站稱 2026-10-16 查詢） | thyroid-eye-disease |
| iol-self-pay-difference | 球面單焦全額給付；特殊功能人工水晶體健保給付 2,744 點、病人自付差額 | 健保署特材自付差額 | cataract-comprehensive-guide、cataract-surgery-faq、cataract-surgery-selection、toric-iol-astigmatism-cataract-review |
| iol-self-pay-price-lookup | 各類人工水晶體差額常見收費（非球面 3 萬、散光 4.5 萬、三焦點 8.5 萬、三焦點散光 11 萬等） | 健保署「自付差額醫材比價查詢」（網站稱 2026-10 查詢） | 同上 4 篇 |
| glaucoma-devices-special-material | MIGS 不在特材或自付差額品項；Ahmed、PAUL 引流管需事前審查 | 未標節次 | glaucoma-treatment-selection |
| laser-trabeculoplasty-60007c | 支付標準「小樑雷射術」60007C | 醫療服務給付項目及支付標準（未標版本） | glaucoma-treatment-selection |

未列入登錄：只寫「依規定繳交部分負擔」「以健保署最新公告為準」「本文不就給付下斷言」等一般性提醒（例如 ophthalmic-trauma-overlooked-burden、pterygium 手術費、osa-amd 的睡眠檢查費用、pediatric-myopia-control 的紅光治療、lacrimal-gland-tumor 的動脈內化療），這些沒有陳述具體規定。`blog/index.html` 與 `blog/topics.html` 只有文章摘要裡的「健保條件」字樣，不另列。

## 需優先對照原文的地方（未修改文章，由站主決定）

以下都是網站內部比對得出的觀察，不是與官方原文比對的結論。

1. **anti-VEGF 與病理性近視 CNV 的藥品範圍。** lacrimal-gland-tumor 寫「anti-VEGF（ranibizumab、aflibercept、faricimab）的給付適應症限於濕性 AMD、DME、PCV、RVO 續發黃斑部水腫及病理性近視 CNV」，讀者可能理解為三種藥都給付這五種適應症；pediatric-high-myopia-maculopathy-progression 則寫病理性近視 CNV 只有「ranibizumab 或 aflibercept」。兩篇須對照 14.9.2 原文，確認各藥品的適應症範圍。
2. **藥品給付規定版本日期。** 全站 18 篇文章標示「115.9.22 更新版」。開放網路後，第一步是確認健保署目前公告的最新版本是否仍是 115.9.22；若已有新版，以上 22 條藥品規定候選全部要重新比對。
3. **人工水晶體 2,744 點與差額收費。** 4 篇白內障相關文章都寫 2,744 點，彼此一致；但收費是 2026-10 的比價查詢快照，屬會變動的資料，建議登錄後定期檢查。
4. **未標出處的特材陳述。** glaucoma-treatment-selection 的「Ahmed 與 PAUL 引流管需事前審查」「MIGS 不在特材或自付差額品項」沒有標示來源節次或查詢日期，是補登時最難追溯的一條。
5. **「未列」類陳述。** section-14-topical-steroid-no-limit、neuropathic-pain、smoking-cessation、immunomodulators-ted、biologics-uveitis、teprotumumab-not-listed 都是「規定中沒有」的陳述。指紋只能偵測該節文字有沒有變，無法證明「整份規定都沒有」；補登時須寫明比對的範圍。

## 本次未能驗證

- 所有健保署頁面與 PDF（藥品給付規定第 1、8、10、14 節，特材自付差額公告，自付差額醫材比價查詢，醫療服務給付項目及支付標準）。
- 食藥署 teprotumumab 許可證資料。
- 因此本次沒有任何一條規定的 `effective`、`version`、`url`、`fingerprint`。
