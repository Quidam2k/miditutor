import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import backup_review  # noqa: E402


def git(cwd, *args):
    return subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True, check=True).stdout


def make_repo(tmp_path):
    remote = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", "-q", str(remote)], check=True)
    repo = tmp_path / "reports"
    subprocess.run(["git", "clone", "-q", str(remote), str(repo)], check=True, capture_output=True)
    git(repo, "config", "user.email", "t@example.com")
    git(repo, "config", "user.name", "T")
    (repo / "README").write_text("x")
    git(repo, "add", "README")
    git(repo, "commit", "-qm", "init")
    git(repo, "push", "-q", "origin", "HEAD")
    return remote, repo


def make_library(tmp_path):
    lib = tmp_path / "lib"
    (lib / "review" / "o.proposals").mkdir(parents=True)
    (lib / "review" / "o.events.jsonl").write_text('{"id":"a"}\n')
    (lib / "review" / "o.log").write_text("accept\n")
    (lib / "review" / "o.layout.json").write_text("{}")  # rebuilt from the scan: not backed up
    (lib / "review" / "o.proposals" / "p.json").write_text("{}")
    (lib / "review" / "o.proposals" / "p.png").write_bytes(b"png")  # crop: not backed up
    (lib / "o.musicxml").write_text("<score/>")
    (lib / "untouched.musicxml").write_text("<score/>")  # no review log: not backed up
    (lib / "trust.json").write_text("{}")
    return lib


def run(lib, dest, capsys):
    assert backup_review.main(["--library", str(lib), "--dest", str(dest)]) == 0
    return json.loads(capsys.readouterr().out.strip().splitlines()[-1])


def test_copies_his_work_commits_only_dest_and_pushes(tmp_path, capsys):
    remote, repo = make_repo(tmp_path)
    lib = make_library(tmp_path)
    (repo / "someone-elses.md").write_text("staged by another session")
    git(repo, "add", "someone-elses.md")
    dest = repo / "miditutor" / "review-backup"

    out = run(lib, dest, capsys)
    assert out == {"ok": True, "changed": 5, "committed": True, "pushed": True}
    files = sorted(git(remote, "ls-tree", "-r", "--name-only", "HEAD").split())
    assert files == ["README", "miditutor/review-backup/o.musicxml", "miditutor/review-backup/review/o.events.jsonl",
                     "miditutor/review-backup/review/o.log", "miditutor/review-backup/review/o.proposals/p.json",
                     "miditutor/review-backup/trust.json"]
    # The other session's staged file stays staged, not swept into the backup commit.
    assert "someone-elses.md" in git(repo, "diff", "--cached", "--name-only")


def test_unchanged_is_a_no_op_and_changes_are_picked_up(tmp_path, capsys):
    _, repo = make_repo(tmp_path)
    lib = make_library(tmp_path)
    dest = repo / "backup"
    run(lib, dest, capsys)
    assert run(lib, dest, capsys) == {"ok": True, "changed": 0, "committed": False, "pushed": None}
    (lib / "review" / "o.events.jsonl").write_text('{"id":"a"}\n{"id":"b"}\n')
    assert run(lib, dest, capsys)["changed"] == 1


def test_not_a_repo(tmp_path, capsys):
    lib = make_library(tmp_path)
    assert backup_review.main(["--library", str(lib), "--dest", str(tmp_path / "nowhere" / "x")]) == 1
