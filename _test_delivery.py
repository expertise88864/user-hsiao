"""Offline regression tests for publication evidence. No real push/network."""
import unittest
import io
import subprocess
import os
from pathlib import Path
import shutil
import tempfile
from unittest.mock import patch
import _delivery as d

SHA = "a" * 40


class DeliveryTests(unittest.TestCase):
    def test_cli_preserves_claude_gate_failure_and_stdin(self):
        cfg = {**d.policy(), "claude_hook": True}
        updates = f"HEAD {SHA} refs/heads/codex/test {'0'*40}\n"
        with patch.object(d, "policy", return_value=cfg), \
             patch.object(d.sys, "argv", ["_delivery.py", "pre-push"]), \
             patch.object(d.sys, "stdin", io.StringIO(updates)), \
             patch.object(d, "pre_push") as gate, \
             patch.object(d.subprocess, "run", return_value=subprocess.CompletedProcess([], 4)) as review:
            self.assertEqual(d.main(), 4)
            gate.assert_called_once_with([updates], "origin", cfg)
            self.assertEqual(review.call_args.args[0][1:4], ["tools/claude_diff_review.py", "push", "--remote-name"])
            self.assertEqual(review.call_args.kwargs["input"], updates)

    def test_failed_delivery_gate_never_reaches_claude_or_success(self):
        with patch.object(d, "policy", return_value={**d.policy(), "claude_hook": True}), \
             patch.object(d.sys, "argv", ["_delivery.py", "pre-push"]), \
             patch.object(d.sys, "stdin", io.StringIO("")), \
             patch.object(d, "pre_push", side_effect=d.Blocked("missing CI")), \
             patch.object(d.subprocess, "run") as review:
            self.assertEqual(d.main(), 1)
            review.assert_not_called()

    def test_sha(self):
        for value in ("a", "0" * 40, "g" * 40, "a" * 40 + "\n"):
            with self.assertRaises(d.Blocked):
                d.check_sha(value)
        self.assertEqual(d.check_sha(SHA), SHA)

    def test_jobs_require_presence(self):
        with self.assertRaises(d.Blocked):
            d.assess_jobs([], ["test"], [])

    def test_required_step_must_be_present_unique_complete_and_successful(self):
        step = {"name": "Full tests", "status": "completed", "conclusion": "success"}
        job = {"name": "test", "status": "completed", "conclusion": "success", "steps": [step]}
        contract = {"test": {"required": ["Full tests"]}}
        d.assess_jobs([job], ["test"], [], contract)
        for steps in (None, [], [step, step], [{**step, "name": "Partial tests"}],
                      [{**step, "status": "in_progress"}],
                      *[[{**step, "conclusion": c}] for c in (None, "skipped", "neutral", "failure")]):
            with self.subTest(steps=steps), self.assertRaises(d.Blocked):
                d.assess_jobs([{**job, "steps": steps}], ["test"], [], contract)

    def test_controlled_font_diagnostic_is_required_only_for_candidate(self):
        quality = next(entry for entry in d.policy()["workflows"]
                       if entry["path"] == ".github/workflows/quality.yml")
        name = "Lighthouse CI"
        contract = quality["steps"][name]
        probe_steps = ["Measure isolated candidate font geometry", "Probe installed CJK system fallback", "Upload controlled font experiment"]
        self.assertEqual(contract["candidate_required"], probe_steps)
        steps = [{"name": step, "status": "completed", "conclusion": "success"}
                 for step in contract["required"] + probe_steps]
        job = {"name": name, "status": "completed", "conclusion": "success", "steps": steps}
        d.assess_jobs([job], [name], [], {name: contract}, "candidate")
        for probe in probe_steps:
            skipped = [{**step, "conclusion": "skipped"} if step["name"] == probe else step for step in steps]
            with self.subTest(probe=probe), self.assertRaises(d.Blocked):
                d.assess_jobs([{**job, "steps": skipped}], [name], [], {name: contract}, "candidate")
        main_steps = [{**step, "conclusion": "skipped"} if step["name"] in probe_steps else step for step in steps]
        d.assess_jobs([{**job, "steps": main_steps}], [name], [], {name: contract}, "main")

    def test_font_experiment_cannot_run_before_scoring_or_on_main(self):
        workflow = (d.ROOT / ".github/workflows/quality.yml").read_text(encoding="utf-8")
        scoring = workflow.index("      - name: Run Lighthouse CI\n")
        measure = workflow.index("      - name: Measure isolated candidate font geometry\n")
        install = workflow.index("      - name: Probe installed CJK system fallback\n")
        upload = workflow.index("      - name: Upload controlled font experiment\n")
        normal_fonts = workflow.index("      - name: Upload font environment\n")
        self.assertLess(scoring, measure)
        self.assertLess(measure, install)
        self.assertLess(install, upload)
        self.assertLess(upload, normal_fonts)
        for block in (workflow[measure:install], workflow[install:upload], workflow[upload:normal_fonts]):
            self.assertIn("if: github.ref != 'refs/heads/main'", block)
        self.assertIn("CANDIDATE_SHA: ${{ github.event.pull_request.head.sha || github.sha }}", workflow[measure:upload])
        self.assertIn("temporaryPublicStorage: false", workflow[scoring:measure])

    def test_candidate_non_fast_forward_blocks_before_tests(self):
        with patch.object(d, "git", side_effect=["https://github.com/owner/repo.git", "b"*40]), \
             patch.object(d, "clean"), \
             patch.object(d.subprocess, "run", side_effect=[None, subprocess.CalledProcessError(1, "merge-base")]) as run:
            with self.assertRaises(subprocess.CalledProcessError):
                d.pre_push([f"HEAD {SHA} refs/heads/codex/test {'b'*40}"], "origin", {"repository": "owner/repo"})
            self.assertEqual(run.call_count, 2)
            self.assertIn("--is-ancestor", run.call_args.args[0])

    def test_git_really_invokes_the_tracked_hook_and_blocks_unexpected_destination(self):
        # Entire remote is a new temporary bare repo: never contacts GitHub.
        # Git hooks export GIT_DIR etc. Those MUST NOT reach a foreign repo,
        # or even `git init <temp>` can reconfigure the calling repository.
        local_vars = subprocess.check_output(["git", "rev-parse", "--local-env-vars"],
                                             text=True, encoding="utf-8").splitlines()
        foreign_env = {key: value for key, value in os.environ.items() if key not in local_vars}
        with tempfile.TemporaryDirectory(prefix="delivery-hook-") as directory:
            root = Path(directory)
            work = root / "work"
            remote = root / "remote.git"
            def run(*args):
                return subprocess.run(["git", *args], cwd=work if work.exists() else root,
                                      capture_output=True, text=True, encoding="utf-8", check=True, env=foreign_env)
            run("init", "--bare", str(remote))
            run("init", str(work))
            run("config", "user.name", "Delivery test")
            run("config", "user.email", "delivery-test@example.invalid")
            (work / ".githooks").mkdir()
            for name in ("_delivery.py", "_delivery_policy.json", ".githooks/pre-push"):
                shutil.copyfile(d.ROOT / name, work / name)
            os.chmod(work / ".githooks/pre-push", 0o755)
            run("add", ".")
            run("commit", "-m", "isolated hook test")
            run("remote", "add", "origin", str(remote))
            run("config", "core.hooksPath", ".githooks")
            with self.assertRaises(subprocess.CalledProcessError) as blocked:
                run("push", "origin", "HEAD:refs/heads/codex/test")
            self.assertIn("Unexpected push destination", blocked.exception.stderr)
            self.assertEqual(run("ls-remote", "origin").stdout.strip(), "")

    def test_policy_cannot_omit_all_checks(self):
        for cfg in ({}, {"workflows": []}, {"workflows": [{"path": ".github/workflows/ci.yml", "jobs": []}]}):
            with self.assertRaises(d.Blocked):
                d.validate_policy(cfg)
        d.validate_policy(d.policy())

    def test_dispatch_requires_explicit_project_support(self):
        run = {"id": 1, "path": "ci.yml", "event": "workflow_dispatch", "head_branch": "codex/test",
               "head_sha": SHA, "status": "completed", "conclusion": "success"}
        with self.assertRaises(d.Blocked):
            d.select_run([run], "ci.yml", SHA, "candidate")
        self.assertEqual(d.select_run([run], "ci.yml", SHA, "candidate", True), run)

    def test_every_non_success_blocks(self):
        for state in (None, "failure", "cancelled", "timed_out", "neutral", "skipped"):
            with self.subTest(state=state), self.assertRaises(d.Blocked):
                d.assess_jobs([{"name": "test", "status": "completed", "conclusion": state}], ["test"], [])

    def test_only_declared_inapplicable_job_may_skip(self):
        d.assess_jobs([{"name": "test", "status": "completed", "conclusion": "success"},
                       {"name": "production-only", "status": "completed", "conclusion": "skipped"}],
                      ["test"], ["production-only"])

    def test_hidden_failure_blocks(self):
        with self.assertRaises(d.Blocked):
            d.assess_jobs([{"name": "test", "status": "completed", "conclusion": "success",
                            "steps": [{"name": "masked", "conclusion": "failure"}]}], ["test"], [])

    def test_running_job_blocks(self):
        with self.assertRaises(d.Blocked):
            d.assess_jobs([{"name": "test", "status": "in_progress", "conclusion": None}], ["test"], [])

    def test_select_only_exact_candidate_push(self):
        good = {"id": 1, "path": "ci.yml", "event": "push", "head_branch": "codex/test",
                "head_sha": SHA, "status": "completed", "conclusion": "success"}
        self.assertEqual(d.select_run([good], "ci.yml", SHA, "candidate"), good)
        for key, value in (("head_sha", "b"*40), ("head_branch", "main"),
                           ("path", "fake.yml"), ("event", "pull_request")):
            with self.subTest(key=key), self.assertRaises(d.Blocked):
                d.select_run([{**good, key: value}], "ci.yml", SHA, "candidate")

    def test_new_failed_run_does_not_reuse_old_green(self):
        good = {"id": 1, "path": "ci.yml", "event": "push", "head_branch": "codex/test",
                "head_sha": SHA, "status": "completed", "conclusion": "success"}
        with self.assertRaises(d.Blocked):
            d.select_run([good, {**good, "id": 2, "conclusion": "failure"}], "ci.yml", SHA, "candidate")

    def test_reject_other_ref_and_deletion(self):
        cfg = {"repository": "owner/repo"}
        with patch.object(d, "git", return_value="https://github.com/owner/repo.git"), patch.object(d, "clean"):
            for sha, target in (("0"*40, "refs/heads/main"), (SHA, "refs/tags/v1")):
                with self.assertRaises(d.Blocked):
                    d.pre_push([f"HEAD {sha} {target} {'b'*40}"], "origin", cfg)

    def test_main_advanced_blocks_before_api(self):
        with patch.object(d, "git", side_effect=["https://github.com/owner/repo.git", "c"*40]), \
             patch.object(d, "clean"), patch.object(d.subprocess, "run"), patch.object(d, "API") as api:
            with self.assertRaises(d.Blocked):
                d.pre_push([f"HEAD {SHA} refs/heads/main {'b'*40}"], "origin", {"repository": "owner/repo"})
            api.assert_not_called()

    def test_preview_exact_sha_not_production(self):
        class Fake:
            def pages(self, path):
                if path.startswith("/deployments?"):
                    return [{"id": 1, "sha": SHA, "environment": "Preview", "production_environment": False, "creator": {"login": "vercel[bot]"}}]
                return [{"state": "success", "environment_url": "https://candidate-unique.vercel.app"}]
        self.assertEqual(d.preview_url(Fake(), SHA), "https://candidate-unique.vercel.app")

    def test_preview_missing_blocks(self):
        class Fake:
            def pages(self, path):
                return []
        with self.assertRaises(d.Blocked):
            d.preview_url(Fake(), SHA)

    def test_vercel_production_uses_environment_name_not_unreliable_boolean(self):
        # Actual Vercel GitHub deployment 6289256604 has Production + False.
        class Fake:
            def pages(self, path):
                if path.startswith("/deployments?"):
                    return [{"id": 1, "sha": SHA, "environment": "Production", "production_environment": False,
                             "creator": {"login": "vercel[bot]"}}]
                return [{"state": "success", "environment_url": "https://production-unique.vercel.app"}]
        self.assertEqual(d.deployment_url(Fake(), SHA, "production"), "https://production-unique.vercel.app")
        with self.assertRaises(d.Blocked):
            d.preview_url(Fake(), SHA)

    def _review_api(self, *statuses):
        class Fake:
            def pages(self, path):
                assert path == f"/commits/{SHA}/statuses"
                return list(statuses)
        return Fake()

    def _status(self, state="success", description=None, login="owner", context=None, ident=1):
        return {"id": ident, "state": state, "context": context or d.REVIEW_CONTEXT,
                "description": description or f"APPROVE base={'b'*40}",
                "creator": {"login": login}, "target_url": "https://github.com/owner/repo/pull/1"}

    def test_pr_review_approve_covering_main_passes(self):
        cfg = {"repository": "owner/repo"}
        with patch.object(d.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)) as run:
            result = d.pr_review(self._review_api(self._status()), cfg, SHA, "c"*40)
        self.assertEqual(result["pr_review"], "APPROVE")
        self.assertEqual(run.call_args.args[0][-2:], ["b"*40, "c"*40])

    def test_pr_review_blocks_missing_failed_foreign_or_malformed(self):
        cfg = {"repository": "owner/repo"}
        cases = ([], [self._status("failure", f"REQUEST_CHANGES base={'b'*40}")],
                 [self._status(login="someone-else")], [self._status(context="other")],
                 [self._status("pending", f"APPROVE base={'b'*40}")],
                 [self._status(description="APPROVE")],
                 [self._status(ident=1), self._status("failure", f"REQUEST_CHANGES base={'b'*40}", ident=2)])
        for statuses in cases:
            with self.subTest(statuses=statuses), \
                 patch.object(d.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)), \
                 self.assertRaises(d.Blocked):
                d.pr_review(self._review_api(*statuses), cfg, SHA, "c"*40)

    def test_pr_review_range_must_cover_promoted_commits(self):
        with patch.object(d.subprocess, "run", return_value=subprocess.CompletedProcess([], 1)), \
             self.assertRaises(d.Blocked):
            d.pr_review(self._review_api(self._status()), {"repository": "owner/repo"}, SHA, "c"*40)

    def test_pr_review_quota_pending_publishes_but_is_reported(self):
        status = self._status("pending", f"quota-pending base={'b'*40}")
        with patch.object(d.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)), \
             patch.object(d.sys, "stderr", io.StringIO()) as err:
            result = d.pr_review(self._review_api(status), {"repository": "owner/repo"}, SHA, "c"*40)
        self.assertEqual(result["pr_review"], "quota-pending")
        self.assertIn("not approved", err.getvalue())

    def test_candidate_cannot_drop_base_pr_review(self):
        self.assertTrue(d.requires_pr_review({"pr_review": False}, {"pr_review": True}))
        self.assertTrue(d.requires_pr_review({"pr_review": True}, {}))
        self.assertFalse(d.requires_pr_review({}, {}))
        with self.assertRaises(d.Blocked):
            d.validate_policy({**d.policy(), "pr_review": "yes"})

    def test_morning_dry_run_routing(self):
        self.assertFalse(d.needs_morning_preview(["AGENTS.md", "_delivery.py", "tests/test_email.py"]))
        for path in ("morning_report.py", "news_rules.py", "requirements.lock", ".github/workflows/morning-report-b.yml"):
            self.assertTrue(d.needs_morning_preview([path]))


class _VercelAPI:
    """Offline GitHub API double for deployment waits (no network)."""

    def __init__(self, deployments=(), deployment_statuses=None, commit_statuses=(),
                 main=None, compare=None, broken=()):
        self.deployments = list(deployments)
        self.deployment_statuses = deployment_statuses or {}
        self.commit_statuses = list(commit_statuses)
        self.main = main or SHA
        self.compare = compare
        self.broken = set(broken)

    def pages(self, path, key=None):
        if path.startswith("/deployments?"):
            return list(self.deployments)
        if path.startswith("/deployments/"):
            return list(self.deployment_statuses.get(int(path.split("/")[2]), []))
        if path == f"/commits/{SHA}/statuses":
            if "statuses" in self.broken:
                raise OSError("statuses unavailable")
            return list(reversed(self.commit_statuses))  # GitHub lists newest first
        raise AssertionError(path)

    def get(self, path):
        if path == "/branches/main":
            return {"commit": {"sha": self.main}}
        if path.startswith("/compare/"):
            if self.compare is None:
                raise OSError("compare unavailable")
            return self.compare
        raise AssertionError(path)


def _deployment(ident, environment="Preview", production=False):
    return {"id": ident, "sha": SHA, "environment": environment,
            "production_environment": production, "creator": {"login": "vercel[bot]"}}


def _build(ident, state, description="", login="vercel[bot]", context="Vercel"):
    return {"id": ident, "state": state, "context": context, "description": description,
            "created_at": f"2026-10-15T14:{ident:02d}:00Z", "creator": {"login": login}}


PENDING = "Vercel is deploying your app"
DONE = "Deployment has completed"
IGNORED = "Canceled by Ignored Build Step"
FAILED = "Deployment has failed"


class DeploymentWaitFailFastTests(unittest.TestCase):
    def assertFinal(self, api, environment="preview"):
        with self.assertRaises(d.Final) as caught:
            d.deployment_url(api, SHA, environment)
        self.assertIn("No successful Vercel", str(caught.exception))

    def assertKeepsWaiting(self, api, environment="preview"):
        with self.assertRaises(d.Blocked) as caught:
            d.deployment_url(api, SHA, environment)
        self.assertNotIsInstance(caught.exception, d.Final)

    def test_failed_exact_sha_deployment_is_final(self):
        self.assertFinal(_VercelAPI([_deployment(7)], {7: [{"state": "failure"}]},
                                    [_build(1, "pending", PENDING), _build(2, "failure", FAILED)]))
        self.assertFinal(_VercelAPI([_deployment(7)], {7: [{"state": "error"}]},
                                    [_build(1, "pending", PENDING), _build(2, "error", FAILED)]))

    def test_failed_build_status_without_deployment_is_final(self):
        self.assertFinal(_VercelAPI(commit_statuses=[_build(1, "pending", PENDING),
                                                     _build(2, "failure", FAILED)]))

    def test_ignored_build_step_is_final_for_production(self):
        api = _VercelAPI([_deployment(7)], {7: [{"state": "success", "environment_url": "https://exact.vercel.app"}]},
                         [_build(1, "pending", PENDING), _build(2, "success", DONE),
                          _build(3, "pending", PENDING), _build(4, "success", IGNORED)])
        self.assertFinal(api, "production")
        self.assertEqual(d.preview_url(api, SHA), "https://exact.vercel.app")

    def test_a_successful_deployment_still_wins(self):
        api = _VercelAPI([_deployment(7)], {7: [{"state": "success", "environment_url": "https://exact.vercel.app"}]},
                         [_build(1, "pending", PENDING), _build(2, "failure", FAILED)])
        self.assertEqual(d.preview_url(api, SHA), "https://exact.vercel.app")

    def test_a_newer_successful_build_outweighs_an_older_failed_deployment(self):
        # Review finding (2026-10-16): the rebuild's deployment record may still
        # be unpublished when its success status is already visible.
        self.assertKeepsWaiting(_VercelAPI([_deployment(7)], {7: [{"state": "failure"}]},
                                           [_build(1, "pending", PENDING), _build(2, "failure", FAILED),
                                            _build(3, "pending", PENDING), _build(4, "success", DONE)]))

    def test_still_pending_keeps_waiting(self):
        self.assertKeepsWaiting(_VercelAPI(commit_statuses=[_build(1, "pending", PENDING)]))

    def test_a_rebuild_after_a_failure_keeps_waiting(self):
        self.assertKeepsWaiting(_VercelAPI([_deployment(7)], {7: [{"state": "failure"}]},
                                           [_build(1, "pending", PENDING), _build(2, "failure", FAILED),
                                            _build(3, "pending", PENDING)]))

    def test_overlapping_builds_keep_waiting_until_all_end(self):
        self.assertKeepsWaiting(_VercelAPI(commit_statuses=[
            _build(1, "pending", PENDING), _build(2, "pending", PENDING), _build(3, "failure", FAILED)]))

    def test_production_not_reported_yet_keeps_waiting(self):
        api = _VercelAPI([_deployment(7)], {7: [{"state": "success", "environment_url": "https://exact.vercel.app"}]},
                         [_build(1, "pending", PENDING), _build(2, "success", DONE)])
        self.assertKeepsWaiting(api, "production")

    def test_a_running_matching_deployment_keeps_waiting(self):
        for state in ("queued", "pending", "in_progress"):
            with self.subTest(state=state):
                self.assertKeepsWaiting(_VercelAPI(
                    [_deployment(8), _deployment(7)], {7: [{"state": "failure"}], 8: [{"state": state}]},
                    [_build(1, "pending", PENDING), _build(2, "failure", FAILED)]))

    def test_missing_or_unreadable_evidence_keeps_waiting(self):
        self.assertKeepsWaiting(_VercelAPI())
        self.assertKeepsWaiting(_VercelAPI(commit_statuses=[_build(2, "failure", FAILED)]))
        self.assertKeepsWaiting(_VercelAPI(commit_statuses=[_build(1, "pending", PENDING), _build(2, "failure", FAILED)],
                                           broken={"statuses"}))
        self.assertKeepsWaiting(_VercelAPI(commit_statuses=[_build(1, "pending", PENDING),
                                                            {"id": 2, "state": "failure", "context": "Vercel"}]))

    def test_statuses_from_others_are_ignored(self):
        self.assertKeepsWaiting(_VercelAPI(commit_statuses=[
            _build(1, "pending", PENDING), _build(2, "success", DONE),
            _build(3, "failure", FAILED, login="someone"), _build(4, "failure", FAILED, context="ci/other")]))

    def _run_main(self, outcomes, wait="600"):
        calls, sleeps, clock = [], [], [0.0]

        def deployment(api, sha, environment):
            calls.append(environment)
            outcome = outcomes[len(calls) - 1]
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        def monotonic():
            clock[0] += 1
            return clock[0]

        with patch.object(d, "policy", return_value={"repository": "owner/repo"}), \
             patch.object(d, "API"), patch.object(d, "deployment_url", side_effect=deployment), \
             patch.object(d.time, "monotonic", side_effect=monotonic), \
             patch.object(d.time, "sleep", side_effect=sleeps.append), \
             patch.object(d.sys, "argv", ["_delivery.py", "preview", SHA, "--wait", wait]), \
             patch("sys.stdout", new_callable=io.StringIO), patch("sys.stderr", new_callable=io.StringIO) as err:
            code = d.main()
        return code, len(calls), err.getvalue()

    def test_wait_ends_early_only_after_two_consecutive_final_observations(self):
        code, calls, err = self._run_main([d.Final("gone"), d.Final("gone")])
        self.assertEqual((code, calls), (1, 2))
        self.assertIn("Stopped waiting early", err)

    def test_a_final_observation_that_recovers_still_passes(self):
        self.assertEqual(self._run_main([d.Final("gone"), "https://exact.vercel.app"])[:2], (0, 2))
        self.assertEqual(self._run_main([d.Final("gone"), d.Blocked("pending"), d.Final("gone"),
                                         "https://exact.vercel.app"])[:2], (0, 4))

    def test_ordinary_blocks_keep_waiting(self):
        outcomes = [d.Blocked("No successful Vercel preview deployment bound to this SHA")] * 8
        self.assertEqual(self._run_main(outcomes + ["https://exact.vercel.app"])[:2], (0, 9))

    def test_no_wait_still_reports_once(self):
        self.assertEqual(self._run_main([d.Final("gone")], wait="0")[:2], (1, 1))
        self.assertEqual(self._run_main([d.Blocked("pending")], wait="0")[:2], (1, 1))


if __name__ == "__main__":
    unittest.main()
