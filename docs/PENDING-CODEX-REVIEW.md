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

## 補審已執行（2026-08-05，codex GPT-5.6-sol,累積審 `cad9d80..HEAD`）

**結果:REQUEST_CHANGES —— 13 項 blocking,橫跨 8 個批次。** 逐批分開審會看不到跨批交互,故一次審完整範圍。

### 貫穿全部發現的同一個病灶:**修了產物,沒修源頭**

這不是 8 個獨立疏忽,是同一個錯誤犯了四次:

| 批次 | 產物已修 | **源頭未修** | 狀態 |
|---|---|---|---|
| A-02 | `tools/eye-3d.html` | `api/admin/_new.js` 移除舊 skip link **卻沒補新的** → CMS 新建頁面**完全沒有跳過機制**(比原狀更糟) | ✅ **已修並外審 APPROVE** |
| P-01 | 64 個既有 `<head>` | `api/admin/_new.js` 仍吐**同步**字型 link → 每篇新文章重新引入 P-01 | ✅ **已修並外審 APPROVE** |
| M-12 | 我挑的 5 個生成器 | `_gen_serp_meta.py` + 2 個 checker + **4 個線上 API**(`og.js`／`feed.js`／`sitemap.js`／`_list.js`) | ⬜ 未修 |
| A-01 | 既有 `hs-skiplinks` | `_apply_i_series.py` 注入的是 **`dn-skiplinks`**,normalizer/checker 都不認;且 **CI 順序是先修剪後注入** | 🟡 class 盲區已修;**CI 順序仍未修** |

### 已結案:A-02 + P-01(2026-08-05,codex deep/high,pass 2 APPROVE)

修的是**源頭**,並補上原本不存在的守衛:

- `api/admin/_new.js` —— 字型改非阻塞(preload + `<noscript>` + bootstrap,字串與既有 64 頁**逐位元組相同**,故現有 CSP hash 已涵蓋);skip nav 補回,用 **`dn-skiplinks`**,因為 `_apply_i_series.py:78` 只在該 class 存在時抑制自己的注入 —— 用 `hs-skiplinks` 會讓頁面帶**兩個** skip nav。只發 `#main-content`,那是此模板唯一存在的目標。
- `_check_performance_budget.py` —— **新規則**:同步 Google Fonts stylesheet 一律失敗,HTML **與 scaffold 模板都掃**。原本唯一的字型規則只問「preload 有沒有套用路徑」,所以 P-01 要消滅的那個形狀**完全沒有守衛**。
- `_check_skiplinks.py` / `_normalize_skiplinks.py` —— 同時認 `hs-` 與 `dn-skiplinks`(原本漏掉 14 頁卻回報成功),並斷言 scaffold 有 skip nav、恰好一個、至少一個連結、目標都存在。
- `_gen_csp_hashes.py` —— 明確把 fonts bootstrap hash 種進 `__fallback__`,**從 scaffold 抽取**而非另抄一份字面值。今天是 no-op(404.html 已帶同一段),留著是防那個巧合改變。
- `scripts/codex_review.sh` —— 本 repo 原本**沒有**外審 wrapper,補上正式版。放 `scripts/` 而非 `tools/`,因為 **`tools/` 在本站是公開部署的**(它服務 eye-3d.html),`scripts/` 已在 `.vercelignore`。

外審另抓到兩項 P2,皆 CONFIRMED 並已修:scaffold 的**空 nav** 會讓檢查真空通過(只刪 `<a>` 不刪 `<nav>`);wrapper 的 resume 只驗 UUID **格式**不驗**相符**,一個格式正確但不同的 UUID 會續到別場 review、拿它的 APPROVE 放行 push。

> ⚠️ **後者同樣存在於 `-morning-report-main`、`CMUHdermatology-main`、`user-main` 三個 repo 的 wrapper 副本** —— 那是共用的 push 閘門,建議一併修。

**我宣稱的「0 殘留」,量的是我自己挑的清單,不是真實的出現集合。** 這正是我整段在別處獵、卻在自己手上重複犯的錯。

### 完整判定原文

```
## Blocking findings

### Batch 1 — A-02

- The CMS scaffold lost its only skip link but did not gain the standard visible skip navigation. Its `<body>` proceeds directly to the header in [api/admin/_new.js:126](C:/Users/User/Desktop/程式/user-hsiao-main/api/admin/_new.js:126). Since CMS commits go directly to `main`, newly created pages lack a keyboard bypass until someone separately runs and commits `_apply_i_series.py`.

### Batch 2 — M-13

- The new escaping checker appends a boolean instead of its diagnostic when it finds raw `<`. At [_check_jsonld_escaping.py:61](C:/Users/User/Desktop/程式/user-hsiao-main/_check_jsonld_escaping.py:61), the prematurely closed f-string makes the expression a string comparison. The checker still fails, but reports `True`/`False` instead of the affected file and remediation.

### Batch 3 — M-15

- Per-call isolation is incomplete. Five calculator calls remain direct inside one `forEach` at [blog/blog-shared.js:5464](C:/Users/User/Desktop/程式/user-hsiao-main/blog/blog-shared.js:5464). One calculator throwing aborts all later calculators and the trailing `applyTextOnly`, reproducing the exact failure M-15 claimed to eliminate.

### Batch 4 — M-09

- A successful unchanged rewrite is treated as “no entry matched.” [api/admin/_precompute-meta.js:103](C:/Users/User/Desktop/程式/user-hsiao-main/api/admin/_precompute-meta.js:103) compares output text with input text and returns 409 at line 109. Consequently, the intended aggregate `noop: true` response at line 135 is unreachable for a normal repeat run.
- The claimed `}` protection is self-verifying and unsafe. Both the rewrite and its landed check use `[^}]*?` at [api/admin/_precompute-meta.js:100](C:/Users/User/Desktop/程式/user-hsiao-main/api/admin/_precompute-meta.js:100). A `}` inside a quoted field can make the rewrite insert metadata into that string, after which the similarly truncated verifier accepts the corruption.

### Batch 6 — M-12

- The parser migration is incomplete. `_gen_serp_meta.py` still uses the apostrophe-truncating expression at [_gen_serp_meta.py:102](C:/Users/User/Desktop/程式/user-hsiao-main/_gen_serp_meta.py:102), while [_check_listing_schema.py:50](C:/Users/User/Desktop/程式/user-hsiao-main/_check_listing_schema.py:50) and [_check_en_jsonld.py:35](C:/Users/User/Desktop/程式/user-hsiao-main/_check_en_jsonld.py:35) repeat the same bug, allowing bad generated values to pass.
- Live consumers remain affected too: [api/og.js:53](C:/Users/User/Desktop/程式/user-hsiao-main/api/og.js:53), [api/feed.js:96](C:/Users/User/Desktop/程式/user-hsiao-main/api/feed.js:96), [api/sitemap.js:92](C:/Users/User/Desktop/程式/user-hsiao-main/api/sitemap.js:92), and [api/admin/_list.js:27](C:/Users/User/Desktop/程式/user-hsiao-main/api/admin/_list.js:27). T-02 now makes the `api/og.js` defect externally reachable whenever the static OG image is missing.

### Batch 7 — M-05

- The three documented chains were not reconciled with CI. CI requires the normalizers before `_gen_en_pages.py` at [.github/workflows/quality.yml:83](C:/Users/User/Desktop/程式/user-hsiao-main/.github/workflows/quality.yml:83), but AGENTS runs them afterward at [AGENTS.md:100](C:/Users/User/Desktop/程式/user-hsiao-main/AGENTS.md:100), as does the full chain in [WRITING_NEW_ARTICLE.md:43](C:/Users/User/Desktop/程式/user-hsiao-main/WRITING_NEW_ARTICLE.md:43). Its quick command also omits several required steps.
- [_check_chain_docs.py:47](C:/Users/User/Desktop/程式/user-hsiao-main/_check_chain_docs.py:47) only checks a set of script names mentioned anywhere in each document. It cannot detect wrong ordering, omissions from the actual command block, or scripts mentioned only in unrelated prose.

### Batch 9 — A-01

- The enforcement point does not cover the generator that creates future skip navigation. The normalizer and checker only recognize `class="hs-skiplinks"` at [_normalize_skiplinks.py:38](C:/Users/User/Desktop/程式/user-hsiao-main/_normalize_skiplinks.py:38) and [_check_skiplinks.py:31](C:/Users/User/Desktop/程式/user-hsiao-main/_check_skiplinks.py:31), while `_apply_i_series.py` injects `class="dn-skiplinks"` at [_apply_i_series.py:34](C:/Users/User/Desktop/程式/user-hsiao-main/_apply_i_series.py:34).
- CI runs normalization before that injection—[quality.yml:101](C:/Users/User/Desktop/程式/user-hsiao-main/.github/workflows/quality.yml:101) versus line 112. A new page can therefore receive dead unconditional targets after pruning, and the checker will ignore the resulting navigation.

### Batch 10 — T-02

- The central implementation comment still says the `/assets/og/...` rewrite is deferred and blocked by immutable caching at [api/og.js:11](C:/Users/User/Desktop/程式/user-hsiao-main/api/og.js:11). The rewrite now exists at [vercel.json:129](C:/Users/User/Desktop/程式/user-hsiao-main/vercel.json:129), and its header is intentionally non-immutable. This leaves the routing contract documented as the opposite of current behavior.

### Batch 11 — P-01

- The 64 current artifacts were converted, but the CMS source template was not. [api/admin/_new.js:86](C:/Users/User/Desktop/程式/user-hsiao-main/api/admin/_new.js:86) still emits a synchronous Google Fonts stylesheet, so every newly created CMS article reintroduces P-01.
- The guard cannot catch this because it scans only existing `.html` files at [_check_performance_budget.py:70](C:/Users/User/Desktop/程式/user-hsiao-main/_check_performance_budget.py:70).
- I found no load-event race in the converted markup: the preload’s event is queued, while the adjacent synchronous script attaches its listener before the current parser task yields.

Per instruction, I performed no writes, tests, builds, or network access.

REQUEST_CHANGES
```

### 修復前必須逐項驗證(CONFIRMED / REJECTED / UNCERTAIN),只修 CONFIRMED

**唯一已被駁回的是我最擔心的那項**:P-01 **沒有** load 事件競態——codex 獨立確認 preload 的事件排入佇列,而相鄰同步 script 在目前解析任務讓出前已掛好監聽器。

### 續審規則

修完 CONFIRMED 後 **resume 同一個 session**(勿開新的、勿盲用 `--last`),直到回 `APPROVE`。只讀 `-o` 指定的最後一則訊息。`APPROVE` 後刪除本檔案。
