# ARTICLE-STANDARDS.md — 文章內容標準（WRITING_NEW_ARTICLE.md 的增量）

> **關係**：`WRITING_NEW_ARTICLE.md` 講「機械怎麼加一篇文章」（目錄 4 處、建置鏈、HTML 結構）。**這份**講「內容要長什麼樣才對」——FAQ、答案優先、醫療根據、叢集連結、stub 生命週期。兩份都要遵守。
> **讀者**：寫/改文章的 AI session（任何等級）。給具體判準與**可貼上的範例**；抽象要求（「寫得好」）在這裡等於沒寫。

---

## 1. 醫療正確性 — 鐵律（MODEL-GUIDE §4，任何模型都一樣）
- 每個臨床宣稱（發生率、%、劑量、時程、鑑別）**必須**能溯源到文內已有的引用（指引/RCT/官方）。
- AI **只能重述**文章已有引用支持的內容。需要新事實 → 標 `<!-- TODO(醫師確認): <問題> -->` 並在回報中列出，**絕不自己搜尋補「大概對」的醫療數字**。
- 最終正確性判定者 = 站主本人（執業醫師）。這是責任結構，不是能力問題。
- 語氣：專業但親民、**不恐嚇、不商業化**；醫學縮寫首次出現給中文全名；守《醫療法》衛教框架（不宣稱療效、不用最高級形容、不招攬）。

---

## 2. 答案優先（answer-first）— AI 引用最大槓桿
每個 `<h2>`/`<h3>` 下的**第一段**，在 40-60 字內先給直接結論，再展開。AI 引擎在**段落層級**檢索與引用，這是低權威站被引用的最有效單一改動。

**❌ 反例（鋪陳式，AI 難引用）**：
```html
<h2 id="glaucoma-symptoms">青光眼的症狀</h2>
<p data-zh="青光眼是一種複雜的疾病，牽涉到眼壓、視神經與許多因素，很多人都很關心它到底有什麼症狀……"
   data-en="...">青光眼是一種複雜的疾病……</p>
```
**✅ 正例（答案優先）**：
```html
<h2 id="glaucoma-symptoms">青光眼早期有症狀嗎？</h2>
<p data-zh="多數青光眼（隅角開放型）早期幾乎沒有症狀——周邊視野先壞、中心視力最後才受影響，患者常在視野缺損 30-50% 才察覺。因此 40 歲以上、高度近視或有家族史者建議每年檢查。"
   data-en="Most (open-angle) glaucoma has almost no early symptoms — peripheral vision degrades first...">多數青光眼……</p>
```
- 標題本身盡量寫成**病人會搜尋的問句**（「青光眼早期有症狀嗎？」勝過「青光眼的症狀」）。
- 只改語序/開頭句，**不改醫療事實**。既有文章的改寫是 BACKLOG C-02，優先 5 篇見 GROWTH-PLAYBOOK §3。

---

## 3. FAQ 區塊 — 只用 on-page `<details>`（DECISIONS D-09）
FAQ 一律寫在頁面上，JSON-LD 由 `_gen_faqpage_jsonld.py` 自動生成。**不要手寫 FAQPage JSON-LD**（產生器看到手寫版會跳過 → 雙軌）。

**可貼上的範本**（放在文章正文末、footer/related 之前）：
```html
<section class="hs-faq" aria-labelledby="hs-faq-h">
  <h2 id="hs-faq-h" data-zh="常見問題" data-en="Frequently asked questions">常見問題</h2>
  <details>
    <summary data-zh="飛蚊症會自己好嗎？" data-en="Do floaters go away on their own?">飛蚊症會自己好嗎？</summary>
    <div data-zh="良性的後玻璃體剝離造成的飛蚊，大腦通常會在數週到數月逐漸適應、變得不明顯，但陰影本身不會消失。若突然大量增加或伴隨閃光，請當天就醫。"
         data-en="Floaters from benign PVD usually...">良性的後玻璃體剝離……</div>
  </details>
  <!-- 重複 <details> 4-6 題 -->
</section>
```
**產生器門檻（不滿足會默默不收錄）**：
- 每個 zh `<summary>` 必須含**全形問號「？」**（或「迷思」「為什麼」等 hint），≤140 字。
- 每個答案 `<div>` ≥ 30 中文字（產生器下限 20，用 30 保險），CJK 比例 ≥0.18。
- 每頁 ≤15 題。noindex 頁跳過。只處理 zh 源，EN 鏡像繼承。
- **每個 h2/summary/div 都要 `data-zh` + `data-en`**（`_check_bilingual_attrs.py` 守），且可見文字 = `data-zh` 值。
- 全形標點（，。、？；「」（）），半形會被 `halfwidth_to_fullwidth.py` gate 擋。
- 樣式已在 `assets/article.css` 的 `.hs-faq`，不用另寫 `<style>`。

**每篇文章都該有 FAQ 嗎？** 問題型/研究型文章 CP 值最高（吃 rich result + 餵 AI）。本 session 已補的 7 篇是模式範例（`9303014`）。

---

## 4. 引用密度（E-E-A-T + AI 引用）
- 做臨床建議的文章（治療選擇、鑑別）**必須**有「參考文獻」區塊含 DOI 連結。
- 補統計數字時，數字後面**接來源**（例：「LAMP 研究顯示 0.05% 阿托品平均控制 67%[參考文獻 N]」）。
- 引述指引原文（AAO PPP、衛福部、學會）比自己改寫更有 AI 引用價值。

---

## 5. 新文章的內部連結義務（DECISIONS D-23）
發布新文章時，把它接進所屬**主題叢集**（兒童近視/乾眼/飛蚊症-視網膜/白內障/青光眼…）：
- 新文 → 該叢集支柱頁：一條**文內情境連結**，描述性中文錨點（「兒童近視控制總覽」，禁「點此」）。
- 支柱頁 → 新文：一條回鏈。
- 其餘交給 `_gen_related.py` 自動層（related.json + 靜態 related 區塊）。
- **不要**對既有文章批量補鏈——三叢集已全互連，過度加鏈是坑（先 `grep -oE 'href="/blog/[a-z0-9-]+"' blog/<slug>.html | sort | uniq -c` 驗證真缺）。

---

## 6. Stub（佔位/預告文）生命週期
本站有兩種「未完成」狀態，別搞混：
- **`DN.STUB_SLUGS`**（zh 佔位）：有 HTML 骨架、內容是「預告/籌備中」，設 `noindex,follow`、排除 sitemap/listings。目前：`contact-lens-safety`、`red-eye-conjunctivitis`（`cataract-surgery-faq`、`glaucoma-warnings` 已改為 301 轉址到完整指南，見 D-03）。
- **`DN.EN_STUB_SLUGS`**（en 翻譯未完成）：zh 已發布但英文 body 不完整，EN 鏡像設 noindex 避免重複內容。

**把 stub 升級為正式文章的完整程序**（例如 C-01 寫完隱形眼鏡）：
1. 寫完整內容（醫療正確性由站主定案）。
2. 從 `DN.STUB_SLUGS`（`blog/blog-shared.js`）移除該 slug。
3. 文章 `<meta robots>` 改 `index,follow`。
4. 加進 `DN.ARTICLES` + 3 處卡片（index.html、blog/index.html、blog/topics.html）——`_check_article_listings.py` 守。
5. 若原本有 301 轉址（D-03 那兩篇），從 `vercel.json` 移除該轉址。
6. 若 `_check_index_boundaries.py` 的 `PRIVATE_PAGES` 有它，移除。
7. 走建置鏈（sitemap 自動收錄）+ preflight + codex + push。
> 反向（把文章退役成 stub）就是上述反操作。**一次做完所有耦合處**，否則 CI 紅。

---

## 7. 提交前自檢（文章類）
```bash
set PYTHONIOENCODING=utf-8
python halfwidth_to_fullwidth.py --dry-run   # 必須 "WOULD WRITE: 0 files"
python _check_bilingual_attrs.py             # 每個可見元素雙語
python _check_article_listings.py            # 目錄 4 處同步
python _check_faq_schema.py                  # FAQ 若有，schema 正確
python preflight.py                          # 完整閘門（見 MODEL-GUIDE §5）
```
