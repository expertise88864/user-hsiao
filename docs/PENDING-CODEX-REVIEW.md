# 待補外審清單（PENDING CODEX REVIEW）

> 本檔案存在 = 有已上線但**外審未完成**的 commit。
> 全部補審完成並取得 `APPROVE` 後，**刪除本檔案**（不要留一份說「已無待審」的空殼，那本身就是一種假保證）。

D-20 的常規閘門是 `preflight.py` → codex GPT-5.6-sol 外審 `APPROVE` → push → CI。
以下項目**跳過了第 2 關**，屬使用者明示定案的例外，不是新常規。

---

## 待審批次 1 — M-07 / M-08 / P-04 / P-05

| 欄位 | 內容 |
|---|---|
| commit 標記 | commit 標題含 `[UNREVIEWED]` |
| 上線日 | 2026-07-26 |
| 跳關原因 | 使用者 Codex 額度用罄；使用者定案「先 commit+push、標記未審，額度回復後一次補審」 |
| 已完成的驗證 | `preflight.py` PASS（生成鏈跑到固定點 + `validate.py` + `_check_all --quick` 59/0/0）、`node --check` 四個 JS 檔、`npm run minify`、CI 全綠 |
| 外審進度 | **round-1 已跑完並回 REQUEST_CHANGES（4 項 blocking，全數 CONFIRMED 且已修）；round-2 未跑** |

### round-1 的 4 項發現與修法（補審時請先覆核這些修法本身）

1. `sw.js` `activate` 的 POPULAR 精快取是**浮動 promise**，install 縮成 SHELL-only 後會造成離線退化 → 改為 `return`，納入 `waitUntil`。
2. `_check_pwa.py` 我改的斷言用 `\w+\.map`，**連 `PRECACHE.map` 都收 = 擋不住 P-04 迴歸本身** → 改為要求 `Promise.allSettled(SHELL.map((u) => c.add(u)))`、拒絕 install 出現其他 tier、要求 `waitUntil`，並新增 activate 端斷言（含拒絕浮動形式）。
3. `_gen_en_pages.py` 的 `prune_en_jsonld` 未達成自己 docstring 宣稱的「at any nesting」 → 改為遞迴所有容器屬性。
4. `sw.js` 註解宣稱 `trimCache` 有 PRECACHE keep-list —— **錯誤**；`trimCache` 從不讀 PRECACHE → 同時修正註解與其錯誤來源（`PRECACHE` 宣告處的既有註解）。

### round-2 必須涵蓋的問題（原本要問而沒問成的）

- 把 POPULAR 精快取納入 `activate` 的 `waitUntil` 是否引入我未考慮到的啟動延遲或正確性問題（SW 在 waitUntil settle 前停留在 activating，functional events 會被延後）。
- 收緊後的 `_check_pwa.py` 斷言**是否仍可能被壞掉的程式滿足**，或反過來**對合理重構誤報**。
- 遞迴版 `prune_en_jsonld` 是否會刪除或破壞合法 schema。
- P-05 造成的全站 64 個 HTML critical-CSS 變更（`@media` → `@supports`）是否真的只有已宣稱的兩個生效規則。

### 補審指令

```bash
git add -A && codex exec -c model="gpt-5.6-sol" -c model_reasoning_effort="high" --ignore-user-config "$(cat <你的 prompt 檔>)" -o last.txt
```

**只讀 `-o` 指定的最後一則訊息判定結果** —— prompt 回音裡含有字面的 "APPROVE or REQUEST_CHANGES"，整份 transcript 做 grep 一定誤判。

---

## 補審完成後要做的事

1. 在 `docs/BACKLOG.md` 的 Round 3 段落把「⚠ 待補外審」改成實際結果。
2. `REQUEST_CHANGES` 的話：照常驗證每一項（CONFIRMED / REJECTED / UNCERTAIN），只修 CONFIRMED，續審到 `APPROVE`。
3. `APPROVE` 後**刪除本檔案**。
