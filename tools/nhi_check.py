#!/usr/bin/env python3
"""Check the NHI rule registry (data/nhi/registry.json) against official sources.

Re-fetches each entry's official source, isolates the rule text, normalizes it
and compares its sha256 with the stored fingerprint. Prints a report grouped as
changed / unknown / unchanged, with the affected articles and exam questions.

Usage:
    python tools/nhi_check.py                 # check every entry
    python tools/nhi_check.py --id atropine-14-9-6 --id iol-self-pay-medians
    python tools/nhi_check.py --json out.json # also write machine-readable results

Exit codes: 0 all unchanged; 1 at least one changed; 2 nothing changed but at
least one entry is unknown (source blocked, unreachable or unreadable). Unknown
is never reported as unchanged, and exit 2 must not be read as a clean pass.

A PDF source needs pypdf. Without it, PDF entries are unknown, not unchanged.
"""
from __future__ import annotations

import argparse
import csv
import datetime
import difflib
import functools
import hashlib
import html
import io
import json
from pathlib import Path
import re
import ssl
import statistics
import sys
import unicodedata
import urllib.error
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
REGISTRY = ROOT / "data" / "nhi" / "registry.json"
USER_AGENT = "HsiaoEye-NHI-Checker/1.0 (+https://hsiao.chendermatologist.com)"
TIMEOUT_SECONDS = 180
MIN_DOCUMENT_CHARS = 200

CHANGED = "changed"
UNCHANGED = "unchanged"
UNKNOWN = "unknown"

ALLOWED_KINDS = {
    "pdf_section",
    "pdf_absent",
    "html_section",
    "csv_absent",
    "csv_rows",
    "zip_csv_rows",
    "json_query",
}
REQUIRED_FIELDS = {"id", "topic", "rule_zh", "effective", "version", "source", "affects", "fingerprint", "baseline"}

_PAGE_HEADER = re.compile(
    r"^[ \t　]*\(\d{2,3}\.\d{1,2}\.\d{1,2}更新\)[ \t　]*\n?(?:[ \t　]*\d{1,3}[ \t　]*\n)?",
    re.MULTILINE,
)
_DOC_VERSION = re.compile(r"\((\d{2,3}\.\d{1,2}\.\d{1,2})更新\)")
_ZERO_WIDTH = re.compile("[​-‍⁠﻿]")
_CHROME_TAGS = re.compile(r"<(script|style|head|nav|footer)\b.*?</\1>", re.IGNORECASE | re.DOTALL)
_ANY_TAG = re.compile(r"<[^>]+>")


class SourceUnavailable(Exception):
    """The source could not be fetched or read, so nothing can be concluded."""


class SectionMissing(Exception):
    """The document was read, but the rule's section is gone or was renumbered."""


def normalize(text: str) -> str:
    """Canonical form for hashing: NFKC, bracket variants unified, no whitespace."""
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("〔", "[").replace("〕", "]")
    text = _ZERO_WIDTH.sub("", text)
    return re.sub(r"\s+", "", text)


def fingerprint(normalized_text: str) -> str:
    return hashlib.sha256(normalized_text.encode("utf-8")).hexdigest()


def strip_page_furniture(page_text: str) -> str:
    """Remove the running version header and page number of the rules PDF."""
    return _PAGE_HEADER.sub("", page_text)


def document_version(raw_text: str) -> str | None:
    """Return the version printed in a rules PDF header, such as 115.10.22."""
    found = _DOC_VERSION.search(raw_text)
    return found.group(1) if found else None


def extract_section(document: str, start: str, end: str) -> str:
    """Return the normalized text from the start marker up to the end marker."""
    normalized = normalize(document)
    start_key = normalize(start)
    end_key = normalize(end)
    begin = normalized.find(start_key)
    if begin < 0:
        raise SectionMissing(f"找不到段落起點：{start}")
    finish = normalized.find(end_key, begin + len(start_key))
    if finish < 0:
        raise SectionMissing(f"找不到段落終點：{end}")
    return normalized[begin:finish]


def absence_summary(document: str, terms: list[str]) -> str:
    """Summarize which terms appear, as text that changes when a listing appears."""
    lines = []
    for term in terms:
        present = re.search(term, document, re.IGNORECASE) is not None
        lines.append(f"{term}={'present' if present else 'absent'}")
    return normalize(";".join(lines))


@functools.lru_cache(maxsize=8)
def pdf_to_text(content: bytes) -> str:
    """Parsing the 400-page rules PDF takes minutes, so each file is parsed once."""
    try:
        import pypdf
    except ImportError as exc:
        raise SourceUnavailable("未安裝 pypdf，無法讀取 PDF") from exc
    try:
        reader = pypdf.PdfReader(io.BytesIO(content))
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    except Exception as exc:
        raise SourceUnavailable(f"PDF 解析失敗：{exc}") from exc


def html_to_text(content: bytes) -> str:
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise SourceUnavailable(f"HTML 解碼失敗：{exc}") from exc
    return html.unescape(_ANY_TAG.sub("", _CHROME_TAGS.sub("", text)))


def decode_csv(content: bytes, encoding: str) -> list[list[str]]:
    try:
        return list(csv.reader(io.StringIO(content.decode(encoding))))
    except (UnicodeDecodeError, csv.Error, LookupError) as exc:
        raise SourceUnavailable(f"CSV 解碼失敗：{exc}") from exc


def require_document(text: str) -> str:
    if len(text.strip()) < MIN_DOCUMENT_CHARS:
        raise SourceUnavailable("來源內容過短，可能是錯誤頁或無文字層")
    return text


def _tls_context() -> ssl.SSLContext:
    """Verified TLS. Python 3.13 adds a strict X.509 check that the certificate of
    info.nhi.gov.tw fails (no Subject Key Identifier); chain and hostname checks stay on."""
    context = ssl.create_default_context()
    context.verify_flags &= ~ssl.VERIFY_X509_STRICT
    return context


def fetch_url(url: str, method: str = "GET", body: dict | None = None) -> tuple[bytes, dict]:
    """Fetch a URL. Every failure, including a bot challenge, is SourceUnavailable."""
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("User-Agent", USER_AGENT)
    if data is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS, context=_tls_context()) as response:
            headers = {key.lower(): value for key, value in response.headers.items()}
            content = response.read()
    except urllib.error.HTTPError as exc:
        mitigated = exc.headers.get("cf-mitigated") if exc.headers else None
        note = "（Cloudflare 挑戰頁，腳本不可讀）" if mitigated else ""
        raise SourceUnavailable(f"HTTP {exc.code}{note}") from exc
    except (urllib.error.URLError, OSError) as exc:
        raise SourceUnavailable(f"連線失敗：{exc}") from exc
    if headers.get("cf-mitigated"):
        raise SourceUnavailable("Cloudflare 挑戰頁，腳本不可讀")
    return content, headers


class CachedFetcher:
    """Fetch each distinct request once per run; failures are cached too."""

    def __init__(self, fetch=None):
        self._fetch = fetch or fetch_url
        self._results: dict = {}

    def __call__(self, url: str, method: str = "GET", body: dict | None = None) -> tuple[bytes, dict]:
        key = (url, method, json.dumps(body, sort_keys=True, ensure_ascii=False))
        if key not in self._results:
            try:
                self._results[key] = ("ok", self._fetch(url, method, body))
            except SourceUnavailable as exc:
                self._results[key] = ("error", exc)
        state, value = self._results[key]
        if state == "error":
            raise value
        return value


def _load_json(content: bytes):
    try:
        return json.loads(content.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise SourceUnavailable(f"JSON 解析失敗：{exc}") from exc


def parse_iol_categories(rows, _today) -> str:
    if not isinstance(rows, list) or not rows:
        raise SourceUnavailable("官方查詢未回傳人工水晶體類別")
    return "\n".join(sorted(str(row["text"]) for row in rows))


def parse_iol_medians(rows, _today) -> str:
    """One line per class: the median self-pay amount, as the articles quote it."""
    if not isinstance(rows, list) or not rows:
        raise SourceUnavailable("官方查詢未回傳收費資料")
    groups: dict[str, list[float]] = {}
    for row in rows:
        groups.setdefault(row["codE_DESC5"], []).append(float(row["ouT_AMT"]))
    return "\n".join(f"{name}={statistics.median(groups[name]):g}" for name in sorted(groups))


def parse_iol_pay_price(rows, _today) -> str:
    if not isinstance(rows, list) or not rows:
        raise SourceUnavailable("官方查詢未回傳收費資料")
    prices = sorted({float(row["paY_PRICE"]) for row in rows})
    return "健保支付點數=" + ",".join(f"{price:g}" for price in prices)


def parse_service_items(payload, _today) -> str:
    """Code and name of each currently paid item; the price is deliberately left out."""
    if not isinstance(payload, dict) or "data" not in payload:
        raise SourceUnavailable("支付標準查詢回傳格式不符")
    rows = payload["data"] or []
    return "\n".join(sorted(f"{row['treaT_CODE']}={row['curE_CNAME']}" for row in rows))


def parse_device_review(payload, _today) -> str:
    if not isinstance(payload, dict) or "data" not in payload:
        raise SourceUnavailable("審議進度查詢回傳格式不符")
    rows = payload["data"] or []
    fields = ("meT_RCNAME", "doH_LICENSE_NO", "approV_STATUS_NAME", "approV_DATE", "exaM_COMMENT")
    return "\n".join(sorted("|".join(str(row.get(field)) for field in fields) for row in rows))


def parse_drug_listing(payload, today) -> str:
    """Whether any item under the query is paid today; the price is left out."""
    if not isinstance(payload, dict) or "data" not in payload:
        raise SourceUnavailable("健保用藥品項查詢回傳格式不符")
    rows = payload["data"] or []
    listed = [
        row
        for row in rows
        if str(row.get("paY_E_DATE") or "")[:10] >= today and float(row.get("paY_PRICE") or 0) > 0
    ]
    return "listed" if listed else "not-listed"


JSON_PARSERS = {
    "iol_categories": parse_iol_categories,
    "iol_medians": parse_iol_medians,
    "iol_pay_price": parse_iol_pay_price,
    "service_items": parse_service_items,
    "device_review": parse_device_review,
    "drug_listing": parse_drug_listing,
}


def _extract_rows(rows: list[list[str]], source: dict) -> str:
    pattern = re.compile(source["contains"], re.IGNORECASE)
    fields = source["fields"]
    picked = set()
    for row in rows:
        searched = " ".join(row[index] for index in source["search_fields"] if index < len(row))
        if pattern.search(searched):
            picked.add("|".join(row[index].strip() if index < len(row) else "" for index in fields))
    return "\n".join(sorted(picked))


def _read_pdf_document(source: dict, fetcher) -> tuple[str, str | None]:
    content, headers = fetcher(source["url"])
    if content[:5] != b"%PDF-":
        raise SourceUnavailable(f"預期 PDF，實際為 {headers.get('content-type', '未知格式')}")
    raw = require_document(pdf_to_text(content))
    return strip_page_furniture(raw), document_version(raw)


def extract(source: dict, fetcher, today: str) -> tuple[str, str | None]:
    """Return (normalized rule text, document version when the source prints one)."""
    kind = source.get("kind")
    if kind == "pdf_section":
        document, version = _read_pdf_document(source, fetcher)
        return extract_section(document, source["start"], source["end"]), version
    if kind == "pdf_absent":
        document, version = _read_pdf_document(source, fetcher)
        return absence_summary(document, source["terms"]), version
    if kind == "html_section":
        content, _headers = fetcher(source["url"])
        document = require_document(html_to_text(content))
        return extract_section(document, source["start"], source["end"]), None
    if kind == "csv_absent":
        content, _headers = fetcher(source["url"])
        rows = decode_csv(content, source["encoding"])
        document = require_document("\n".join(" ".join(row) for row in rows))
        return absence_summary(document, source["terms"]), None
    if kind == "csv_rows":
        content, _headers = fetcher(source["url"])
        rows = decode_csv(content, source["encoding"])
        require_document("\n".join(" ".join(row) for row in rows))
        return normalize(_extract_rows(rows, source)), None
    if kind == "zip_csv_rows":
        content, _headers = fetcher(source["url"])
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                member = archive.read(source["member"])
        except (zipfile.BadZipFile, KeyError) as exc:
            raise SourceUnavailable(f"壓縮檔讀取失敗：{exc}") from exc
        rows = decode_csv(member, source["encoding"])
        require_document("\n".join(" ".join(row) for row in rows))
        return normalize(_extract_rows(rows, source)), None
    if kind == "json_query":
        parser = JSON_PARSERS[source["parser"]]
        lines = []
        for query in source["queries"]:
            content, _headers = fetcher(source["url"], "POST", query["body"])
            try:
                parsed = parser(_load_json(content), today)
            except (KeyError, TypeError, ValueError) as exc:
                raise SourceUnavailable(f"查詢結果欄位不符：{exc}") from exc
            label = query.get("label")
            lines.append(f"{label}:{parsed}" if label else parsed)
        return normalize("\n".join(lines)), None
    raise SourceUnavailable(f"未知的來源類型：{kind}")


def readable_diff(old: str, new: str) -> list[str]:
    """Line diff of whitespace-free text, split at sentence and clause boundaries."""
    def split(text: str) -> list[str]:
        return [part for part in re.split(r"(?<=[。;:])|(?=\n)", text) if part]

    return list(difflib.unified_diff(split(old), split(new), "登錄版本", "目前來源", lineterm="", n=0))


def check_entry(entry: dict, fetcher, today: str) -> dict:
    result = {
        "id": entry["id"],
        "topic": entry["topic"],
        "url": entry["source"]["url"],
        "affects": entry["affects"],
        "status": UNKNOWN,
        "reason": "",
        "diff": [],
        "document_version": None,
    }
    try:
        current, version = extract(entry["source"], fetcher, today)
    except SourceUnavailable as exc:
        result["reason"] = str(exc)
        return result
    except SectionMissing as exc:
        result["status"] = CHANGED
        result["reason"] = f"{exc}（段落可能被刪除或改號）"
        return result
    result["document_version"] = version
    if fingerprint(current) == entry["fingerprint"]:
        result["status"] = UNCHANGED
        recorded = entry["source"].get("document_version")
        if version and recorded and version != recorded:
            result["reason"] = f"文件版本由 {recorded} 更新為 {version}，本條文字未變"
        return result
    result["status"] = CHANGED
    result["reason"] = "規則文字與登錄指紋不符"
    result["diff"] = readable_diff(entry.get("baseline", ""), current)
    return result


def run(entries: list[dict], fetcher, today: str) -> list[dict]:
    return [check_entry(entry, fetcher, today) for entry in entries]


def exit_code(results: list[dict]) -> int:
    statuses = {result["status"] for result in results}
    if CHANGED in statuses:
        return 1
    if UNKNOWN in statuses:
        return 2
    return 0


def _affects_lines(result: dict) -> list[str]:
    affects = result["affects"]
    lines = ["    受影響文章：" + ("、".join(affects.get("articles", [])) or "（無）")]
    questions = affects.get("questions", [])
    lines.append("    陳述此規則的題目：" + ("、".join(map(str, questions)) or "（無）"))
    related = affects.get("related_questions", [])
    if related:
        lines.append("    提及相關藥物或器材的題目：" + "、".join(map(str, related)))
    return lines


def format_report(results: list[dict]) -> str:
    groups = {
        CHANGED: [r for r in results if r["status"] == CHANGED],
        UNKNOWN: [r for r in results if r["status"] == UNKNOWN],
        UNCHANGED: [r for r in results if r["status"] == UNCHANGED],
    }
    lines = [
        f"NHI 規則檢查：變更 {len(groups[CHANGED])}、未知 {len(groups[UNKNOWN])}、未變 {len(groups[UNCHANGED])}",
    ]
    if groups[CHANGED]:
        lines.append("\n=== changed（須人工檢視）===")
        for result in groups[CHANGED]:
            lines.append(f"[{result['id']}] {result['topic']}")
            lines.append(f"    來源：{result['url']}")
            lines.append(f"    原因：{result['reason']}")
            lines.extend(_affects_lines(result))
            lines.extend("    " + row for row in result["diff"])
    if groups[UNKNOWN]:
        lines.append("\n=== unknown（無法確認，不代表未變）===")
        for result in groups[UNKNOWN]:
            lines.append(f"[{result['id']}] {result['reason']}")
            lines.append(f"    來源：{result['url']}")
            lines.extend(_affects_lines(result))
    if groups[UNCHANGED]:
        lines.append("\n=== unchanged ===")
        for result in groups[UNCHANGED]:
            note = f"（{result['reason']}）" if result["reason"] else ""
            lines.append(f"[{result['id']}]{note}")
    return "\n".join(lines)


def validate_registry(entries: list[dict]) -> list[str]:
    """Return schema problems; an empty list means the registry is well formed."""
    problems = []
    seen = set()
    for index, entry in enumerate(entries):
        label = entry.get("id", f"#{index}")
        missing = REQUIRED_FIELDS - set(entry)
        if missing:
            problems.append(f"{label}: 缺少欄位 {sorted(missing)}")
            continue
        if entry["id"] in seen:
            problems.append(f"{label}: id 重複")
        seen.add(entry["id"])
        effective = entry["effective"]
        if effective is not None and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(effective)):
            problems.append(f"{label}: effective 格式錯誤")
        source = entry["source"]
        for field in ("title", "url", "retrieved", "kind"):
            if not source.get(field):
                problems.append(f"{label}: source 缺少 {field}")
        if source.get("kind") not in ALLOWED_KINDS:
            problems.append(f"{label}: 未知的來源類型 {source.get('kind')}")
        if source.get("kind") == "json_query" and source.get("parser") not in JSON_PARSERS:
            problems.append(f"{label}: 未知的解析器 {source.get('parser')}")
        if fingerprint(entry["baseline"]) != entry["fingerprint"]:
            problems.append(f"{label}: baseline 與 fingerprint 不符")
    return problems


def load_registry(path: Path = REGISTRY) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))["rules"]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check NHI rule fingerprints against official sources.")
    parser.add_argument("--registry", type=Path, default=REGISTRY)
    parser.add_argument("--id", action="append", default=[], help="check only this entry (repeatable)")
    parser.add_argument("--json", type=Path, help="also write the results as JSON to this path")
    args = parser.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    entries = load_registry(args.registry)
    problems = validate_registry(entries)
    if problems:
        print("\n".join(problems), file=sys.stderr)
        return 2
    if args.id:
        unknown_ids = set(args.id) - {entry["id"] for entry in entries}
        if unknown_ids:
            print(f"registry 沒有這些 id：{sorted(unknown_ids)}", file=sys.stderr)
            return 2
        entries = [entry for entry in entries if entry["id"] in args.id]

    today = datetime.date.today().isoformat()
    results = run(entries, CachedFetcher(), today)
    print(format_report(results))
    if args.json:
        args.json.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    return exit_code(results)


if __name__ == "__main__":
    sys.exit(main())
