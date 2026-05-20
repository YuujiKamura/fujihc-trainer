"""b33 brief 責務 2: scripts/hooks/pre-commit の単体 test。

tmp_path に git init + hook install + subprocess で git commit を呼ぶ fixture 駆動。
各 regex pattern を個別 fixture で hit / non-hit を pin する (= b33 軸 4 fix)。
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
HOOK_SRC = REPO_ROOT / "scripts" / "hooks" / "pre-commit"


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


@pytest.fixture
def hook_in_tmp_repo(tmp_path: Path) -> Path:
    """tmp_path に git init + pre-commit hook install。 git commit を発火させて
    block されることを test できる状態。
    core.hooksPath が global で設定されていても local override で tmp_path の hooks を使う。"""
    if not HOOK_SRC.exists():
        pytest.skip(f"hook source missing: {HOOK_SRC}")
    _git(tmp_path, "init", "-q", "-b", "main").check_returncode()
    hooks_dir = tmp_path / ".git" / "hooks"
    hooks_dir.mkdir(parents=True, exist_ok=True)
    # global core.hooksPath を local override (= tmp_path の hooks を使う)
    _git(tmp_path, "config", "--local", "core.hooksPath",
         str(hooks_dir).replace("\\", "/")).check_returncode()
    dst = hooks_dir / "pre-commit"
    shutil.copy2(HOOK_SRC, dst)
    dst.chmod(0o755)
    return tmp_path


def _stage_and_commit(repo: Path, filename: str, content: str) -> subprocess.CompletedProcess:
    p = repo / filename
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    _git(repo, "add", filename).check_returncode()
    return _git(repo, "commit", "-m", "test", "--no-gpg-sign")


# ---------- leaked content による block ----------

@pytest.mark.parametrize("leaked_content,expected_label", [
    ("// reference: https://www.strava.com/oauth/authorize?...\n", "Strava OAuth URL"),
    ("const token = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345abc';\n", "40-hex token"),
    ("// Authorization: Bearer abc123def456ghi789jkl0\n", "Bearer token"),
    ("OPENAI_KEY=sk-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789aBcDeFgH\n", "OpenAI key shape"),
    ("GH_TOKEN=ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789\n", "GitHub token"),
    ("client_secret: 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789'\n", "secret key=value"),
])
def test_pre_commit_blocks_each_leaked_pattern(hook_in_tmp_repo: Path, leaked_content: str, expected_label: str) -> None:
    result = _stage_and_commit(hook_in_tmp_repo, "leak.js", leaked_content)
    assert result.returncode != 0, f"hook が block しなかった ({expected_label}): stdout={result.stdout!r} stderr={result.stderr!r}"
    assert "pre-commit blocked" in result.stderr or "pre-commit blocked" in result.stdout


# ---------- secret file 名 variant の block ----------

@pytest.mark.parametrize("filename", [
    ".env",
    ".env.local",
    ".env.production",
    ".env.development.local",
    ".env.test",
    "master.key",
    "credentials.yml.enc",
    "config/credentials/development.yml.enc",
])
def test_pre_commit_blocks_secret_file_names(hook_in_tmp_repo: Path, filename: str) -> None:
    result = _stage_and_commit(hook_in_tmp_repo, filename, "DUMMY=ok\n")
    assert result.returncode != 0, f"{filename} を block しなかった"


# ---------- master.key 内容 (= 32 hex 1 行 file) の block ----------

def test_pre_commit_blocks_master_key_content(hook_in_tmp_repo: Path) -> None:
    # filename rename 回避を覆う、 32 hex 1 行 file を別 filename で stage
    # 32 hex 1 行 file の内容を hook の master.key shape detection で block
    result = _stage_and_commit(
        hook_in_tmp_repo, "looks_innocent.bin",
        "a1b2c3d4e5f60718293a4b5c6d7e8f90\n",
    )
    # 32 hex 内容 + 1 行 file → master.key shape として block されるか、
    # ただし 32 hex content の loop 検出は hook 内 for-loop が tmp_path で正しく動くかに依存
    # (= 環境依存)、 まずは「いずれかの shape (= hex 32+ の grep 経路) で block」 を確認
    assert result.returncode != 0


# ---------- 配布元再配布禁止 path の block ----------

def test_pre_commit_blocks_redistribution_tile_path(hook_in_tmp_repo: Path) -> None:
    result = _stage_and_commit(
        hook_in_tmp_repo, "web/static/tiles/gsi_dem/8/226/100.png",
        "PNG fake bytes",
    )
    assert result.returncode != 0


# ---------- positive: 通常編集は通る ----------

def test_pre_commit_allows_normal_changes(hook_in_tmp_repo: Path) -> None:
    result = _stage_and_commit(hook_in_tmp_repo, "src/normal.py", "def hello():\n    return 1\n")
    assert result.returncode == 0, f"normal commit が block された: stderr={result.stderr!r}"


def test_pre_commit_allows_markdown_with_docs(hook_in_tmp_repo: Path) -> None:
    result = _stage_and_commit(
        hook_in_tmp_repo, "docs/notes.md",
        "# Notes\n\nThis describes how OAuth works at a high level.\n",
    )
    assert result.returncode == 0


def test_pre_commit_allows_strava_source_files(hook_in_tmp_repo: Path) -> None:
    """source tree に Strava 関連 file を置くこと自体は OK (= 軸 7 fix で WARN/INFO 撤回、
    開発体験を壊さない、 _site/ に landing しないことは別 gate で覆う)。
    ファイル名だけでは block されないことを pin。"""
    result = _stage_and_commit(
        hook_in_tmp_repo, "web/lib/strava_oauth.js",
        "// strava oauth flow, no actual token here\n",
    )
    assert result.returncode == 0
