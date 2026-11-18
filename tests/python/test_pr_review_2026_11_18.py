"""tools/pr_review.py after the 2026-11-18 switch to gpt-6.2-astra/medium. Offline; no GitHub or Codex calls."""
import contextlib
import importlib.util
import io
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

OLD = "codex-review/gpt-6.1-sol"
HEAD_A, HEAD_B, BASE = "a" * 40, "b" * 40, "c" * 40


def status(ident, context, state, description, login="owner"):
    return {"id": ident, "context": context, "state": state, "description": description,
            "creator": {"login": login}}


class FakeAPI:
    repo = "owner/repo"

    def __init__(self, statuses=None):
        self.statuses = statuses or {}
        self.posts = []

    def call(self, method, path, body=None):
        if method == "POST":
            self.posts.append((path, body))
            return {}
        if path.startswith("/commits/"):
            return self.statuses.get(path.split("/")[2], [])
        raise AssertionError(path)


class PastContextTests(unittest.TestCase):
    def test_contexts_are_the_new_one_plus_the_old_gpt61_status(self):
        self.assertEqual(pr.CONTEXT, "codex-review/gpt-6.2-astra")
        self.assertEqual(pr.PAST_CONTEXTS, (OLD,))

    def test_pending_skips_old_context_success_and_lists_old_quota_pending(self):
        api = FakeAPI({
            HEAD_A: [status(1, OLD, "success", f"APPROVE base={BASE}")],
            HEAD_B: [status(2, OLD, "pending", f"quota-pending base={BASE}")],
            "d" * 40: [],
            "e" * 40: [status(3, OLD, "success", "APPROVE", login="intruder")],
        })
        prs = [{"number": n, "state": "open", "merged_at": None, "title": f"t{n}", "head": {"sha": sha}}
               for n, sha in ((1, HEAD_A), (2, HEAD_B), (3, "d" * 40), (4, "e" * 40))]
        out = io.StringIO()
        with mock.patch.object(pr, "all_prs", return_value=prs), \
             mock.patch.object(pr.subprocess, "run"), mock.patch.object(pr, "git", return_value=""), \
             contextlib.redirect_stdout(out):
            pr.list_pending(api)
        text = out.getvalue()
        self.assertNotIn("#1 ", text)
        self.assertIn(f"#2 [open] {HEAD_B[:12]} quota-pending base={BASE}", text)
        self.assertIn("#3 [open]", text)
        self.assertIn("never reviewed", text)
        # A success from someone other than the owner never counts, under any context.
        self.assertIn("#4 [open]", text)
        self.assertIn("3 PR(s) without an APPROVE status", text)

    def test_latest_status_prefers_success_then_current_then_past(self):
        rows = [status(1, OLD, "success", "APPROVE"), status(5, pr.CONTEXT, "failure", "REQUEST_CHANGES")]
        self.assertEqual(pr.latest_status(FakeAPI({HEAD_A: rows}), HEAD_A)["id"], 1)
        rows = [status(1, OLD, "pending", "quota-pending"), status(5, pr.CONTEXT, "failure", "REQUEST_CHANGES")]
        self.assertEqual(pr.latest_status(FakeAPI({HEAD_A: rows}), HEAD_A)["id"], 5)
        rows = [status(1, OLD, "pending", "quota-pending")]
        self.assertEqual(pr.latest_status(FakeAPI({HEAD_A: rows}), HEAD_A)["id"], 1)
        self.assertIsNone(pr.latest_status(FakeAPI({HEAD_A: []}), HEAD_A))

    def test_reviewed_base_recovers_the_base_from_an_old_context_status(self):
        old_only = FakeAPI({HEAD_A: [status(1, OLD, "pending", f"quota-pending base={BASE}"),
                                     status(2, OLD, "pending", f"quota-pending base={'d' * 40}")]})
        self.assertEqual(pr.reviewed_base(old_only, HEAD_A), "d" * 40)
        both = FakeAPI({HEAD_A: [status(1, OLD, "pending", f"quota-pending base={BASE}"),
                                 status(2, pr.CONTEXT, "failure", f"REQUEST_CHANGES base={'e' * 40}")]})
        self.assertEqual(pr.reviewed_base(both, HEAD_A), "e" * 40)
        foreign = FakeAPI({HEAD_A: [status(1, OLD, "pending", f"base={BASE}", login="intruder")]})
        self.assertEqual(pr.reviewed_base(foreign, HEAD_A), "")

    def test_new_verdicts_are_recorded_under_the_new_context_only(self):
        for verdict in ("APPROVE", "REQUEST_CHANGES", "QUOTA_PENDING", "ERROR"):
            with self.subTest(verdict=verdict):
                api = FakeAPI()
                pr.record(api, {"number": 9, "html_url": "https://example.invalid/9"}, verdict,
                          BASE, HEAD_A, "sid", "msg", False)
                status_posts = [body for path, body in api.posts if path.startswith("/statuses/")]
                self.assertEqual([b["context"] for b in status_posts], [pr.CONTEXT])


class CheckoutTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pr-review-checkout-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.tool = self.base / "tool"
        self.review = self.base / "review"
        for path in (self.tool, self.review):
            path.mkdir()
        patcher = mock.patch.object(pr, "ROOT", self.tool)
        patcher.start()
        self.addCleanup(patcher.stop)
        patcher = mock.patch.object(pr, "CHECKOUT", None)
        patcher.start()
        self.addCleanup(patcher.stop)

    def init_repo(self, path, origin):
        subprocess.run(["git", "init", "-q", str(path)], check=True, capture_output=True)
        if origin:
            subprocess.run(["git", "-C", str(path), "remote", "add", "origin", origin],
                           check=True, capture_output=True)

    def test_checkout_without_pr_is_refused(self):
        err = io.StringIO()
        with mock.patch.object(pr.sys, "argv", ["pr_review.py", "--checkout", str(self.review)]), \
             mock.patch.object(pr, "API") as api, contextlib.redirect_stderr(err):
            self.assertEqual(pr.main(), 1)
        self.assertIn("--checkout is only for a backfill", err.getvalue())
        api.assert_not_called()

    def test_use_checkout_requires_the_same_repository(self):
        self.init_repo(self.tool, "https://github.com/owner/repo.git")
        self.init_repo(self.review, "https://github.com/owner/repo")
        pr.use_checkout(str(self.review))
        self.assertEqual(pr.repo_dir(), self.review.resolve())
        with mock.patch.object(pr, "CHECKOUT", None):
            other = self.base / "other"
            other.mkdir()
            self.init_repo(other, "https://github.com/someone/else.git")
            with self.assertRaises(pr.Blocked):
                pr.use_checkout(str(other))
            self.assertIsNone(pr.CHECKOUT)
            with self.assertRaises(pr.Blocked):
                pr.use_checkout(str(self.base / "missing"))
            plain = self.base / "plain"
            plain.mkdir()
            with self.assertRaises(pr.Blocked):
                pr.use_checkout(str(plain))

    def test_run_review_uses_checkout_for_cwd_state_and_the_tooling_wrapper(self):
        state = self.review / ".codex-review"
        state.mkdir()
        (self.tool / "scripts").mkdir()
        (self.tool / "scripts" / "codex_review.sh").write_text("#!/bin/bash\n", encoding="utf-8")
        calls = []

        def fake_run(args, **kwargs):
            calls.append((args, kwargs))
            (state / "last_message.txt").write_text("APPROVE\n", encoding="utf-8")
            (state / "last_session_id").write_text("sid-from-checkout", encoding="utf-8")
            return subprocess.CompletedProcess(args, 0)
        with mock.patch.object(pr, "CHECKOUT", self.review), mock.patch.object(pr, "bash", return_value="bash"), \
             mock.patch.object(pr.subprocess, "run", fake_run):
            verdict, session, _ = pr.run_review("targeted", BASE, HEAD_A, None, None)
        self.assertEqual((verdict, session), ("APPROVE", "sid-from-checkout"))
        args, kwargs = calls[0]
        self.assertEqual(Path(kwargs["cwd"]), self.review)
        self.assertEqual(kwargs["env"]["CODEX_REVIEW_REPO"], str(self.review))
        self.assertEqual(args[1], (self.tool / "scripts" / "codex_review.sh").as_posix())

    def test_main_backfill_runs_in_the_checkout_and_explains_a_head_mismatch(self):
        subprocess_run = mock.Mock(return_value=subprocess.CompletedProcess([], 0))
        fake_pr = {"number": 7, "head": {"sha": HEAD_B}, "base": {"sha": "f" * 40}, "html_url": "u"}

        def fake_git(*args):
            return {"rev-parse HEAD": HEAD_A, "status --porcelain --untracked-files=all": "",
                    "rev-parse FETCH_HEAD": "9" * 40, "merge-base": BASE}.get(
                        " ".join(args[:2]) if args[0] == "merge-base" else " ".join(args), BASE)
        argv = ["pr_review.py", "--pr", "7", "--checkout", str(self.review)]
        common = (mock.patch.object(pr.sys, "argv", argv), mock.patch.object(pr, "API", return_value=FakeAPI()),
                  mock.patch.object(pr, "repository", return_value="owner/repo"),
                  mock.patch.object(pr, "use_checkout", side_effect=lambda d: setattr(pr, "CHECKOUT", Path(d))),
                  mock.patch.object(pr, "git", fake_git), mock.patch.object(pr.subprocess, "run", subprocess_run),
                  mock.patch.object(pr, "find_pr", return_value=fake_pr))
        err = io.StringIO()
        with contextlib.ExitStack() as stack:
            for patcher in common:
                stack.enter_context(patcher)
            stack.enter_context(contextlib.redirect_stderr(err))
            self.assertEqual(pr.main(), 1)
        message = err.getvalue()
        self.assertIn("git worktree add --detach DIR " + HEAD_B, message)
        self.assertIn("--pr 7 --checkout DIR", message)
        self.assertIn((self.tool / "tools" / "pr_review.py").as_posix(), message)
        self.assertEqual(subprocess_run.call_args.kwargs["cwd"], self.review)

        # Same head: the review runs with the checkout as repository and keeps its state there.
        fake_pr["head"]["sha"] = HEAD_A
        seen = {}

        def fake_review(*args):
            seen["repo"] = pr.repo_dir()
            return "APPROVE", "sid", "ok"
        with contextlib.ExitStack() as stack:
            for patcher in common:
                stack.enter_context(patcher)
            stack.enter_context(mock.patch.object(pr, "run_review", fake_review))
            finish = stack.enter_context(mock.patch.object(pr, "finish", return_value=0))
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            self.assertEqual(pr.main(), 0)
        self.assertEqual(seen["repo"], self.review)
        self.assertTrue((self.review / ".codex-review").is_dir())
        self.assertEqual(finish.call_args.args[3], self.review / ".codex-review" / "pr_review.json")


class WrapperRepoVariableTests(unittest.TestCase):
    def test_wrapper_honours_codex_review_repo_and_fails_closed(self):
        text = (ROOT / "scripts" / "codex_review.sh").read_text(encoding="utf-8")
        self.assertIn('CODEX_REVIEW_REPO', text)
        self.assertIn('STATE_DIR="$REPO_ROOT/.codex-review"', text)
        self.assertIn('--repo "$REPO_ROOT"', text)


if __name__ == "__main__":
    unittest.main()
