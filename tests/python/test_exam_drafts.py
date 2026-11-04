"""Admin exam drafts (group 4, ported from the dermatology site 2026-11-04).

_pull_exam_drafts.py is exercised against temporary git repositories only (a bare
origin, a maintainer checkout and a "cloud" clone that writes cms-exam/drafts the
way /api/admin/exam-draft does). Also covered: the generated admin/exam-preview.css
and the json.dumps format identity the editor relies on.
API behaviour: tests/api/exam-draft.test.mjs; editor UI: tests/seo/exam-editor.spec.js.
"""
from __future__ import annotations

import io
import json
import re
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

import _gen_exam as gen
import _pull_exam_drafts as pull

ROOT = Path(__file__).resolve().parents[2]
BRANCH = pull.BRANCH
NOTE_A = '<h2 id="ch4-s1">一、重點</h2>\n<ul>\n<li>舊內容 A。</li>\n</ul>\n'
NOTE_B = '<h2 id="ch2-s1">一、重點</h2>\n<ul>\n<li>舊內容 B。</li>\n</ul>\n'


def entry(summary: str) -> dict:
    return {"answer": "A", "summary": summary, "flags": [],
            "items": [{"key": k, "answer": k == "A", "label": "正確" if k == "A" else "錯誤", "text": f"{k} {summary}",
                       "refs": [[1, "276–277"]]} for k in "ABCD"]}


def base_explanations() -> dict:
    return {str(n): entry(f"第 {n} 題") for n in range(1, 12)}


def run(cwd: Path, *args: str) -> str:
    result = subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.test", "-c", "commit.gpgsign=false",
                             "-c", "core.hooksPath=/dev/null", *args],
                            cwd=cwd, capture_output=True, text=True, encoding="utf-8")
    if result.returncode:
        raise AssertionError(f"git {args} failed: {result.stderr}")
    return result.stdout


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.encode("utf-8"))


class Scenario:
    """origin (bare) + a maintainer checkout on a codex/* branch; the cloud writer is another clone."""

    def __init__(self, tmp: Path, autocrlf: str = "false"):
        self.tmp = tmp
        self.origin = tmp / "origin.git"
        run(tmp, "init", "--bare", "-b", "main", str(self.origin))
        seed = tmp / "seed"
        run(tmp, "clone", str(self.origin), str(seed))
        run(seed, "checkout", "-b", "main")
        write(seed / pull.note_path("1-4"), NOTE_A)
        write(seed / pull.note_path("12-2"), NOTE_B)
        write(seed / pull.EXPLANATIONS, pull.dumps(base_explanations()))
        run(seed, "add", "-A"); run(seed, "commit", "-m", "base"); run(seed, "push", "origin", "main")
        self.base = run(seed, "rev-parse", "HEAD").strip()
        self.seed = seed
        self.work = tmp / "work"
        run(tmp, "-c", f"core.autocrlf={autocrlf}", "clone", "-b", "main", str(self.origin), str(self.work))
        run(self.work, "config", "core.autocrlf", autocrlf)
        run(self.work, "checkout", "-b", "codex/exam-drafts")

    def draft(self, notes: dict[str, str] | None = None, explanations: dict[str, dict] | None = None,
              manifest: dict | None = None, expl_text: str | None = None) -> None:
        cloud = self.tmp / "cloud"
        if not cloud.exists():
            run(self.tmp, "clone", str(self.origin), str(cloud))
            run(cloud, "checkout", "-b", BRANCH, self.base)
        for key, text in (notes or {}).items():
            write(cloud / pull.note_path(key), text)
        if explanations or expl_text:
            data = json.loads((cloud / pull.EXPLANATIONS).read_text(encoding="utf-8"))
            data.update(explanations or {})
            write(cloud / pull.EXPLANATIONS, expl_text if expl_text is not None else pull.dumps(data))
        record = manifest or {"version": 1, "baseMain": self.base, "updated": "2026-11-04T00:00:00Z",
                              "notes": sorted(notes or {}, key=pull.key_order), "explanations": sorted(explanations or {}, key=int)}
        write(cloud / pull.MANIFEST, json.dumps(record, indent=1) + "\n")
        run(cloud, "add", "-A"); run(cloud, "commit", "-m", "draft"); run(cloud, "push", "origin", BRANCH)

    def main_commit(self, changes: dict[str, str], into_work: bool = True) -> None:
        run(self.seed, "pull", "origin", "main")
        for path, text in changes.items():
            write(self.seed / path, text)
        run(self.seed, "add", "-A"); run(self.seed, "commit", "-m", "main moves"); run(self.seed, "push", "origin", "main")
        if into_work:
            run(self.work, "pull", "--ff-only", "origin", "main")

    def pull(self, **kwargs) -> tuple[int, str]:
        lines: list[str] = []
        code = pull.pull(self.work, out=lines.append, **kwargs)
        return code, "\n".join(lines)

    def text(self, path: str) -> str:
        return (self.work / path).read_bytes().decode("utf-8")

    def status(self) -> list[str]:
        return sorted(line[3:] for line in run(self.work, "status", "--porcelain").splitlines())

    def remote_head(self) -> str:
        listing = run(self.work, "ls-remote", "--heads", "origin", BRANCH).strip()
        return listing.split()[0] if listing else ""


class PullTests(unittest.TestCase):
    def scenario(self, **kwargs) -> Scenario:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        return Scenario(Path(directory.name), **kwargs)

    def test_no_draft_branch_is_nothing_to_do(self):
        s = self.scenario()
        code, output = s.pull()
        self.assertEqual(code, 0)
        self.assertIn("沒有雲端草稿", output)
        self.assertEqual(s.status(), [])

    def test_applies_only_listed_items_and_prints_next_steps_without_pushing(self):
        s = self.scenario()
        edited = NOTE_A.replace("舊內容 A", "新內容 A")
        s.draft(notes={"1-4": edited}, explanations={"3": entry("草稿第 3 題")})
        head = s.remote_head()
        code, output = s.pull()
        self.assertEqual(code, 0, output)
        self.assertEqual(s.text(pull.note_path("1-4")), edited)
        self.assertEqual(s.text(pull.note_path("12-2")), NOTE_B)
        data = json.loads(s.text(pull.EXPLANATIONS))
        expected = base_explanations(); expected["3"] = entry("草稿第 3 題")
        self.assertEqual(s.text(pull.EXPLANATIONS), pull.dumps(expected), "byte-exact, only entry 3 changed")
        self.assertEqual(list(data), list(expected), "key order kept")
        self.assertEqual(s.status(), sorted([pull.EXPLANATIONS, pull.note_path("1-4")]))
        self.assertNotIn(pull.MANIFEST, s.status(), "the draft record never enters the checkout")
        self.assertIn("python preflight.py", output)
        self.assertIn("tools/pr_review.py", output)
        cleanup = [line.strip() for line in output.splitlines() if line.strip().startswith("git push")]
        self.assertEqual(cleanup, [pull.cleanup_command("origin", head)])
        self.assertEqual(s.remote_head(), head, "the script itself never deletes or pushes")
        self.assertEqual(run(s.work, "log", "-1", "--format=%s").strip(), "base", "nothing is committed")
        # Running it again before committing is refused (uncommitted targets);
        # after the maintainer commits, it is a no-op.
        self.assertEqual(s.pull()[0], 2)
        run(s.work, "commit", "-am", "integrate drafts")
        code, output = s.pull()
        self.assertEqual(code, 0, output)
        self.assertIn("已是草稿內容", output)

    def test_cleanup_command_refuses_to_delete_a_branch_with_newer_drafts(self):
        s = self.scenario()
        s.draft(notes={"1-4": NOTE_A.replace("舊", "新")})
        code, output = s.pull()
        imported = s.remote_head()
        s.draft(notes={"1-4": NOTE_A.replace("舊", "更新")})
        newer = s.remote_head()
        args = pull.cleanup_command("origin", imported).split()[1:]
        result = subprocess.run(["git", *args], cwd=s.work, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(s.remote_head(), newer, "a draft saved after the import is kept")
        result = subprocess.run(["git", *pull.cleanup_command("origin", newer).split()[1:]], cwd=s.work, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(s.remote_head(), "")

    def test_main_changing_the_same_item_since_the_draft_base_is_a_reported_conflict(self):
        s = self.scenario()
        s.draft(notes={"1-4": NOTE_A.replace("舊", "草稿")}, explanations={"5": entry("草稿第 5 題")})
        newer = base_explanations(); newer["5"] = entry("main 改過第 5 題")
        # main moved but the candidate branch has not been rebased yet: still a conflict.
        s.main_commit({pull.note_path("1-4"): NOTE_A.replace("舊", "main"), pull.EXPLANATIONS: pull.dumps(newer)}, into_work=False)
        code, output = s.pull()
        self.assertEqual(code, 1, output)
        self.assertIn("課本重點 1-4", output); self.assertIn("origin/main", output)
        self.assertIn("題目詳解 5", output)
        self.assertEqual(s.status(), [], "nothing is written when any item conflicts")
        run(s.work, "pull", "--ff-only", "origin", "main")
        code, output = s.pull()
        self.assertEqual(code, 1)
        self.assertIn("目前的 HEAD", output)

    def test_main_changing_other_entries_is_kept(self):
        s = self.scenario()
        s.draft(explanations={"2": entry("草稿第 2 題")})
        newer = base_explanations(); newer["7"] = entry("main 改過第 7 題")
        s.main_commit({pull.EXPLANATIONS: pull.dumps(newer)})
        code, output = s.pull()
        self.assertEqual(code, 0, output)
        data = json.loads(s.text(pull.EXPLANATIONS))
        self.assertEqual(data["2"], entry("草稿第 2 題"))
        self.assertEqual(data["7"], entry("main 改過第 7 題"), "the stale draft copy never reverts main")

    def test_dirty_target_is_refused(self):
        s = self.scenario()
        s.draft(notes={"1-4": NOTE_A.replace("舊", "新")})
        write(s.work / pull.note_path("1-4"), NOTE_A + "local\n")
        code, output = s.pull()
        self.assertEqual(code, 2)
        self.assertIn("未提交", output)
        self.assertEqual(s.text(pull.note_path("1-4")), NOTE_A + "local\n")

    def test_bad_records_and_formats_fail_closed(self):
        for manifest in [{"version": 2}, {"version": 1, "baseMain": "x", "updated": "", "notes": [], "explanations": []},
                         {"version": 1, "baseMain": "a" * 40, "updated": "", "notes": ["12-2", "1-4"], "explanations": []},
                         {"version": 1, "baseMain": "a" * 40, "updated": "", "notes": [], "explanations": ["10", "9"]},
                         {"version": 1, "baseMain": "a" * 40, "updated": "", "notes": [4], "explanations": []}]:
            with self.subTest(manifest=manifest):
                s = self.scenario()
                s.draft(manifest=manifest)
                code, output = s.pull()
                self.assertEqual(code, 1, output)
                self.assertEqual(s.status(), [])
        s = self.scenario()
        s.draft(explanations={"2": entry("x")}, expl_text=json.dumps(base_explanations(), ensure_ascii=False))
        code, output = s.pull()
        self.assertEqual(code, 1)
        self.assertIn("json.dumps", output)

    def test_crlf_checkouts_keep_their_line_endings(self):
        s = self.scenario(autocrlf="true")
        self.assertIn(b"\r\n", (s.work / pull.note_path("1-4")).read_bytes())
        s.draft(notes={"1-4": NOTE_A.replace("舊", "新")}, explanations={"4": entry("草稿")})
        code, output = s.pull()
        self.assertEqual(code, 0, output)
        self.assertEqual((s.work / pull.note_path("1-4")).read_bytes(), NOTE_A.replace("舊", "新").replace("\n", "\r\n").encode())
        self.assertIn(b"\r\n", (s.work / pull.EXPLANATIONS).read_bytes())
        self.assertEqual(run(s.work, "diff", "--stat", "--", pull.note_path("12-2")).strip(), "")

    def test_main_entry_point_dry_run(self):
        s = self.scenario()
        s.draft(notes={"1-4": NOTE_A.replace("舊", "新")})
        code, output = s.pull(dry_run=True)
        self.assertEqual(code, 0)
        self.assertIn("dry-run", output)
        self.assertEqual(s.status(), [])


class FormatTests(unittest.TestCase):
    def test_explanations_file_is_the_exact_json_dumps_output_the_editor_reproduces(self):
        raw = (ROOT / pull.EXPLANATIONS).read_bytes().decode("utf-8").replace("\r\n", "\n")
        data = json.loads(raw)
        self.assertEqual(pull.dumps(data), raw)
        self.assertFalse(raw.endswith("\n"))
        self.assertEqual(list(data), sorted(data, key=int), "integer-like keys in ascending order (JS object order)")

    def test_preview_css_is_generated_from_exam_style(self):
        css = gen.preview_css()
        self.assertTrue(css.startswith("/* Generated by _gen_exam.py"))
        inner = re.fullmatch(r"<style data-exam-style>\n(.*)</style>\n", gen.EXAM_STYLE, re.S).group(1)
        self.assertTrue(css.endswith(inner))
        for selector in (".ex-note h2", ".ex-note .ex-trap", ".ex-qref", ".ex-note .ted-table", ".ref,.ex-ref"):
            self.assertIn(selector, css)
        self.assertNotIn("<", css.replace("</", ""), "plain CSS, no markup")
        committed = (ROOT / "admin" / "exam-preview.css").read_bytes().decode("utf-8").replace("\r\n", "\n")
        self.assertEqual(committed, css, "run python _gen_exam.py")

    def test_check_mode_reports_a_stale_preview(self):
        original = gen.PREVIEW_CSS
        with tempfile.TemporaryDirectory() as tmp:
            gen.PREVIEW_CSS = Path(tmp) / "exam-preview.css"
            gen.PREVIEW_CSS.write_text("stale", encoding="utf-8")
            try:
                with redirect_stdout(io.StringIO()) as out:
                    self.assertEqual(gen.main(["--check"]), 1)
                self.assertIn("exam-preview.css", out.getvalue())
            finally:
                gen.PREVIEW_CSS = original

    def test_admin_page_loads_the_editor_without_inline_script(self):
        page = (ROOT / "admin.html").read_text(encoding="utf-8")
        self.assertIn('<script src="/admin/exam-editor.js" defer></script>', page)
        self.assertIn('data-tab="exam"', page)
        self.assertIn('id="tab-exam"', page)
        editor = (ROOT / "admin" / "exam-editor.js").read_text(encoding="utf-8")
        self.assertNotRegex(editor, r"\.(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML")
        self.assertIn("setAttribute('sandbox', '')", editor)
        self.assertIn("/admin/exam-preview.css", editor)


if __name__ == "__main__":
    unittest.main()
