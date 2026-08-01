# 待補外審清單（PENDING CODEX REVIEW）

> 這個檔案存在 = 有已上線但**外審未完成**的 commit。
> 補審取得 `APPROVE` 後**刪除本檔案**——不要留一份寫著「已無待審」的空殼,那本身就是一種假保證。

D-20 的常規閘門是 `preflight.py` → codex GPT-5.6-sol 外審 `APPROVE` → push → CI。
以下項目**跳過了第 2 關的最後一輪**,屬使用者明示定案的例外,不是新常規。

---

## 待審批次 2 — Batch A（M-01 / M-02 / P-03 / A-02 + R-01 決策）

| 欄位 | 內容 |
|---|---|
| commit 標記 | commit 標題含 `[UNREVIEWED]` |
| 上線日 | 2026-07-27 |
| 跳關原因 | Codex 額度用罄（訊息顯示 2026-08-05 12:28 重置）。使用者定案:比照前次,先 push 並標記未審,額度回復後補審 |
| 已完成的驗證 | `preflight.py` PASS（生成鏈跑到固定點 + `validate.py` + `_check_all --quick`）、`node --check` 三個 JS 檔、`npm run minify`、兩個版本紀元一致、CI |
| 外審進度 | **round-1 ~ round-5 已跑完,11 項發現全部驗證並修復（1 項由我駁回、codex 自行複查後撤回）。round-6 未跑。** |

### 已完成的五輪各抓到什麼（補審時請先覆核這些修法本身）

1. **round-1**：`blog-admin.js` 仍吐 `<hs-redflag>`／`<hs-tldr>`——我刪掉 `assets/components.js` 時只 grep 檔名,沒 grep 它**定義的自訂元素**;另 REVIEW-PLAYBOOK 三處過時 + 站主決策應寫進 `DECISIONS.md`（已補 D-26）。
2. **round-2**：插入的標記**不是雙語**（缺 `data-zh`/`data-en` → 中文會原封進 `/en/` 鏡像）；**漏 D-06 bump**（第二次犯同樣的錯）；我的註解謊稱 `app.css` 有 `.tldr` 規則（實際沒有）。**駁回**其「無任何 `blog/*.html` 含 `#proseZh`」——實測 26 篇中 20 篇有。
3. **round-3**：D-06 的「目前值」自己過時；M-16 漏列第 6 個指令 `math`。
4. **round-4**：BACKLOG M-16 第二處仍寫「5 個指令」；REVIEW-PLAYBOOK 87／238 行仍宣稱 A-02 未修、且誤指 `404.html`，以及 M-02 仍列為死碼。
5. **round-5**：**A-02 仍可重現**——`api/admin/_new.js` 仍吐 legacy skip-link，等於每篇新 scaffold 文章都重長一個隱形 focus 停留點（我只修了產物沒修源頭）；**D-10 的單一來源宣稱是假的**（6 個非文章頁仍內嵌整份 footer CSS）→ 立案 M-17 並把 D-10 降級為「目標」；帳本另有數處半矛盾。

### round-6 必須涵蓋的問題（原本要問而沒問成）

- 對 round-5 三項修正的**複驗**：`_new.js` 移除 skip-link 後，scaffold 出的頁面是否真的仍取得可見的 skip 機制（`.skip-to-main` / `.hs-skiplinks`）。
- **是否還有耐久文件與程式不一致**——這一批連續四輪都是「改一處、漏其他處」，我在 round-5、round-6 的送審內容都明確請它一次列全，但最後一輪沒跑成。**這是本批最可能殘留問題的地方。**
- M-17 延後處理的判斷是否恰當（D-10 記載的 `918dae6` 事故正是出在那 6 頁，故未逐條比對 + 視覺回歸前不動）。
- M-16 延後處理的判斷是否恰當（6 個 toolbar 指令的區塊巢狀問題屬既有，修它會動到 M-06 存檔路徑）。

### 補審指令

```bash
git add -A && codex exec -c model="gpt-5.6-sol" -c model_reasoning_effort="high" --ignore-user-config "$(cat <prompt 檔>)" -o last.txt
```

**只讀 `-o` 指定的最後一則訊息判定結果**——prompt 回音裡含有字面的 "APPROVE or REQUEST_CHANGES"，整份 transcript 做 grep 一定誤判。

---

## 待審批次 3 — Batch B 部分（M-13 JSON-LD 逸出）

| 欄位 | 內容 |
|---|---|
| commit 標記 | commit 標題含 `[UNREVIEWED]` |
| 上線日 | 2026-07-27 |
| 跳關原因 | 同批次 2:Codex 額度用罄 |
| 已完成的驗證 | preflight PASS、`_check_jsonld_escaping` 255 區塊 0 裸 `<`、變異 3/3、CI |
| 外審進度 | **完全未審**（批次 2 是 round-6 未跑;這批一輪都沒跑） |

**補審時請特別看**：
- `_jsonld.py` 的逸出是否真的不改變解析後的值(我以 `json.loads` 往返斷言,請獨立複核)。
- 12 條輸出路徑是否有遺漏,以及**是否誤改了 `sort_keys=True` 的比較用呼叫**(那會破壞冪等性)。
- `_check_jsonld_escaping.py` 從「`<` `>` `&` 都違規」收斂成「只 `<`」的判斷是否正確——依據是 `<script>` 內容為 raw text、且 `</script`／`<!--` 都以 `<` 開頭。
- 生成鏈中新步驟的位置(此批未新增鏈步驟,只改既有生成器內部)。

---

## 待審批次 4 — M-15（initBlog 逐一呼叫隔離）

| 欄位 | 內容 |
|---|---|
| commit 標記 | commit 標題含 `[UNREVIEWED]` |
| 上線日 | 2026-07-27 |
| 跳關原因 | 同前:Codex 額度用罄 |
| 已完成的驗證 | 73/73 包裝、0 誤包、0 殘留、`node --check`、safeCall 隔離行為實測、D-06 兩紀元 bump、preflight、CI |
| 外審進度 | **完全未審** |

**補審時請特別看**：
- 包裝正則是否漏掉或誤包——尤其**跨行呼叫**與**有回傳值**的用法(賦值/條件/return 應完全未動)。
- `safeCall` 吞掉例外後,是否有哪個呼叫的**失敗其實應該中止後續**(例如某個 Phase 1 呼叫是後面呼叫的前提)。**這是本批最可能的真缺陷**:把錯誤隔離開,代價是後續程式在前提未成立的狀態下繼續跑。
- Phase 1 從「拋錯即中止 initBlog」改成「逐一隔離」是否改變了首屏行為。
- 73 個包裝對 min.js 體積的影響是否仍在 size-budget 內。

---

## 待審批次 5 — M-09 / A-03

| 欄位 | 內容 |
|---|---|
| commit 標記 | commit 標題含 `[UNREVIEWED]` |
| 上線日 | 2026-07-27 |
| 跳關原因 | 同前:Codex 額度用罄 |
| 已完成的驗證 | `node --check`、對比值實算、preflight 62/0/0、D-06 bump、CI |
| 外審進度 | **完全未審** |

**補審時請特別看**：
- M-09 的三層防護是否真的擋得住它宣稱的兩種失效——特別是 **mis-anchor 回查**那一層的正則本身是否也會被同樣的 `[^}]` 問題影響。
- 三個 409 出口是否會讓**正常**的 precompute 意外失敗(誤報比漏報更容易被忽略,因為 admin 只會看到操作失敗)。
- A-03a 的 `DN.detectLang()` 在 cmdk 建構當下是否已可用(若尚未初始化會退回中文——是否可接受)。
- A-03b 換色是否影響 visual-regression 基準。

---

## 待審批次 6 — S-02（SVG 回應加 CSP）

| 欄位 | 內容 |
|---|---|
| commit 標記 | commit 標題含 `[UNREVIEWED]` |
| 上線日 | 2026-07-27 |
| 跳關原因 | 同前:Codex 額度用罄 |
| 已完成的驗證 | `_check_static_asset_headers` 15 條規則、vercel.json 合法、preflight、CI |
| 外審進度 | **完全未審** |

**補審時請特別看**：
- `default-src 'none'; sandbox` 是否會影響 `icon.svg` 作為 **favicon / manifest icon** 的載入(我判斷不會,因為那不是 document 情境,但沒有實測手段)。
- 是否該連同 `Content-Disposition: attachment` 一起加(驗收條件寫「與/或」,我只做了 CSP)。
- `assets/icons.svg` 引用數為 0——**是否真的可刪**。M-01 的教訓是「grep 檔名找不到」不等於沒人用。
- 上線後應 curl 驗證 `/icon.svg` 的標頭確實出現,且首頁 favicon 仍正常。

---

## 待審批次 7 — M-12（DN.ARTICLES 欄位解析）

| 欄位 | 內容 |
|---|---|
| commit 標記 | commit 標題含 `[UNREVIEWED]` |
| 上線日 | 2026-07-27 |
| 跳關原因 | 同前:Codex 額度用罄 |
| 已完成的驗證 | 5 檔換完 0 殘留、6 個消費點補 unescape、fixture 端到端、preflight 62/0/0、產出零變動 |
| 外審進度 | **完全未審** |

**補審時請特別看**：
- `_articles_field.unescape()` 的處理是否正確——尤其 `\`(逸出的反斜線)後接引號的情形。
- 5 個生成器是否**全部**同時改到(BACKLOG 原文強調「必須一致改全部」),以及 `_gen_og_images.py` 為何不在清單內(它未使用該 pattern,請複核)。
- 一個編輯腳本曾把 `_gen_search_index.py` 第 48 行改壞(前綴匹配 `match` 命中 `articles_match`),已修復——請確認該檔沒有其他被波及處。

---

## 待審批次 8 — M-05（建置鏈文件 drift）

| 已完成的驗證 | 三份文件補齊至 22 步、`_check_chain_docs` 變異 4/4、preflight、CI |
|---|---|
| 外審進度 | **完全未審** |

**補審時請特別看**：
- 補進三份文件的步驟**位置**是否合理(統一插在 `_gen_csp_hashes.py` 之前,因為它被標為 must-run-last)——語意上是否正確,或只是能過檢查。
- 只查單一方向(CI→文件)的取捨是否恰當,還是應該讓文件標出鏈區塊邊界以便雙向檢查。
- `_check_chain_docs.py` 的 `CI_STEP_RE` 依賴 10 空格縮排;空集合防護是否足以涵蓋所有格式變動。

---

## 待審批次 9 — S-07（admin markdown 預覽的 URL 白名單）

| 已完成的驗證 | 9 個 URL 案例 + 屬性跳脫、preflight 63/0/0、CI |
|---|---|
| 外審進度 | **完全未審** |

**補審時請特別看**：
- `mdSafeUrl()` 的 scheme 偵測是否還有繞法(我剝掉空白與控制字元後才比對,但沒有處理 HTML 實體如 `&#106;avascript:`——**預覽輸入是 markdown 原文不是 HTML,所以我判斷不需要,請複核**)。
- URL 被判定不安全時我回傳 `mdAttr(整段原文)`,讓它以純文字顯示而非消失——這個行為是否恰當。
- 既有的**渲染**順序問題(link 規則排在 image 之前,`![x](y)` 會先被 link 規則吃掉留下一個 `!`)——**我沒有動它**,那是既有的顯示瑕疵不是安全問題,但補審時可一併判斷。

---

## 待審批次 10 — A-01（skip-link 死錨點）

| 已完成的驗證 | 28 死錨點全清、冪等、`_check_skiplinks` 變異通過、鏈位置在 `_gen_en_pages` 之後、preflight 64/0/0、CI |
|---|---|
| 外審進度 | **完全未審** |

**補審時請特別看**：
- normalizer 的 `LINK_RE` 是否可能誤刪**合法**連結(它只在 `hs-skiplinks` nav 內作用,但 `<a>` 的比對是否夠嚴)。
- 鏈位置:排在 `_gen_en_pages.py` 之後、`_gen_search_index.py` 之前——是否有其他步驟會在之後重新注入 skip-nav。
- `_check_skiplinks.py` 與 `_check_dead_anchors.py` 的**分工**是否正確:後者白名單含 `hs-related`(JS 注入,對的),前者只看 skip-nav(文章頁該 id 靜態存在,故無歧義)。這個推理請獨立複核。
- nav 被清空後只剩 `<nav>` 空殼——是否該連同移除(我刻意保留,避免改變 DOM 形狀)。

---

## 待審批次 11 — T-02（OG 圖 fallback rewrite）

| 已完成的驗證 | rewrite + 非-immutable 兩個不變式釘進 checker、變異 2/2、preflight 64/0/0、CI |
|---|---|
| 外審進度 | **完全未審** |

**補審時請特別看**：
- ~~Vercel 的 filesystem 是否真的優先於 rewrites~~ **已於上線後實測確認**: 回 **200 image/png 31,361 bytes**(靜態檔勝出), 回 **200 image/png**(動態卡接手,不再 404)。原先我標為「無實測手段」,現在有數據。
- `:slug` 參數是否會匹配到含斜線或點的路徑,造成非預期的 rewrite。
- `/api/og` 對不存在的 slug 的行為(應回合理的預設卡而非 500)。
- 上線後應實測:既有文章的 OG PNG 仍回靜態檔(比對 bytes 或 header),而一個不存在的 slug 會回動態卡。

---

## 待審批次 12 — P-01（字型非阻塞載入）

| 已完成的驗證 | 64 檔轉換 + 後置條件 0 失敗、bootstrap hash 確認在 CSP 內、perf 規則同步更新、preflight 64/0/0、CI(Lighthouse + 視覺回歸) |
|---|---|
| 外審進度 | **完全未審** |

**補審時請特別看**：
- **load 事件時序**:bootstrap 緊接在 `<link rel=preload>` 之後同步執行。我的判斷是「解析期間事件迴圈不會跑,所以 load 不可能在監聽器掛上前觸發」——**請獨立確認**。若判斷錯誤,字型在部分情況下會停在 preload、永不套用。
- 三種 URL 變體是否都正確保留(尤其 `&amp;` 那兩個 /en/ 檔——preload / noscript / bootstrap 三處必須逐字一致,否則會下載兩份)。
- `_check_performance_budget.py` 規則的改寫是否**削弱**了原本的保護(我認為是對準真實不變式,請覆核)。
- CI Lighthouse 的 FCP/LCP 是否真的改善;視覺回歸是否有字型 fallback 造成的位移。

---

## 補審完成後要做的事

1. 在 `docs/BACKLOG.md` 的 Batch A 段落把「⚠ 待補外審」改成實際結果。
2. `REQUEST_CHANGES` 的話：照常逐項驗證（CONFIRMED / REJECTED / UNCERTAIN），只修 CONFIRMED，續審到 `APPROVE`。
3. `APPROVE` 後**刪除本檔案**。
