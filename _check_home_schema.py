#!/usr/bin/env python3
"""Audit homepage entity schema used for search understanding."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DOMAIN = "https://hsiao.chendermatologist.com"
PERSON_ID = f"{DOMAIN}/about#person"
WEBSITE_ID = f"{DOMAIN}/#website"
WEBPAGE_ID = f"{DOMAIN}/#webpage"


def type_names(obj: dict) -> set[str]:
    value = obj.get("@type")
    if isinstance(value, list):
        return {str(x) for x in value}
    return {str(value)} if value else set()


def ref_id(value) -> str:
    return str(value.get("@id") or "") if isinstance(value, dict) else str(value or "")


def jsonld_blocks() -> list[dict]:
    src = (ROOT / "index.html").read_text(encoding="utf-8")
    blocks: list[dict] = []
    for raw in re.findall(r'<script\s+type="application/ld\+json"[^>]*>(.*?)</script>', src, re.S):
        data = json.loads(raw.strip())
        if isinstance(data, dict):
            blocks.append(data)
    return blocks


def find_block(blocks: list[dict], schema_type: str) -> dict | None:
    return next((block for block in blocks if schema_type in type_names(block)), None)


def main() -> int:
    errors: list[str] = []
    try:
        blocks = jsonld_blocks()
    except Exception as exc:
        print(f"[FAIL] Homepage JSON-LD parse error: {exc}")
        return 1

    website = find_block(blocks, "WebSite")
    organization = find_block(blocks, "Organization")
    person = find_block(blocks, "Physician")
    webpage = find_block(blocks, "MedicalWebPage")

    if not website:
        errors.append("index.html: missing WebSite schema")
    else:
        if website.get("@id") != WEBSITE_ID:
            errors.append("index.html: WebSite @id mismatch")
        if website.get("url") != f"{DOMAIN}/":
            errors.append("index.html: WebSite url mismatch")
        if ref_id(website.get("publisher")) != PERSON_ID:
            errors.append("index.html: WebSite publisher should reference the physician")
        action = website.get("potentialAction")
        if not isinstance(action, dict) or action.get("@type") != "SearchAction":
            errors.append("index.html: WebSite missing SearchAction")
        else:
            target = action.get("target")
            url_template = target.get("urlTemplate") if isinstance(target, dict) else ""
            if url_template != f"{DOMAIN}/blog?q={{search_term_string}}":
                errors.append("index.html: SearchAction urlTemplate mismatch")
            if action.get("query-input") != "required name=search_term_string":
                errors.append("index.html: SearchAction query-input mismatch")

    if not organization:
        errors.append("index.html: missing Organization schema")
    else:
        if organization.get("url") != f"{DOMAIN}/":
            errors.append("index.html: Organization url mismatch")
        if "sameAs" in organization and not organization.get("sameAs"):
            errors.append("index.html: Organization sameAs should be omitted when empty")
        logo = organization.get("logo")
        if not isinstance(logo, dict) or not str(logo.get("url", "")).endswith("/logo-512.png"):
            errors.append("index.html: Organization logo should point to logo-512.png")

    if not person:
        errors.append("index.html: missing Person/Physician schema")
    else:
        if person.get("@id") != PERSON_ID:
            errors.append("index.html: Physician @id mismatch")
        if "Person" not in type_names(person):
            errors.append("index.html: Physician schema should also include Person")
        if person.get("url") != f"{DOMAIN}/about":
            errors.append("index.html: Physician url mismatch")
        works_for = person.get("worksFor")
        if not isinstance(works_for, dict) or works_for.get("@type") != "MedicalOrganization" or not works_for.get("name"):
            errors.append("index.html: Physician worksFor should be a named MedicalOrganization")
        if not isinstance(person.get("knowsAbout"), list) or len(person.get("knowsAbout", [])) < 5:
            errors.append("index.html: Physician knowsAbout should cover core topics")

    if not webpage:
        errors.append("index.html: missing MedicalWebPage schema")
    else:
        if webpage.get("@id") != WEBPAGE_ID:
            errors.append("index.html: MedicalWebPage @id mismatch")
        if webpage.get("url") != f"{DOMAIN}/":
            errors.append("index.html: MedicalWebPage url mismatch")
        if ref_id(webpage.get("isPartOf")) != WEBSITE_ID:
            errors.append("index.html: MedicalWebPage isPartOf should reference WebSite")
        for key in ("reviewedBy", "mainEntity", "publisher"):
            if ref_id(webpage.get(key)) != PERSON_ID:
                errors.append(f"index.html: MedicalWebPage {key} should reference the physician")

    if errors:
        print("[FAIL] Homepage entity schema audit failed:")
        for error in errors:
            print(" - " + error)
        return 1

    print("[OK] Homepage entity schema audit passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
