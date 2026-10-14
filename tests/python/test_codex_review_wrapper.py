"""Exercise the real review entry with a fixture CLI; never call a model."""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SESSION = "11111111-2222-3333-4444-555555555555"
HEX_SESSION = "abcdef12-3456-7890-abcd-ef1234567890"


class ReviewEntryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="review-entry-fixture-")
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        scripts = self.repo / "scripts"
        scripts.mkdir()
        self.wrapper = scripts / "codex_review.sh"
        shutil.copyfile(ROOT / "scripts/codex_review.sh", self.wrapper)
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
        codex.write_text(
            "#!/usr/bin/env bash\n"
            "if [ \"${CODEX_FIXTURE_READ_STDIN:-}\" = 1 ]; then cat > /dev/null; fi\n"
            "printf '%s\\0' \"$@\" > \"$CODEX_REVIEW_TEST_CAPTURE\"\n"
            "last=''; next=0\n"
            "for arg in \"$@\"; do\n"
            "  if [ \"$next\" = 1 ]; then last=\"$arg\"; next=0; fi\n"
            "  if [ \"$arg\" = -o ]; then next=1; fi\n"
            "done\n"
            "printf 'Fixture CLI only; no model called.\\nREQUEST_CHANGES\\n' > \"$last\"\n"
            "if [ \"${CODEX_FIXTURE_NO_SESSION:-}\" != 1 ]; then\n"
            f"  printf 'session id: {SESSION}\\n'\n"
            "fi\n"
            "printf 'tokens used\\n0\\n'\n",
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
        self.assertEqual(args[args.index("--model") + 1], "gpt-5.6-sol")
        self.assertEqual(args[args.index("--sandbox") + 1], "read-only")
        self.assertIn("model_reasoning_effort=high", args)
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
        self.assertIn("model_reasoning_effort=high", args)
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
        # the previous task's record behind for a bare resume to pick up.
        state = self.seed_session()
        result, args = self.run_entry("deep", "HEAD", extra_env={"CODEX_FIXTURE_NO_SESSION": "1"})
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertNotEqual(args, [])
        self.assertFalse((state / "last_session_id").exists())
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

    def test_missing_resume_context_never_calls_cli(self):
        state = self.seed_session()
        result, args = self.run_entry("resume", SESSION, self.repo / "missing.txt")
        self.assertEqual(result.returncode, 64)
        self.assertEqual(args, [])
        self.assertEqual((state / "last_pass").read_text(encoding="utf-8"), "1\n")


if __name__ == "__main__":
    unittest.main()
