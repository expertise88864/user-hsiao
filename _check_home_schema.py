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
ORG_ID = f"{DOMAIN}/#organization"
LOGO_ID = f"{DOMAIN}/#logo"
WEBSITE_ID = f"{DOMAIN}/#website"
WEBPAGE_ID = f"{DOMAIN}/#webpage"


def type_names(obj: dict) -> set[str]:
    value = obj.get("@type")
    if isinstance(value, list):
        return {str(x) for x in value}
    return {str(value)} if value else set()


def ref_id(value) -> str:
    return str(value.get("@id") or "") if isinstance(value, dict) else str(value or "")


def jsonld_blocks(rel: str) -> list[dict]:
    src = (ROOT / rel).read_text(encoding="utf-8")
    blocks: list[dict] = []
    for raw in re.findall(r'<script\s+type="application/ld\+json"[^>]*>(.*?)</script>', src, re.S):
        data = json.loads(raw.strip())
        if isinstance(data, dict):
            blocks.append(data)
    return blocks


def find_block(blocks: list[dict], schema_type: str) -> dict | None:
    return next((block for block in blocks if schema_type in type_names(block)), None)


def audit_home(
    rel: str,
    website_id: str,
    website_url: str,
    webpage_id: str,
    physician_url: str,
    profile_page_id: str,
) -> list[str]:
    errors: list[str] = []
    try:
        blocks = jsonld_blocks(rel)
    except Exception as exc:
        return [f"{rel}: JSON-LD parse error: {exc}"]

    website = find_block(blocks, "WebSite")
    organization = find_block(blocks, "Organization")
    person = find_block(blocks, "Physician")
    webpage = find_block(blocks, "MedicalWebPage")

    if not website:
        errors.append(f"{rel}: missing WebSite schema")
    else:
        if website.get("@id") != website_id:
            errors.append(f"{rel}: WebSite @id mismatch")
        if website.get("url") != website_url:
            errors.append(f"{rel}: WebSite url mismatch")
        if ref_id(website.get("publisher")) != PERSON_ID:
            errors.append(f"{rel}: WebSite publisher should reference the physician")
        action = website.get("potentialAction")
        if not isinstance(action, dict) or action.get("@type") != "SearchAction":
            errors.append(f"{rel}: WebSite missing SearchAction")
        else:
            target = action.get("target")
            url_template = target.get("urlTemplate") if isinstance(target, dict) else ""
            expected_search = f"{DOMAIN}/en/blog?q={{search_term_string}}" if rel.startswith("en/") else f"{DOMAIN}/blog?q={{search_term_string}}"
            if url_template != expected_search:
                errors.append(f"{rel}: SearchAction urlTemplate mismatch")
            if action.get("query-input") != "required name=search_term_string":
                errors.append(f"{rel}: SearchAction query-input mismatch")

    if not organization:
        errors.append(f"{rel}: missing Organization schema")
    else:
        if organization.get("@id") != ORG_ID:
            errors.append(f"{rel}: Organization @id mismatch")
        if organization.get("url") != f"{DOMAIN}/":
            errors.append(f"{rel}: Organization url should be the canonical site root")
        if "sameAs" in organization and not organization.get("sameAs"):
            errors.append(f"{rel}: Organization sameAs should be omitted when empty")
        logo = organization.get("logo")
        if not isinstance(logo, dict) or not str(logo.get("url", "")).endswith("/icon-512.png"):
            errors.append(f"{rel}: Organization logo should point to icon-512.png")
        elif logo.get("@id") != LOGO_ID or logo.get("width") != 512 or logo.get("height") != 512:
            errors.append(f"{rel}: Organization logo should be a stable 512x512 ImageObject")
        if ref_id(organization.get("founder")) != PERSON_ID:
            errors.append(f"{rel}: Organization founder should reference the physician")
        if ref_id(organization.get("mainEntityOfPage")) != WEBPAGE_ID:
            errors.append(f"{rel}: Organization mainEntityOfPage should reference the canonical homepage WebPage")

    if not person:
        errors.append(f"{rel}: missing Person/Physician schema")
    else:
        if person.get("@id") != PERSON_ID:
            errors.append(f"{rel}: Physician @id mismatch")
        if "Person" not in type_names(person):
            errors.append(f"{rel}: Physician schema should also include Person")
        if person.get("url") != physician_url:
            errors.append(f"{rel}: Physician url mismatch")
        works_for = person.get("worksFor")
        if not isinstance(works_for, dict) or works_for.get("@type") != "MedicalOrganization" or not works_for.get("name"):
            errors.append(f"{rel}: Physician worksFor should be a named MedicalOrganization")
        if not isinstance(person.get("knowsAbout"), list) or len(person.get("knowsAbout", [])) < 5:
            errors.append(f"{rel}: Physician knowsAbout should cover core topics")
        if ref_id(person.get("mainEntityOfPage")) != profile_page_id:
            errors.append(f"{rel}: Physician mainEntityOfPage should reference the locale ProfilePage")

    if not webpage:
        errors.append(f"{rel}: missing MedicalWebPage schema")
    else:
        if webpage.get("@id") != webpage_id:
            errors.append(f"{rel}: MedicalWebPage @id mismatch")
        if webpage.get("url") != website_url:
            errors.append(f"{rel}: MedicalWebPage url mismatch")
        if ref_id(webpage.get("isPartOf")) != website_id:
            errors.append(f"{rel}: MedicalWebPage isPartOf should reference WebSite")
        for key in ("reviewedBy", "mainEntity", "publisher"):
            if ref_id(webpage.get(key)) != PERSON_ID:
                errors.append(f"{rel}: MedicalWebPage {key} should reference the physician")

    return errors


def main() -> int:
    errors: list[str] = []
    errors.extend(audit_home(
        "index.html",
        WEBSITE_ID,
        f"{DOMAIN}/",
        WEBPAGE_ID,
        f"{DOMAIN}/about",
        f"{DOMAIN}/about#profilepage",
    ))
    errors.extend(audit_home(
        "en/index.html",
        f"{DOMAIN}/en#website",
        f"{DOMAIN}/en",
        f"{DOMAIN}/en#webpage",
        f"{DOMAIN}/en/about",
        f"{DOMAIN}/en/about#profilepage",
    ))

    if errors:
        print("[FAIL] Homepage entity schema audit failed:")
        for error in errors:
            print(" - " + error)
        return 1

    print("[OK] Homepage entity schema audit passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
