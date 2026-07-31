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

## 補審完成後要做的事

1. 在 `docs/BACKLOG.md` 的 Batch A 段落把「⚠ 待補外審」改成實際結果。
2. `REQUEST_CHANGES` 的話：照常逐項驗證（CONFIRMED / REJECTED / UNCERTAIN），只修 CONFIRMED，續審到 `APPROVE`。
3. `APPROVE` 後**刪除本檔案**。
