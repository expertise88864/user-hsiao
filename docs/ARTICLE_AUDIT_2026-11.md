# 衛教文章醫學正確性稽核（2026-11）

站主決定：「不確定的做查證，若仍不確定則用保守性寫法或刪除」。本檔列出全部改動，供站主事後檢查。

## 怎麼做的

| 輪次 | 內容 | 結果 |
|---|---|---|
| 第一輪 | 逐篇逐句對原始出處 | 844 項主張：正確 618、不精確 27、錯誤 2、無法確認 197 |
| 第二輪 | 獨立複查並查證，依站主決定修改 | 改動 173 筆、確認無誤 154 筆、駁回 4 筆 |
| 第三輪 | 對照 2026-10-16 站主提供全文時留下的核對紀錄 | 還原 75 筆、改為紀錄值 2 筆、維持第二輪 89 筆、兩邊依據不同 13 筆（裁決見下方） |

第三輪的原因：第二輪的指引漏了 10-16 的全文紀錄（`讀書筆記/_work/proof/`）。代理打不開付費全文，於是把部分已對全文確認的內容（例如 769,930 總人數、翼狀贅片 FG vs 自體血 0.74）改弱或刪除。這些都已還原，不列在下方改動清單。

之後依健保署資料修正的 12 項差異（葡萄膜炎 Yuflyma、MIGS 未收載、版本標示 115.10.22 等）另列於 `docs/NHI_REGISTRY_R1.md`，不在下方清單。

下方清單由最終版本與改動前的差異自動產生，是實際留在文章裡的改動。
`dateModified` 與頁面更新日期改為 2026-11-05。`lastReviewed` 由建置鏈與 `dateModified` 同步，也會變成 2026-11-05，但這批改動是站主授權後由 Claude 修改，站主尚未逐條審閱；請站主看完本檔。

## 站主決定後已直接保守處理

站主再次確認：「不確定的地方就用保守性寫法或刪除」。以下原本列為待確認的項目，已直接改掉，不需要再決定。

1. **散瞳藥物（pediatric-myopia-control）**：食藥署資料集內 cyclopentolate 眼用許可證全部已註銷，台灣現況不確定。改為「點睫狀肌麻痺眼藥水，等睫狀肌充分放鬆後再驗光；藥物種類與等待時間由眼科醫師決定」，不列藥名、次數與分鐘數。
2. **LiGHT 勘誤（glaucoma-treatment-selection）**：勘誤內文打不開，33 vs 16 眼也無法重新核對。改為「需要切開式青光眼手術與白內障手術的眼睛也較多（2025 年有勘誤，細項眼數這裡不列）」。
3. **MIGS 給付（glaucoma-treatment-selection）**：10-16 查的是三項裝置，另有 iStent infinite 未涵蓋。改為「包括 iStent 系列、XEN、PreserFlo；通常需要自費，是否有健保給付或差額負擔與價格，請以手術醫院說明為準」，表格同步。
4. **SEER 年份（lacrimal-gland-tumor）**：Liu 摘要與 Ma 引用的年份不同，拿掉年份，只留來源與 118 例。
5. **效價分級（hzo-stromal-keratitis-zeds-lessons）**：改成「Jacobs 2026 論文寫依試驗計畫書定義」，只寫論文的說法。

## 僅供知悉（不必動作）

1. **LAMP 副作用表（pediatric-myopia-control）**：原文 Table 3 與文中不符，畏光由 40%／20% 改為 0.05% 第 2 週 31%、1 年 8%，0.025% 第 2 週 19%、1 年 7%；刪除查無出處的近距離模糊 20%。這是本次最大的實質修正。
2. **Jiang 2026（pediatric-high-myopia-maculopathy-progression）**：從未取得全文，OR 6.26、C3 100%、−13.7 D 等已改保守或刪除。日後若提供 PDF 可核對補回。
3. **RUBI（refractory-noninfectious-uveitis-biologics-rubi-trial）**：表格數字來自站主 10-16 提供的全文，維持不動；摘要本身前後矛盾，所以與表格不同。
4. **NT$ 30,500**：維持站主 10-15 核可的金額。健保署 11-05 查詢顯示它是中位數，最常見的收費是 30,856 與 30,000，所以標籤改為「收費中位數」。
5. **DREAM 年齡（dry-eye-symptom-sign-discordance-dream）**：Matar 2026 寫 42.1 ± 15.5，NEJM 2018 表 1 是 44.6／44.1。文章照本文主要來源，未改。

## 兩邊依據不同時的裁決

| 文章 | 問題 | 裁決 | 理由 |
|---|---|---|---|
| cataract-comprehensive-guide、cataract-surgery-selection、cataract-surgery-faq | 單焦非球面自付差額 NT$ 30,500 或 30,000-30,856 | 還原 30,500 | 站主 10-15 核可「金額不動」；收費表其他類別也用同一計法。11-05 查詢：30,500 是中位數，最常見為 30,856 與 30,000 |
| red-eye-conjunctivitis | 黃綠色膿性分泌物要不要加「大量、嚴重」 | 還原原文 | PPP 寫 Severe, purulent；「大量」無出處。衛教提醒就醫，門檻寬一點較安全 |
| contact-lens-safety | 每天配戴超過 8 小時 | 還原原文 | 重新打開食藥署 2017-10-23 專文，標題即為不建議長期戴超過 8 小時 |
| hzo-stromal-keratitis-zeds-lessons | 效價分級「依試驗計畫書定義」 | 改寫為「Jacobs 2026 論文寫依試驗計畫書定義」 | Jacobs 全文寫 According to the ZEDS protocol；公開的方案 v3.0 找不到這份清單 |
| glaucoma-comprehensive-guide | 咖啡因對一般人的影響 | 改寫為「對一般人的影響較小」 | Li 2011 無明顯變化，Simanjuntak 2026 健康者約 0.61–1.60 mmHg，改成兩者都成立的寫法 |
| diabetic-retinopathy-dementia-trinetx-cohort | 非增殖性糖網追蹤間隔 | 維持第二輪（輕度 12 個月、中度 6-12 個月） | 與 PPP 2024 Table 5 相同，也較精確 |
| diabetic-retinopathy-dementia-trinetx-cohort | Pedersen 是否依 DR 分級 | 維持第二輪（比較有無 DR） | 兩份紀錄對同一全文讀法不同；此寫法兩邊都成立 |
| dims-pediatric-myopia-control | Buzzonetti 對照組人數 | 維持第二輪（18／22） | 原始論文 18／22，整合分析森林圖 20／20 |
| dims-pediatric-myopia-control | Chun「許多孩子」 | 維持第二輪（約 13%，63/489） | 原始論文的具體數字；整合分析作者寫 many |
| dims-pediatric-myopia-control | Chun 0.07 D 是否顯著 | 維持第二輪（年化 p = 0.030，總變化未顯著） | 原始論文如此；整合分析森林圖的信賴區間跨 0 |
| cataract-surgery-selection | Cochrane 2018 與辨色 | 維持第二輪（無法確定） | Cochrane 摘要原文；「似乎不影響」是 PPP 的轉述 |
| cataract-surgery-selection | LAL 防護眼鏡時間 | 維持第二輪（數週） | FDA 寫 several weeks，RxSight 病人 FAQ 寫約 4-5 週；「數週」兩邊都成立 |
| glaucoma-treatment-selection | PTVT 失敗原因 | 維持第二輪 | 全文 Table 3：眼壓不足才是兩組最常見原因，數字不矛盾且較完整 |

另有一項相同處理：dry-eye-myths 的 BAK 與淚膜、角膜神經，維持第二輪歸給 Walsh 2019，因為兩邊看的不是同一份 DEWS III 文件。

## 各篇改動清單

### cataract-comprehensive-guide

第三輪依 10-16 全文紀錄還原 3 筆（不列）。

- 改前：最差（同樣是瞳孔縮小因素）。年輕患者（未滿 50 歲）、長期使用類固醇者、糖尿
  改後：最差（同樣是瞳孔縮小因素）。相對較年輕的患者（常見於 40 至 60 多歲）、長期使用類固醇者、糖尿
  理由：BCSC 11 寫 PSC 病人常較年輕（fifth to seventh decade），與「未滿 50 歲」不符。
  出處：AAO BCSC Section 11, Lens and Cataract, 2025-2026（站主本機 PDF） 2025（C:/Users/User/Desktop/翊嘉/程式/個人網頁謙/讀書筆記/2026 AAO/2025-2026 BCSC 11 Lens and Cataract.pdf）
- 改前：美國：40 歲以上約 2,440 萬人有白內障，預估到 2050 年將翻倍至 5,000 萬人。
  改後：美國：有白內障的人數預估將從約 2,440 萬人翻倍至 2050 年的約 5,000 萬人（AAO 2021 PPP）。
  理由：數字由 PPP 證實；PPP 這句未限定 40 歲以上，NEI 統計頁也查不到，故拿掉年齡限定並補出處。
  出處：American Academy of Ophthalmology. Cataract in the Adult Eye Preferred Practice Pattern. Ophthalmology 2022;129(1):P1-P126 2021（https://www.aao.org/Assets/a7c4e054-2b43-4ac9-869a-d858ed48bb21/638876828052630000/cataract-in-the-adult-eye-ppp-7-9-25）
- 改前：看書不用戴眼鏡了」，眼鏡度數半年內變了 1-2 D。
  改後：看書不用戴眼鏡了」，眼鏡度數可能在短期內明顯改變。
  理由：近視化（second sight）有出處，「半年 1-2 D」查無來源，拿掉數字。
  出處：AAO BCSC Section 11, Lens and Cataract, 2025-2026（站主本機 PDF） 2025（C:/Users/User/Desktop/翊嘉/程式/個人網頁謙/讀書筆記/2026 AAO/2025-2026 BCSC 11 Lens and Cataract.pdf）
- 改前：多在術後 4-6 週出現，視力霧霧的、看東西彎曲
  改後：多在術後數週內出現，視力霧霧的、看東西彎曲
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：、不需住院、術後立刻可以回家、不會再次發生。
  改後：、不需住院、術後立刻可以回家；多數人開口能維持清澈，少數人可能因細胞再長回來而需要再打一次雷射。
  理由：第一輪 finding 複查 CONFIRMED：原文記錄 22 眼開口再閉合，部分需第二、三次雷射；「不會再次發生」過於絕對。
  出處：Ota A et al. Factors Associated with Reclosure of Posterior Capsule Aperture after Nd:YAG Laser Posterior Capsulotomy. Diseases 2023（https://pmc.ncbi.nlm.nih.gov/articles/PMC10296942/）
- 改前：水晶體設計，從不到 5% 到約 50% 都有（AAO PPP 引
  改後：水晶體設計，從不到 5% 到 54% 都有（AAO PPP 引
  理由：PPP 原文 less than 5% to 54%，改為原數字。
  出處：American Academy of Ophthalmology. Cataract in the Adult Eye Preferred Practice Pattern. Ophthalmology 2022;129(1):P1-P126 2021（https://www.aao.org/Assets/a7c4e054-2b43-4ac9-869a-d858ed48bb21/638876828052630000/cataract-in-the-adult-eye-ppp-7-9-25）
- 改前：活。視力當天就改善。YAG 處理過後，後囊已被切開，不會再次發生後發性白內障。
  改後：活。視力當天就改善。YAG 雷射打開的開口通常能長期維持清澈，多數人不需再處理；少數人開口邊緣的細胞會再長回來遮住開口，可能需要再打一次雷射。
  理由：同上，迷思 6；頁內 FAQ JSON-LD 同步（產生器重跑後也會一致）。
  出處：Ota A et al. Factors Associated with Reclosure of Posterior Capsule Aperture after Nd:YAG Laser Posterior Capsulotomy. Diseases 2023（https://pmc.ncbi.nlm.nih.gov/articles/PMC10296942/）

### cataract-surgery-faq

- 改前：類固醇、眼睛受過外傷者，建議定期追蹤
  改後：類固醇、眼睛受過外傷者，建議與眼科醫師討論追蹤頻率
  理由：三者是 PPP 列出的風險因子，但無統一追蹤建議；英文原寫 annual monitoring，一併改掉。
  出處：American Academy of Ophthalmology. Cataract in the Adult Eye Preferred Practice Pattern. Ophthalmology 2022;129(1):P1-P126 2021（https://www.aao.org/Assets/a7c4e054-2b43-4ac9-869a-d858ed48bb21/638876828052630000/cataract-in-the-adult-eye-ppp-7-9-25）

### cataract-surgery-selection

第三輪依 10-16 全文紀錄還原 3 筆（不列）。

- 改前：2.2-2.75 mm（台灣常規 2.75 mm）
  改後：2.2-2.75 mm
  理由：台灣常規切口查無可引用資料（共 2 處）。
  出處：AAO BCSC Section 11, Lens and Cataract, 2025-2026（站主本機 PDF） 2025（C:/Users/User/Desktop/翊嘉/程式/個人網頁謙/讀書筆記/2026 AAO/2025-2026 BCSC 11 Lens and Cataract.pdf）
- 改前：絕對主流（> 95%）
  改後：絕對主流
  理由：無官方統計可確認 95%；AAPPO、PPP 只支持全球主流。
  出處：American Academy of Ophthalmology. Cataract in the Adult Eye Preferred Practice Pattern. Ophthalmology 2022;129(1):P1-P126 2021（https://www.aao.org/Assets/a7c4e054-2b43-4ac9-869a-d858ed48bb21/638876828052630000/cataract-in-the-adult-eye-ppp-7-9-25）
- 改前：2.75 mm 透明角膜切口（台灣多數醫院常規 2.75 mm），以超音波探頭把白內障核震碎
  改後：2.75 mm 透明角膜切口，以超音波探頭把白內障核震碎
  理由：台灣常規切口查無可引用資料（共 2 處）。
  出處：AAO BCSC Section 11, Lens and Cataract, 2025-2026（站主本機 PDF） 2025（C:/Users/User/Desktop/翊嘉/程式/個人網頁謙/讀書筆記/2026 AAO/2025-2026 BCSC 11 Lens and Cataract.pdf）
- 改前：缺點：切口較大（術後散光略多 0.5-1.0 D）、恢復略慢、視覺結果穩定時
  改後：缺點：切口較大（術後散光可能較多）、恢復略慢、視覺結果穩定時
  理由：PPP 確認較大切口散光變化較多，0.5-1.0 D 查無出處。
  出處：American Academy of Ophthalmology. Cataract in the Adult Eye Preferred Practice Pattern. Ophthalmology 2022;129(1):P1-P126 2021（https://www.aao.org/Assets/a7c4e054-2b43-4ac9-869a-d858ed48bb21/638876828052630000/cataract-in-the-adult-eye-ppp-7-9-25）
- 改前：實在臨床結果上優於傳統超音波；應依個別病人情境選擇而非一律採用
  改後：實在臨床結果上優於傳統超音波
  理由：後半句 AAPPO 摘要無法確認，前半句可確認。
  出處：Srinivas SP et al. Controversies, consensuses and guidelines on modern cataract surgery by AAPPO. Asia Pac J Ophthalmol 2025（https://pubmed.ncbi.nlm.nih.gov/40628343/）
- 改前：chrane 系統性回顧認為它似乎不影響辨色。是否選擇可與醫師討論，並非
  改後：chrane 系統性回顧認為現有研究不足，無法確定它對辨色是否有明顯影響。是否選擇可與醫師討論，並非
  理由：第一輪 finding 複查 CONFIRMED：Cochrane 摘要寫 not able to determine with any certainty。AAO PPP 轉述為 nor do they seem to impair，但本句掛 Cochrane，依原始回顧修改。
  出處：Downie LE et al. Blue-light filtering intraocular lenses for protecting macular health. Cochrane Database Syst Rev 2018（https://doi.org/10.1002/14651858.CD011977.pub2）
- 改前：精準矯正──可矯正 1-6 D 的散光，比 LRIs 範圍更廣
  改後：精準矯正──可矯正的散光範圍比 LRIs 更廣（美國市售型號約 1-4 D，各地可用型號不同）
  理由：BCSC 11：美國 toric IOL 約可矯正 1.00-4.00 D；1-6 D 找不到出處。
  出處：AAO BCSC Section 11, Lens and Cataract, 2025-2026（站主本機 PDF） 2025（C:/Users/User/Desktop/翊嘉/程式/個人網頁謙/讀書筆記/2026 AAO/2025-2026 BCSC 11 Lens and Cataract.pdf）
- 改前：適用範圍窄──只能矯正 0.75-2.0 D 的散光，太多不夠
  改後：適用範圍窄──主要用於較低度的散光，散光較高時效果不足
  理由：BCSC 11 與 PPP 只寫 lower／small amounts，無 0.75-2.0 D。
  出處：AAO BCSC Section 11, Lens and Cataract, 2025-2026（站主本機 PDF） 2025（C:/Users/User/Desktop/翊嘉/程式/個人網頁謙/讀書筆記/2026 AAO/2025-2026 BCSC 11 Lens and Cataract.pdf）
- 改前：術後需戴特殊紫外線防護眼鏡約 4-5 週直到鎖定──清醒時室內、室外都要戴
  改後：術後需戴特殊紫外線防護眼鏡數週直到鎖定完成──清醒時室內、室外都要戴
  理由：FDA SSED 寫 several weeks；RxSight 手冊寫戴到最後鎖定後 24 小時；4-5 週無官方依據。
  出處：FDA Summary of Safety and Effectiveness Data P160055, Light Adjustable Lens and Light Delivery Device 2017（https://www.accessdata.fda.gov/cdrh_docs/pdf16/P160055B.pdf）
- 改前：A-scan 精準得多。AAO PPP 與 AAPPO 共識皆強烈建議使用光學生物測量。
  改後：A-scan 精準得多。AAPPO 共識認為干涉式光學生物測量是必要的，AAO PPP 也指出它比接觸式 A-scan 更精準。
  理由：改成兩份文件實際能確認的說法（AAPPO 摘要 essential；PPP significantly more accurate）。
  出處：Srinivas SP et al. Controversies, consensuses and guidelines on modern cataract surgery by AAPPO. Asia Pac J Ophthalmol 2025（https://pubmed.ncbi.nlm.nih.gov/40628343/）
- 改前：了角膜曲率，傳統 K 值量測會「低估真實角膜屈光力」（因為前表
  改後：了角膜曲率，傳統 K 值量測通常會「高估真實角膜屈光力」（因為前表
  理由：第一輪 finding 複查 CONFIRMED（方向寫反）：after myopic correction, keratometry readings usually overestimate corneal power；下一句「度數太低、術後遠視」本來就正確。
  出處：Savini G, Hoffer KJ. Intraocular lens power calculation in eyes with previous corneal refractive surgery. Eye Vis (Lond) 2018（https://pmc.ncbi.nlm.nih.gov/articles/PMC6053834/）
- 改前：真實角膜屈光力」（因為前表面變平了，但後表面變化較少），導致：
  改後：真實角膜屈光力」（因為前表面被改變、後表面幾乎不變，一般換算角膜屈光力時假設的前後比例已不適用），導致：
  理由：第一輪 finding 複查 CONFIRMED（方向寫反）：after myopic correction, keratometry readings usually overestimate corneal power；下一句「度數太低、術後遠視」本來就正確。
  出處：Savini G, Hoffer KJ. Intraocular lens power calculation in eyes with previous corneal refractive surgery. Eye Vis (Lond) 2018（https://pmc.ncbi.nlm.nih.gov/articles/PMC6053834/）
- 改前：健保或自費水晶體都可能發生（5-50%），處理方式是門診 YAG
  改後：健保或自費水晶體都可能發生（文獻中需雷射處理的比例從不到 5% 到 54%），處理方式是門診 YAG
  理由：PPP 原文 less than 5% to 54%，且是雷射處理比例。
  出處：American Academy of Ophthalmology. Cataract in the Adult Eye Preferred Practice Pattern. Ophthalmology 2022;129(1):P1-P126 2021（https://www.aao.org/Assets/a7c4e054-2b43-4ac9-869a-d858ed48bb21/638876828052630000/cataract-in-the-adult-eye-ppp-7-9-25）

### diabetic-retinopathy-dementia-trinetx-cohort

第三輪依 10-16 全文紀錄還原 11 筆（不列）。

- 改前：來，眼底可能早已開始病變）；第 1 型糖尿病則在發病 5
  改後：來，眼底可能早已開始病變）；成人第 1 型糖尿病則在發病 5
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：病 5 年後做第一次眼底檢查。後續追蹤：一次以上的年度檢
  改後：病 5 年後做第一次眼底檢查（兒童與青少年的時機另有建議，請依醫師安排）。後續追蹤：一次以上的年度檢
  理由：ADA 建議 12.3 的對象是成人，兒童青少年另見第 14 節（Q7）。
  出處：12. Retinopathy, Neuropathy, and Foot Care: Standards of Care in Diabetes-2026 2026（https://pmc.ncbi.nlm.nih.gov/articles/PMC12690177/）
- 改前：滲出物早期信號；多數無症狀；6-12 個月追蹤
  改後：滲出物早期信號；多數無症狀；輕度每 12 個月、中度每 6-12 個月追蹤
  理由：PPP 2024 Table 5：輕度無水腫 12 個月，中度 6-12 個月。
  出處：AAO Diabetic Retinopathy Preferred Practice Pattern (2024 edition, PDF), Table 5 2024（https://www.aao.org/education/preferred-practice-pattern/diabetic-retinopathy-ppp）
- 改前：病人 19,221 人，並已依 DR 分級分析阿茲海默症風險，所以「最大」「第一個」的說法宜保留看待。
  改後：病人 19,221 人，並已比較有無 DR 的阿茲海默症風險，所以本研究並不是這個主題唯一的大型研究。
  理由：作者討論內容無法確認，刪除；Pedersen 的反例保留。
  出處：The Association Between Diabetic Retinopathy Severity and Dementia Risk: A TriNetX Longitudinal Cohort Study (Khangura et al., Am J Ophthalmol; abstract only, full text paywalled) 2026（https://pubmed.ncbi.nlm.nih.gov/41692179/）
- 改前：糖尿病本身就是失智症的獨立風險因子，即使眼底正常仍有 26% 風險增加（共同病理機轉所致）
  改後：糖尿病本身就與較高的失智風險相關：即使沒有視網膜病變，全因失智 HR 仍約 1.26（回顧性世代研究，只能說明相關，無法確定機轉或因果）
  理由：摘要為回顧性世代、HR 1.262，不支持「獨立」與「所致」的因果語氣。
  出處：The Association Between Diabetic Retinopathy Severity and Dementia Risk: A TriNetX Longitudinal Cohort Study (Khangura et al., Am J Ophthalmol; abstract only, full text paywalled) 2026（https://pubmed.ncbi.nlm.nih.gov/41692179/）
- 改前：糖尿病常已存在多年才被診斷；第 1 型糖尿病則在發病五年
  改後：糖尿病常已存在多年才被診斷；成人第 1 型糖尿病則在發病五年
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：病則在發病五年後做第一次檢查。之後若一次以上的年度檢查都
  改後：病則在發病五年後做第一次檢查（兒童與青少年請依醫師安排）。之後若一次以上的年度檢查都
  理由：同上，文末常見問題同一句。
  出處：12. Retinopathy, Neuropathy, and Foot Care: Standards of Care in Diabetes-2026 2026（https://pmc.ncbi.nlm.nih.gov/articles/PMC12690177/）

### dims-pediatric-myopia-control

第三輪依 10-16 全文紀錄還原 20 筆（不列）。

- 改前： 156 位）──作者指出，它的 DIMS 組人數比其他研究 DIMS 組加總（265 位）還多，這種權重不均會降低整合分析的
  改後： 156 位）──作者指出，這種權重不均會降低整合分析的
  理由：原始論文為 63/489，不是「許多」；其餘 5 篇 DIMS 組原始人數加總 279，也不是 265。
  出處：Real-world outcomes of DIMS lenses on retarding axial elongation (Chun et al., Front Med) 2024（https://www.frontiersin.org/journals/medicine/articles/10.3389/fmed.2024.1416286/full）
- 改前：重不均會降低整合分析的價值；而且該研究有許多孩子先前接受過其他近視控制，
  改後：重不均會降低整合分析的價值；該研究 DIMS 組約 13%（63/489）的孩子先前接受過其他近視控制或
  理由：原始論文為 63/489，不是「許多」；其餘 5 篇 DIMS 組原始人數加總 279，也不是 265。
  出處：Real-world outcomes of DIMS lenses on retarding axial elongation (Chun et al., Front Med) 2024（https://www.frontiersin.org/journals/medicine/articles/10.3389/fmed.2024.1416286/full）
- 改前：多孩子先前接受過其他近視控制，進展較快，使觀察到的 DIMS 效果變小
  改後：的孩子先前接受過其他近視控制或同時併用低劑量阿托品，這些孩子的度數進展較快（Chun 2024）
  理由：原始論文為 63/489，不是「許多」；其餘 5 篇 DIMS 組原始人數加總 279，也不是 265。
  出處：Real-world outcomes of DIMS lenses on retarding axial elongation (Chun et al., Front Med) 2024（https://www.frontiersin.org/journals/medicine/articles/10.3389/fmed.2024.1416286/full）
- 改前：主要來自 Chun 2024（真實世界世代研究，許多孩子先前接受過其他近視控制，進展較快，使觀察到的 DIMS 效果變小；該研究的 SER 差異只有 0.07 D，未達統計意義），Akagun 2025 也
  改後：主要來自 Chun 2024，Akagun 2025 也
  理由：Chun 年化差異 p=0.030 其實顯著，只有總變化未顯著；I² 數值與作者歸因無法確認。
  出處：Real-world outcomes of DIMS lenses on retarding axial elongation (Chun et al., Front Med) 2024（https://www.frontiersin.org/journals/medicine/articles/10.3389/fmed.2024.1416286/full）
- 改前：2025 也增加了研究間差異
  改後：2025 也增加了研究間差異。各研究結果確實差異不小：Chun 2024（真實世界世代研究，DIMS 組約 13% 的孩子先前接受過其他近視控制或併用低劑量阿托品）的年化 SER 差異約 0.07 D（-0.38 vs -0.45 D／年，p = 0.030），總變化差異未達統計意義；Li 2025 的隨機試驗則為 0.28 D，達統計意義
  理由：Chun 年化差異 p=0.030 其實顯著，只有總變化未顯著；I² 數值與作者歸因無法確認。
  出處：Real-world outcomes of DIMS lenses on retarding axial elongation (Chun et al., Front Med) 2024（https://www.frontiersin.org/journals/medicine/articles/10.3389/fmed.2024.1416286/full）
- 改前：> 10 歲兩組（原文寫法；每組 DIMS／單焦各 20 位）分別計算，因此在森林圖
  改後：> 10 歲兩組（原文寫法；DIMS 每組 20 位；單焦對照組 10 歲以上 18 位、未滿 10 歲 22 位）分別計算，因此在森林圖
  理由：摘要：group B 18 人、group D 22 人；森林圖細節無法確認，一併拿掉。
  出處：Effectiveness of DIMS in Slowing Myopia Progression in Pediatric Patients as a Function of Age (Buzzonetti et al., Diseases) 2024（https://pubmed.ncbi.nlm.nih.gov/39329891/）

### dry-eye-myths

- 改前：。TFOS DEWS II 與 2025 年 TFOS DE
  改後：。TFOS DEWS II 把局部防腐劑列為乾眼的醫源性原因之一；2025 年 TFOS DE
  理由：DEWS III 只寫毒性、促發炎、惡化徵象症狀；淚膜與角膜神經的敘述改歸文內既有的 Walsh 2019（PMC6682755）。
  出處：TFOS DEWS III: Management and Therapy (Jones et al., Am J Ophthalmol) 2025（https://publications.aston.ac.uk/id/eprint/47669/）
- 改前：OS DEWS III 報告都指出：BAK 等防腐劑對眼表
  改後：OS DEWS III 報告指出：BAK 等防腐劑對眼表
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：眼表有毒性並會引發發炎，可能破壞淚膜穩定、傷害角膜神經，反而讓乾眼的徵象與症狀惡化。
  改後：眼表有毒性並會引發發炎，可能讓乾眼的徵象與症狀惡化。文獻
  理由：DEWS III 只寫毒性、促發炎、惡化徵象症狀；淚膜與角膜神經的敘述改歸文內既有的 Walsh 2019（PMC6682755）。
  出處：TFOS DEWS III: Management and Therapy (Jones et al., Am J Ophthalmol) 2025（https://publications.aston.ac.uk/id/eprint/47669/）
- 改前：反而讓乾眼的徵象與症狀惡化。
  改後：可能讓乾眼的徵象與症狀惡化。文獻回顧也提到，BAK 可能降低淚膜穩定度、減少角膜神經（Walsh 2019）。
  理由：DEWS III 只寫毒性、促發炎、惡化徵象症狀；淚膜與角膜神經的敘述改歸文內既有的 Walsh 2019（PMC6682755）。
  出處：TFOS DEWS III: Management and Therapy (Jones et al., Am J Ophthalmol) 2025（https://publications.aston.ac.uk/id/eprint/47669/）
- 改前：I 整理的流行病學資料顯示，以症狀與徵象定義時，年輕成人與年長者的比率都偏高，且有證據顯示乾眼盛行率隨時間上升
  改後：I 整理的流行病學資料顯示，乾眼在年輕人與年長者都常見；以症狀與徵象定義時，各成人年齡層的比率相當接近，也有部分證據顯示乾眼盛行率隨時間上升
  理由：Digest：prevalent in both the young and the old、成人各年齡層相當一致、some evidence。
  出處：TFOS DEWS III: Digest (Stapleton et al., Am J Ophthalmol) 2025（https://www.ajo.com/article/S0002-9394(25)00276-4/fulltext）
- 改前：是依嚴重度硬性排列，醫師可依病因、經驗與病人偏好從任一類別選擇
  改後：是依嚴重度硬性排列，醫師可依經驗與病人偏好從任一類別選擇
  理由：PPP 原文只寫 physician experience and patient preference，沒有病因；英文版原本正確。
  出處：Dry Eye Syndrome Preferred Practice Pattern (Amescua et al.; AAO PDF) 2023（https://www.aao.org/education/preferred-practice-pattern/dry-eye-syndrome-ppp-2023）
- 改前：、各級之間有重疊，治療也可依病因跨級選用；TFOS DEWS
  改後：、各級之間有重疊，治療也可依醫師經驗與病人偏好跨級選用；TFOS DEWS
  理由：同上，表 1 資料來源同一說法。
  出處：Dry Eye Syndrome Preferred Practice Pattern (Amescua et al.; AAO PDF) 2023（https://www.aao.org/education/preferred-practice-pattern/dry-eye-syndrome-ppp-2023）
- 改前：次、每次 1 錠（5 mg），每半年依症狀改善評量表評估是否續用
  改後：次、每次 1 錠（5 mg）；修格蘭氏症每半年、放射線治療後口乾每兩個月依症狀改善評量表評估是否續用
  理由：1.5.1：修格蘭氏症每半年，頭頸部放療後每兩個月。
  出處：全民健康保險藥品給付規定（115.9.22 更新版，本機條文） 2026（https://www.nhi.gov.tw/）
- 改前： TFOS DEWS II and 2025 TFOS DEW
  改後： TFOS DEWS II lists topical preservatives among iatrogenic causes of dry eye; the 2025 TFOS DEW
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：EWS III reports both note that preserva
  改後：EWS III report notes that preserva
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：cular surface — they can destabilize the tear film and impair corneal nerves, worsening dry eye signs
  改後：cular surface and can worsen dry eye signs
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前： and symptoms.
  改後： and symptoms. A literature review also reports that BAK may reduce tear film stability and corneal nerves (Walsh 2019).
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：III shows that, defined by sy
  改後：III shows that dry eye is common in both young and older people; defined by sy
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：ns, rates are higher in both younger and older adults, with some e
  改後：ns, rates are fairly consistent across adult age groups, with some e
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。

### floaters-retinal-detachment

第三輪依 10-16 全文紀錄還原 3 筆（不列）。

- 改前： 多發生在 45–65 歲，到 70 多歲時多數眼睛都已發生
  改後： 多發生在 45–65 歲，之後隨年齡增加更常見（部分研究顯示 70 多歲時已超過半數）
  理由：Takahashi 1982 裂隙燈檢查 70 多歲 71%；但 Handan 族群研究定義不同、比例低很多，改寫為部分研究。
  出處：高橋正孝. 正常眼 1,077 眼の硝子体剥離. 臨床眼科 1982（https://webview.isho.jp/journal/detail/abs/10.11477/mf.1410208712）
- 改前：判斷簡單：蓋住一隻眼睛後還有閃光 → 睜開的那隻眼睛有問題（眼科）；蓋
  改後：簡單判斷：輪流遮住左右眼。只有遮住某一眼時閃光才消失 → 較可能是被遮住的那隻眼睛有問題（眼科）；遮
  理由：CONFIRMED：只遮一眼無法區分單眼與雙眼／腦部來源，ICHD-3 也列單眼與同側視覺症狀的誤報；第一輪建議句「另一眼」方向相反，未採用，改為被遮住的那隻眼。
  出處：ICHD-3, 1.2 Migraine with aura 2018（https://ichd-3.org/1-migraine/1-2-migraine-with-aura/）
- 改前：開的那隻眼睛有問題（眼科）；蓋住任一眼都還在 → 雙眼或中樞性問題。
  改後：住的那隻眼睛有問題（眼科）；遮哪一眼都還看得到 → 可能是雙眼或腦部（如偏頭痛先兆）的問題。單用這個方法不能排除眼科急症。
  理由：CONFIRMED：只遮一眼無法區分單眼與雙眼／腦部來源，ICHD-3 也列單眼與同側視覺症狀的誤報；第一輪建議句「另一眼」方向相反，未採用，改為被遮住的那隻眼。
  出處：ICHD-3, 1.2 Migraine with aura 2018（https://ichd-3.org/1-migraine/1-2-migraine-with-aura/）
- 改前：所以即使度數不深，有上述任一危險因子（尤其白內障術後）都
  改後：所以即使度數不深，有上述危險因子（尤其白內障術後）的
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：一危險因子（尤其白內障術後）都應該每年接受眼底檢查，並注意警訊。
  改後：述危險因子（尤其白內障術後）的人都要認識警訊，並依眼科醫師建議的間隔回診；例如無症狀的晶格狀變性，AAO 2024 PPP 建議每年追蹤。
  理由：CONFIRMED：PPP Table 3 的每年追蹤只列晶格狀變性等病灶，無症狀 PVD 僅需例行追蹤；FAQ 同句一併修改。
  出處：AAO Posterior Vitreous Detachment, Retinal Breaks, and Lattice Degeneration PPP 2024（https://www.aao.org/preferred-practice-pattern/posterior-vitreous-detachment-retinal-breaks-latti）
- 改前：體，合併雷射或冷凍治療，術後需特定姿勢約 5–8 天單次手術約 81%（PIVO
  改後：體，合併雷射或冷凍治療，術後可能需維持特定姿勢數天（NHS：最多約 7 天）單次手術約 81%（PIVO
  理由：5–8 天查無原文；NHS 寫 up to 7 days。
  出處：NHS Detached retina (retinal detachment) 2024（https://www.nhs.uk/conditions/detached-retina-retinal-detachment/）
- 改前：），完全恢復可能需數月；矽油多在 3-6 個月內取出
  改後：），完全恢復可能需數月；矽油通常之後需再手術取出，時機因人而異（不少醫師建議至少放置 3-6 個月）
  理由：原文是至少放置 3-6 個月且時機無共識，與「3-6 個月內取出」不同。
  出處：Retina Today, Pearls: silicone oil removal 2018（https://assets.bmctoday.net/retinatoday/pdfs/0718RT_Pearls.pdf）
- 改前：ages 45 and 65; most eyes are affected by their 70s
  改後：ages 45 and 65, becoming more common with age (some studies find it in over half of eyes by the 70s)
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：Quick test: Cover one eye — flashes still there in the other = ocular issue. Persists with either eye covered = bilateral or central origin.
  改後：Quick test: cover each eye in turn. If flashes disappear only when one eye is covered, the covered eye is the likely source (ocular); if they persist whichever eye is covered, both eyes or the brain (such as migraine aura) may be involved. This test alone cannot rule out an eye emergency.
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前： mild myopia, any of the above risk factors
  改後： mild myopia, people with these risk factors
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：ost-cataract) warrants annual fundus exam plus warning-sign awareness.
  改後：ost-cataract) should know the warning signs and follow up at the interval their ophthalmologist advises; for asymptomatic lattice degeneration, for example, the AAO 2024 PPP recommends annual review.
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前： cryotherapy; specific positioning fo
  改後： cryotherapy; positioning ma
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：c positioning for about 5–8 days~81% single-pr
  改後：; positioning may be needed for several days (NHS: up to 7 days)~81% single-pr
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：; oil usually removed within 3–6 mo
  改後：; oil usually needs later surgical removal; timing varies (many surgeons suggest at least 3–6 months first)
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：央視野的鋸齒狀光。簡單判斷：蓋住一隻眼還有閃光，就是那隻眼睛的問題，即使只出現一次也建議當天看眼科散瞳檢查。
  改後：央視野的鋸齒狀光。簡單判斷：輪流遮住左右眼，只有遮住某一眼時閃光才消失，較可能是被遮住的那隻眼睛的問題；遮哪一眼都還看得到，則可能是雙眼或腦部（如偏頭痛先兆）的問題。單用這個方法不能排除眼科急症，新出現的閃光即使只有一次，也建議當天看眼科散瞳檢查。
  理由：CONFIRMED：同上（FAQ），保留當天就醫提醒。
  出處：ICHD-3, 1.2 Migraine with aura 2018（https://ichd-3.org/1-migraine/1-2-migraine-with-aura/）
- 改前：曾經剝離。因此即使度數不深，只要有上述任一危險因子（尤其白內障術後），
  改後：曾經剝離。因此即使度數不深，有這些危險因子（尤其白內障術後）的
  理由：CONFIRMED：PPP Table 3 的每年追蹤只列晶格狀變性等病灶，無症狀 PVD 僅需例行追蹤；FAQ 同句一併修改。
  出處：AAO Posterior Vitreous Detachment, Retinal Breaks, and Lattice Degeneration PPP 2024（https://www.aao.org/preferred-practice-pattern/posterior-vitreous-detachment-retinal-breaks-latti）
- 改前：一危險因子（尤其白內障術後），都應每年接受眼底檢查並留意警訊。
  改後：些危險因子（尤其白內障術後）的人都要認識警訊，並依眼科醫師建議的間隔回診；例如無症狀的晶格狀變性，AAO 建議每年追蹤。
  理由：CONFIRMED：PPP Table 3 的每年追蹤只列晶格狀變性等病灶，無症狀 PVD 僅需例行追蹤；FAQ 同句一併修改。
  出處：AAO Posterior Vitreous Detachment, Retinal Breaks, and Lattice Degeneration PPP 2024（https://www.aao.org/preferred-practice-pattern/posterior-vitreous-detachment-retinal-breaks-latti）

### glaucoma-comprehensive-guide

- 改前：nal rim）變薄。正常人杯盤比約 0.3，且符合 ISNT 規則（下
  改後：nal rim）變薄。正常人的杯盤比多半較小（部分族群研究平均約 0.3-0.4，個體差異大），且符合 ISNT 規則（下
  理由：族群研究平均值因族群與量法不同（韓國垂直 CDR 0.34、南印度 0.36）；圖中 C/D 0.3 是示意，未改。
  出處：Associations between Optic Cup-to-disc Ratio and Systemic Factors in the Healthy Korean Population. Korean J Ophthalmol 2015（https://pmc.ncbi.nlm.nih.gov/articles/PMC4595260）
- 改前：360° SLT 列為新診斷開角型青光眼（OAG）與高眼壓症（OHT，IOP ≥ 24 mmHg）的第一線治療，而非眼藥水。
  改後：360° SLT 列為新診斷、非進階期慢性開角型青光眼（COAG），以及眼壓 ≥ 24 mmHg 且一生中有視力受損風險的高眼壓症（OHT）的第一線治療，而非眼藥水（
  理由：CONFIRMED：rec 1.4.4、1.4.17 有這些限制。
  出處：NICE NG81 Glaucoma: diagnosis and management 2022（https://www.nice.org.uk/guidance/ng81/chapter/Recommendations）
- 改前：g）的第一線治療，而非眼藥水。依據是 LiGHT 試驗（
  改後：T）的第一線治療，而非眼藥水（色素分散症候群除外）。依據是 LiGHT 試驗（
  理由：CONFIRMED：rec 1.4.4、1.4.17 有這些限制。
  出處：NICE NG81 Glaucoma: diagnosis and management 2022（https://www.nice.org.uk/guidance/ng81/chapter/Recommendations）
- 改前：olol（選擇性 β1 阻斷）
  改後：olol（選擇性 β1 阻斷；眼藥水台灣目前無有效許可證）
  理由：查 TFDA 時發現：Betoptic S 最後一張 2026/8/26 註銷，有效證只剩錠劑與原料藥，與姊妹文一致。
  出處：食藥署藥品許可證開放資料（InfoId 36，2026-11-02 版） 2026（https://data.fda.gov.tw/opendata/exportDataList.do?method=ExportData&InfoId=36&logType=2）
- 改前： block）。是急性發作後與閉角型可疑者的標準處置。
  改後： block）。是急性發作後的標準處置；對閉角型可疑者（PACS），AAO 建議考慮 LPI，也可以選擇定期追蹤，由醫師依風險討論。
  理由：CONFIRMED：PPP 原文 should be considered、Alternatively may be followed。
  出處：AAO Primary Angle-Closure Disease PPP 2025（https://www.aao.org/education/preferred-practice-pattern/primary-angle-closure-disease-ppp）
- 改前：入性與併發症風險也同步上升。AAO PPP 與 NICE 都強調：SLT 在合適病人是非常好的第一線選擇，可減少終身藥物負擔。
  改後：入性與併發症風險也同步上升。NICE 把 SLT 列為第一線；AAO PPP 認為近年資料支持 SLT 作為起始治療，但也指出目前最常見的起始治療仍是眼藥水。SLT 有機會減少點藥負擔。
  理由：CONFIRMED：PPP 原文 Topical medical therapy is currently the most common initial intervention。
  出處：AAO Primary Open-Angle Glaucoma PPP 2025（https://www.aao.org/preferred-practice-pattern/primary-open-angle-glaucoma-ppp）
- 改前：穩定病人：每 3-6 個月測眼壓、每 6-12 個月做視野與 OCT 剛調整治療：4-6 週回診評估反應
  改後：穩定病人：AAO PPP 依嚴重度與控制時間建議，眼壓追蹤約每 3-12 個月（嚴重者約 3-6 個月）；視野與視神經評估約每 6-18 個月（嚴重者約 6-12 個月）。NICE 對未惡化且眼壓受控的慢性開角型青光眼（COAG）建議約 6-18 個月重新評估，實際間隔由醫師個別調整 剛調整治療：AAO PPP 提到可依嚴重度於 2-8 週回診，評估效果與副作用
  理由：CONFIRMED：依 PPP Table 7–8 與 NICE Table 3 改寫。
  出處：AAO Primary Open-Angle Glaucoma PPP 2025（https://www.aao.org/preferred-practice-pattern/primary-open-angle-glaucoma-ppp）
- 改前：跑、游泳、單車）──研究顯示可短暫降眼壓 1-3 mmHg，並改善整體心血管與灌流壓 避免：某些瑜珈倒立姿勢（頭倒立、肩倒立、下犬式持續超過 1-2 分鐘）──可使眼壓上升 5-15 mmHg。其他要避免的：用力憋氣（重
  改後：跑、游泳、單車）──研究顯示中等強度有氧運動後眼壓可能短暫下降，幅度與持續時間因人而異；也有助於整體心血管健康 避免：頭低或倒立的瑜珈姿勢（如頭倒立、下犬式）──小型研究顯示，頭低姿勢一分鐘內可使眼壓上升約 4-12 mmHg，坐起後約 2 分鐘回到基準；頭倒立的報告約可使眼壓升為兩倍。其他要避免的：用力憋氣（重
  理由：Jasien 2015 原文一分鐘內即上升，四姿勢增幅約 4-12 mmHg；未測肩倒立；FAQ JSON-LD 改為不列數字。
  出處：Jasien JV, et al. Intraocular Pressure Rise in Subjects with and without Glaucoma during Four Common Yoga Positions. PLoS One 2015（https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0144505）
- 改前：咖啡因：喝一杯咖啡（咖啡因超過約 100 mg）後 1-1.5 小時內，眼壓可能短暫上升約 1-2 mmHg，青光眼或高眼壓症病人較明顯，但臨床意義不大，不必戒掉；不過有家族史或高遺傳風險者，應避免大量攝取（AAO PPP 引用 UK Biobank 研究）
  改後：咖啡因：統合分析顯示，青光眼或高眼壓症病人喝含咖啡因飲品後 1-1.5 小時，眼壓平均約上升 2 mmHg，對一般人的影響較小；臨床意義仍待確認，不必戒掉。UK Biobank 研究顯
  理由：CONFIRMED：統合分析一般人無變化、臨床意義待探討；PPP 只講遺傳傾向，非家族史；手寫 FAQ JSON-LD 同步。
  出處：Li M, et al. The effect of caffeine on intraocular pressure. Graefes Arch Clin Exp Ophthalmol 2011（https://pubmed.ncbi.nlm.nih.gov/20706731/）
- 改前： UK Biobank 研究）
  改後：。UK Biobank 研究顯示，遺傳上眼壓偏高者，攝取較多咖啡因與較高眼壓及青光眼盛行率相關，這類族群可與醫師討論是否節制（AAO PPP 引用）
  理由：CONFIRMED：統合分析一般人無變化、臨床意義待探討；PPP 只講遺傳傾向，非家族史；手寫 FAQ JSON-LD 同步。
  出處：Li M, et al. The effect of caffeine on intraocular pressure. Graefes Arch Clin Exp Ophthalmol 2011（https://pubmed.ncbi.nlm.nih.gov/20706731/）
- 改前：終身用藥或定期評估。自行停藥會讓眼壓很快回升、新的視神經損傷可能在幾週內發生。AAO PPP 強調用藥配
  改後：終身用藥或定期評估。自行停藥可能讓眼壓回升，增加視神經繼續受損的風險。AAO PPP 強調用藥配
  理由：「幾週內」查無原文；保留停藥風險提醒，調整語氣。
  出處：AAO Primary Open-Angle Glaucoma PPP 2025（https://www.aao.org/preferred-practice-pattern/primary-open-angle-glaucoma-ppp）

### glaucoma-treatment-selection

第三輪依 10-16 全文紀錄還原 3 筆（不列）。

- 改前：6%），需要切開式青光眼手術（33 vs 16 眼，依 2025 年勘誤）與白內障手術（95 vs 57 眼）也較多
  改後：6%），需要切開式青光眼手術與白內障手術的眼睛也較多（2025 年有勘誤，細項眼數這裡不列）
  理由：勘誤確實存在（PMID 41110942），但內文擋下打不開，33 vs 16 無法確認；站主若有勘誤原文請核對，同段其他數字也可能受影響。
  出處：Corrigendum. Ophthalmology 2025;132(11):1323-1325（勘誤 Gazzard 2023 LiGHT） 2025（https://pubmed.ncbi.nlm.nih.gov/41110942/）
- 改前：25-31%
  改後：28-31%
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：28-32%
  改後：29-31%
  理由：三支依統合分析修正；另兩支查無個別原文，改用類別範圍。
  出處：van der Valk R, et al. Intraocular pressure-lowering effects of all commonly used glaucoma drugs. Ophthalmology 2005（https://pubmed.ncbi.nlm.nih.gov/15921747/）
- 改前：30-33%
  改後：28-33%
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：25-28%
  改後：25-33%
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：30-33%
  改後：25-33%
  理由：勘誤確實存在（PMID 41110942），但內文擋下打不開，33 vs 16 無法確認；站主若有勘誤原文請核對，同段其他數字也可能受影響。
  出處：Corrigendum. Ophthalmology 2025;132(11):1323-1325（勘誤 Gazzard 2023 LiGHT） 2025（https://pubmed.ncbi.nlm.nih.gov/41110942/）
- 改前：* 上述為國際文獻引用之大致範圍（AAO PPP 2025 整
  改後：* Latanoprost、Travoprost、Bimatoprost 為 van der Valk 2005 統合分析的谷值至峰值；其餘為 AAO PPP 2025 的
  理由：三支依統合分析修正；另兩支查無個別原文，改用類別範圍。
  出處：van der Valk R, et al. Intraocular pressure-lowering effects of all commonly used glaucoma drugs. Ophthalmology 2005（https://pubmed.ncbi.nlm.nih.gov/15921747/）
- 改前：（AAO PPP 2025 整理的前列腺素類整體降幅為 25-33%），個體差異很大
  改後： AAO PPP 2025 的前列腺素類整體範圍（25-33%），個體差異很大
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：🚨 絕對禁忌：開立 β 阻斷劑前必問三題
  改後：🚨 開立 β 阻斷劑前必問三題（
  理由：CONFIRMED：仿單禁忌未列糖尿病，Warnings 為 administered with caution、may mask signs。
  出處：Timoptic in Ocudose (timolol) FDA label. DailyMed 2026（https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=16323b0e-78ae-40e5-be93-04f698dd672b）
- 改前：：開立 β 阻斷劑前必問三題
  改後： 開立 β 阻斷劑前必問三題（前兩題屬禁忌，糖尿病需謹慎）
  理由：CONFIRMED：仿單禁忌未列糖尿病，Warnings 為 administered with caution、may mask signs。
  出處：Timoptic in Ocudose (timolol) FDA label. DailyMed 2026（https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=16323b0e-78ae-40e5-be93-04f698dd672b）
- 改前：有沒有糖尿病？──β 阻斷劑會掩蓋低血糖時的心搏加快，病人可能不察覺低血糖而昏迷
  改後：有沒有糖尿病？──不是禁忌，但需謹慎使用：β 阻斷劑可能掩蓋低血糖的徵兆（如心搏加快），使用降血糖藥物者要特別留意
  理由：CONFIRMED：仿單禁忌未列糖尿病，Warnings 為 administered with caution、may mask signs。
  出處：Timoptic in Ocudose (timolol) FDA label. DailyMed 2026（https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=16323b0e-78ae-40e5-be93-04f698dd672b）
- 改前：膜發炎、加重乾眼、過敏反應。最關鍵也最常被忽略的是：結膜下纖維化會降低日後小樑切除術／MIGS 手術的成功率。
  改後：膜發炎、加重乾眼、過敏反應。另一個需要留意的是：術前使用含 BAK 的藥水，可能是日後小樑切除術失敗的風險因子（AAO PPP）。
  理由：CONFIRMED：PPP 原文 may be a risk factor for surgical failure，且未提 MIGS。
  出處：AAO Primary Open-Angle Glaucoma PPP 2025（https://www.aao.org/preferred-practice-pattern/primary-open-angle-glaucoma-ppp）
- 改前：有許可證；健保不給付（自費）
  改後：有許可證；通常需自費（請洽手術醫院）
  理由：許可證經 TFDA 確認（另有 iStent infinite），但健保特材清單查詢不到，給付面改保守。
  出處：食藥署醫療器材許可證開放資料（InfoId 68） 2026（https://data.fda.gov.tw/opendata/exportDataList.do?method=ExportData&InfoId=68&logType=2）
- 改前：有許可證（2023 年）；健保不給付（自費）
  改後：有許可證（2023 年）；通常需自費（請洽手術醫院）
  理由：許可證經 TFDA 確認（另有 iStent infinite），但健保特材清單查詢不到，給付面改保守。
  出處：食藥署醫療器材許可證開放資料（InfoId 68） 2026（https://data.fda.gov.tw/opendata/exportDataList.do?method=ExportData&InfoId=68&logType=2）
- 改前：灣有許可證的 MIGS 裝置（iStent inject W、XEN、PreserFlo
  改後：灣有許可證的 MIGS 裝置包括 iStent 系列、XEN、PreserFlo
  理由：許可證經 TFDA 確認（另有 iStent infinite），但健保特材清單查詢不到，給付面改保守。
  出處：食藥署醫療器材許可證開放資料（InfoId 68） 2026（https://data.fda.gov.tw/opendata/exportDataList.do?method=ExportData&InfoId=68&logType=2）
- 改前：、XEN、PreserFlo）都不在健保特材給付或自付差額品項中，需全額自費；價格依裝置及醫院而異（具體請洽手術醫院）
  改後：、XEN、PreserFlo；通常需要自費，是否有健保給付或差額負擔與價格，請以手術醫院說明為準
  理由：許可證經 TFDA 確認（另有 iStent infinite），但健保特材清單查詢不到，給付面改保守。
  出處：食藥署醫療器材許可證開放資料（InfoId 68） 2026（https://data.fda.gov.tw/opendata/exportDataList.do?method=ExportData&InfoId=68&logType=2）
- 改前：術後需密切追蹤（前 2 個月每 1-2 週、之後逐漸延長）
  改後：術後早期需密切回診追蹤，之後再逐漸拉長間隔；實際頻率由手術醫師依恢復情況決定
  理由：查無統一時程，院所單張多為每週回診，做法不一。
  出處：AAO Primary Open-Angle Glaucoma PPP 2025（https://www.aao.org/preferred-practice-pattern/primary-open-angle-glaucoma-ppp）
- 改前： vs 小樑切除術 35%），但失敗原因不同：引流管組較常因需要再次青光眼手術而失敗，小樑切除術組較常因低眼壓而失敗
  改後： vs 小樑切除術 35%）；兩組最常見的失敗原因都是眼壓下降不足，此外引流管組因再次青光眼手術而失敗的比例較高，持續低眼壓造成的失敗則只見於小樑切除術組
  理由：CONFIRMED：Table 3 眼壓不足 63% vs 61%、再手術 37% vs 24%、低眼壓 0 vs 13%；原句未錯但遺漏最主要原因。
  出處：Gedde SJ, et al. PTVT Study after 5 Years of Follow-up. Ophthalmology 2022（https://pmc.ncbi.nlm.nih.gov/articles/PMC9691551）
- 改前：短、前房較淺，PACG 比例約為歐美 2-3 倍。實務影響：
  改後：短、前房較淺，PACG 比例明顯高於歐美。實務影響：
  理由：PACD PPP 只說亞洲比例較高，Table 2 研究定義不一，無法定倍數。
  出處：AAO Primary Angle-Closure Disease PPP 2025（https://www.aao.org/education/preferred-practice-pattern/primary-angle-closure-disease-ppp）

### hzo-stromal-keratitis-zeds-lessons

第三輪依 10-16 全文紀錄還原 6 筆（不列）。

- 改前：減少眼壓、白內障副作用
  改後：可能減少眼壓、白內障副作用
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：。低效價類固醇相對於高效價，最大的好處是長期使用造成眼壓上升、白內障
  改後：。低效價類固醇相對於高效價，一般認為長期使用造成眼壓上升、白內障
  理由：EyeWiki 與 CRST 支持風險大致隨效價上升，但也寫比例未明確、未給效價別白內障率，故降為「一般認為、可能」；追蹤提醒保留。
  出處：EyeWiki: Steroid-Induced Glaucoma 2025（https://eyewiki.aao.org/Steroid-Induced_Glaucoma）
- 改前：成眼壓上升、白內障進展的風險較低。但這不代表「換成低效價
  改後：成眼壓上升、白內障進展的風險可能較低。但這不代表「換成低效價
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：長期低效價維持，降低眼壓上升與白內障進展風險
  改後：長期低效價維持，可能降低眼壓上升與白內障進展風險
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：明長期用高效價更能預防復發，高效價的副作用風險卻較高；作者建議治療與長期抑制
  改後：明長期用高效價更能預防復發，而高效價的副作用風險一般認為可能較高；作者建議治療與長期抑制
  理由：EyeWiki 與 CRST 支持風險大致隨效價上升，但也寫比例未明確、未給效價別白內障率，故降為「一般認為、可能」；追蹤提醒保留。
  出處：EyeWiki: Steroid-Induced Glaucoma 2025（https://eyewiki.aao.org/Steroid-Induced_Glaucoma）
- 改前：固醇分為高效價與低效價兩組（依試驗計畫書定義；臨床上 d
  改後：固醇分為高效價與低效價兩組（Jacobs 2026 論文寫依試驗計畫書定義；臨床上 d
  理由：句子依賴無法確認的品項表，改為能確認的敘述。
  出處：Jacobs DS, et al. Stromal Keratitis in the Zoster Eye Disease Study: Lessons Learned. Am J Ophthalmol (abstract; full text paywalled, PMC embargoed) 2026（https://doi.org/10.1016/j.ajo.2026.01.034）
- 改前：用 acyclovir 軟膏不能同時開立口服抗病毒藥）
  改後：用 acyclovir 軟膏原則上不與口服抗病毒藥併用）
  理由：第一輪 finding CONFIRMED：§14.2 條文用「不宜」，括號不應加強成「不能」；英文同步改，且原英文把「製劑」誤窄化為 antivirals。
  出處：全民健康保險藥品給付規定 §14.2 Acyclovir 眼用製劑（115.9.22 更新；本機 _work/nhi/sec14.txt） 2026（https://www.nhi.gov.tw/）
- 改前：率處理，沒有換成高效價；而且低效價長期使用造成眼壓上升與
  改後：率處理，沒有換成高效價；而且一般認為低效價長期使用造成眼壓上升與
  理由：EyeWiki 與 CRST 支持風險大致隨效價上升，但也寫比例未明確、未給效價別白內障率，故降為「一般認為、可能」；追蹤提醒保留。
  出處：EyeWiki: Steroid-Induced Glaucoma 2025（https://eyewiki.aao.org/Steroid-Induced_Glaucoma）
- 改前：用造成眼壓上升與白內障的風險較低。但任何長期使用類固醇者
  改後：用造成眼壓上升與白內障的風險可能較低。但任何長期使用類固醇者
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。

### lacrimal-gland-tumor

第三輪依 10-16 全文紀錄還原 1 筆（不列）。

- 改前： Results）資料庫 1999-2016 年 118 例 LGACC 的分析
  改後： Results）資料庫 118 例 LGACC 的分析
  理由：第一輪 finding CONFIRMED：Liu 摘要寫 1975–2016，Ma 全文確實寫 1999–2016，兩者並陳；英文段（SEER data 1999-2016, n=118）同步改。
  出處：Liu R, et al. Tumori (SEER 18); Ma M, et al. Heliyon 2024 PMC11301145 2023（https://doi.org/10.1177/03008916211070328）
- 改前：iu 2023 Tumori；由 Ma 2024 Heliyon 引用），LGACC 可發生於所有
  改後：iu 2023 Tumori），LGACC 可發生於所有
  理由：第一輪 finding CONFIRMED：Liu 摘要寫 1975–2016，Ma 全文確實寫 1999–2016，兩者並陳；英文段（SEER data 1999-2016, n=118）同步改。
  出處：Liu R, et al. Tumori (SEER 18); Ma M, et al. Heliyon 2024 PMC11301145 2023（https://doi.org/10.1177/03008916211070328）
- 改前： According to SEER data (1999-2016, n=118): median age 
  改後： According to a SEER analysis of 118 LGACC cases (Liu 2023): median age 
  理由：第一輪 finding CONFIRMED：Liu 摘要寫 1975–2016，Ma 全文確實寫 1999–2016，兩者並陳；英文段（SEER data 1999-2016, n=118）同步改。
  出處：Liu R, et al. Tumori (SEER 18); Ma M, et al. Heliyon 2024 PMC11301145 2023（https://doi.org/10.1177/03008916211070328）

### monitoring-myopia-ser-vs-axial-length

- 改前：照明；（4）定期回診追蹤——對學齡兒童一般建議每 6 個月做一次完整眼科檢查（包括驗光與眼軸測量）；（5）與眼科醫師討論個別化
  改後：照明；（4）定期回診追蹤——國健署建議每年至少做 1 次視力檢查；已近視或正在做近視控制的孩子，回診間隔與檢查項目（如驗光、眼軸）請依眼科醫師建議；（5）與眼科醫師討論個別化
  理由：句子無出處；國健署寫每年至少 1 次；IMI 每 6 個月只查到二手摘要且對眼軸頻率說法不一。定期回診提醒保留。
  出處：衛福部／國健署：近視是疾病！國健署推動「護眼123」幫孩子從小存視力 2018（https://www.mohw.gov.tw/fp-16-41061-1.html）
- 改前：90% 的近視兒童：以 SER 為主——眼軸通
  改後：約 90% 的近視眼：以 SER 為主——眼軸通
  理由：原文「≈90% of myopic eyes」且為 heuristic，分母是近視眼不是兒童；「約 90% 的近視眼軸不會超過 26 mm」本句相符不改。
  出處：Clark RA, Wong RK. SER Versus Axial Length for Monitoring Childhood Myopia and Estimating Disease Risk. Am J Ophthalmol (open-access full text) 2026（https://www.ajo.com/article/S0002-9394(26)00125-X/fulltext）
- 改前：、性別、族裔影響的監測指標 10% 進入長眼尾巴（AL 
  改後：、性別、族裔影響的監測指標 約 10% 進入長眼尾巴（AL 
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：巴（AL ≥ 26 mm）的孩子：眼軸成為重點追蹤工具——這
  改後：巴（AL ≥ 26 mm）的近視眼：眼軸成為重點追蹤工具——這
  理由：原文「≈90% of myopic eyes」且為 heuristic，分母是近視眼不是兒童；「約 90% 的近視眼軸不會超過 26 mm」本句相符不改。
  出處：Clark RA, Wong RK. SER Versus Axial Length for Monitoring Childhood Myopia and Estimating Disease Risk. Am J Ophthalmol (open-access full text) 2026（https://www.ajo.com/article/S0002-9394(26)00125-X/fulltext）
- 改前：式策略」而非「捨棄眼軸」。對 10% 進入長眼尾巴（AL
  改後：式策略」而非「捨棄眼軸」。對約 10% 進入長眼尾巴（AL
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：巴（AL ≥ 26 mm）的孩子，眼軸的視網膜風險預測力非常
  改後：巴（AL ≥ 26 mm）的近視眼，眼軸的視網膜風險預測力非常
  理由：原文「≈90% of myopic eyes」且為 heuristic，分母是近視眼不是兒童；「約 90% 的近視眼軸不會超過 26 mm」本句相符不改。
  出處：Clark RA, Wong RK. SER Versus Axial Length for Monitoring Childhood Myopia and Estimating Disease Risk. Am J Ophthalmol (open-access full text) 2026（https://www.ajo.com/article/S0002-9394(26)00125-X/fulltext）

### ophthalmic-trauma-overlooked-burden

第三輪依 10-16 全文紀錄還原 7 筆（不列）。

最終版本沒有留下內容改動。

### osa-amd-systematic-review-2026

第三輪依 10-16 全文紀錄還原 8 筆（不列）。

- 改前：CI 1.13-2.19）；新生血管型 AMD（nAMD
  改後：CI 1.13-2.19）；粗分析中新生血管型 AMD（nAMD
  理由：第一輪 IMPRECISE 複查 CONFIRMED：摘要原文把 1.76、1.95 列在 crude analyses 之下。
  出處：Yaldo et al. Obstructive sleep apnea and risk of AMD: systematic review and meta-analysis. Am J Ophthalmol 285:276-287（摘要） 2026（https://pubmed.ncbi.nlm.nih.gov/41692178/）
- 改前：13-2.19，低證據力）；新生血管型 AMD（neov
  改後：13-2.19，低證據力）；粗分析中新生血管型 AMD（neov
  理由：第一輪 IMPRECISE 複查 CONFIRMED：摘要原文把 1.76、1.95 列在 crude analyses 之下。
  出處：Yaldo et al. Obstructive sleep apnea and risk of AMD: systematic review and meta-analysis. Am J Ophthalmol 285:276-287（摘要） 2026（https://pubmed.ncbi.nlm.nih.gov/41692178/）
- 改前：新生血管型 nAMD OR 1.76
  改後：粗分析 nAMD OR 1.76
  理由：第一輪 IMPRECISE 複查 CONFIRMED：摘要原文把 1.76、1.95 列在 crude analyses 之下。
  出處：Yaldo et al. Obstructive sleep apnea and risk of AMD: systematic review and meta-analysis. Am J Ophthalmol 285:276-287（摘要） 2026（https://pubmed.ncbi.nlm.nih.gov/41692178/）
- 改前：非新生血管型 OR 1.95
  改後：粗分析 非新生血管型 OR 1.95
  理由：第一輪 IMPRECISE 複查 CONFIRMED：摘要原文把 1.76、1.95 列在 crude analyses 之下。
  出處：Yaldo et al. Obstructive sleep apnea and risk of AMD: systematic review and meta-analysis. Am J Ophthalmol 285:276-287（摘要） 2026（https://pubmed.ncbi.nlm.nih.gov/41692178/）
- 改前：時間風險 aHR 1.66、新生血管型 AMD（nAMD
  改後：時間風險 aHR 1.66、粗分析的新生血管型 AMD（nAMD
  理由：第一輪 IMPRECISE 複查 CONFIRMED：摘要原文把 1.76、1.95 列在 crude analyses 之下。
  出處：Yaldo et al. Obstructive sleep apnea and risk of AMD: systematic review and meta-analysis. Am J Ophthalmol 285:276-287（摘要） 2026（https://pubmed.ncbi.nlm.nih.gov/41692178/）
- 改前：A：兩種都增加，且濕性與乾性風險
  改後：A：在未調整混雜因子的粗分析中，兩種都增加，且濕性與乾性增加
  理由：第一輪 IMPRECISE 複查 CONFIRMED：摘要原文把 1.76、1.95 列在 crude analyses 之下。
  出處：Yaldo et al. Obstructive sleep apnea and risk of AMD: systematic review and meta-analysis. Am J Ophthalmol 285:276-287（摘要） 2026（https://pubmed.ncbi.nlm.nih.gov/41692178/）
- 改前：A：兩種都增加，且濕性與乾性風險增加幅度相近。新生血管型 A
  改後：中，兩種都增加，且濕性與乾性增加幅度相近。新生血管型 A
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：：（1）糖尿病視網膜病變——間歇缺氧惡化視網膜微血管病；（2）非動脈炎性前部缺血性
  改後：：（1）糖尿病視網膜病變——未調整的分析有相關，但調整混雜因子後不明顯，關聯仍待釐清；（2）非動脈炎性前部缺血性
  理由：2026 整合分析：未調整 OR 2.41，調整後 1.03（0.64-1.66）。Bulloch 2024 也未涵蓋 DR。已加入參考文獻。
  出處：Abdelaal et al. Bidirectional association between OSA and diabetic retinopathy. Acta Diabetol 2026（https://doi.org/10.1007/s00592-026-02732-2）
- 改前：athy, NAION）——尤其凌晨醒來時發現視野缺損；（3）中心性漿液性脈絡膜視
  改後：athy, NAION）——常在睡醒時發現視力變差；（3）中心性漿液性脈絡膜視
  理由：Bulloch：NAION OR 3.98、FES 3.68、KC 1.87、青光眼 1.49 有相關；CSR 2.28（0.65-7.97）跨 1。機轉補述與「尤其 NTG」未確認。
  出處：Bulloch et al. Ocular manifestations of OSA: systematic review and meta-analysis. Graefes Arch 262:19-32 2024（https://pmc.ncbi.nlm.nih.gov/articles/PMC10806133/）
- 改前：retinopathy）——壓力與血流相關；（4）青光眼——尤其正常眼壓性青光眼；（5）角膜結構異常如
  改後：retinopathy）——整合分析的信賴區間仍跨 1，證據較不確定；（4）青光眼；（5）角膜結構異常如
  理由：Bulloch：NAION OR 3.98、FES 3.68、KC 1.87、青光眼 1.49 有相關；CSR 2.28（0.65-7.97）跨 1。機轉補述與「尤其 NTG」未確認。
  出處：Bulloch et al. Ocular manifestations of OSA: systematic review and meta-analysis. Graefes Arch 262:19-32 2024（https://pmc.ncbi.nlm.nih.gov/articles/PMC10806133/）
- 改前：濕性與乾性 AMD 都受影響：nAMD OR 1.76、非
  改後：濕性與乾性 AMD 都可能受影響：粗分析（未調整混雜因子）nAMD OR 1.76、非
  理由：第一輪 IMPRECISE 複查 CONFIRMED：摘要原文把 1.76、1.95 列在 crude analyses 之下。
  出處：Yaldo et al. Obstructive sleep apnea and risk of AMD: systematic review and meta-analysis. Am J Ophthalmol 285:276-287（摘要） 2026（https://pubmed.ncbi.nlm.nih.gov/41692178/）
- 改前：非新生血管型 OR 1.95；風險增加幅度相近
  改後：非新生血管型 OR 1.95，幅度相近；分型的時間風險分析則未達顯著
  理由：第一輪 IMPRECISE 複查 CONFIRMED：摘要原文把 1.76、1.95 列在 crude analyses 之下。
  出處：Yaldo et al. Obstructive sleep apnea and risk of AMD: systematic review and meta-analysis. Am J Ophthalmol 285:276-287（摘要） 2026（https://pubmed.ncbi.nlm.nih.gov/41692178/）
- 改前：SA 是「多系統疾病」：眼科亦與糖尿病視網膜病變、NAION、中漿、青光眼、圓錐角膜、眼瞼鬆弛症候群相關
  改後：SA 是「多系統疾病」：眼科研究也報告與 NAION、眼瞼鬆弛症候群、圓錐角膜、青光眼等相關；與糖尿病視網膜病變、中漿的關聯較不確定
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：這條機轉鏈也解釋了為什麼 OSA 不只與 AMD 有關，更與糖尿病視網膜病變、非動脈炎性前部缺血性視神經病
  改後：這條機轉鏈也可能有助於理解，為什麼研究會報告 OSA 與 AMD 以外的眼疾有關（如非動脈炎性前部缺血性視神經病
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：動脈炎性前部缺血性視神經病變（NAION）、中心性漿液性脈絡膜視網膜病變（central serous chorioretinopathy）、青光眼等共享相同的致病基礎。OSA 是一種「全身性的退化加速器」，不專門針對某一隻眼睛或某一條神經。
  改後：動脈炎性前部缺血性視神經病變 NAION、青光眼）；但這些關聯多來自觀察性研究，是否真有共同致病基礎仍待確認。
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：（無）
  改後：Abdelaal A, Mahmoud YA, Alsouri W, et al. Bidirectional association between obstructive sleep apnea and diabetic retinopathy: a severity-stratified systematic review and meta-analysis with GRADE assessment. Acta Diabetol. 2026. doi:10.1007/s00592-026-02732-2
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。

### pediatric-high-myopia-maculopathy-progression

- 改前：點 0.325 mm/年）；病理性近視為強預測因子（OR 6.26）。","datePubli
  改後：點 0.325 mm/年）；惡化組基線已有瀰漫性萎縮（C2）的比例較高（37.1% vs 5.2%）。","datePubli
  理由：OR 6.26 在摘要與可讀全文都看不到（Table 位於付費段）。站主有全文可補回。
  出處：Jiang et al. 2026 全文前段（方法、Results 首段、Table 1；轉載頁，後段付費看不到） 2026（https://entokey.com/short-term-axial-length-changes-predict-progression-of-myopic-maculopathy-in-pediatric-high-myopia/）
- 改前：每年增加 0.325 mm。病理性近視（PM）本身是強烈的預測因子（惡化的勝算比約 6.3，OR 6.26）。白話：高度近視兒童，前兩
  改後：每年增加 0.325 mm。惡化組基線已有瀰漫性萎縮（C2）的比例也明顯較高（37.1% vs 5.2%）。白話：高度近視兒童，前兩
  理由：OR 6.26 在摘要與可讀全文都看不到（Table 位於付費段）。站主有全文可補回。
  出處：Jiang et al. 2026 全文前段（方法、Results 首段、Table 1；轉載頁，後段付費看不到） 2026（https://entokey.com/short-term-axial-length-changes-predict-progression-of-myopic-maculopathy-in-pediatric-high-myopia/）
- 改前：已有萎縮者幾乎都惡化：C2 達 77%、C3 達 100%
  改後：基線 C2 眼約 77% 惡化（36／47 眼）
  理由：Table 1 算得 C2 36/47=76.6%，數字相符；但 C3 基線只有 1 眼，「100%」與「幾乎都惡化」誇大，改掉。
  出處：Jiang et al. 2026 全文前段（方法、Results 首段、Table 1；轉載頁，後段付費看不到） 2026（https://entokey.com/short-term-axial-length-changes-predict-progression-of-myopic-maculopathy-in-pediatric-high-myopia/）
- 改前：病理性近視（PM）本身惡化的勝算比約 6.3（OR 6.26）
  改後：模型已校正年齡與病理性近視（PM）
  理由：OR 6.26 在摘要與可讀全文都看不到（Table 位於付費段）。站主有全文可補回。
  出處：Jiang et al. 2026 全文前段（方法、Results 首段、Table 1；轉載頁，後段付費看不到） 2026（https://entokey.com/short-term-axial-length-changes-predict-progression-of-myopic-maculopathy-in-pediatric-high-myopia/）
- 改前：3% 眼睛往更嚴重階段移動，已有萎縮者（C2、C3）幾乎都會惡化。② 預測模型：只用基線眼軸
  改後：3% 眼睛往更嚴重階段移動，基線已有瀰漫性萎縮（C2）的眼睛約 77% 惡化（47 眼中 36 眼）。② 預測模型：只用基線眼軸
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：增加 ≥ 0.325 mm；病理性近視本身惡化的勝算比約 6.3（OR 6.26）。③ 三個重點：（綠）高度近
  改後：增加 ≥ 0.325 mm；模型已校正年齡與病理性近視。③ 三個重點：（綠）高度近
  理由：OR 6.26 在摘要與可讀全文都看不到（Table 位於付費段）。站主有全文可補回。
  出處：Jiang et al. 2026 全文前段（方法、Results 首段、Table 1；轉載頁，後段付費看不到） 2026（https://entokey.com/short-term-axial-length-changes-predict-progression-of-myopic-maculopathy-in-pediatric-high-myopia/）
- 改前：s 26.7 mm）；（4）已經是病理性近視（PM）：惡化的勝算比約 6.3（OR 6.26）；（5）已經出現漆裂紋（lacquer 
  改後：s 26.7 mm）；（4）基線已有萎縮性變化：基線瀰漫性萎縮（C2）的眼睛約 77%（47 眼中 36 眼）在 8 年內惡化；（5）追蹤中出現漆裂紋（lacquer 
  理由：OR 6.26 在摘要與可讀全文都看不到（Table 位於付費段）。站主有全文可補回。
  出處：Jiang et al. 2026 全文前段（方法、Results 首段、Table 1；轉載頁，後段付費看不到） 2026（https://entokey.com/short-term-axial-length-changes-predict-progression-of-myopic-maculopathy-in-pediatric-high-myopia/）
- 改前：cquer cracks）：這群孩子更年輕、度數極深（平均 −13.7 D）、眼軸長得更快。符合越多項，越需要積極控制
  改後：cquer cracks）：8 年時有 15 眼出現，是需要密切追蹤的病灶。符合越多項，越需要積極控制
  理由：−13.7 D 等細項在可讀原文找不到；Table 1 只確認 8 年時 15 眼（基線 0 眼），漆裂紋是追蹤中出現，不是基線特徵。
  出處：Jiang et al. 2026 全文前段（方法、Results 首段、Table 1；轉載頁，後段付費看不到） 2026（https://entokey.com/short-term-axial-length-changes-predict-progression-of-myopic-maculopathy-in-pediatric-high-myopia/）
- 改前：還特別排除了使用角膜塑型片、低濃度阿托品、重複低能量紅光治療的
  改後：還特別排除了使用角膜塑型片、離焦設計鏡片、阿托品、重複低能量紅光治療的
  理由：第一輪 IMPRECISE 複查 CONFIRMED：方法段寫 worn defocus or orthokeratology lenses……received atropine treatment or RLRL；原文未限定低濃度，一併改為阿托品。
  出處：Jiang et al. 2026 全文前段（方法、Results 首段、Table 1；轉載頁，後段付費看不到） 2026（https://entokey.com/short-term-axial-length-changes-predict-progression-of-myopic-maculopathy-in-pediatric-high-myopia/）
- 改前：可能發展成病理性近視。本研究中，發展出漆裂紋的孩子在 8 年追蹤時平均才約 20 歲。所以重點是：高度近視兒童的
  改後：可能發展成病理性近視。本研究 8 年追蹤時，受試者平均約 22 歲，已有 15 眼出現漆裂紋。所以重點是：高度近視兒童的
  理由：「約 20 歲」無法確認；全體 21.99 歲與 15 眼見 Results／Table 1。
  出處：Jiang et al. 2026 全文前段（方法、Results 首段、Table 1；轉載頁，後段付費看不到） 2026（https://entokey.com/short-term-axial-length-changes-predict-progression-of-myopic-maculopathy-in-pediatric-high-myopia/）
- 改前：年紀小就高度近視、度數極深、已是病理性近視（勝算比約 6.3，OR 6.26）、已有漆裂紋 這是「預測」研究、不
  改後：年紀小就高度近視、度數極深、基線已有瀰漫性萎縮（C2，約 77% 惡化）、出現漆裂紋 這是「預測」研究、不
  理由：OR 6.26 在摘要與可讀全文都看不到（Table 位於付費段）。站主有全文可補回。
  出處：Jiang et al. 2026 全文前段（方法、Results 首段、Table 1；轉載頁，後段付費看不到） 2026（https://entokey.com/short-term-axial-length-changes-predict-progression-of-myopic-maculopathy-in-pediatric-high-myopia/）
- 改前：排除使用阿托品／角膜塑型片／紅光者；沒有說哪種控制法最好
  改後：排除使用阿托品／角膜塑型片／離焦鏡片／紅光者；沒有說哪種控制法最好
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：自然病程，使用過角膜塑型片、低濃度阿托品、重複低能量紅光治療、
  改後：自然病程，使用過角膜塑型片、離焦設計鏡片、阿托品、重複低能量紅光治療、
  理由：第一輪 IMPRECISE 複查 CONFIRMED：方法段寫 worn defocus or orthokeratology lenses……received atropine treatment or RLRL；原文未限定低濃度，一併改為阿托品。
  出處：Jiang et al. 2026 全文前段（方法、Results 首段、Table 1；轉載頁，後段付費看不到） 2026（https://entokey.com/short-term-axial-length-changes-predict-progression-of-myopic-maculopathy-in-pediatric-high-myopia/）
- 改前：008），代表模型內部穩定。基線眼軸（勝算比 OR 1.
  改後：008），代表模型內部穩定。在校正年齡與病理性近視後，基線眼軸（勝算比 OR 1.
  理由：摘要有 OR 1.62 但未寫單位；與 OR 6.26 同句一併處理。
  出處：Jiang et al. Short-Term Axial Length Changes Predict Progression of Myopic Maculopathy. Am J Ophthalmol 287:188-197（摘要） 2026（https://pubmed.ncbi.nlm.nih.gov/41871728/）
- 改前：軸（勝算比 OR 1.62）、2 年眼軸變化率（OR 1.
  改後：軸（勝算比 OR 1.62）與 2 年眼軸變化率（OR 1.
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：年眼軸變化率（OR 1.62，每 0.1 mm/年）、病理性近視（OR 6.26）都是顯著預測因子。
  改後：年眼軸變化率（OR 1.62）都是顯著預測因子。
  理由：摘要有 OR 1.62 但未寫單位；與 OR 6.26 同句一併處理。
  出處：Jiang et al. Short-Term Axial Length Changes Predict Progression of Myopic Maculopathy. Am J Ophthalmol 287:188-197（摘要） 2026（https://pubmed.ncbi.nlm.nih.gov/41871728/）
- 改前：未評估後鞏膜葡萄腫：用 45° 眼底照可能漏掉後極外的葡萄腫，可能低估病變實際盛行率。
  改後：眼底照範圍有限：研究以黃斑部與視神經為中心拍攝眼底照，拍攝範圍外的變化（例如後鞏膜葡萄腫）可能無法完整評估。
  理由：可讀方法段只寫 centered on macula and optic disc，45° 與論文自述的葡萄腫限制未見。
  出處：Jiang et al. 2026 全文前段（方法、Results 首段、Table 1；轉載頁，後段付費看不到） 2026（https://entokey.com/short-term-axial-length-changes-predict-progression-of-myopic-maculopathy-in-pediatric-high-myopia/）
- 改前：流失（最終納入約 36%）；不過參與者與流失者基線特徵無顯著差異，選擇偏差應有限。
  改後：流失（最終納入約 36%）；參與者與未納入者的基線特徵除性別外無顯著差異，但選擇偏差仍無法完全排除。
  理由：複查時順帶發現：Results 寫 no significant differences……except sex（清單外，列出供檢查）。
  出處：Jiang et al. 2026 全文前段（方法、Results 首段、Table 1；轉載頁，後段付費看不到） 2026（https://entokey.com/short-term-axial-length-changes-predict-progression-of-myopic-maculopathy-in-pediatric-high-myopia/）
- 改前：D、眼軸 27.7 mm）、已經是病理性近視（惡化的勝算比約 6.3，OR 6.26），以及已經出現漆裂紋。符合越多項，越需
  改後：D、眼軸 27.7 mm）、基線已有瀰漫性萎縮（約 77% 惡化），以及追蹤中出現漆裂紋。符合越多項，越需
  理由：OR 6.26 在摘要與可讀全文都看不到（Table 位於付費段）。站主有全文可補回。
  出處：Jiang et al. 2026 全文前段（方法、Results 首段、Table 1；轉載頁，後段付費看不到） 2026（https://entokey.com/short-term-axial-length-changes-predict-progression-of-myopic-maculopathy-in-pediatric-high-myopia/）
- 改前：還特別排除了使用角膜塑型片、低濃度阿托品與重複低能量紅光治療的
  改後：還特別排除了使用角膜塑型片、離焦設計鏡片、阿托品與重複低能量紅光治療的
  理由：第一輪 IMPRECISE 複查 CONFIRMED：方法段寫 worn defocus or orthokeratology lenses……received atropine treatment or RLRL；原文未限定低濃度，一併改為阿托品。
  出處：Jiang et al. 2026 全文前段（方法、Results 首段、Table 1；轉載頁，後段付費看不到） 2026（https://entokey.com/short-term-axial-length-changes-predict-progression-of-myopic-maculopathy-in-pediatric-high-myopia/）

### pediatric-myopia-control

第三輪依 10-16 全文紀錄還原 2 筆（不列）。

- 改前：c refraction），通常用 1% Cyclopentolate 點兩次（間隔 5 分鐘），第一滴後 30–45 分鐘、睫狀肌充分放鬆後再驗光（IMI 2019 建議；藥品仿單記載最大睫狀肌麻痺出現在點藥後 25–75 分鐘）。如果散瞳前後度數差很多 →
  改後：c refraction），也就是點睫狀肌麻痺眼藥水，等睫狀肌充分放鬆後再驗光；藥物種類與等待時間由眼科醫師決定。如果散瞳前後度數差很多 →
  理由：IMI 全文被 Cloudflare 擋；WCO 文件寫 tropicamide or cyclopentolate。另提醒站主：TFDA 資料集內 cyclopentolate 眼用許可證全部已註銷，請確認台灣現況是否要再調整這句。已加參考文獻。
  出處：World Council of Optometry. Myopia Moment: What to Measure 2021（https://myopia.worldcouncilofoptometry.info/wp-content/uploads/2021/09/Myopia-Moment_What-To-Measure.pdf）
- 改前：0.05%~67%畏光（40%）、近距離模糊（20%） 0.025%~43%畏光（
  改後：0.05%~67%畏光（第 2 週 31%、1 年時 8%；安慰劑 13%、4%）；調節力下降約 2 D，近距離視力未受明顯影響 0.025%~43%畏光（
  理由：最重要改動：原始全文 Table 3 與文中 40%／20% 不符（31.2→7.8、18.5→6.6、5.5→2.1、安慰劑 12.6→4.3）；near vision 未受明顯影響（P=0.25），找不到近距離模糊 20%。
  出處：Yam et al. LAMP Study. Ophthalmology 126:113-124（全文 Table 3、摘要） 2019（https://static1.squarespace.com/static/5d9741a56b45d153f8f5f753/t/5da35a00ae38d1604198d75d/1570986498529/PIIS0161642018302859.pdf）
- 改前： 0.025%~43%畏光（20%） 0.01%~27%幾乎
  改後： 0.025%~43%畏光（第 2 週 19%、1 年時 7%） 0.01%~27%畏光
  理由：最重要改動：原始全文 Table 3 與文中 40%／20% 不符（31.2→7.8、18.5→6.6、5.5→2.1、安慰劑 12.6→4.3）；near vision 未受明顯影響（P=0.25），找不到近距離模糊 20%。
  出處：Yam et al. LAMP Study. Ophthalmology 126:113-124（全文 Table 3、摘要） 2019（https://static1.squarespace.com/static/5d9741a56b45d153f8f5f753/t/5da35a00ae38d1604198d75d/1570986498529/PIIS0161642018302859.pdf）
- 改前：20%） 0.01%~27%幾乎無
  改後： 7%） 0.01%~27%畏光（第 2 週 6%、1 年時 2%）
  理由：最重要改動：原始全文 Table 3 與文中 40%／20% 不符（31.2→7.8、18.5→6.6、5.5→2.1、安慰劑 12.6→4.3）；near vision 未受明顯影響（P=0.25），找不到近距離模糊 20%。
  出處：Yam et al. LAMP Study. Ophthalmology 126:113-124（全文 Table 3、摘要） 2019（https://static1.squarespace.com/static/5d9741a56b45d153f8f5f753/t/5da35a00ae38d1604198d75d/1570986498529/PIIS0161642018302859.pdf）
- 改前：c refraction, typically two drops of 1% cyclopentolate 5 minutes apart, refracting 30–45 minutes after the first drop once the cili
  改後：c refraction, meaning cycloplegic drops are used and refraction is done once the cili
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：le has relaxed (IMI 2019; the drug label states maximal cycloplegia within 25–75 minutes). If pre/post-
  改後：le has relaxed; your eye doctor decides the drug and the waiting time. If pre/post-
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：%Photophobia (40%), near blur (20%) 0.025%~43%Pho
  改後：%Photophobia (31% at 2 weeks, 8% at 1 year; placebo 13%, 4%); accommodation down about 2 D, near vision not significantly affected 0.025%~43%Pho
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：%Photophobia (20%) 0.01%~27%Negligible
  改後：%Photophobia (19% at 2 weeks, 7% at 1 year) 0.01%~27%Photophobia (6% at 2 weeks, 2% at 1 year)
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。

### pterygium-surgery-fixation-methods-2026-nma

第三輪依 10-16 全文紀錄還原 6 筆（不列）。

- 改前：差（肉芽腫風險最高）；自體血穩定性最差（位移、裂開風險顯著高於 Vi
  改後：差（肉芽腫風險最高）；自體血位移、裂開風險顯著高於 Vi
  理由：摘要只有 FG vs 絲線 0.11；排名、網絡估計與作者討論無法確認。目錄同步改；en 鏡像由 build 產生。
  出處：Terres et al. Conjunctival Autograft Fixation in Primary Pterygium Surgery: NMA. Am J Ophthalmol 285:240-253（摘要；全文付費打不開） 2026（https://pubmed.ncbi.nlm.nih.gov/41679367/）
- 改前：開風險顯著高於 Vicryl）。③ 三個臨床選擇方向：（綠
  改後：開風險顯著高於 Vicryl。③ 三個臨床選擇方向：（綠
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：發風險顯著較低。復發時機：多在術後 6-12 個月內發生；超過 1 年仍未復發者，長
  改後：發風險顯著較低。復發時機：多數發生在術後第一年內；超過 1 年仍未復發者，長
  理由：EyeWiki：97% of all recurrences occur in the first year；6-12 個月的窗口未確認（清單外，同句處理）。
  出處：EyeWiki. Pterygium（Surgical follow up：97% 復發在第一年內） 2026（https://eyewiki.org/Pterygium）
- 改前： 年仍未復發者，長期穩定機率高。復發影響因子：年輕患者（
  改後： 年仍未復發者，長期穩定機率較高。復發影響因子：文獻提到年輕患者（有研究指 45 歲以下風險較高）、術後發炎控制不佳、手術因素（如切除不完整、移植片過小或殘留 Tenon 組織、移植片退縮）都可能增加復發風險；持續紫外線曝露也可能有影響，個別風險請與醫師討論。
  理由：回顧文寫 under the age of 45（3.5 倍），不是 40 歲；未見「類固醇停太早」。已加參考文獻。
  出處：Ghiasian et al. Recurrent pterygium: a review. J Curr Ophthalmol 33(4):367-378 2021（https://pmc.ncbi.nlm.nih.gov/articles/PMC8772501/）
- 改前：與白內障風險。• 定期回診：術後 1 週、1 個月、3 個月、6 個月、12 個月是常見追蹤點。復發紅旗：以下情況請當天回
  改後：與白內障風險。• 定期回診：回診時間依醫師安排，第一年內應定期追蹤（多數復發發生在第一年內）。復發紅旗：以下情況請當天回
  理由：具體時點找不到出處；保留回診提醒、調整語氣。
  出處：EyeWiki. Pterygium（Surgical follow up：97% 復發在第一年內） 2026（https://eyewiki.org/Pterygium）
- 改前：（無）
  改後：Ghiasian L, Samavat B, Hadi Y, Arbab M, Abolfathzadeh N. Recurrent pterygium: a review. J Curr Ophthalmol. 2021;33(4):367–378. doi:10.4103/joco.joco_153_20 Khan N, Ahmad M, Baseer A, Kundi NK. To compare the recurrence rate of pterygium excision with bare-sclera, free conjunctival auto graft and amniotic membrane grafts. Pak J Ophthalmol. 2010;26(3).
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：指示逐步減量、不要自行停藥；常見追蹤點為術後一週、一個月、三個月、六個月與十二個月。若出現術眼突然劇痛或視力下
  改後：指示逐步減量、不要自行停藥；回診時間依醫師安排，第一年內應定期追蹤。若出現術眼突然劇痛或視力下
  理由：具體時點找不到出處；保留回診提醒、調整語氣。
  出處：EyeWiki. Pterygium（Surgical follow up：97% 復發在第一年內） 2026（https://eyewiki.org/Pterygium）

### red-eye-conjunctivitis

- 改前：單側嚴重眼紅，合併強烈異物感
  改後：單側眼紅明顯，且異物感強烈或持續（可能需要檢查角膜）
  理由：PPP 與 AAO 都未列此項；AAO 把異物感列為一般結膜炎症狀，AFP 把異物感列為角膜炎表現，就醫提醒保留、語氣調整
  出處：Diagnosis and management of red eye in primary care. Am Fam Physician 2010（https://www.aafp.org/pubs/afp/issues/2010/0115/p137.html）

### thyroid-eye-disease

- 改前： JCEM 顯示：TRAb 越高，眼疾發生率與嚴重度越高、反應越差。
  改後： JCEM 顯示：TRAb 是眼疾的獨立危險因子，數值越高，病程通常越嚴重，也有助於預測預後。
  理由：摘要談風險、嚴重度與預後，未提治療反應
  出處：Eckstein AK, et al. J Clin Endocrinol Metab 2006（https://doi.org/10.1210/jc.2005-2813）
- 改前：06 顯示 TRAb 越高，眼疾越嚴重、反應越差；亦可作為治療反應的追蹤。
  改後：06 顯示 TRAb 越高，病程通常越嚴重；追蹤其數值也有助於評估部分病人的預後。
  理由：摘要結論：追蹤 TBII 可在約半數病人評估預後，未提治療反應
  出處：Eckstein AK, et al. J Clin Endocrinol Metab 2006（https://doi.org/10.1210/jc.2005-2813）
- 改前：標準 IVMP 4.5 g。組合療法第 24 週反應率 71% vs IVMP 單獨 53%（Ka
  改後：標準 IVMP 4.5 g。MINGO 試驗預設的第 12 週主要結果，兩組未達統計差異（63% vs 49%）；事後分析（post-hoc）第 24 週反應率為組合療法 71%、IVMP 單獨 53%（Ka
  理由：摘要：第 24 週為 post-hoc；第 12 週 63% vs 49%，p=0.089。finding CONFIRMED
  出處：Kahaly GJ, et al. MINGO. Lancet Diabetes Endocrinol 2018（https://doi.org/10.1016/S2213-8587(18)30020-2）
- 改前：禁忌：懷孕、年齡 < 18 歲、已知 IBD。
  改後：注意事項：美國仿單未列禁忌症，但可能傷害胎兒（用藥前、治療期間及停藥後 6 個月需避孕）、可能使發炎性腸道疾病（IBD）惡化；未滿 18 歲的安全性與療效尚未確立。
  理由：仿單 4 寫 None；IBD 為 5.2 警語；8.3 避孕至停藥後 6 個月；8.4 兒童未確立。finding CONFIRMED
  出處：TEPEZZA prescribing information, DailyMed (revised 9/2026) 2026（https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=3e6c54a1-cefd-4a5b-a855-ab9f268b6cce）
- 改前：週內完成，特別適合複視為主。禁忌：年齡 < 35 歲、糖尿病或高血壓視網膜病變。
  改後：週內完成，特別適合複視為主。應避免用於：年齡 < 35 歲（理論上的遠期腫瘤風險）、糖尿病或高血壓視網膜病變。
  理由：EUGOGO 寫 should be avoided，ATA/ETA 寫 relatively contraindicated，都不是絕對禁忌
  出處：Bartalena L, et al. 2021 EUGOGO guidelines, Eur J Endocrinol (Wayback snapshot; publisher site returned 525) 2021（https://web.archive.org/web/2024/https://eje.bioscientifica.com/view/journals/eje/185/4/EJE-21-0479.xml）

### toric-iol-astigmatism-cataract-review

第三輪依 10-16 全文紀錄還原 1 筆（不列）。

- 改前：③ 殘餘散光 ≤ 0.5 D 達成率
  改後：③ 殘餘散光 < 0.5 D 達成率
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前： 約 70% 達成殘餘散光 ≤ 0.5 D，LRI 約 5
  改後： 約 70% 達成殘餘散光 < 0.5 D，LRI 約 5
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：A：以「術後殘餘散光 ≤ 0.5 D 的達成率」來說
  改後：A：以「術後殘餘散光 < 0.5 D 的達成率」來說
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：ric 組約 70% 達成 ≤ 0.5 D 殘餘散光，LR
  改後：ric 組約 70% 達成 < 0.5 D 殘餘散光，LR
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：晚處理，囊袋纖維化後較困難。多數重置手術安全性良好，並無嚴重併發症報告。減少轉位的方法：選對 IO
  改後：晚處理，囊袋纖維化後較困難。重置手術仍可能有併發症，細節請與醫師討論。減少轉位的方法：選對 IO
  理由：同上，安全性宣稱無法確認
  出處：Oshika T, et al. Ophthalmology 2018（https://doi.org/10.1016/j.ophtha.2017.07.004）
- 改前：率與一般單焦 IOL 相近，輕度負性光現象術後初期約 15–20% 病人會抱怨，多在 3–6 個月內自行緩解，長期持續者僅 0.5–2%。多焦 toric IOL 
  改後：率與一般單焦 IOL 相近，負性光現象術後最多約 26% 病人會出現，1 年後仍持續者約 0.13–3%（Pusnik 等 2022）。多焦 toric IOL 
  理由：Pusnik 摘要與 Verstraaten 表 3 都是最高 26%、長期 0.1–3%；3–6 個月緩解查無出處。finding CONFIRMED
  出處：Pusnik A, et al. Dysphotopsias after cataract surgery. Life (Basel) 2022（https://doi.org/10.3390/life13010053）
- 改前：光（PCA）：忽略 PCA 是「術後殘餘散光」的最大來源——WTR 眼會被高估 ~0.5 D，ATR 眼會被低估 ~0.3 D
  改後：光（PCA）：忽略 PCA 可能造成術後殘餘散光誤差——PCA 平均在 WTR 眼約 0.5 D、ATR 眼約 0.3 D，只看角膜前表面會傾向高估 WTR、低估 ATR 眼的散光
  理由：Verstraaten 有 0.5／0.3 D 與高估／低估方向，但沒有「最大來源」
  出處：Verstraaten JWH, et al. Am J Ophthalmol 2026（https://www.ajo.com/article/S0002-9394(26)00107-8/fulltext）
- 改前：ulafia-Koch）——這也是「術後殘餘散光」誤差的最大來源。
  改後：ulafia-Koch）——忽略 PCA 是術後殘餘散光誤差的重要來源之一。
  理由：「最大來源」查無出處
  出處：Verstraaten JWH, et al. Am J Ophthalmol 2026（https://www.ajo.com/article/S0002-9394(26)00107-8/fulltext）
- 改前：忽略 PCA 是術後殘餘散光最大來源
  改後：忽略 PCA 是術後殘餘散光誤差的重要來源之一
  理由：「最大來源」查無出處
  出處：Verstraaten JWH, et al. Am J Ophthalmol 2026（https://www.ajo.com/article/S0002-9394(26)00107-8/fulltext）
- 改前：餘散光不會是零，70% 達 ≤ 0.5 D 不代表 100
  改後：餘散光不會是零，70% 達 < 0.5 D 不代表 100
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：殘餘屈光散光 ≤ 0.5 D 比例：tori
  改後：殘餘屈光散光 < 0.5 D 比例：tori
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：ric IOL 的光暈／眩光率顯著較高（約 50%，Visser 等 2011）
  改後：ric IOL 的光暈／眩光較常見：Visser 等 2011 
  理由：摘要寫 moderate，單組無對照，「顯著較高」「多為輕度」都不成立。finding CONFIRMED
  出處：Visser N, et al. J Cataract Refract Surg 2011（https://doi.org/10.1016/j.jcrs.2011.05.041）
- 改前：，Visser 等 2011），但多為輕度
  改後：：Visser 等 2011 年研究（25 位病人、無對照組）約 50% 病人表示有中度眩光、光暈或星芒
  理由：摘要寫 moderate，單組無對照，「顯著較高」「多為輕度」都不成立。finding CONFIRMED
  出處：Visser N, et al. J Cataract Refract Surg 2011（https://doi.org/10.1016/j.jcrs.2011.05.041）
- 改前：1.0–8.0 D（部分品牌可達 12.0 D）
  改後：約 1.0 D 起；常見品牌多至 6.0 D，部分品牌可達 12.0 D 
  理由：Verstraaten IOL 表列 1.0–6.0、1.5–6.0 D 與 1.0–12.0 D，查無 8.0 D
  出處：Verstraaten JWH, et al. Am J Ophthalmol 2026（https://www.ajo.com/article/S0002-9394(26)00107-8/fulltext）
- 改前：（部分品牌可達 12.0 D） 0.5–2.5 D（散光更高時準確性下降） 0
  改後：，部分品牌可達 12.0 D 低度散光（散光更高時準確性下降） 低
  理由：Verstraaten 只寫 LRI 可處理低度散光、高度較不準，查無 0.5–2.5 D
  出處：Verstraaten JWH, et al. Am J Ophthalmol 2026（https://www.ajo.com/article/S0002-9394(26)00107-8/fulltext）
- 改前：D（散光更高時準確性下降） 0.75–3.5 D
  改後：光（散光更高時準確性下降） 低至中度散光（範圍依研究而異）
  理由：查無 0.75–3.5 D 出處，拿掉數字
  出處：Verstraaten JWH, et al. Am J Ophthalmol 2026（https://www.ajo.com/article/S0002-9394(26)00107-8/fulltext）
- 改前：殘餘散光 ≤ 0.5 D 比例
  改後：殘餘散光 < 0.5 D 比例
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：23 兩篇統合分析都沒有報 ≤ 0.5 D 的比例。Yen
  改後：23 兩篇統合分析都沒有報 < 0.5 D 的比例。Yen
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：平均誤差 ~3–5°；最便宜，但精度受墨水擴散、病
  改後：最便宜，但精度受墨水擴散、病
  理由：查無 3–5° 出處；Yao 2024 確認手動誤差較大
  出處：Yao L, et al. Semin Ophthalmol 2024（https://doi.org/10.1080/08820538.2023.2231575）
- 改前：擴散、病人擺位、醫師手感影響
  改後：擴散、病人擺位、醫師手感影響；軸位誤差比影像導航大
  理由：查無 3–5° 出處；Yao 2024 確認手動誤差較大
  出處：Yao L, et al. Semin Ophthalmol 2024（https://doi.org/10.1080/08820538.2023.2231575）
- 改前：平均誤差 ~2–3°；Panagiotopoul
  改後：統合分析（6 個 RCT）顯示軸位誤差比手動平均少約 2°（Yao 2024）；Panagiotopoul
  理由：查無 2–3° 出處，改用 Yao 摘要 MD −1.98
  出處：Yao L, et al. Semin Ophthalmol 2024（https://doi.org/10.1080/08820538.2023.2231575）
- 改前：u 等 2019 系統性回顧顯示比手動精準。設備昂貴是主
  改後：u 等 2019 系統性回顧也顯示比手動精準。設備昂貴是主
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：Singh et al. 2022 綜述 95% toric IOL 在 6 個月內維持在預期軸位 ±5° 內；多數轉位發生在術後第一個月
  改後：（刪除）
  理由：Singh 原文（PMC 全文）查無此數字，只有 Verstraaten 表 3 轉述且把綜述標成 30 眼研究；非必要，刪除該表列
  出處：Singh VM, et al. Indian J Ophthalmol (PMC8917572) 2022（https://pmc.ncbi.nlm.nih.gov/articles/PMC8917572/）
- 改前：重置手術安全性：Oshika 等的 42 眼大型病例系列中無嚴重併發症，可能的併發症包括短暫眼壓升高
  改後：重置手術安全性：可能的併發症包括短暫眼壓升高
  理由：Oshika 摘要與 Verstraaten 都未寫無嚴重併發症，刪除該宣稱
  出處：Oshika T, et al. Ophthalmology 2018（https://doi.org/10.1016/j.ophtha.2017.07.004）
- 改前： IOL 病人達到殘餘散光 ≤ 0.5 D，這代表約 30
  改後： IOL 病人達到殘餘散光 < 0.5 D，這代表約 30
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
- 改前：D，這代表約 30% 仍有 > 0.5 D 殘餘散光、可能
  改後：D，這代表約 30% 仍有 ≥ 0.5 D 殘餘散光、可能
  理由：同段其他改動的同步調整，或上方的裁決與保守處理。
