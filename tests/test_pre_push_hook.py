"""b33 brief 責務 2: scripts/hooks/pre-push の単体 test (= --all-history mode と --push-range mode 両方)。

install_b33_hooks.sh の冪等性 + backup 機構も pin する。
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
PRE_PUSH_SRC = REPO_ROOT / "scripts" / "hooks" / "pre-push"
PRE_COMMIT_SRC = REPO_ROOT / "scripts" / "hooks" / "pre-push"  # placeholder, overwritten below
PRE_COMMIT_SRC = REPO_ROOT / "scripts" / "hooks" / "pre-commit"
INSTALL_SCRIPT = REPO_ROOT / "scripts" / "install_b33_hooks.sh"


def _find_bash() -> str:
    """Git for Windows bash を優先 (= Windows path を理解する)。 WSL bash は path 形式が違うので避ける。"""
    candidates = [
        r"C:\Program Files\Git\usr\bin\bash.exe",
        r"C:\Program Files (x86)\Git\usr\bin\bash.exe",
        "/usr/bin/bash",
        "/bin/bash",
    ]
    for c in candidates:
        if Path(c).exists():
            return c
    found = shutil.which("bash")
    return found if found else "bash"


BASH = _find_bash()


def _posix(p: Path) -> str:
    """Windows path を bash が認識できる posix-like 形式に変換 ('\\' を '/' に)。"""
    return str(p).replace("\\", "/")


def _git(repo: Path, *args: str) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env.setdefault("GIT_AUTHOR_NAME", "test")
    env.setdefault("GIT_AUTHOR_EMAIL", "test@example.com")
    env.setdefault("GIT_COMMITTER_NAME", "test")
    env.setdefault("GIT_COMMITTER_EMAIL", "test@example.com")
    return subprocess.run(
        ["git", *args],
        cwd=str(repo), env=env, capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )


def _bash(script: Path, *args: str, cwd: Path | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        [BASH, _posix(script), *args],
        cwd=str(cwd) if cwd else None,
        capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )


@pytest.fixture
def repo_with_pre_push(tmp_path: Path) -> Path:
    """tmp_path に git init + pre-push hook install (= core.hooksPath を local override)。"""
    if not PRE_PUSH_SRC.exists():
        pytest.skip(f"hook source missing: {PRE_PUSH_SRC}")
    _git(tmp_path, "init", "-q", "-b", "main").check_returncode()
    hooks_dir = tmp_path / ".git" / "hooks"
    hooks_dir.mkdir(parents=True, exist_ok=True)
    _git(tmp_path, "config", "--local", "core.hooksPath", _posix(hooks_dir)).check_returncode()
    dst = hooks_dir / "pre-push"
    shutil.copy2(PRE_PUSH_SRC, dst)
    dst.chmod(0o755)
    return tmp_path


def _run_pre_push(repo: Path) -> subprocess.CompletedProcess:
    """hook を直接 bash で実行 (= git push を実際には発火しない、 hook script の挙動を unit 観点で確認)。"""
    return subprocess.run(
        [BASH, _posix(repo / ".git" / "hooks" / "pre-push")],
        cwd=str(repo),
        env=os.environ.copy(),
        capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )


# ---------- mode=all-history (= origin/HEAD 未確立) で block ----------

def test_pre_push_blocks_in_all_history_mode(repo_with_pre_push: Path) -> None:
    # commit に Strava OAuth literal を仕込む
    (repo_with_pre_push / "leak.js").write_text("// https://www.strava.com/oauth/authorize\n", encoding="utf-8")
    _git(repo_with_pre_push, "add", "leak.js").check_returncode()
    _git(repo_with_pre_push, "commit", "-m", "leak", "--no-gpg-sign").check_returncode()
    result = _run_pre_push(repo_with_pre_push)
    assert result.returncode != 0, f"all-history mode で block しなかった: stderr={result.stderr!r}"
    assert "all-history" in result.stderr or "all-history" in result.stdout


def test_pre_push_passes_in_all_history_mode_when_clean(repo_with_pre_push: Path) -> None:
    (repo_with_pre_push / "clean.py").write_text("print('ok')\n", encoding="utf-8")
    _git(repo_with_pre_push, "add", "clean.py").check_returncode()
    _git(repo_with_pre_push, "commit", "-m", "clean", "--no-gpg-sign").check_returncode()
    result = _run_pre_push(repo_with_pre_push)
    assert result.returncode == 0, f"clean commit が誤 block: stderr={result.stderr!r}"


# ---------- mode=push-range (= origin/HEAD 確立済) で block ----------

@pytest.fixture
def repo_with_origin(tmp_path: Path) -> Path:
    """upstream "origin/main" を作って push-range mode を発火させる setup。
    core.hooksPath は local override で tmp_path の hooks を使う。"""
    if not PRE_PUSH_SRC.exists():
        pytest.skip(f"hook source missing: {PRE_PUSH_SRC}")
    # bare upstream
    upstream = tmp_path / "upstream.git"
    _git(tmp_path, "init", "--bare", str(upstream)).check_returncode()
    # working repo
    work = tmp_path / "work"
    work.mkdir()
    _git(work, "init", "-q", "-b", "main").check_returncode()
    _git(work, "remote", "add", "origin", _posix(upstream)).check_returncode()
    # core.hooksPath を local override
    hooks_dir = work / ".git" / "hooks"
    hooks_dir.mkdir(parents=True, exist_ok=True)
    _git(work, "config", "--local", "core.hooksPath", _posix(hooks_dir)).check_returncode()
    # 最初の clean commit を push
    (work / "init.txt").write_text("init\n", encoding="utf-8")
    _git(work, "add", "init.txt").check_returncode()
    _git(work, "commit", "-m", "init", "--no-gpg-sign").check_returncode()
    _git(work, "push", "-u", "origin", "main").check_returncode()
    # hook を install (= init 後にすると最初の push が block されない)
    dst = hooks_dir / "pre-push"
    shutil.copy2(PRE_PUSH_SRC, dst)
    dst.chmod(0o755)
    return work


def test_pre_push_blocks_in_push_range_mode(repo_with_origin: Path) -> None:
    (repo_with_origin / "leak.js").write_text("Bearer aBcDeFgHiJkLmNoPqRsTuVwXyZ0123\n", encoding="utf-8")
    _git(repo_with_origin, "add", "leak.js").check_returncode()
    _git(repo_with_origin, "commit", "-m", "leak", "--no-gpg-sign").check_returncode()
    result = _run_pre_push(repo_with_origin)
    assert result.returncode != 0, f"push-range mode で block しなかった: stderr={result.stderr!r}"
    assert "push-range" in result.stderr or "push-range" in result.stdout


def test_pre_push_passes_in_push_range_mode_when_clean(repo_with_origin: Path) -> None:
    (repo_with_origin / "ok.py").write_text("ok = True\n", encoding="utf-8")
    _git(repo_with_origin, "add", "ok.py").check_returncode()
    _git(repo_with_origin, "commit", "-m", "ok", "--no-gpg-sign").check_returncode()
    result = _run_pre_push(repo_with_origin)
    assert result.returncode == 0


# ---------- install_b33_hooks.sh の冪等性 + backup ----------

@pytest.fixture
def empty_repo_for_install(tmp_path: Path) -> Path:
    if not INSTALL_SCRIPT.exists():
        pytest.skip(f"install script missing: {INSTALL_SCRIPT}")
    _git(tmp_path, "init", "-q", "-b", "main").check_returncode()
    # core.hooksPath を local override (= install 後に hook が tmp_path に置かれることを保証)
    hooks_dir = tmp_path / ".git" / "hooks"
    hooks_dir.mkdir(parents=True, exist_ok=True)
    _git(tmp_path, "config", "--local", "core.hooksPath", _posix(hooks_dir)).check_returncode()
    # install script は repo の scripts/hooks/ を期待するので、 fixture の repo 側にも置く
    src_dir = tmp_path / "scripts" / "hooks"
    src_dir.mkdir(parents=True)
    shutil.copy2(PRE_COMMIT_SRC, src_dir / "pre-commit")
    shutil.copy2(PRE_PUSH_SRC, src_dir / "pre-push")
    return tmp_path


def test_install_creates_both_hooks(empty_repo_for_install: Path) -> None:
    result = _bash(INSTALL_SCRIPT, cwd=empty_repo_for_install)
    assert result.returncode == 0, f"install failed: {result.stderr}"
    assert (empty_repo_for_install / ".git" / "hooks" / "pre-commit").exists()
    assert (empty_repo_for_install / ".git" / "hooks" / "pre-push").exists()


def test_pre_push_install_is_idempotent(empty_repo_for_install: Path) -> None:
    """2 度 install しても backup file が増えない (= 自分由来 marker で skip)。"""
    _bash(INSTALL_SCRIPT, cwd=empty_repo_for_install).check_returncode()
    backups_after_first = list((empty_repo_for_install / ".git" / "hooks").glob("*.bak.*"))
    _bash(INSTALL_SCRIPT, cwd=empty_repo_for_install).check_returncode()
    backups_after_second = list((empty_repo_for_install / ".git" / "hooks").glob("*.bak.*"))
    assert len(backups_after_first) == len(backups_after_second), \
        f"2 度目 install で backup が増えた: {backups_after_first} → {backups_after_second}"


def test_pre_push_install_backs_up_existing_hook(empty_repo_for_install: Path) -> None:
    """既存 hook (= 別 source) → .bak.<timestamp> に避難してから上書き。"""
    hooks_dir = empty_repo_for_install / ".git" / "hooks"
    hooks_dir.mkdir(parents=True, exist_ok=True)
    existing = hooks_dir / "pre-push"
    existing.write_text("#!/bin/sh\necho 'I am a different hook'\nexit 0\n", encoding="utf-8")
    existing.chmod(0o755)
    _bash(INSTALL_SCRIPT, cwd=empty_repo_for_install).check_returncode()
    backups = list(hooks_dir.glob("pre-push.bak.*"))
    assert len(backups) == 1, f"backup が作られなかった: {list(hooks_dir.iterdir())}"
    assert "different hook" in backups[0].read_text(encoding="utf-8")
