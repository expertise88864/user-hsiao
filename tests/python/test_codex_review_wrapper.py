"""Exercise the real review entry with a fixture CLI; never call a model."""

import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SESSION = "11111111-2222-3333-4444-555555555555"
HEX_SESSION = "abcdef12-3456-7890-abcd-ef1234567890"

# The fixture reports the profile it was asked for (or a forced wrong one)
# through the same machine-readable events and session log the real CLI
# writes, so the wrapper's actual-identity check runs for real.
EMITTER = r"""import datetime, json, os, pathlib, subprocess, sys
args = sys.argv[1:]
capture = pathlib.Path(os.environ["CODEX_REVIEW_TEST_CAPTURE"])
capture.write_bytes(b"".join(a.encode("utf-8") + b"\0" for a in args))
pathlib.Path(str(capture) + ".git").write_text(os.environ.get("GIT_CONFIG_PARAMETERS", ""), encoding="utf-8")
def value(flag):
    return args[args.index(flag) + 1] if flag in args else ""
config = dict(a.split("=", 1) for a in args if "=" in a and not a.startswith("-"))
pathlib.Path(value("-o")).write_text("Fixture CLI only; no model called.\nREQUEST_CHANGES\n", encoding="utf-8")
sid = os.environ.get("CODEX_FIXTURE_FORCE_SID") or (args[2] if args[:2] == ["exec", "resume"] else os.environ["CODEX_FIXTURE_SESSION"])
model = os.environ.get("CODEX_FIXTURE_ACTUAL_MODEL") or value("--model")
sandbox = value("--sandbox") or config.get("sandbox_mode", "")
top = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True).stdout.strip()
context = {"cwd": top, "model": model, "effort": config.get("model_reasoning_effort", ""),
           "sandbox_policy": {"type": sandbox}, "turn_id": "fixture"}
rows = [{"type": "session_meta", "payload": {"id": sid, "cwd": top}},
        {"type": "turn_context", "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(), "payload": context}]
sessions = pathlib.Path(os.environ["CODEX_HOME"]) / "sessions"
sessions.mkdir(parents=True, exist_ok=True)
(sessions / ("rollout-" + sid + ".jsonl")).write_text("\n".join(map(json.dumps, rows)), encoding="utf-8")
if os.environ.get("CODEX_FIXTURE_NO_SESSION") != "1":
    print(json.dumps({"type": "thread.started", "thread_id": sid}))
print(json.dumps({"type": "turn.completed", "usage": {"input_tokens": 3, "output_tokens": 2}}))
"""


class ReviewEntryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="review-entry-fixture-")
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        scripts = self.repo / "scripts"
        scripts.mkdir()
        self.wrapper = scripts / "codex_review.sh"
        shutil.copyfile(ROOT / "scripts/codex_review.sh", self.wrapper)
        shutil.copyfile(ROOT / "scripts/codex_review_identity.py", scripts / "codex_review_identity.py")
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True,
                       capture_output=True)
        subprocess.run(["git", "-C", str(self.repo), "-c", "user.name=Fixture",
                        "-c", "user.email=fixture@example.invalid", "commit",
                        "--allow-empty", "-qm", "fixture-base"], check=True,
                       capture_output=True)
        self.bin = self.repo / "fixture-bin"
        self.bin.mkdir()
        self.capture = self.repo / "fixture-argv"
        codex = self.bin / "codex"
        emitter = self.repo / "fixture-emit.py"
        emitter.write_text(EMITTER, encoding="utf-8")
        python = sys.executable.replace("\\", "/")
        codex.write_text(
            "#!/usr/bin/env bash\n"
            "if [ \"${CODEX_FIXTURE_READ_STDIN:-}\" = 1 ]; then cat > /dev/null; fi\n"
            f'exec "{python}" "{emitter.as_posix()}" "$@"\n',
            encoding="utf-8")
        codex.chmod(0o755)
        uname = self.bin / "uname"
        uname.write_text("#!/usr/bin/env bash\nprintf '%s\\n' \"$CODEX_REVIEW_TEST_PLATFORM\"\n",
                         encoding="utf-8")
        uname.chmod(0o755)
        git_bash = Path("C:/Program Files/Git/bin/bash.exe")
        self.bash = str(git_bash) if os.name == "nt" and git_bash.exists() else shutil.which("bash")
        if not self.bash:
            self.skipTest("Bash is required by the review entry")

    def run_entry(self, *args, platform="MINGW64_NT-fixture", sandbox=None, extra_env=None,
                  open_stdin=False):
        env = os.environ.copy()
        env.pop("CODEX_FIXTURE_READ_STDIN", None)
        env.pop("CODEX_FIXTURE_NO_SESSION", None)
        env.pop("CODEX_FIXTURE_ACTUAL_MODEL", None)
        env.pop("CODEX_FIXTURE_FORCE_SID", None)
        env.pop("GIT_CONFIG_PARAMETERS", None)
        env["CODEX_FIXTURE_SESSION"] = SESSION
        # The fixture CLI, never the highest-version CLI installed on this machine.
        env["CODEX_REVIEW_CLI"] = "codex"
        env["CODEX_HOME"] = str(self.repo / "fixture-codex-home")
        env.update(extra_env or {})
        env["CODEX_REVIEW_TEST_CAPTURE"] = self.capture.as_posix()
        env["CODEX_REVIEW_TEST_PLATFORM"] = platform
        env.pop("CODEX_REVIEW_WINDOWS_SANDBOX", None)
        if sandbox is not None:
            env["CODEX_REVIEW_WINDOWS_SANDBOX"] = sandbox
        # Git Bash builds its startup PATH on Windows. Install the fixture PATH
        # inside that shell so the platform stub also wins over /usr/bin/uname.
        posix_bin = self.bin.as_posix()
        if os.name == "nt":
            posix_bin = "/" + posix_bin[0].lower() + posix_bin[2:]
        command = [self.bash, "-c", 'export PATH="$1:$PATH"; shift; exec bash "$@"',
                   "fixture-harness", posix_bin, str(self.wrapper), *map(str, args)]
        if open_stdin:
            # A harness whose stdin is a pipe that never reaches EOF, like a
            # backgrounded agent shell. The entry must not wait on it.
            # Output goes to files, not pipes, so waiting cannot deadlock on a
            # full pipe buffer; stdin stays an open pipe until the entry exits.
            out_path, err_path = self.repo / "fixture-stdout", self.repo / "fixture-stderr"
            with open(out_path, "wb") as out_file, open(err_path, "wb") as err_file:
                proc = subprocess.Popen(command, cwd=self.repo, env=env, stdin=subprocess.PIPE,
                                        stdout=out_file, stderr=err_file)
                try:
                    proc.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
                    raise
                finally:
                    proc.stdin.close()
            result = subprocess.CompletedProcess(
                command, proc.returncode, out_path.read_text(encoding="utf-8"),
                err_path.read_text(encoding="utf-8"))
        else:
            result = subprocess.run(command, cwd=self.repo, env=env, capture_output=True,
                                    text=True, encoding="utf-8", timeout=30)
        captured = self.capture.read_bytes().decode("utf-8").split("\0")[:-1] if self.capture.exists() else []
        return result, captured

    def seed_session(self):
        state = self.repo / ".codex-review"
        state.mkdir()
        (state / "last_session_id").write_text(SESSION, encoding="utf-8")
        (state / "last_pass").write_text("1\n", encoding="utf-8")
        (state / "usage.tsv").write_text(
            "timestamp\trepository\tmode\tmodel\teffort\tbase_ref\tsession_id\ttokens_used\tresult\tfindings\tpass\n"
            f"fixture\tfixture\tdeep\tgpt-5.6-sol\thigh\tHEAD\t{SESSION}\t0\tREQUEST_CHANGES\tunavailable\t1\n",
            encoding="utf-8")
        return state

    def test_windows_entry_keeps_readonly_and_isolation_with_explicit_backend(self):
        result, args = self.run_entry("deep", "HEAD")
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(args[args.index("--model") + 1], "gpt-6.1-sol")
        self.assertIn("--json", args)
        self.assertEqual(args[args.index("--sandbox") + 1], "read-only")
        self.assertIn("model_reasoning_effort=xhigh", args)
        self.assertIn("approval_policy=never", args)
        self.assertIn("windows.sandbox=unelevated", args)
        self.assertIn("--ignore-user-config", args)
        self.assertIn("--strict-config", args)
        self.assertNotIn("--dangerously-bypass-approvals-and-sandbox", args)

    def test_resume_preserves_session_high_readonly_and_adds_scope_summary(self):
        state = self.seed_session()
        context = self.repo / "scope.txt"
        context.write_text("Prior attempt read no source. Review the complete current frozen scope.\n",
                           encoding="utf-8")
        result, args = self.run_entry("resume", SESSION, context)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(args[:3], ["exec", "resume", SESSION])
        self.assertIn("model_reasoning_effort=xhigh", args)
        self.assertIn("approval_policy=never", args)
        self.assertIn("sandbox_mode=read-only", args)
        self.assertIn("windows.sandbox=unelevated", args)
        self.assertIn("Review the complete current frozen scope.", args[-1])
        self.assertEqual((state / "last_session_id").read_text(encoding="utf-8"), SESSION)

    def test_resume_rejects_diff_context_before_cli_and_pass_increment(self):
        state = self.seed_session()
        context = self.repo / "diff.txt"
        context.write_text("diff --git a/file b/file\n@@ -1 +1 @@\n", encoding="utf-8")
        result, args = self.run_entry("resume", SESSION, context)
        self.assertEqual(result.returncode, 64)
        self.assertEqual(args, [])
        self.assertEqual((state / "last_pass").read_text(encoding="utf-8"), "1\n")

    def test_invalid_windows_backend_never_calls_cli(self):
        result, args = self.run_entry("deep", "HEAD", sandbox="danger-full-access")
        self.assertEqual(result.returncode, 64)
        self.assertEqual(args, [])

    def test_linux_entry_does_not_select_windows_backend(self):
        result, args = self.run_entry("deep", "HEAD", platform="Linux")
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertFalse(any(arg.startswith("windows.sandbox=") for arg in args))
        self.assertEqual(args[args.index("--sandbox") + 1], "read-only")

    def test_resume_accepts_uppercase_spelling_of_the_recorded_session(self):
        # UUIDs are case-insensitive; refusing the same session typed in
        # uppercase would push the operator toward opening a new session.
        # SESSION is all digits, so upper() would not change it; use hex letters.
        state = self.seed_session()
        (state / "last_session_id").write_text(HEX_SESSION, encoding="utf-8")
        result, args = self.run_entry("resume", HEX_SESSION.upper())
        self.assertNotEqual(HEX_SESSION.upper(), HEX_SESSION)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(args[:3], ["exec", "resume", HEX_SESSION])
        self.assertEqual((state / "last_pass").read_text(encoding="utf-8").strip(), "2")

    def test_resume_normalises_an_uppercase_record_before_calling_cli(self):
        state = self.seed_session()
        (state / "last_session_id").write_text(HEX_SESSION.upper(), encoding="utf-8")
        result, args = self.run_entry("resume", HEX_SESSION)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(args[:3], ["exec", "resume", HEX_SESSION])

    def test_resume_rejects_a_different_valid_session_before_cli(self):
        state = self.seed_session()
        other = "99999999-8888-7777-6666-555555555555"
        result, args = self.run_entry("resume", other)
        self.assertEqual(result.returncode, 64)
        self.assertIn(other, result.stderr)
        self.assertEqual(args, [])
        self.assertEqual((state / "last_pass").read_text(encoding="utf-8"), "1\n")

    def test_resume_rejects_an_explicit_session_when_nothing_is_recorded(self):
        # Pass 1 state exists but its session record is gone: an explicit id
        # has nothing to be compared against, so it must not be trusted.
        state = self.seed_session()
        (state / "last_session_id").unlink()
        result, args = self.run_entry("resume", SESSION)
        self.assertEqual(result.returncode, 64)
        self.assertIn("沒有第一輪 session 紀錄", result.stderr)
        self.assertNotIn("No such file", result.stderr)
        self.assertEqual(args, [])
        self.assertEqual((state / "last_pass").read_text(encoding="utf-8"), "1\n")

    def test_resume_rejects_a_malformed_record_before_cli(self):
        state = self.seed_session()
        (state / "last_session_id").write_text("not-a-uuid-but-36-chars-aaaaaaaaaaaa", encoding="utf-8")
        result, args = self.run_entry("resume")
        self.assertEqual(result.returncode, 64)
        self.assertEqual(args, [])

    def test_new_first_pass_without_session_id_does_not_leave_the_old_record(self):
        # A new task's pass 1 whose output carries no session id must not leave
        # the previous task's record behind for a bare resume to pick up, and
        # an unverifiable pass does not count.
        state = self.seed_session()
        result, args = self.run_entry("deep", "HEAD", extra_env={"CODEX_FIXTURE_NO_SESSION": "1"})
        self.assertEqual(result.returncode, 4, result.stderr)
        self.assertNotEqual(args, [])
        self.assertFalse((state / "last_session_id").exists())
        self.assertEqual((state / "last_pass").read_text(encoding="utf-8").strip(), "0")
        self.capture.unlink()
        result, args = self.run_entry("resume")
        self.assertEqual(result.returncode, 64)
        self.assertEqual(args, [])
        # The diagnostic must point at the path the guards accept (a new first
        # pass), not at an explicit session id, which the no-record guard refuses.
        self.assertIn("請重跑第一輪", result.stderr)
        self.assertNotIn("請以明確 session id 執行", result.stderr)

    def test_first_pass_records_the_new_session(self):
        state = self.seed_session()
        (state / "last_session_id").write_text(HEX_SESSION, encoding="utf-8")
        result, _ = self.run_entry("deep", "HEAD")
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual((state / "last_session_id").read_text(encoding="utf-8"), SESSION)

    def test_first_pass_does_not_wait_on_an_open_stdin(self):
        result, args = self.run_entry("deep", "HEAD", open_stdin=True,
                                      extra_env={"CODEX_FIXTURE_READ_STDIN": "1"})
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertNotEqual(args, [])

    def test_resume_does_not_wait_on_an_open_stdin(self):
        self.seed_session()
        result, args = self.run_entry("resume", SESSION, open_stdin=True,
                                      extra_env={"CODEX_FIXTURE_READ_STDIN": "1"})
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(args[:3], ["exec", "resume", SESSION])

    def test_every_mode_requests_gpt61_sol_xhigh(self):
        for mode in ("diff", "targeted", "deep"):
            with self.subTest(mode=mode):
                result, args = self.run_entry(mode, "HEAD")
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertEqual(args[args.index("--model") + 1], "gpt-6.1-sol")
                self.assertIn("model_reasoning_effort=xhigh", args)

    def test_resume_requests_xhigh_even_after_a_medium_record(self):
        state = self.seed_session()
        usage = (state / "usage.tsv").read_text(encoding="utf-8").replace("\thigh\t", "\tmedium\t")
        (state / "usage.tsv").write_text(usage, encoding="utf-8")
        result, args = self.run_entry("resume", SESSION)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("model_reasoning_effort=xhigh", args)

    def test_wrong_actual_model_never_counts(self):
        state = self.seed_session()
        result, _ = self.run_entry("deep", "HEAD", extra_env={"CODEX_FIXTURE_ACTUAL_MODEL": "gpt-5.6-sol"})
        self.assertEqual(result.returncode, 4, result.stderr)
        self.assertFalse((state / "last_session_id").exists())
        self.assertEqual((state / "last_pass").read_text(encoding="utf-8").strip(), "0")

    def test_resume_with_wrong_actual_model_never_counts(self):
        state = self.seed_session()
        result, _ = self.run_entry("resume", SESSION, extra_env={"CODEX_FIXTURE_ACTUAL_MODEL": "gpt-5.5"})
        self.assertEqual(result.returncode, 4, result.stderr)
        self.assertEqual((state / "last_pass").read_text(encoding="utf-8"), "1\n")
        self.assertEqual((state / "last_session_id").read_text(encoding="utf-8"), SESSION)

    def test_resume_answered_by_another_session_never_counts(self):
        state = self.seed_session()
        result, args = self.run_entry("resume", SESSION, extra_env={"CODEX_FIXTURE_FORCE_SID": HEX_SESSION})
        self.assertEqual(result.returncode, 4, result.stderr)
        self.assertEqual(args[:3], ["exec", "resume", SESSION])
        self.assertEqual((state / "last_pass").read_text(encoding="utf-8"), "1\n")
        self.assertEqual((state / "last_session_id").read_text(encoding="utf-8"), SESSION)

    def test_only_this_repository_is_marked_safe_for_the_review_child(self):
        result, _ = self.run_entry("deep", "HEAD")
        self.assertEqual(result.returncode, 2, result.stderr)
        top = subprocess.run(["git", "-C", str(self.repo), "rev-parse", "--show-toplevel"],
                             capture_output=True, text=True, check=True).stdout.strip()
        self.assertEqual(Path(str(self.capture) + ".git").read_text(encoding="utf-8"),
                         f"'safe.directory'='{top}'")

    def _pr_range(self):
        def git(*args):
            return subprocess.run(["git", "-C", str(self.repo), *args], check=True,
                                  capture_output=True, text=True).stdout.strip()
        base = git("rev-parse", "HEAD")
        git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
            "commit", "--allow-empty", "-qm", "fixture-pr-head")
        return base, git("rev-parse", "HEAD")

    def test_pr_range_is_named_in_first_round_and_resume(self):
        base, tip = self._pr_range()
        env = {"CODEX_REVIEW_BASE": base, "CODEX_REVIEW_TIP": tip}
        result, args = self.run_entry("targeted", base, extra_env=env)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn(f"Committed range {base}..{tip} (one whole pull request: "
                      "merge-base of main .. exact PR head).", args[-1])
        result, args = self.run_entry("resume", extra_env=env)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(args[:3], ["exec", "resume", SESSION])
        self.assertIn(f"The pull request range is now {base}..{tip};", args[-1])

    def test_pr_range_must_be_the_exact_checkout_before_cli(self):
        base, tip = self._pr_range()
        cases = ({"CODEX_REVIEW_BASE": base, "CODEX_REVIEW_TIP": base},       # tip is not HEAD
                 {"CODEX_REVIEW_BASE": base},                                  # tip missing
                 {"CODEX_REVIEW_BASE": base[:12], "CODEX_REVIEW_TIP": tip},    # abbreviated
                 {"CODEX_REVIEW_BASE": tip, "CODEX_REVIEW_TIP": tip, "_arg": base})  # arg != env base
        for env in cases:
            with self.subTest(env=env):
                arg = env.pop("_arg", base)
                result, args = self.run_entry("targeted", arg, extra_env=env)
                self.assertEqual(result.returncode, 64, result.stderr)
                self.assertEqual(args, [])

    def test_missing_resume_context_never_calls_cli(self):
        state = self.seed_session()
        result, args = self.run_entry("resume", SESSION, self.repo / "missing.txt")
        self.assertEqual(result.returncode, 64)
        self.assertEqual(args, [])
        self.assertEqual((state / "last_pass").read_text(encoding="utf-8"), "1\n")


def _git_bash():
    git_bash = Path("C:/Program Files/Git/bin/bash.exe")
    return str(git_bash) if os.name == "nt" and git_bash.exists() else shutil.which("bash")


class ResolveCliUnicodePathTests(unittest.TestCase):
    """Automatic CLI selection must return a non-ASCII path intact.

    The wrapper tests pin CODEX_REVIEW_CLI and never run this branch. Here the
    real resolve_cli runs against a stand-in `which` helper that prints a
    Chinese path with Python's default (locale) encoding.
    """
    CLI = "C:/Users/\u9673\u7fca\u5609/AppData/Local/OpenAI/Codex/bin/x/codex.exe"

    def test_resolve_cli_keeps_unicode_path(self):
        source = (ROOT / "scripts/codex_review.sh").read_text(encoding="utf-8")
        start = source.index("resolve_cli() {")
        end = source.index("\nVERIFIED_SID=", start)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "codex_review_identity.py").write_text(
                "import sys\nassert sys.argv[1:] == ['which'], sys.argv\n"
                f"print({self.CLI!r})\nprint('codex-cli 0.0.0')\n", encoding="utf-8")
            out = root / "cli.txt"
            script = root / "probe.sh"
            python = sys.executable.replace("\\", "/")
            script.write_text(
                'die() { echo "$*" >&2; exit 64; }\n'
                f'PYTHON="{python}"\nSCRIPT_DIR="{root.as_posix()}"\nREPO_ROOT=/fixture\n'
                + source[start:end]
                + f'\nresolve_cli >/dev/null\nprintf "%s" "$CODEX_CLI" > "{out.as_posix()}"\n',
                encoding="utf-8", newline="\n")
            env = {k: v for k, v in os.environ.items()
                   if k not in ("PYTHONUTF8", "PYTHONIOENCODING", "CODEX_REVIEW_CLI", "BASH_ENV")}
            result = subprocess.run([_git_bash(), "--noprofile", "--norc", str(script)], env=env,
                                    capture_output=True, text=True, encoding="utf-8", errors="replace")
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(out.read_bytes().decode("utf-8", "replace"), self.CLI)


if __name__ == "__main__":
    unittest.main()
