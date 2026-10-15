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
            pr.resume_base({"head": prev}, head)
        with patch.object(pr.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)) as run:
            self.assertEqual(pr.resume_base({"head": prev}, head), prev)
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
        assert '"head": head}' in main_src and "previous_head = resume_base(saved, head)" in main_src


if __name__ == "__main__":
    unittest.main()
