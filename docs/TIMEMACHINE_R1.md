# Time Machine 第一輪研究紀錄（R1）

範圍：`data/exam/doubts.json` 中主章節已有筆記（59 章）的 222 題。流程：研究子代理判定 INCLUDE／EXCLUDE → 另一獨立子代理重開每個來源逐句查證（PASS／FIX／REJECT），只有通過者寫入 `data/exam/timemachine.json`。

## 結果

| 項目 | 數量 |
|---|---|
| 候選題 | 222 |
| INCLUDE（寫入 timemachine.json） | 0 |
| EXCLUDE：內容上無觀念變遷（措辭、誤植、題意歧義、純事實、證據不一致或早於考試年代） | 208 |
| EXCLUDE：有變遷線索但原始來源無法開啟，待重跑 | 14 |
| 依影響程度：「不影響」／「依現行觀念答案會不同」 | 0／0 |

**阻礙**：本輪執行環境的網路政策封鎖原始文獻主機（`pubmed.ncbi.nlm.nih.gov`、`www.ncbi.nlm.nih.gov`、`www.ebi.ac.uk`（Europe PMC）、`eyewiki.aao.org`），WebFetch 與 curl 均無法開啟。依業主規則「無法由原始文獻確認者不寫」，即使線索明確也一律不收錄；因此沒有任何條目進入獨立查證階段，`timemachine.json` 為空物件 `{}`。搜尋引擎摘要與二手報導不作為依據。

## 待重跑的候選（網路開放後優先處理）

| 題號 | 線索（未經原文查證，不可直接引用） |
|---|---|
| 26 | 為有效候選（2016 年 AAO 將劑量門檻由理想體重 6.5 mg/kg 改為實際體重 ≤5.0 mg/kg，答案不影響），但本次網路環境無法開啟 PubMed／Europe PMC 原始文獻，未能親自查證，依規則排除；網路開放後建議重審。 |
| 403 | 2006→2015 NMOSD 診斷標準確有改變且不影響答案，但本次環境無法開啟原始來源（PubMed/Europe PMC 連線遭拒），不符來源驗證條件，暫不收錄。 |
| 416 | 2015 年共識取消腦部 MRI 須不符 MS 的要求，為可能候選，但本次無法開啟原始來源驗證，暫不收錄。 |
| 428 | IIH 名稱與 2013 年修訂診斷準則為可能候選，但本 session 無法連線 PubMed／Europe PMC 開啟原始文獻驗證，依規則排除。 |
| 597 | 2021 年 NF1 診斷準則修訂（新增脈絡膜異常與基因診斷）為可能題材，但考試年代不明且本環境無法開啟 PubMed／Europe PMC 原始頁面驗證，依規則排除。 |
| 676 | ICROP3（2021）以 A-ROP 取代 AP-ROP 為可能的時光機題材，但題目已使用 A-ROP 名稱（考試應晚於改版），且本環境無法開啟 PubMed／Europe PMC 原始頁面驗證，依規則排除。 |
| 790 | Edrophonium 試驗式微為可能候選且不影響答案，但本次無法開啟原始來源驗證，暫不收錄。 |
| 868 | 可能候選（interferon α-2b 在美國停止供應），但本次 session 網路無法開啟 PubMed／Europe PMC／EyeWiki 等原始來源，無法依規則驗證，故排除。 |
| 994 | VKH 分期由四期改為 2021 SUN 早／晚期分類可能為候選，但不影響答案；本 session 無法連上 PubMed／Europe PMC／EyeWiki 原始來源，無法依規則開啟驗證，故排除。 |
| 1093 | VKH 分期改為 2021 SUN 早／晚期分類可能為候選（不影響答案）；本 session 無法連上 PubMed／Europe PMC／EyeWiki 原始來源，無法依規則開啟驗證，故排除。 |
| 1112 | 2021 SUN VKH 分類標準為研究用分類，未取代 2001 修訂診斷標準；本 session 無法連上 PubMed／Europe PMC／EyeWiki 原始來源，無法依規則開啟驗證，故排除。 |
| 1400 | 新世代公式（Kane、Barrett Universal II）於短眼軸表現較佳為合理線索，但本次無法開啟 PubMed／Europe PMC 原始來源查證，依規則不收錄。 |
| 1435 | 補體抑制劑（2023 年核可）確屬可能的觀念更新，但本次環境無法開啟 PubMed/Europe PMC 原始來源（連線被拒），依規則不得引用，暫列排除，建議於可連線時重新查證。 |
| 1612 | 角膜嵌入物（KAMRA、Raindrop）後續停產或召回可能為真實改變且不影響答案，但本次環境無法開啟任何原始來源（eyewiki.org、PubMed、Europe PMC 均被網路政策阻擋），依規則不得收錄。 |

## 重要的內容性排除

- **1052**：VKH 2021 SUN 分類對 alopecia 分期的影響證據解讀不一致。
- **565**：AAP 2018 ROP 篩檢標準與先前大致相同，選項 A 至今仍錯；台灣共識未能查證。
- **1149／1206**：懷孕期 prostaglandin 使用證據有限且不一致，答案亦不受影響。
- **1326**：statin 與白內障：世代研究與 RCT 方向不一致。
- **1308**：糖尿病屈光變化方向文獻不一致，且非考後才改變。
- **1344**：分散型黏彈劑與 wound burn：屬官方答案疑誤而非考後觀念改變。
- **1096**：CMV retinitis／IRU 處置觀念考試當時與現在一致。
- **775**：facial nerve ablation 被 myectomy 取代早於考試年代。

## 全部候選判定

| 題號 | doubts 類別 | 判定 | 理由 | 獨立查證 |
|---|---|---|---|---|
| 26 | outdated | EXCLUDE（待重跑） | 為有效候選（2016 年 AAO 將劑量門檻由理想體重 6.5 mg/kg 改為實際體重 ≤5.0 mg/kg，答案不影響），但本次網路環境無法開啟 PubMed／Europe PMC 原始文獻，未能親自查證，依規則排除；網路開放後建議重審。 | 未進入（非 INCLUDE） |
| 36 | ambiguous | EXCLUDE | 僅為數字範圍與題意歧義，AS 與前葡萄膜炎的觀念未改變。 | 未進入（非 INCLUDE） |
| 43 | bcsc_conflict | EXCLUDE | 屬教科書內部數字不一致，現行文獻仍支持原答案，並非觀念改變；且原始文獻本次無法開啟查證。 | 未進入（非 INCLUDE） |
| 63 | typo | EXCLUDE | 僅為選項名稱誤植與主要毒性的教科書範圍問題，觀念未改變。 | 未進入（非 INCLUDE） |
| 96 | ambiguous | EXCLUDE | 純解剖題，題意歧義，無觀念改變。 | 未進入（非 INCLUDE） |
| 98 | ambiguous | EXCLUDE | 純解剖題，題意歧義，無觀念改變。 | 未進入（非 INCLUDE） |
| 120 | bcsc_silent | EXCLUDE | 類固醇升眼壓的效價比較與 steroid responder 比例觀念未改變。 | 未進入（非 INCLUDE） |
| 124 | ambiguous | EXCLUDE | 遺傳型 retinoblastoma 多為新生突變、約 10% 有家族史的觀念未改變。 | 未進入（非 INCLUDE） |
| 130 | typo | EXCLUDE | 疑似漏抄選項的題目問題，組織學事實未改變。 | 未進入（非 INCLUDE） |
| 149 | ambiguous | EXCLUDE | 遺傳學事實與筆誤問題，無觀念改變。 | 未進入（非 INCLUDE） |
| 162 | ambiguous | EXCLUDE | 選項設計錯誤（四項皆為 X-linked），屬題目問題而非觀念改變。 | 未進入（非 INCLUDE） |
| 189 | ambiguous | EXCLUDE | 小樑網組織學與老化變化屬基礎事實，無觀念改變。 | 未進入（非 INCLUDE） |
| 194 | ambiguous | EXCLUDE | 局部麻醉劑起效時間屬藥理表格數值，無觀念改變。 | 未進入（非 INCLUDE） |
| 204 | ambiguous | EXCLUDE | 純光學題，無觀念改變。 | 未進入（非 INCLUDE） |
| 206 | ambiguous | EXCLUDE | 調節幅度計算題，題目用字瑕疵，光學概念未改變。 | 未進入（非 INCLUDE） |
| 252 | ambiguous | EXCLUDE | 變色鏡片原理屬物理事實，題目僅波長範圍寫法寬鬆，無觀念變遷。 | 未進入（非 INCLUDE） |
| 255 | ambiguous | EXCLUDE | 純光學題，無觀念改變。 | 未進入（非 INCLUDE） |
| 260 | ambiguous | EXCLUDE | 純光學計算題，無觀念改變。 | 未進入（非 INCLUDE） |
| 272 | ambiguous | EXCLUDE | 純光學題，題幹歧義，無觀念改變。 | 未進入（非 INCLUDE） |
| 276 | ambiguous | EXCLUDE | Angle kappa／alpha 屬光學與解剖定義，無觀念變遷，僅措辭爭議。 | 未進入（非 INCLUDE） |
| 277 | ambiguous | EXCLUDE | 純光學計算題，概念未隨時間改變，僅選項數值不精確。 | 未進入（非 INCLUDE） |
| 287 | typo | EXCLUDE | 題幹折射率數字疑似誤植，屬計算與題目用字問題，無觀念變遷。 | 未進入（非 INCLUDE） |
| 300 | bcsc_silent | EXCLUDE | Retinoblastoma 轉移途徑與 IRBP 表現屬既有病理事實，無觀念變遷。 | 未進入（非 INCLUDE） |
| 313 | ambiguous | EXCLUDE | 胚胎學分類歧義，無觀念改變。 | 未進入（非 INCLUDE） |
| 324 | bcsc_conflict | EXCLUDE | Parinaud oculoglandular syndrome 病因屬既有知識，爭議為題目設計而非觀念改變。 | 未進入（非 INCLUDE） |
| 334 | ambiguous | EXCLUDE | Rosette 分化屬病理學定義事實，無觀念變遷。 | 未進入（非 INCLUDE） |
| 348 | ambiguous | EXCLUDE | Leukemia 眼部表現屬措辭主觀性爭議，觀念未改變。 | 未進入（非 INCLUDE） |
| 353 | ambiguous | EXCLUDE | Schwannoma 的 S-100 免疫染色屬既有病理事實，無觀念變遷。 | 未進入（非 INCLUDE） |
| 355 | ambiguous | EXCLUDE | MMP 診斷觀念（免疫螢光陰性不能排除）未改變，A 選項僅措辭籠統。 | 未進入（非 INCLUDE） |
| 361 | ambiguous | EXCLUDE | Oncocytoma 病理屬固定組織學事實，A 選項僅用字不精確。 | 未進入（非 INCLUDE） |
| 362 | typo | EXCLUDE | CMV retinitis 玻璃體發炎輕微的觀念未變，C 選項僅為筆誤。 | 未進入（非 INCLUDE） |
| 363 | ambiguous | EXCLUDE | 屬 CHRPE-like 與 hyperplasia 的命名／組織學用語差異，非實質觀念變遷。 | 未進入（非 INCLUDE） |
| 370 | ambiguous | EXCLUDE | 題目為措辭歧義（一般細菌性結膜炎），肉芽腫性結膜炎病因觀念未改變。 | 未進入（非 INCLUDE） |
| 380 | bcsc_conflict | EXCLUDE | 成人 preseptal cellulitis 病因觀念未改變，屬 BCSC 各冊敘述不一致，非時代變遷。 | 未進入（非 INCLUDE） |
| 383 | bcsc_silent | EXCLUDE | 淚腺 adenoid cystic carcinoma 的 p53 預後證據稀少且不一致，不符合收錄條件。 | 未進入（非 INCLUDE） |
| 403 | outdated | EXCLUDE（待重跑） | 2006→2015 NMOSD 診斷標準確有改變且不影響答案，但本次環境無法開啟原始來源（PubMed/Europe PMC 連線遭拒），不符來源驗證條件，暫不收錄。 | 未進入（非 INCLUDE） |
| 411 | ambiguous | EXCLUDE | 純解剖題，題意歧義，無觀念改變。 | 未進入（非 INCLUDE） |
| 416 | outdated | EXCLUDE（待重跑） | 2015 年共識取消腦部 MRI 須不符 MS 的要求，為可能候選，但本次無法開啟原始來源驗證，暫不收錄。 | 未進入（非 INCLUDE） |
| 419 | ambiguous | EXCLUDE | Ocular tilt reaction 判讀為選項設計歧義，無觀念變更。 | 未進入（非 INCLUDE） |
| 428 | outdated | EXCLUDE（待重跑） | IIH 名稱與 2013 年修訂診斷準則為可能候選，但本 session 無法連線 PubMed／Europe PMC 開啟原始文獻驗證，依規則排除。 | 未進入（非 INCLUDE） |
| 429 | outdated | EXCLUDE | 問的是常見表現而非診斷標準，periventricular 病灶提示 MS 的觀念未改變。 | 未進入（非 INCLUDE） |
| 432 | ambiguous | EXCLUDE | Double Maddox rod 判讀屬檢查原理與題意歧義，無觀念變更。 | 未進入（非 INCLUDE） |
| 442 | bcsc_silent | EXCLUDE | NAION 危險因子中心源性栓子仍未被確立，觀念未改變，B 選項爭議屬原有證據不一致。 | 未進入（非 INCLUDE） |
| 452 | outdated | EXCLUDE | 題目本身即依 2015 年國際準則，考後無觀念變更。 | 未進入（非 INCLUDE） |
| 459 | bcsc_silent | EXCLUDE | Fingolimod 相關黃斑水腫觀念至今未變。 | 未進入（非 INCLUDE） |
| 483 | bcsc_silent | EXCLUDE | 題目已反映 2019–2020 年 FDA 核准，考後無變更。 | 未進入（非 INCLUDE） |
| 491 | typo | EXCLUDE | 僅題幹 APEM/ADEM 誤植，MOGAD 觀念未改變。 | 未進入（非 INCLUDE） |
| 492 | ambiguous | EXCLUDE | RAPD 不造成瞳孔不等屬生理事實，僅用字歧義。 | 未進入（非 INCLUDE） |
| 500 | ambiguous | EXCLUDE | 核上性眼動判斷屬題意歧義，無指引或觀念變更。 | 未進入（非 INCLUDE） |
| 510 | ambiguous | EXCLUDE | Apraclonidine 對瞳孔影響僅程度差異，無觀念變更。 | 未進入（非 INCLUDE） |
| 514 | ambiguous | EXCLUDE | 眼型 MG 轉全身型比例各來源不一但仍與課本一致，無明確觀念變更。 | 未進入（非 INCLUDE） |
| 532 | typo | EXCLUDE | 圖片缺漏造成的歧義，INO 定位屬解剖事實，無觀念變更。 | 未進入（非 INCLUDE） |
| 561 | ambiguous | EXCLUDE | 嬰幼兒白內障術後青光眼危險因子的觀念未改變，僅選項措辭有出入。 | 未進入（非 INCLUDE） |
| 565 | outdated | EXCLUDE | AAP 2018 篩檢標準與先前（≤1500 g 或 ≤30 週）大致相同，選項 A 至今仍錯；台灣 TPR 共識為候選資訊但本環境無法開啟 PubMed／Europe PMC 原始頁面驗證，依規則排除。 | 未進入（非 INCLUDE） |
| 576 | ambiguous | EXCLUDE | 屬先天虹膜異常的描述與題意判讀問題，無指引或觀念改變。 | 未進入（非 INCLUDE） |
| 577 | outdated | EXCLUDE | IATS 結果（2010）早已納入課本，單側白內障預後較差的觀念未改變；且本環境無法開啟 PubMed 原始來源驗證。 | 未進入（非 INCLUDE） |
| 597 | ambiguous | EXCLUDE（待重跑） | 2021 年 NF1 診斷準則修訂（新增脈絡膜異常與基因診斷）為可能題材，但考試年代不明且本環境無法開啟 PubMed／Europe PMC 原始頁面驗證，依規則排除。 | 未進入（非 INCLUDE） |
| 599 | ambiguous | EXCLUDE | 無虹膜症青光眼機轉與兒童青光眼三聯徵為既有觀念，屬題意爭議。 | 未進入（非 INCLUDE） |
| 602 | ambiguous | EXCLUDE | 爭點在 limbal dermoid 手術方式的措辭判讀，觀念未改變。 | 未進入（非 INCLUDE） |
| 615 | ambiguous | EXCLUDE | 白化症視交叉過度交叉為解剖生理事實，觀念未改變。 | 未進入（非 INCLUDE） |
| 626 | bcsc_silent | EXCLUDE | Paradoxical pupil 相關疾病名單無明確觀念變更。 | 未進入（非 INCLUDE） |
| 627 | ambiguous | EXCLUDE | Crouzon 症候群特徵屬遺傳症候群事實，僅選項歧義。 | 未進入（非 INCLUDE） |
| 655 | ambiguous | EXCLUDE | 顱縫早閉頭型配對屬遺傳症候群事實，無觀念變更。 | 未進入（非 INCLUDE） |
| 657 | ambiguous | EXCLUDE | 無虹膜症角膜病變源於角膜緣幹細胞缺乏為既有觀念，僅選項數字措辭差異。 | 未進入（非 INCLUDE） |
| 661 | ambiguous | EXCLUDE | WAGR 症候群與 WT1 的關係為遺傳事實，爭議僅在題意，無觀念改變。 | 未進入（非 INCLUDE） |
| 670 | bcsc_silent | EXCLUDE | 白血病眼部表現屬課本未載的推論題，無指引或觀念改變。 | 未進入（非 INCLUDE） |
| 671 | ambiguous | EXCLUDE | 水晶體脫位病因判讀屬題幹線索不足的爭議，無觀念改變。 | 未進入（非 INCLUDE） |
| 676 | outdated | EXCLUDE（待重跑） | ICROP3（2021）以 A-ROP 取代 AP-ROP 為可能的時光機題材，但題目已使用 A-ROP 名稱（考試應晚於改版），且本環境無法開啟 PubMed／Europe PMC 原始頁面驗證，依規則排除。 | 未進入（非 INCLUDE） |
| 681 | ambiguous | EXCLUDE | 爭點為角膜病變出現時間的用語判讀，觀念未改變。 | 未進入（非 INCLUDE） |
| 682 | ambiguous | EXCLUDE | PCG 臨床表現與治療原則未改變，疑義僅在選項措辭與數字。 | 未進入（非 INCLUDE） |
| 687 | ambiguous | EXCLUDE | NF1 臨床表現比例屬穩定的疾病描述事實，疑點僅為譯詞與措辭，觀念未改變。 | 未進入（非 INCLUDE） |
| 690 | ambiguous | EXCLUDE | 屬 sclerocornea 描述性特徵與名詞判讀，無指引改變。 | 未進入（非 INCLUDE） |
| 691 | ambiguous | EXCLUDE | 兒童青光眼診斷特徵清單措辭差異，無指引更新影響。 | 未進入（非 INCLUDE） |
| 692 | ambiguous | EXCLUDE | 兒童 IOL 植入時機與 FDA 未核准兒童 IOL 的敘述至今未見改變，屬既有觀念。 | 未進入（非 INCLUDE） |
| 697 | typo | EXCLUDE | 僅為選項中英文譯名誤植（虹膜缺損與 aniridia），先天性 CMV 眼部表現的觀念未改變。 | 未進入（非 INCLUDE） |
| 698 | bcsc_silent | EXCLUDE | 題目屬遺傳與臨床特徵事實（FGFR2、水腦與智力），概念未改變。 | 未進入（非 INCLUDE） |
| 701 | bcsc_silent | EXCLUDE | 虹膜異色症高／低色素分類為機轉事實，BCSC 未載明，無觀念改變可記錄。 | 未進入（非 INCLUDE） |
| 702 | typo | EXCLUDE | 選項 D 為錯字（sulfite oxidase），屬 typo，觀念未改變。 | 未進入（非 INCLUDE） |
| 704 | bcsc_silent | EXCLUDE | Paradoxical pupil 名單證據強弱不一，無明確觀念變更。 | 未進入（非 INCLUDE） |
| 711 | ambiguous | EXCLUDE | 頸動脈海綿竇瘻管的 CT 表現屬穩定影像事實，無觀念改變。 | 未進入（非 INCLUDE） |
| 717 | ambiguous | EXCLUDE | 僅為 keratoacanthoma／Bowen disease 歸類的定義措辭問題，無考後觀念改變。 | 未進入（非 INCLUDE） |
| 718 | ambiguous | EXCLUDE | BCC 好發部位比例屬描述性資料，疑點為選項 B 的措辭，觀念未改變。 | 未進入（非 INCLUDE） |
| 725 | bcsc_silent | EXCLUDE | TED 與 NSOI 的性別比例屬流行病學描述，無指引或觀念的改變，僅為課本未明載。 | 未進入（非 INCLUDE） |
| 746 | typo | EXCLUDE | 僅為 Tenzel 拼字誤植，下眼瞼大缺損重建原則未改變。 | 未進入（非 INCLUDE） |
| 774 | ambiguous | EXCLUDE | 眼瞼皮膚 melanoma 不以 cryotherapy 治療為長期一致的觀念，疑點僅為選項 C 措辭。 | 未進入（非 INCLUDE） |
| 775 | bcsc_conflict | EXCLUDE | facial nerve ablation 因高復發與顏面麻痺而被 myectomy 取代早已是長期觀念，並非考後改變，課本與現行資料一致。 | 未進入（非 INCLUDE） |
| 785 | bcsc_silent | EXCLUDE | 淚腺 adenoid cystic carcinoma 以神經侵犯致痛為長期一致的觀念，現行資料與課本一致，無改變。 | 未進入（非 INCLUDE） |
| 786 | ambiguous | EXCLUDE | BPES 特徵為穩定的臨床定義，題幹僅有拼字誤植。 | 未進入（非 INCLUDE） |
| 788 | ambiguous | EXCLUDE | 臨床推論題，眼瞼美容術後閉眼不全的觀念未改變，屬題幹情境推論而非觀念演變。 | 未進入（非 INCLUDE） |
| 790 | outdated | EXCLUDE（待重跑） | Edrophonium 試驗式微為可能候選且不影響答案，但本次無法開啟原始來源驗證，暫不收錄。 | 未進入（非 INCLUDE） |
| 793 | ambiguous | EXCLUDE | 疑點在於「可能會上升」的措辭寬嚴，各實驗室檢查的觀念並無考後改變。 | 未進入（非 INCLUDE） |
| 794 | ambiguous | EXCLUDE | 題幹描述不精確屬措辭問題，轉移性乳癌造成眼球內陷的觀念未改變。 | 未進入（非 INCLUDE） |
| 799 | ambiguous | EXCLUDE | 下眼瞼重建階梯為穩定的手術原則，疑點僅為寬度排序的界定。 | 未進入（非 INCLUDE） |
| 803 | bcsc_silent | EXCLUDE | 題目已含 FDA 核准之 teprotumumab，屬近年考題；減壓術式選擇、CAS 門檻與 selenium 建議在考後未有改變答案的更新，疑點僅為措辭精確度。 | 未進入（非 INCLUDE） |
| 804 | bcsc_silent | EXCLUDE | BEB 睡眠時緩解與家族史為危險因子屬穩定觀念，現行文獻與答案一致，無改變。 | 未進入（非 INCLUDE） |
| 805 | bcsc_silent | EXCLUDE | IgG4-RD 惡性風險與血球表現的文獻屬佐證性資料，並非考後臨床觀念或分類的改變，疑點為出題措辭。 | 未進入（非 INCLUDE） |
| 810 | ambiguous | EXCLUDE | NSOI 與 TED 的影像鑑別為穩定觀念，疑點僅為題意界定。 | 未進入（非 INCLUDE） |
| 843 | ambiguous | EXCLUDE | 角膜脂質沉積與 spheroidal degeneration 性質屬病理事實，無觀念更動。 | 未進入（非 INCLUDE） |
| 850 | ambiguous | EXCLUDE | PAM 惡性潛能最高屬既有觀念，爭議僅在選項用語。 | 未進入（非 INCLUDE） |
| 851 | bcsc_silent | EXCLUDE | Terrien 散光軸向屬臨床特徵描述，無指引或觀念改變；先前文獻僅佐證原答案。 | 未進入（非 INCLUDE） |
| 856 | ambiguous | EXCLUDE | 結膜淋巴瘤合併全身淋巴瘤屬既有觀念，無改變。 | 未進入（非 INCLUDE） |
| 868 | outdated | EXCLUDE（待重跑） | 可能候選（interferon α-2b 在美國停止供應），但本次 session 網路無法開啟 PubMed／Europe PMC／EyeWiki 等原始來源，無法依規則驗證，故排除。 | 未進入（非 INCLUDE） |
| 871 | bcsc_silent | EXCLUDE | 腎衰竭血磷升高致 band keratopathy 屬病理機轉，無觀念改變。 | 未進入（非 INCLUDE） |
| 872 | bcsc_silent | EXCLUDE | Terrien 雙側性屬疾病特徵描述，無觀念改變。 | 未進入（非 INCLUDE） |
| 875 | ambiguous | EXCLUDE | CMV 前葡萄膜炎需前房水 PCR 確診的觀念與答案一致，且原始來源本 session 無法連上 PubMed／Europe PMC／EyeWiki 原始來源，無法依規則開啟驗證，故排除。 | 未進入（非 INCLUDE） |
| 879 | ambiguous | EXCLUDE | OSSN 切除原則無觀念改變，爭議為題幹資訊不足。 | 未進入（非 INCLUDE） |
| 883 | bcsc_silent | EXCLUDE | Band keratopathy 與鈣磷沉積之關係屬病理事實，無觀念改變。 | 未進入（非 INCLUDE） |
| 889 | ambiguous | EXCLUDE | SJS 瞼球沾黏處置原則無足以改變答案之更新，選項 B 僅為用語差異。 | 未進入（非 INCLUDE） |
| 913 | ambiguous | EXCLUDE | 結膜淋巴組織腫瘤合併眼外淋巴瘤比例屬既有觀念，爭議僅在選項定性用字。 | 未進入（非 INCLUDE） |
| 925 | ambiguous | EXCLUDE | PPCD／ICE／A-R 比較之爭議在「較無明顯關聯」用語，非觀念演變。 | 未進入（非 INCLUDE） |
| 926 | ambiguous | EXCLUDE | 爭議在選項用字（crab-claw 與隱形眼鏡風險），圓錐角膜診斷觀念與答案無改變。 | 未進入（非 INCLUDE） |
| 927 | ambiguous | EXCLUDE | 周邊角膜變薄疾病比較屬臨床特徵描述，爭議僅在選項用字，無觀念改變。 | 未進入（非 INCLUDE） |
| 936 | bcsc_silent | EXCLUDE | ICRS 與 CXL 先後順序及選擇標準無明確指引改變；先前資料僅支持原答案，且原始文獻本次無法開啟驗證（網路受限）。 | 未進入（非 INCLUDE） |
| 959 | bcsc_silent | EXCLUDE | 微孢子蟲角膜炎以局部 fluoroquinolone 治療之觀念未改變，原答案仍成立。 | 未進入（非 INCLUDE） |
| 960 | typo | EXCLUDE | 屬選項誤植（rion）與沉積物命名配對，為純事實與錯字問題。 | 未進入（非 INCLUDE） |
| 969 | ambiguous | EXCLUDE | 結膜色素病變的分類與數字差異屬課本數值／措辭出入，觀念未改變。 | 未進入（非 INCLUDE） |
| 975 | ambiguous | EXCLUDE | 前房蓄膿好發疾病屬既有臨床知識，觀念未改變。 | 未進入（非 INCLUDE） |
| 986 | ambiguous | EXCLUDE | 疑似 sarcoidosis 以胸部 CT 補強檢查屬既有觀念，未改變。 | 未進入（非 INCLUDE） |
| 994 | ambiguous | EXCLUDE（待重跑） | VKH 分期由四期改為 2021 SUN 早／晚期分類可能為候選，但不影響答案；本 session 無法連上 PubMed／Europe PMC／EyeWiki 原始來源，無法依規則開啟驗證，故排除。 | 未進入（非 INCLUDE） |
| 997 | ambiguous | EXCLUDE | SUN 定義（remission、chronic、recurrent）自 2005 年至今未變，屬定義題。 | 未進入（非 INCLUDE） |
| 1004 | ambiguous | EXCLUDE | ocular sarcoidosis 最常見表現為葡萄膜炎屬既有知識，僅出題範圍解讀問題。 | 未進入（非 INCLUDE） |
| 1009 | bcsc_silent | EXCLUDE | 僅為課本未依病因比較濾過手術失敗率，現有證據為零散小型回溯研究且不一致，無明確觀念改變。 | 未進入（非 INCLUDE） |
| 1013 | bcsc_silent | EXCLUDE | 葡萄膜炎流行病學敘述屬既有知識，觀念未改變。 | 未進入（非 INCLUDE） |
| 1018 | ambiguous | EXCLUDE | sarcoidosis 葡萄膜炎以前段為主屬既有知識，數字差異屬措辭問題。 | 未進入（非 INCLUDE） |
| 1020 | bcsc_silent | EXCLUDE | 弓漿蟲最終宿主為貓科、IgG 陰性於免疫正常者可排除等觀念至今未變，僅屬課本未明言的細節，無觀念改變。 | 未進入（非 INCLUDE） |
| 1031 | ambiguous | EXCLUDE | Gallium 改以 FDG-PET 描述僅為課本用詞更新，且不影響答案；觀念核心未改變。 | 未進入（非 INCLUDE） |
| 1032 | bcsc_silent | EXCLUDE | Sunset-glow fundus 組織學屬既有病理知識，觀念未改變。 | 未進入（非 INCLUDE） |
| 1039 | bcsc_silent | EXCLUDE | VKH 隅角閉鎖機轉課本未直接比較，近年病例報告未改變答案邏輯，屬課本未言明而非觀念改變。 | 未進入（非 INCLUDE） |
| 1044 | typo | EXCLUDE | SITE 世代研究結論（TNF inhibitor 未增加整體或癌症死亡率）未改變，A 為疑似誤植，屬 typo。 | 未進入（非 INCLUDE） |
| 1052 | outdated | EXCLUDE | VKH 2021 SUN 早／晚期分類對 alopecia 分期的影響有爭議、證據解讀不一致；本 session 無法連上 PubMed／Europe PMC／EyeWiki 原始來源，無法依規則開啟驗證，故排除。 | 未進入（非 INCLUDE） |
| 1053 | ambiguous | EXCLUDE | KP 型態與疾病對應屬既有臨床知識，僅選項措辭不精確。 | 未進入（非 INCLUDE） |
| 1087 | ambiguous | EXCLUDE | 視網膜血管炎動靜脈分類屬既有知識，觀念未改變。 | 未進入（非 INCLUDE） |
| 1092 | ambiguous | EXCLUDE | 血清 ACE／lysozyme 不能確診 sarcoidosis 屬既有觀念，未改變。 | 未進入（非 INCLUDE） |
| 1093 | outdated | EXCLUDE（待重跑） | VKH 分期改為 2021 SUN 早／晚期分類可能為候選（不影響答案）；本 session 無法連上 PubMed／Europe PMC／EyeWiki 原始來源，無法依規則開啟驗證，故排除。 | 未進入（非 INCLUDE） |
| 1096 | outdated | EXCLUDE | IRU 可用類固醇治療、玻璃體內 ganciclovir 合併口服 valganciclovir 等觀念考試當時與現在一致，D 的 CD4 數字僅為描述差異，無實質改變。 | 未進入（非 INCLUDE） |
| 1105 | typo | EXCLUDE | Heerfordt syndrome 定義屬既有知識，題幹截斷屬 typo。 | 未進入（非 INCLUDE） |
| 1107 | typo | EXCLUDE | 題幹截斷屬誤植問題，ARN 立即靜脈 acyclovir 治療的觀念未改變。 | 未進入（非 INCLUDE） |
| 1112 | outdated | EXCLUDE（待重跑） | 2021 SUN VKH 分類標準為研究用分類，未取代 2001 修訂診斷標準；本 session 無法連上 PubMed／Europe PMC／EyeWiki 原始來源，無法依規則開啟驗證，故排除。 | 未進入（非 INCLUDE） |
| 1142 | ambiguous | EXCLUDE | 小樑網解剖與老化變化屬基礎解剖事實，未改變。 | 未進入（非 INCLUDE） |
| 1149 | outdated | EXCLUDE | 懷孕期 prostaglandin 使用證據仍有限且不一致，難認定為明確觀念改變，且本次原始來源（PubMed、EyeWiki）無法開啟查證。 | 未進入（非 INCLUDE） |
| 1159 | ambiguous | EXCLUDE | angle recession 摘除晶體無法改善屬機轉推理，題目僅前提模糊，無觀念改變。 | 未進入（非 INCLUDE） |
| 1166 | ambiguous | EXCLUDE | LPI 適應症觀念未改變，疑義僅在 plateau iris 定義解讀。 | 未進入（非 INCLUDE） |
| 1170 | bcsc_conflict | EXCLUDE | succinylcholine 為課本內部表格與內文矛盾，非臨床觀念改變。 | 未進入（非 INCLUDE） |
| 1171 | ambiguous | EXCLUDE | 眼壓測量假性偏低因素屬儀器原理，無觀念改變。 | 未進入（非 INCLUDE） |
| 1173 | ambiguous | EXCLUDE | Imbert-Fick 原則與眼壓計分類屬物理原理，未改變。 | 未進入（非 INCLUDE） |
| 1179 | ambiguous | EXCLUDE | 屬兒童青光眼分類歸屬的定義與題意解讀問題，非觀念改變。 | 未進入（非 INCLUDE） |
| 1180 | bcsc_silent | EXCLUDE | 哺乳期 CAI 可用屬既有資料，非考後改變；且原始來源本次無法開啟查證。 | 未進入（非 INCLUDE） |
| 1181 | bcsc_silent | EXCLUDE | 合併或分階段手術比較僅有單一非隨機研究，未構成指引改變。 | 未進入（非 INCLUDE） |
| 1183 | ambiguous | EXCLUDE | 以眼軸長追蹤先天性青光眼的觀念未改變，疑義僅在選項間比較。 | 未進入（非 INCLUDE） |
| 1185 | ambiguous | EXCLUDE | Imbert-Fick 原則與眼壓計分類屬物理原理，未改變。 | 未進入（非 INCLUDE） |
| 1201 | ambiguous | EXCLUDE | 房水動力學生理數值與用詞不精確問題，無觀念改變。 | 未進入（非 INCLUDE） |
| 1206 | ambiguous | EXCLUDE | 疑義在懷孕期 prostaglandin 的傳統與現行觀點，證據有限不一致且來源無法開啟查證，答案 C 亦不受影響。 | 未進入（非 INCLUDE） |
| 1211 | ambiguous | EXCLUDE | 色素沉積徵象定義屬描述性事實，僅用詞不精確，無觀念改變。 | 未進入（非 INCLUDE） |
| 1222 | typo | EXCLUDE | 選項誤植（Mackay-Marg）屬文字問題，眼壓與 CCT 非線性關係未改變。 | 未進入（非 INCLUDE） |
| 1229 | ambiguous | EXCLUDE | 屬青光眼機轉分類與題意解讀問題，觀念本身未改變。 | 未進入（非 INCLUDE） |
| 1231 | ambiguous | EXCLUDE | 回彈式眼壓計受 CCT 影響等屬儀器特性，題目僅措辭模糊，無觀念改變。 | 未進入（非 INCLUDE） |
| 1235 | typo | EXCLUDE | Fluorometholone 升眼壓風險較低、difluprednate 為誤植，觀念未改變。 | 未進入（非 INCLUDE） |
| 1237 | bcsc_silent | EXCLUDE | 哺乳期與 G6PD 缺乏用藥屬排除法推論，未有明確觀念改變，且來源無法開啟查證。 | 未進入（非 INCLUDE） |
| 1239 | ambiguous | EXCLUDE | 角膜直徑正常值屬解剖數據，未有觀念改變。 | 未進入（非 INCLUDE） |
| 1241 | bcsc_silent | EXCLUDE | 結膜瓣與濾泡形態的關係未改變，統合分析僅顯示療效相近，不影響題目觀念。 | 未進入（非 INCLUDE） |
| 1273 | bcsc_silent | EXCLUDE | 雷射小樑整形術參數與適應症觀念未改變。 | 未進入（非 INCLUDE） |
| 1279 | ambiguous | EXCLUDE | 無虹膜症青光眼的發病年齡屬疾病自然史，未有改變。 | 未進入（非 INCLUDE） |
| 1280 | ambiguous | EXCLUDE | Sturge-Weber 青光眼盛行率僅為教科書數字區間取捨，非觀念改變。 | 未進入（非 INCLUDE） |
| 1281 | bcsc_conflict | EXCLUDE | Brimonidine 兩歲以下禁用的仿單規定未改變，6 歲門檻屬臨床謹慎建議而非考後改變。 | 未進入（非 INCLUDE） |
| 1290 | bcsc_silent | EXCLUDE | 類固醇反應危險因子清單現行 EyeWiki 仍相同，遠視不在其中，無觀念改變。 | 未進入（非 INCLUDE） |
| 1296 | ambiguous | EXCLUDE | 白內障成因列表無觀念變遷，爭議在於課本未明言而非實務改變。 | 未進入（非 INCLUDE） |
| 1299 | ambiguous | EXCLUDE | TASS 為無菌性反應的觀念未變，僅選項時間措辭差異。 | 未進入（非 INCLUDE） |
| 1308 | bcsc_conflict | EXCLUDE | 糖尿病屈光變化方向的文獻本身不一致，且非考後才改變的觀念，不符收錄條件。 | 未進入（非 INCLUDE） |
| 1312 | ambiguous | EXCLUDE | 僅為角膜水腫消退週數的數字與措辭差異，觀念未改變。 | 未進入（非 INCLUDE） |
| 1316 | ambiguous | EXCLUDE | 相對與絕對禁忌症屬定義差異，Nd:YAG capsulotomy 觀念未改變。 | 未進入（非 INCLUDE） |
| 1317 | ambiguous | EXCLUDE | 局部類固醇可用於眼內炎處置的觀念未改變，選項天數僅措辭差異。 | 未進入（非 INCLUDE） |
| 1326 | bcsc_conflict | EXCLUDE | Statin 與白內障的統合分析結果不一致（世代研究與 RCT 方向不同），證據未形成明確改變。 | 未進入（非 INCLUDE） |
| 1328 | typo | EXCLUDE | 題幹藥名筆誤，IFIS 相關藥物觀念未改變。 | 未進入（非 INCLUDE） |
| 1330 | outdated | EXCLUDE | NSAID 可減少 CME 但未證實改善長期視力的結論至今未變，無觀念改變。 | 未進入（非 INCLUDE） |
| 1331 | ambiguous | EXCLUDE | 脈絡膜上腔出血危險因子列表的爭議屬題目模糊（高度遠視 vs nanophthalmos），無觀念變遷。 | 未進入（非 INCLUDE） |
| 1336 | ambiguous | EXCLUDE | 水晶體胚胎發育與缺損位置屬解剖胚胎學事實。 | 未進入（非 INCLUDE） |
| 1338 | bcsc_silent | EXCLUDE | 戒菸降低白內障風險的證據（2002 年）早於考試年代，觀念未改變，爭議屬選項解讀。 | 未進入（非 INCLUDE） |
| 1341 | ambiguous | EXCLUDE | 白內障類型與症狀對應屬描述性內容，無觀念改變，爭議為選項措辭。 | 未進入（非 INCLUDE） |
| 1342 | ambiguous | EXCLUDE | Aqueous misdirection 以 cycloplegic 為首要治療的觀念未改變。 | 未進入（非 INCLUDE） |
| 1343 | ambiguous | EXCLUDE | 生物測量與矽油屈光指數屬物理／光學事實，可能有兩個正確選項屬題目瑕疵而非觀念改變。 | 未進入（非 INCLUDE） |
| 1344 | bcsc_conflict | EXCLUDE | 現行課本與 EyeWiki 皆支持分散型黏彈劑較易 wound burn，屬官方答案疑誤而非考後觀念改變，且本次無法另行查證。 | 未進入（非 INCLUDE） |
| 1345 | bcsc_silent | EXCLUDE | Brown-McLean syndrome 描述範圍屬教材收錄差異，非觀念隨時間改變。 | 未進入（非 INCLUDE） |
| 1353 | ambiguous | EXCLUDE | 乾眼症病人不宜長期使用 NSAID 的觀念未改變，屬題意判讀問題。 | 未進入（非 INCLUDE） |
| 1355 | ambiguous | EXCLUDE | IFIS 處理方式（瞳孔擴張器或虹膜鉤）無新指引變化，爭議為最佳選項判定。 | 未進入（非 INCLUDE） |
| 1356 | ambiguous | EXCLUDE | 早期晶體半脫位先以光學矯正處理的原則未改變，疑義僅在題幹資訊不足。 | 未進入（非 INCLUDE） |
| 1361 | ambiguous | EXCLUDE | Dysphotopsia 的題目爭議在選項推論與措辭，觀念未改變。 | 未進入（非 INCLUDE） |
| 1382 | ambiguous | EXCLUDE | Pseudoexfoliation 與晚期 IOL 自發脫位的關聯未改變。 | 未進入（非 INCLUDE） |
| 1383 | ambiguous | EXCLUDE | Rosacea/blepharitis 增加眼內炎風險的觀念未改變。 | 未進入（非 INCLUDE） |
| 1389 | ambiguous | EXCLUDE | 無虹膜的家族性與散發比例屬遺傳流行病學事實，觀念未改變，爭議僅為選項措辭。 | 未進入（非 INCLUDE） |
| 1393 | ambiguous | EXCLUDE | Myotonic dystrophy 的多彩結晶屬經典描述，無觀念變遷，爭議僅在「肌無力」用詞。 | 未進入（非 INCLUDE） |
| 1400 | outdated | EXCLUDE（待重跑） | 新世代公式（Kane、Barrett Universal II）於短眼軸表現較佳為合理線索，但本次無法開啟 PubMed／Europe PMC 原始來源查證，依規則不收錄。 | 未進入（非 INCLUDE） |
| 1406 | ambiguous | EXCLUDE | 先天性白內障型態與遺傳方式屬描述性事實，爭議僅在措辭強弱，無觀念變遷。 | 未進入（非 INCLUDE） |
| 1409 | ambiguous | EXCLUDE | 單眼複視與白內障類型的關係無觀念變遷，爭議為課本未直接比較頻率。 | 未進入（非 INCLUDE） |
| 1411 | ambiguous | EXCLUDE | Olsen 公式分類（ray tracing）屬定義問題，無觀念變遷。 | 未進入（非 INCLUDE） |
| 1412 | ambiguous | EXCLUDE | Dispersive OVD 較易殘留碎片的觀念未變，僅選項措辭強度差異。 | 未進入（非 INCLUDE） |
| 1416 | ambiguous | EXCLUDE | Modified monovision 目標度數屬計算與經驗值換算，無指引或觀念改變。 | 未進入（非 INCLUDE） |
| 1419 | ambiguous | EXCLUDE | 題目屬術中併發症機轉與處置細節，爭議僅在選項措辭，觀念未改變。 | 未進入（非 INCLUDE） |
| 1427 | ambiguous | EXCLUDE | 爭議在於高度遠視是否等同 nanophthalmos 的定義問題，危險因子觀念並未改變。 | 未進入（非 INCLUDE） |
| 1435 | outdated | EXCLUDE（待重跑） | 補體抑制劑（2023 年核可）確屬可能的觀念更新，但本次環境無法開啟 PubMed/Europe PMC 原始來源（連線被拒），依規則不得引用，暫列排除，建議於可連線時重新查證。 | 未進入（非 INCLUDE） |
| 1446 | bcsc_silent | EXCLUDE | CSC 影像特徵屬教材未明載的細節，無觀念隨時間改變的證據。 | 未進入（非 INCLUDE） |
| 1498 | ambiguous | EXCLUDE | ESCS 的 ERG 特徵屬電生理事實，爭議為選項判讀，觀念未改變。 | 未進入（非 INCLUDE） |
| 1499 | bcsc_silent | EXCLUDE | Fleck retina of Kandori 屬教材未收錄的疾病描述，無觀念改變。 | 未進入（非 INCLUDE） |
| 1514 | ambiguous | EXCLUDE | 遺傳學定義與選項設計模糊，無觀念改變。 | 未進入（非 INCLUDE） |
| 1557 | ambiguous | EXCLUDE | Suprachoroidal hemorrhage 危險因子的疑點僅在 hyperopia 與 nanophthalmos 的措辭界定，觀念未改變。 | 未進入（非 INCLUDE） |
| 1562 | ambiguous | EXCLUDE | MEWDS 影像表現屬疾病描述事實，僅選項措辭不精確。 | 未進入（非 INCLUDE） |
| 1564 | ambiguous | EXCLUDE | XLRS 為 RS1 基因／retinoschisin 的遺傳學事實，疑點僅在選項 B「常見」的措辭，觀念未改變。 | 未進入（非 INCLUDE） |
| 1588 | outdated | EXCLUDE | BCSC 已將 CXL 列為 ectasia 穩定治療，選項中無 CXL，RGP 仍為最佳答案，未見課本後的觀念改變；且原始來源在本次環境無法開啟查證。 | 未進入（非 INCLUDE） |
| 1604 | bcsc_conflict | EXCLUDE | 表層切削與 LASIK 的乾眼比較僅為證據不一致的次要選項，回退較明顯的觀念未改變；且原始來源在本次環境無法開啟查證。 | 未進入（非 INCLUDE） |
| 1609 | ambiguous | EXCLUDE | 疑點為是否同時加做屈光切削的題意模糊，haze 處理觀念未改變。 | 未進入（非 INCLUDE） |
| 1612 | bcsc_silent | EXCLUDE（待重跑） | 角膜嵌入物（KAMRA、Raindrop）後續停產或召回可能為真實改變且不影響答案，但本次環境無法開啟任何原始來源（eyewiki.org、PubMed、Europe PMC 均被網路政策阻擋），依規則不得收錄。 | 未進入（非 INCLUDE） |
| 1620 | ambiguous | EXCLUDE | LASIK 術後乾眼的比較證據不一致，疑點屬題意與措辭，未見可確認的觀念改變；且原始來源在本次環境無法開啟查證。 | 未進入（非 INCLUDE） |
| 1625 | typo | EXCLUDE | 疑點為選項 C 的筆誤（larellar），myopic PRK 後上皮增厚的觀念未改變。 | 未進入（非 INCLUDE） |
| 1630 | bcsc_conflict | EXCLUDE | SMILE 的 photodisruption 機制屬雷射物理事實，疑點僅為術語分類，觀念未改變。 | 未進入（非 INCLUDE） |
| 1635 | bcsc_silent | EXCLUDE | LASIK 角膜瓣併發症處置的疑點為 BCSC 未明載的細節，觀念未改變；且原始來源在本次環境無法開啟查證。 | 未進入（非 INCLUDE） |
| 1647 | bcsc_silent | EXCLUDE | Transient light sensitivity 以局部類固醇治療的觀念未改變，疑點僅在 BCSC 用語未限定類固醇。 | 未進入（非 INCLUDE） |
| 1648 | ambiguous | EXCLUDE | Munnerlyn 公式（切削深度與光學區直徑平方相關）屬光學物理事實，觀念未改變。 | 未進入（非 INCLUDE） |
| 1700 | ambiguous | EXCLUDE | 硬化性乳癌轉移造成 enophthalmos 為穩定觀念，疑點僅為選項 C 亦可能成立的題意問題。 | 未進入（非 INCLUDE） |
| 1732 | ambiguous | EXCLUDE | 房水由無色素上皮分泌屬生理事實，未改變。 | 未進入（非 INCLUDE） |
| 1733 | ambiguous | EXCLUDE | Goldmann 公式與 EVP 關係屬生理原理，未改變。 | 未進入（非 INCLUDE） |
| 1745 | ambiguous | EXCLUDE | 各手術與核性白內障的關係無新變化，爭議僅在題幹用詞。 | 未進入（非 INCLUDE） |
| 1747 | ambiguous | EXCLUDE | Microspherophakia 與 Weill-Marchesani 症候群的關聯未改變，屬疾病關聯事實，題目僅選項模糊。 | 未進入（非 INCLUDE） |
| 1763 | ambiguous | EXCLUDE | Stargardt flecks 位於 RPE 層屬病理事實，疑點僅為「視網膜層」措辭模糊，觀念未改變。 | 未進入（非 INCLUDE） |
