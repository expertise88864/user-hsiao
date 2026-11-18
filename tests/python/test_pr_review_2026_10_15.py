"""tools/pr_review.py: whole-PR review bookkeeping. Offline; no GitHub or Codex calls."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("pr_review", ROOT / "tools" / "pr_review.py")
pr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pr)

SHA = "a" * 40
# The review identity every saved binding / unrecorded verdict must carry (2026-11-18).
IDENTITY = {"model": pr.MODEL, "effort": pr.EFFORT, "prompt_verified": True}


class FakeAPI:
    repo = "owner/repo"

    def __init__(self, routes):
        self.routes = routes
        self.calls = []

    def call(self, method, path, body=None):
        self.calls.append(path)
        return self.routes(path)


class QuotaClassificationTests(unittest.TestCase):
    def test_reviewed_content_mentioning_quota_is_not_a_quota_error(self):
        raw = "\n".join([
            json.dumps({"type": "item.completed", "item": {"type": "command_execution",
                        "aggregated_output": "+QUOTA = re.compile('usage limit|rate limit')"}}),
            json.dumps({"type": "item.completed", "item": {"type": "agent_message",
                        "text": "checking quota-pending handling"}}),
            "[codex-review] ERROR: rate limit text in a wrapper line is not provider evidence",
        ])
        self.assertFalse(pr.provider_quota_error(raw))

    def test_provider_error_events_are_quota(self):
        for raw in (json.dumps({"type": "error", "message": "You've hit your usage limit. Try again at 5pm"}),
                    json.dumps({"type": "turn.failed", "error": {"message": "rate limit exceeded"}}),
                    "ERROR: You've hit your usage limit."):
            with self.subTest(raw=raw):
                self.assertTrue(pr.provider_quota_error(raw))

    def test_other_provider_errors_are_not_quota(self):
        self.assertFalse(pr.provider_quota_error(json.dumps({"type": "error", "message": "stream disconnected"})))


class PendingAndBackfillTests(unittest.TestCase):
    def test_pending_reads_every_page(self):
        pages = {1: [{"n": i} for i in range(100)], 2: [{"n": i} for i in range(100)], 3: [{"n": 0}]}

        def routes(path):
            page = int(path.rsplit("page=", 1)[1])
            return pages[page]
        api = FakeAPI(routes)
        self.assertEqual(len(pr.all_prs(api)), 201)
        self.assertEqual(len(api.calls), 3)

    def test_legacy_per_commit_review_counts_only_with_evidence_on_every_commit(self):
        def commit(sha, *trailers):
            return {"sha": sha, "commit": {"message": "fix: x\n\n" + "\n".join(trailers)}}
        audited = {"b" * 40}
        passed = commit("a" * 40, "Claude-Opus-5-Review: passed")
        cleared = commit("b" * 40, "Claude-Opus-5-Review: pending")
        audit = commit("c" * 40, "Claude-Opus-5-Reviewed-Commit: " + "b" * 40)
        uncleared = commit("d" * 40, "Claude-Opus-5-Review: pending")
        bare = commit("e" * 40)
        self.assertTrue(pr.legacy_reviewed([passed, cleared, audit], audited))
        self.assertTrue(pr.legacy_reviewed([commit("f" * 40, "Codex-Review: passed")], set()))
        self.assertFalse(pr.legacy_reviewed([passed, uncleared], audited))
        self.assertFalse(pr.legacy_reviewed([passed, bare], audited))
        self.assertFalse(pr.legacy_reviewed([], audited))
        # A trailer quoted inside the body text does not count.
        self.assertFalse(pr.legacy_reviewed([commit("g" * 40, "see Codex-Review: passed earlier")], set()))

    def test_pr_commits_reads_every_page_or_gives_up(self):
        def commits(total):
            rows = [{"sha": f"{i:040x}"} for i in range(total)]

            def routes(path):
                page = int(path.rsplit("page=", 1)[1])
                return rows[(page - 1) * 100:page * 100]
            return FakeAPI(routes)
        api = commits(205)
        self.assertEqual(len(pr.pr_commits(api, 7, 205)), 205)
        self.assertEqual(len(api.calls), 3)
        # GitHub lists at most 250 commits: a longer PR can never be proven reviewed.
        self.assertIsNone(pr.pr_commits(commits(250), 7, 300))
        self.assertIsNone(pr.pr_commits(commits(0), 7, 0))

    def test_backfill_reuses_newest_owner_reviewed_base(self):
        statuses = [
            {"id": 1, "context": pr.CONTEXT, "creator": {"login": "owner"},
             "description": f"REQUEST_CHANGES base={'b' * 40}"},
            {"id": 3, "context": pr.CONTEXT, "creator": {"login": "intruder"},
             "description": f"APPROVE base={'d' * 40}"},
            {"id": 2, "context": pr.CONTEXT, "creator": {"login": "Owner"},
             "description": f"quota-pending base={'c' * 40}"},
        ]
        self.assertEqual(pr.reviewed_base(FakeAPI(lambda path: statuses), SHA), "c" * 40)
        self.assertEqual(pr.reviewed_base(FakeAPI(lambda path: []), SHA), "")


class RunReviewTests(unittest.TestCase):
    """run_review against a fake wrapper process; no Codex call."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pr-review-fixture-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = self.root / ".codex-review"
        self.state.mkdir()
        for name, value in (("ROOT", self.root), ("bash", lambda: "bash"),
                            ("wrapper", lambda: "scripts/codex_review.sh")):
            patcher = mock.patch.object(pr, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def run_with(self, rc, writes=None, ctx=None, resume=None):
        calls = []

        def fake_run(args, **kwargs):
            calls.append(args)
            for name, text in (writes or {}).items():
                (self.state / name).write_text(text, encoding="utf-8")
            return subprocess.CompletedProcess(args, rc)
        with mock.patch.object(pr.subprocess, "run", fake_run):
            result = pr.run_review("targeted", "b" * 40, SHA, ctx, resume)
        return result, calls

    def test_refusal_before_cli_never_reuses_a_stale_quota_log(self):
        quota = json.dumps({"type": "error", "message": "You've hit your usage limit."})
        (self.state / "last_raw.log").write_text(quota, encoding="utf-8")
        (self.state / "last_message.txt").write_text("", encoding="utf-8")
        (verdict, _, _), _ = self.run_with(64)
        self.assertEqual(verdict, "ERROR")

    def test_refusal_before_cli_never_reuses_a_stale_verdict(self):
        (self.state / "last_message.txt").write_text("APPROVE\n", encoding="utf-8")
        (verdict, _, message), _ = self.run_with(64)
        self.assertEqual(verdict, "ERROR")
        self.assertNotIn("APPROVE", message)

    def test_fresh_quota_failure_is_still_quota_pending(self):
        quota = json.dumps({"type": "error", "message": "You've hit your usage limit."})
        (verdict, _, _), _ = self.run_with(64, {"last_raw.log": quota})
        self.assertEqual(verdict, "QUOTA_PENDING")

    def test_resume_passes_updated_context_to_the_wrapper(self):
        _, calls = self.run_with(2, {"last_message.txt": "REQUEST_CHANGES\n"},
                                 ctx="ctx.txt", resume="sid")
        self.assertEqual(calls[0][2:], ["resume", "sid", "ctx.txt"])
        _, calls = self.run_with(2, {"last_message.txt": "REQUEST_CHANGES\n"}, ctx="ctx.txt")
        self.assertEqual(calls[0][2:], ["targeted", "b" * 40, "ctx.txt"])


class TerminalQuotaTests(unittest.TestCase):
    """PR #17 review round 1 (P1): only the terminal provider error decides quota-pending."""

    def test_recovered_rate_limit_then_other_failure_is_not_quota(self):
        for raw in ("\n".join([json.dumps({"type": "error", "message": "rate limit exceeded, retrying"}),
                               json.dumps({"type": "turn.failed", "error": {"message": "401 Unauthorized"}})]),
                    "ERROR: rate limit exceeded; retrying\nERROR: 401 Unauthorized"):
            with self.subTest(raw=raw):
                self.assertFalse(pr.provider_quota_error(raw))

    def test_recovered_rate_limit_then_crash_or_silence_is_not_quota(self):
        """PR #17 review round 2 (P1): quota-pending needs the run to END on a quota error."""
        recovered = "ERROR: rate limit exceeded; retrying"
        for tail in ("exec git diff --stat\nsucceeded in 120ms", "panic: failed to write final output",
                     json.dumps({"type": "item.completed", "item": {"type": "agent_message", "text": "ok"}})):
            with self.subTest(tail=tail):
                self.assertFalse(pr.provider_quota_error(f"{recovered}\n{tail}\n[codex-review] ERROR: x"))

    def test_terminal_quota_after_other_error_is_quota(self):
        self.assertTrue(pr.provider_quota_error("ERROR: stream disconnected\nERROR: You've hit your usage limit."))


class ResumeScopeTests(unittest.TestCase):
    """PR #17 review round 1 (P2): a resume reviews every commit since the last verdict."""

    def test_resume_base_requires_a_newer_descendant_head(self):
        import subprocess
        from unittest.mock import patch
        prev, head = "b" * 40, SHA
        for saved in ({}, {"head": "short"}, {"head": head}):
            with self.subTest(saved=saved), self.assertRaises(pr.Blocked):
                pr.resume_base(saved, head)
        with patch.object(pr.subprocess, "run", return_value=subprocess.CompletedProcess([], 1)), \
             self.assertRaises(pr.Blocked):
            pr.resume_base({"head": prev, **IDENTITY}, head)
        with patch.object(pr.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)) as run:
            self.assertEqual(pr.resume_base({"head": prev, **IDENTITY}, head), prev)
        self.assertEqual(run.call_args.args[0][-2:], [prev, head])

    def test_previous_head_reaches_the_wrapper_only_on_resume(self):
        import os
        import subprocess
        import tempfile
        from unittest.mock import patch
        envs = []

        def fake_run(args, **kwargs):
            envs.append(kwargs["env"])
            return subprocess.CompletedProcess(args, 64)
        with tempfile.TemporaryDirectory() as tmp, \
             patch.dict(os.environ, {"CODEX_REVIEW_PREV_TIP": "c" * 40}), \
             patch.object(pr, "ROOT", Path(tmp)), patch.object(pr, "bash", return_value="bash"), \
             patch.object(pr, "wrapper", return_value="scripts/codex_review.sh"), \
             patch.object(pr.subprocess, "run", side_effect=fake_run):
            pr.run_review("targeted", "b" * 40, SHA, None, None, "d" * 40)
            pr.run_review("targeted", "b" * 40, SHA, None, "0" * 8 + "-0000-0000-0000-" + "0" * 12, "d" * 40)
        self.assertNotIn("CODEX_REVIEW_PREV_TIP", envs[0])
        self.assertEqual(envs[1]["CODEX_REVIEW_PREV_TIP"], "d" * 40)

    def test_binding_records_the_head_of_every_verdict(self):
        # Behaviour of the wrapper side is exercised in test_codex_review_wrapper.py.
        main_src = (ROOT / "tools" / "pr_review.py").read_text(encoding="utf-8")
        assert '"head": head,' in main_src and "previous_head = resume_base(saved, head, bool(rebuttal))" in main_src


class RetryingQuotaTests(unittest.TestCase):
    """PR #1 round 4 (P1): an interrupted retry is not terminal quota exhaustion."""

    def test_retrying_or_transient_rate_limit_last_is_not_quota(self):
        for raw in (json.dumps({"type": "error", "message": "rate limit exceeded, retrying"}),
                    json.dumps({"type": "error", "message": "rate limit exceeded"}),
                    json.dumps({"type": "turn.failed", "error": {"message": "usage limit; retrying in 5s"}}),
                    "ERROR: rate limit exceeded"):
            with self.subTest(raw=raw):
                self.assertFalse(pr.provider_quota_error(raw))


class RecordRetryTests(unittest.TestCase):
    """PR #1 round 4 (P2): a failed GitHub recording keeps the verdict for --retry-record."""

    def test_failed_recording_keeps_verdict_and_old_binding_then_retry_records(self):
        import tempfile
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as tmp:
            binding = Path(tmp) / "pr_review.json"
            unrecorded = Path(tmp) / "pr_review_unrecorded.json"
            binding.write_text(json.dumps({"head": "b" * 40}), encoding="utf-8")
            entry = {"repo": "owner/repo", "pr": 7, "verdict": "APPROVE", "base": "c" * 40, "head": SHA,
                     "session": "s", "bound_session": "s", "message": "APPROVE", "resume": True, **IDENTITY}
            unrecorded.write_text(json.dumps(entry), encoding="utf-8")
            api, pull = FakeAPI(lambda path: None), {"number": 7}
            with patch.object(pr, "record", side_effect=pr.Blocked("HTTP 502")), \
                 self.assertRaises(pr.Blocked):
                pr.finish(api, pull, entry, binding, unrecorded)
            self.assertEqual(json.loads(binding.read_text(encoding="utf-8"))["head"], "b" * 40)
            self.assertTrue(unrecorded.is_file())
            with patch.object(pr, "record") as record:
                self.assertEqual(pr.retry_record(api, pull, SHA, binding, unrecorded), 0)
            record.assert_called_once()
            self.assertEqual(json.loads(binding.read_text(encoding="utf-8"))["head"], SHA)
            self.assertFalse(unrecorded.exists())

    def test_retry_refuses_another_head_or_pr(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            unrecorded = Path(tmp) / "u.json"
            unrecorded.write_text(json.dumps({"repo": "owner/repo", "pr": 7, "head": SHA}), encoding="utf-8")
            for pull, head in (({"number": 8}, SHA), ({"number": 7}, "b" * 40)):
                with self.subTest(pull=pull, head=head), self.assertRaises(pr.Blocked):
                    pr.retry_record(FakeAPI(lambda path: None), pull, head, Path(tmp) / "b.json", unrecorded)


class RebuttalTests(unittest.TestCase):
    """User decision 2026-10-15: one evidence-based rebuttal per unchanged head."""

    def test_same_head_needs_rebuttal_of_request_changes_once(self):
        saved = {"head": SHA, "verdict": "REQUEST_CHANGES", **IDENTITY}
        with self.assertRaises(pr.Blocked):
            pr.resume_base(saved, SHA)
        self.assertIsNone(pr.resume_base(saved, SHA, rebuttal=True))
        for bad in ({**saved, "verdict": "APPROVE"}, {**saved, "rebutted_head": SHA}, {"head": SHA}):
            with self.subTest(saved=bad), self.assertRaises(pr.Blocked):
                pr.resume_base(bad, SHA, rebuttal=True)

    def test_changed_head_cannot_be_rebutted_before_its_own_verdict(self):
        """PR #2 round 1 (P2): a rebuttal on a new head would skip eligibility and the once-only limit."""
        for saved in ({"head": "b" * 40, "verdict": "APPROVE", **IDENTITY},
                      {"head": "b" * 40, "verdict": "REQUEST_CHANGES", **IDENTITY}):
            with self.subTest(saved=saved), self.assertRaises(pr.Blocked):
                pr.resume_base(saved, SHA, rebuttal=True)

    def test_rebuttal_reaches_the_wrapper_only_on_resume(self):
        import os
        import subprocess
        import tempfile
        from unittest.mock import patch
        envs = []

        def fake_run(args, **kwargs):
            envs.append(kwargs["env"])
            return subprocess.CompletedProcess(args, 64)
        with tempfile.TemporaryDirectory() as tmp, \
             patch.dict(os.environ, {"CODEX_REVIEW_REBUTTAL_FILE": "stale"}), \
             patch.object(pr, "ROOT", Path(tmp)), patch.object(pr, "bash", return_value="bash"), \
             patch.object(pr, "wrapper", return_value="scripts/codex_review.sh"), \
             patch.object(pr.subprocess, "run", side_effect=fake_run):
            pr.run_review("targeted", "b" * 40, SHA, None, None, None, "r.txt")
            pr.run_review("targeted", "b" * 40, SHA, None, "0" * 8 + "-0000-0000-0000-" + "0" * 12, None, "r.txt")
        self.assertNotIn("CODEX_REVIEW_REBUTTAL_FILE", envs[0])
        self.assertEqual(envs[1]["CODEX_REVIEW_REBUTTAL_FILE"], "r.txt")
        self.assertNotIn("CODEX_REVIEW_PREV_TIP", envs[1])

    def test_finish_marks_a_same_head_rebuttal_so_it_cannot_repeat(self):
        import tempfile
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as tmp:
            binding, unrecorded = Path(tmp) / "b.json", Path(tmp) / "u.json"
            entry = {"repo": "owner/repo", "pr": 7, "verdict": "REQUEST_CHANGES", "base": "c" * 40, "head": SHA,
                     "session": "s", "bound_session": "s", "message": "", "resume": True,
                     "rebuttal": True, "same_head_rebuttal": True}
            with patch.object(pr, "record") as record:
                pr.finish(FakeAPI(lambda path: None), {"number": 7}, entry, binding, unrecorded)
            self.assertTrue(record.call_args.args[-1])
            saved = json.loads(binding.read_text(encoding="utf-8"))
            self.assertEqual((saved["verdict"], saved["rebutted_head"]), ("REQUEST_CHANGES", SHA))
            with self.assertRaises(pr.Blocked):
                pr.resume_base(saved, SHA, rebuttal=True)


DIFF_SAMPLES = ("diff --git a/x.py b/x.py", "    diff --git a/x.py b/x.py", "\t@@ -1,2 +1,2 @@",
                "  index 1234abc..5678def 100644", "    --- a/x.py", "    +++ b/x.py")
EVIDENCE_SAMPLES = ("Finding 1 is REJECTED: _delivery.py:40 already checks the owner.",
                    "---", "See the delivery suite, test_y (line 12) -- it covers this path.")


class RebuttalDiffMarkerTests(unittest.TestCase):
    """Backport of the morning-report PR #18 fix (P2): indented diffs must not pass as rebuttal evidence."""

    def test_python_check_rejects_indented_diffs_and_keeps_evidence(self):
        for line in DIFF_SAMPLES:
            with self.subTest(line=line):
                self.assertTrue(pr.DIFF_MARKER.search(f"evidence\n{line}\nmore"))
        for line in EVIDENCE_SAMPLES:
            with self.subTest(line=line):
                self.assertIsNone(pr.DIFF_MARKER.search(line))

    def test_wrapper_check_rejects_indented_diffs_and_keeps_evidence(self):
        import re
        import shutil
        import subprocess
        import tempfile
        grep = shutil.which("grep")
        if not grep:
            self.skipTest("grep not available")
        text = (ROOT / "scripts" / "codex_review.sh").read_text(encoding="utf-8")
        block = text.split('REBUTTAL_FILE="${CODEX_REVIEW_REBUTTAL_FILE:-}"', 1)[1]
        pattern = re.search(r"grep -qE '([^']+)' \"\$REBUTTAL_FILE\"", block).group(1)
        with tempfile.TemporaryDirectory() as tmp:
            sample = Path(tmp) / "rebuttal.txt"
            for line, expected in [(x, 0) for x in DIFF_SAMPLES] + [(x, 1) for x in EVIDENCE_SAMPLES]:
                sample.write_text(f"evidence\n{line}\n", encoding="utf-8")
                with self.subTest(line=line):
                    rc = subprocess.run([grep, "-qE", pattern, str(sample)]).returncode
                    self.assertEqual(rc, expected)


if __name__ == "__main__":
    unittest.main()


class ReviewModelSwitchTests(unittest.TestCase):
    """PR #104 round 1: evidence from gpt-6.1-sol/xhigh never becomes a gpt-6.2-astra/medium verdict."""

    def test_resume_refuses_a_session_without_the_current_identity(self):
        from unittest.mock import patch
        ok = subprocess.CompletedProcess([], 0)
        for saved in ({"head": "b" * 40, "verdict": "REQUEST_CHANGES"},
                      {"head": "b" * 40, "verdict": "REQUEST_CHANGES", "model": "gpt-6.1-sol", "effort": "xhigh"},
                      {"head": "b" * 40, "verdict": "REQUEST_CHANGES", "model": pr.MODEL, "effort": "xhigh"}):
            with self.subTest(saved=saved), patch.object(pr.subprocess, "run", return_value=ok),                  self.assertRaises(pr.Blocked):
                pr.resume_base(saved, SHA)

    def test_finish_binds_the_current_identity(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as tmp:
            binding, unrecorded = Path(tmp) / "b.json", Path(tmp) / "u.json"
            entry = {"repo": "owner/repo", "pr": 7, "verdict": "REQUEST_CHANGES", "base": "c" * 40, "head": SHA,
                     "session": "s", "bound_session": "s", "message": "", "resume": False, **IDENTITY}
            with patch.object(pr, "record"):
                pr.finish(FakeAPI(lambda path: None), {"number": 7}, entry, binding, unrecorded)
            saved = json.loads(binding.read_text(encoding="utf-8"))
            self.assertEqual((saved["model"], saved["effort"]), (pr.MODEL, pr.EFFORT))

    def test_retry_refuses_a_verdict_from_another_model(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as tmp:
            unrecorded = Path(tmp) / "u.json"
            base = {"repo": "owner/repo", "pr": 7, "verdict": "APPROVE", "base": "c" * 40, "head": SHA,
                    "session": "s", "bound_session": "s", "message": "APPROVE", "resume": False}
            for entry in (base, {**base, "model": "gpt-6.1-sol", "effort": "xhigh"}):
                unrecorded.write_text(json.dumps(entry), encoding="utf-8")
                with self.subTest(entry=entry), patch.object(pr, "record") as record,                      self.assertRaises(pr.Blocked):
                    pr.retry_record(FakeAPI(lambda path: None), {"number": 7}, SHA, Path(tmp) / "b.json", unrecorded)
                record.assert_not_called()

    def test_legacy_unrecorded_verdict_neither_retries_nor_blocks_a_fresh_review(self):
        """PR #104 round 2 (P2): retry refused it and the fresh review sent the operator back."""
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as tmp:
            unrecorded = Path(tmp) / "u.json"
            base = {"repo": "owner/repo", "pr": 7, "verdict": "APPROVE", "base": "c" * 40, "head": SHA,
                    "session": "s", "bound_session": "s", "message": "APPROVE", "resume": False}
            for legacy in (base, {**base, "model": "gpt-6.1-sol", "effort": "xhigh"}):
                unrecorded.write_text(json.dumps(legacy), encoding="utf-8")
                with self.subTest(entry=legacy):
                    with patch.object(pr, "record"), self.assertRaises(pr.Blocked):
                        pr.retry_record(FakeAPI(lambda path: None), {"number": 7}, SHA, Path(tmp) / "b.json", unrecorded)
                    self.assertFalse(pr.unrecorded_retry_required(unrecorded, SHA))
            # A current-model verdict for this head still has to be re-posted first.
            unrecorded.write_text(json.dumps({**base, **IDENTITY}), encoding="utf-8")
            self.assertTrue(pr.unrecorded_retry_required(unrecorded, SHA))
            self.assertFalse(pr.unrecorded_retry_required(unrecorded, "b" * 40))
            self.assertFalse(pr.unrecorded_retry_required(Path(tmp) / "missing.json", SHA))

    def test_backfill_recovers_the_base_from_a_legacy_status(self):
        legacy = {"id": 5, "context": pr.LEGACY_CONTEXTS[0], "creator": {"login": "owner"},
                  "description": f"quota-pending base={'e' * 40}"}
        current = {"id": 4, "context": pr.CONTEXT, "creator": {"login": "owner"},
                   "description": f"REQUEST_CHANGES base={'f' * 40}"}
        self.assertEqual(pr.reviewed_base(FakeAPI(lambda path: [legacy]), SHA), "e" * 40)
        # The current context wins even when the legacy status is newer.
        self.assertEqual(pr.reviewed_base(FakeAPI(lambda path: [legacy, current]), SHA), "f" * 40)

    def test_pending_skips_merged_legacy_approvals_but_not_unmerged_or_pending_ones(self):
        from unittest.mock import patch
        def pull(n, merged, state="closed"):
            return {"number": n, "title": f"t{n}", "state": state, "merged_at": "x" if merged else None,
                    "head": {"sha": f"{n:040x}"}}
        def legacy(desc, state):
            return [{"id": 1, "context": pr.LEGACY_CONTEXTS[0], "creator": {"login": "owner"},
                     "description": desc, "state": state}]
        approved = legacy(f"APPROVE base={'b' * 40}", "success")
        pending = legacy(f"quota-pending base={'b' * 40}", "pending")
        rows = {f"{1:040x}": approved, f"{2:040x}": approved, f"{3:040x}": pending}
        prs = [pull(1, True), pull(2, False, "open"), pull(3, True)]

        def routes(path):
            if path.startswith("/commits/"):
                return rows[path.split("/")[2]]
            if path.startswith("/pulls/") and "/commits" in path:
                return []
            return {"commits": 1}
        printed = []
        with patch.object(pr, "all_prs", return_value=prs),              patch.object(pr.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)),              patch.object(pr, "git", return_value=""),              patch("builtins.print", side_effect=lambda *a, **k: printed.append(" ".join(map(str, a)))):
            pr.list_pending(FakeAPI(routes))
        listed = [line for line in printed if line.startswith("#")]
        self.assertEqual([line.split()[0] for line in listed], ["#2", "#3"])
        self.assertIn("quota-pending", listed[1])
        self.assertIn("1 merged after an APPROVE by an earlier review model", printed[-1])


class PromptVerifiedIdentityTests(unittest.TestCase):
    """PR #104 full-prompt round 1: a verdict counts only with proof the reviewer got the
    whole prompt, and backfills run the current tooling against the historical head."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pr-review-proof-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = self.root / ".codex-review"
        self.state.mkdir()
        for name, value in (("ROOT", self.root), ("bash", lambda: "bash"),
                            ("wrapper", lambda: "scripts/codex_review.sh")):
            patcher = mock.patch.object(pr, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def run_with(self, rc, proof, session="sid-1", target=None):
        envs = []

        def fake_run(args, **kwargs):
            envs.append(kwargs["env"])
            (self.state / "last_message.txt").write_text("REQUEST_CHANGES\n", encoding="utf-8")
            (self.state / "last_session_id").write_text(session, encoding="utf-8")
            if proof is not None:
                (self.state / "last_identity.json").write_text(json.dumps(proof), encoding="utf-8")
            return subprocess.CompletedProcess(args, rc)
        with mock.patch.object(pr.subprocess, "run", fake_run):
            verdict = pr.run_review("targeted", "b" * 40, SHA, None, None, target=target)[0]
        return verdict, envs[0]

    def proof(self, **changes):
        return {"sessionId": "sid-1", "actualModel": pr.MODEL, "actualEffort": pr.EFFORT,
                "promptVerified": True, **changes}

    def test_verdict_needs_a_matching_prompt_verified_proof(self):
        self.assertEqual(self.run_with(2, self.proof())[0], "REQUEST_CHANGES")
        self.assertEqual(self.run_with(0, self.proof())[0], "APPROVE")
        for bad in (None, self.proof(promptVerified=False), self.proof(sessionId="other"),
                    self.proof(actualModel="gpt-6.1-sol"), self.proof(actualEffort="xhigh")):
            with self.subTest(proof=bad):
                (self.state / "last_identity.json").unlink(missing_ok=True)
                self.assertEqual(self.run_with(0, bad)[0], "ERROR")

    def test_a_stale_proof_from_an_earlier_round_is_discarded(self):
        (self.state / "last_identity.json").write_text(json.dumps(self.proof()), encoding="utf-8")
        self.assertEqual(self.run_with(0, None)[0], "ERROR")

    def test_records_without_prompt_verification_never_resume_or_retry(self):
        void = {"model": pr.MODEL, "effort": pr.EFFORT}  # e.g. written before the prompt check
        ok = subprocess.CompletedProcess([], 0)
        with mock.patch.object(pr.subprocess, "run", return_value=ok), self.assertRaises(pr.Blocked):
            pr.resume_base({"head": "b" * 40, "verdict": "REQUEST_CHANGES", **void}, SHA)
        unrecorded = self.root / "u.json"
        entry = {"repo": "owner/repo", "pr": 7, "verdict": "APPROVE", "base": "c" * 40, "head": SHA,
                 "session": "s", "bound_session": "s", "message": "APPROVE", "resume": False, **void}
        unrecorded.write_text(json.dumps(entry), encoding="utf-8")
        self.assertFalse(pr.unrecorded_retry_required(unrecorded, SHA))
        with mock.patch.object(pr, "record") as record, self.assertRaises(pr.Blocked):
            pr.retry_record(FakeAPI(lambda path: None), {"number": 7}, SHA, self.root / "b.json", unrecorded)
        record.assert_not_called()

    def test_finish_keeps_the_prompt_verification_in_the_binding(self):
        binding, unrecorded = self.root / "b.json", self.root / "u.json"
        entry = {"repo": "owner/repo", "pr": 7, "verdict": "REQUEST_CHANGES", "base": "c" * 40, "head": SHA,
                 "session": "s", "bound_session": "s", "message": "", "resume": False, **IDENTITY}
        with mock.patch.object(pr, "record"):
            pr.finish(FakeAPI(lambda path: None), {"number": 7}, entry, binding, unrecorded)
        self.assertTrue(pr.current_identity(json.loads(binding.read_text(encoding="utf-8"))))

    def test_target_worktree_reaches_the_wrapper_only_for_a_backfill(self):
        _, env = self.run_with(2, self.proof())
        self.assertNotIn("CODEX_REVIEW_TARGET", env)
        target = self.root / ".codex-review" / "target-pr-7"
        _, env = self.run_with(2, self.proof(), target=target)
        self.assertEqual(env["CODEX_REVIEW_TARGET"], str(target))


class BackfillAndQuotaRetryTests(unittest.TestCase):
    """PR #104 prompt-verified round 2: backfill resume after a fix; quota-pending retry."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pr-review-backfill-")
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name) / "repo"
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True, capture_output=True)
        self.shas = [self.commit(f"c{i}") for i in range(2)]
        patcher = mock.patch.object(pr, "ROOT", self.repo)
        patcher.start()
        self.addCleanup(patcher.stop)

    def commit(self, message):
        subprocess.run(["git", "-C", str(self.repo), "-c", "user.name=F", "-c", "user.email=f@example.invalid",
                        "commit", "--allow-empty", "-qm", message], check=True, capture_output=True)
        return subprocess.run(["git", "-C", str(self.repo), "rev-parse", "HEAD"], check=True,
                              capture_output=True, text=True).stdout.strip()

    def head_of(self, path):
        return subprocess.run(["git", "-C", str(path), "rev-parse", "HEAD"], check=True,
                              capture_output=True, text=True).stdout.strip()

    def test_existing_target_advances_to_a_descendant_head(self):
        old, new = self.shas
        target = pr.target_worktree(7, old)
        self.assertEqual(self.head_of(target), old)
        self.assertEqual(pr.target_worktree(7, new), target)
        self.assertEqual(self.head_of(target), new)
        self.assertEqual(pr.target_worktree(7, new), target)  # unchanged head: reused

    def test_target_is_never_moved_backwards_or_when_dirty(self):
        old, new = self.shas
        target = pr.target_worktree(7, new)
        with self.assertRaises(pr.Blocked):
            pr.target_worktree(7, old)  # not a descendant
        self.assertEqual(self.head_of(target), new)
        side = self.commit("c2")
        (target / "stray.txt").write_text("x", encoding="utf-8")
        with self.assertRaises(pr.Blocked):
            pr.target_worktree(7, side)
        self.assertEqual(self.head_of(target), new)

    def test_plain_directory_target_never_moves_the_tooling_checkout(self):
        """PR #104 resume round (P1): git resolves a plain directory to the tooling checkout."""
        old, new = self.shas
        subprocess.run(["git", "-C", str(self.repo), "checkout", "-q", "--detach", old],
                       check=True, capture_output=True)
        plain = self.repo / ".codex-review" / "target-pr-7"
        plain.mkdir(parents=True)
        (self.repo / ".gitignore").write_text(".codex-review/\n", encoding="utf-8")
        subprocess.run(["git", "-C", str(self.repo), "add", ".gitignore"], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(self.repo), "-c", "user.name=F", "-c", "user.email=f@example.invalid",
                        "commit", "-qm", "ignore"], check=True, capture_output=True)
        tooling = self.head_of(self.repo)
        for head in (new, tooling):
            with self.subTest(head=head), self.assertRaises(pr.Blocked):
                pr.target_worktree(7, head)
        self.assertEqual(self.head_of(self.repo), tooling)

    def test_target_on_a_branch_or_the_tooling_checkout_is_refused(self):
        old, new = self.shas
        target = self.repo / ".codex-review" / "target-pr-7"
        subprocess.run(["git", "-C", str(self.repo), "worktree", "add", "-q", "-b", "side", str(target), old],
                       check=True, capture_output=True)
        with self.assertRaises(pr.Blocked):
            pr.target_worktree(7, new)
        self.assertEqual(self.head_of(target), old)
        self.assertFalse(pr.own_detached_worktree(self.repo))

    def test_current_model_quota_pending_can_be_reposted(self):
        unrecorded = Path(self.temp.name) / "u.json"
        entry = {"repo": "owner/repo", "pr": 7, "verdict": "QUOTA_PENDING", "base": "c" * 40, "head": SHA,
                 "session": "unavailable", "bound_session": "unavailable", "message": "usage limit",
                 "resume": False, "model": pr.MODEL, "effort": pr.EFFORT, "prompt_verified": False}
        unrecorded.write_text(json.dumps(entry), encoding="utf-8")
        self.assertTrue(pr.unrecorded_retry_required(unrecorded, SHA))
        with mock.patch.object(pr, "record") as record:
            self.assertEqual(pr.retry_record(FakeAPI(lambda path: None), {"number": 7}, SHA,
                                             Path(self.temp.name) / "b.json", unrecorded), 3)
        record.assert_called_once()
        self.assertFalse((Path(self.temp.name) / "b.json").exists())  # no resume binding from quota

    def test_quota_pending_from_another_model_or_unproven_verdicts_are_not_reposted(self):
        base = {"repo": "owner/repo", "pr": 7, "base": "c" * 40, "head": SHA, "session": "s",
                "bound_session": "s", "message": "", "resume": False}
        for entry in ({**base, "verdict": "QUOTA_PENDING", "model": "gpt-6.1-sol", "effort": "xhigh"},
                      {**base, "verdict": "APPROVE", "model": pr.MODEL, "effort": pr.EFFORT,
                       "prompt_verified": False},
                      {**base, "verdict": "BOGUS", **IDENTITY}):
            with self.subTest(entry=entry):
                self.assertFalse(pr.retryable(entry))
