# MODEL-GUIDE.md — 模型能力路由 + Harness 極限 + 誠實條款

> **這份檔案的存在理由**：本 repo 未來由**輪替的 AI session**維護，多數是較小模型（Sonnet/Haiku/較舊 Opus）。這份檔案由一個較強模型寫成，把「哪些任務靠自己就能做好、哪些必須升級或求助、遇到能力邊界怎麼辦」固化下來，讓每個弱模型 session 開場就知道自己的邊界，不會**假裝**有它沒有的判斷力。
> **給正在讀這份檔的你（AI）**：先自問「我現在是什麼等級的模型？」——看系統提示的 model id。然後對照 §1 的表決定你能不能獨立完成手上的任務。**不確定自己能不能做好，就當作不能，走升級路徑。** 過度自信是這個 repo 最貴的失敗模式（YMYL 醫療站，錯誤會傷到真實病人與站主信譽）。

---

## 1. 任務 → 需要的能力等級

| 任務類型 | 最低可獨立執行等級 | 為什麼 / 判準 |
|---|---|---|
| 跑建置鏈、`_check_all.py --quick`、修 CI 紅燈（照 DECISIONS/PLAYBOOK 對症） | **Haiku** 級可 | 純機械、有明確指令與判準、有 CI 驗證網 |
| 加一篇**已寫好內容**的文章進目錄（DN.ARTICLES + 3 處卡片 + 建置鏈） | **Haiku~Sonnet** | 機械但耦合多（4 處），照 WRITING_NEW_ARTICLE.md 逐步；CI `_check_article_listings` 守 |
| 依 BACKLOG 既有驗收條件執行一個**已定義**的修復 | **Sonnet** | 判準已寫死；需要讀懂耦合、驗證固定點 |
| robots/CSP/schema/redirect 等**政策性**變更（會動 DECISIONS） | **Sonnet + 走升級檢查** | 需判斷連鎖影響；必跑 codex 二審（§3） |
| **新的** SEO/架構取捨（沒有前例、要權衡） | **Opus 級**，或 Sonnet + 外部第二意見 | 需要跨面向權衡與品味 |
| **醫療內容正確性**（新增/修改臨床宣稱、數字、劑量） | **沒有任何模型可獨立定案** | 見 §4「不可替代區」——一律回站主 |
| 判斷「這個 SEO 建議值不值得做」的**優先序/品味** | **Opus 級評審或人類**；Sonnet 易被行銷話術帶偏 | 見 §4；本 session 的成長研究就剔除了 6 個看似合理實則過時的宣稱 |

**用法**：任務落在你的等級**以下** → 直接做（但仍走 §5 驗證儀式）。落在你的等級**以上** → 走 §2 升級路徑，不要硬做。

---

## 2. 升級路徑（能力不足時怎麼辦，按優先序）

1. **拆解 + 驗證補足執行品質**（Sonnet 對「機械但複雜」有效）：
   - 把大任務拆成有明確判準的小步；每步用 `_check_*` 或 `preflight.py` 驗證。
   - 對「找 bug/找 finding」類：用**對抗式驗證**——每個發現先花一次力氣去**反駁它自己**（找反證 file:line），反駁不掉才算數。本 session 的 code review 就靠這招把 9 個高風險發現濾到 8 個真的。
   - 對「不確定哪個方案好」：產 2-3 個方案，各自列證據，再選——比單一方案硬做可靠。
2. **外部第二意見（codex GPT-5.6-sol，本 repo 已接好）**：
   - 政策變更、push 前 diff、拿不準的取捨 → 交 codex MCP（`model=gpt-5.6-sol`）。這是站主的全域規則，也是弱模型補品味的主力。用法見 §3。
3. **升級模型**：任務明顯落在「Opus 級/品味」格 → 明確告訴站主「這題建議用更強的模型或你本人決定」，並把你已整理的證據附上，**不要**用弱模型硬給一個看似完整的答案。
4. **明說做不到**：查不到、驗證不了、超出能力 → **標註**（見 §6 誠實條款），不編造。

**拆解/驗證/多樣本評審補得了什麼、補不了什麼**（誠實）：
- ✅ 補得了：執行品質、找 bug 的漏網、機械複雜度、規格明確的實作。
- ❌ 補不了：模糊題的品味、跨面向優先序、醫療正確性、「這個設計美不美/對不對味」。這些遇到就升級或回人類，不要用更多 agent 假裝補上。

---

## 3. Codex GPT-5.6-sol 二審（外部第二意見）— 具體用法

**何時必用**：(a) 每次 `git push` 前（站主全域規則）；(b) 任何動 DECISIONS.md 的政策變更；(c) 你對某取捨拿不準時。

**怎麼跑**（codex MCP 已在 user scope 接好）：
```
mcp__codex__codex  參數：
  model: "gpt-5.6-sol"
  sandbox: "read-only"          # 只審不改
  cwd: "C:\\Users\\User\\Desktop\\程式\\user-hsiao-main"
  prompt: 「<把 staged diff 貼進來> + 這段脈絡 + 請列 blocking issues，最後輸出 APPROVE 或 REQUEST_CHANGES」
```
CLI 後備（任何 session）：`git diff --cached | codex exec -c model="gpt-5.6-sol" --skip-git-repo-check "<review 指令>"`
**判準**：codex 回 REQUEST_CHANGES → 修到它 APPROVE 才 push；回 APPROVE 但有非阻塞註記 → 記錄、自行判斷是否順手修。
**注意**：codex 也是「第二意見」不是「真理」——本 session codex 曾提一個非阻塞註記（ClaudeBot 分類），我判斷不影響行為而保留並說明。二審是為了抓你漏的，不是外包判斷。

---

## 4. 機器不可替代區（任何模型都一樣，不是能力問題是責任結構）

1. **醫療內容正確性**：臨床宣稱、發生率、劑量、時程、鑑別診斷——**最終判定者只能是站主本人（執業醫師）**。AI 只能重述文章已有引用支持的內容；需要新事實時標 `<!-- TODO(醫師確認) -->` 回報，**絕不**自己搜尋補「大概對」的醫療數字。理由：YMYL，錯誤直接傷病人；且法律責任在醫師。
2. **作者頁/招攬限制**（DECISIONS D-08）：任職醫院名稱、掛號、廣告——只有站主能決定。AI 絕不自行加，也絕不編造作者的外部檔案 URL（sameAs）。
3. **品味/優先序的最終拍板**：AI 可提排序 + 證據，但「先做哪個」的價值權衡若牽涉站主的時間/意願/風險偏好 → 呈現選項讓站主選（本 session 多次用 AskUserQuestion 正是這個道理）。

---

## 5. 驗證儀式（每個等級都要做，這是品質的地板）

**所有改動（包括文件、設定與 audit commit）→ 完整 pre-push 閘門（DECISIONS D-20）**：
```bash
python preflight.py          # 生成／靜態子閘門；不得使用 --fast 或 --allow-fallback 當交付證據
npm run test:api
python -m unittest discover -s tests/python
npm run test:seo
python _check_size_budget.py # 與 hosted Size budget 共用同一份門檻；也已納入 preflight 靜態檢查
# 完成所有其他適用本機 CI 等效檢查，保存版本、exit code 及平台差異
# → Codex 二審 APPROVE 與獨立 Opus review（額度例外依 AGENTS pending 規則）
git push origin main
python _ci_status.py <sha> --watch   # 無 gh CLI，用這個盯 CI
```
**平台與範圍**：本機瀏覽器功能測試必跑；Windows 截圖不能替代 Ubuntu 視覺基準。對改動頁面保留同平台前後比對，推送後仍必須確認 visual、Lighthouse 及所有其他適用 GitHub jobs 的成功。任何必要本機等效檢查不可執行時，依 AGENTS 回報缺口取得決定，不把缺失當成通過。

**「固定點」是什麼、為什麼**：跑一次建置鏈 → `git add -A` → 再跑一次 → `git diff` 必須為空。空 = 你提交的狀態是產生器的不動點 = CI 的 drift 檢查會過。非空 = 你漏跑了某步或有非冪等，先解決再 push。這一招把「Windows/Linux 位元差異」以外的 drift 全擋掉。
**CI 紅了先分類**（DECISIONS D-21）：查 job/step 與實際 SHA；drift 也不能冒充全綠。修正或 regen 後重新執行適用驗證，最後核对新 SHA 的所有 GitHub checks；不得使用 skip-ci。

---

## 6. 誠實條款（明確寫給弱模型）

1. **不確定就查，查不到就標註，不要編造。** 尤其：醫療數字、外部 URL、「Google 一定會…」這類斷言。
2. **標註 harness 極限**——本環境已知做不到的事，遇到直接說，不要假裝：
   - **歷史 session 限制，需重新測量：連不上線上站**：sandbox 擋 Vercel HTTPS（連 vercel.com 都 timeout，但 google.com 正常）。當時「線上頁面/回應頭/rendered HTML/線上 sitemap」本地驗不了；2026-09-06 已可取得 Production 回應，不能沿用此限制 → 標註「以 GSC / CI 的 Lighthouse-axe-indexability job 為準」，不要腦補線上狀態。
   - ❌ **WebSearch 只有美國 locale**：查台灣在地排名/索引會失真 → 標註，請站主用台灣 GSC 佐證。
   - ❌ **無 `gh` CLI**：用 `_ci_status.py`（打公開 GitHub API，無需 token）盯 CI，不要假裝有 gh。
   - ❌ **視覺基準本地產不了**：Windows 光柵化 ≠ CI Ubuntu，本地截圖必 mismatch（DECISIONS D-13）。
   - ⚠️ **子 agent / 大 workflow 會撞速率限制**：本 session 的 deep-research fan-out 一啟動就被伺服器端限流；多代理同時併發風險高。撞到就退回**少量序列**的 WebSearch/檢查，或稍後重試，不要無限重跑。
   - ⚠️ **`git add -A` 會誤收本地產物**：本 session 誤收 playwright-report/（已 gitignore）。commit 前一律看 `git status -s` 清單。
   - ⚠️ **Windows console 是 cp950/GBK**：Python 印 Unicode（✓、中文）會 `UnicodeEncodeError` → 一律 `set PYTHONIOENCODING=utf-8` 或用 ASCII 標記。
3. **標註你自己這次的不確定**：對現況判定沒親自驗證的部分，寫「based on <來源>，未親驗」而不是講得像確認過。本檔 §1 的等級表是**判斷**不是實測，未來 session 可依實際經驗修正它。

---

## 7. 這個 repo 特有的「別踩」清單（血淚，按頻率）
- 別 push 前不 `git pull --rebase`——/admin CMS 會直接 commit main（CLAUDE.md ANTI-OVERWRITE）。
- 別手改 `/en/`（自動生成）、別 `--no-verify`/`--force`。
- 別改一半耦合（robots↔測試↔檢查器；vercel headers↔檢查器；見 REVIEW-PLAYBOOK §9 矩陣）。
- 別把 footer CSS 搬回 article.css（DECISIONS D-10）。
- 別對已完整互連的叢集批量加內鏈（D-23）——先 grep 驗證真缺。
- 別把 CI 的 drift 自癒 commit 當成全綠證據；驗證最終 SHA（D-21）。
- 別新增未溯源的醫療數字（§4）。

---

## 8. 本檔維護
- 未來 session 若發現本檔的能力等級判斷有誤（例如某任務 Sonnet 其實做得很好/很差）→ 修正 §1 表並註記依據。
- 發現新的 harness 極限 → 加進 §6。
- 這是「活文件」：判斷會隨模型演進，但**誠實面對邊界**這條原則不變。
