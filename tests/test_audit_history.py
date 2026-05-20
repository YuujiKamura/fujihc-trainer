"""b33 brief 責務 2 (= 軸 7 secondary-1 / secondary-3 fix): audit_multiline_secrets.py + audit_history.sh の test。

VALUE_PATTERNS 5 shape の hit / non-hit、 SKIP_LINE_RE の skip 動作を fixture で個別 pin。
特に「20+ char 汎用 alnum (= package 名 / URL path) は hit しない」 を pin して
軸 7 round 3 の NEW NG (= false positive 量産経路) の再演を防ぐ。
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import audit_multiline_secrets as ams  # noqa: E402


# ---------- VALUE_PATTERNS の hit / non-hit ----------

def test_value_pattern_matches_hex_32() -> None:
    assert ams.value_hits('"a1b2c3d4e5f60718293a4b5c6d7e8f90"')


def test_value_pattern_matches_base64_24() -> None:
    assert ams.value_hits('"aBcDeFgHiJkLmNoPqRsTuVwX=="')


def test_value_pattern_matches_strava_40hex() -> None:
    assert ams.value_hits("a1b2c3d4e5f60718293a4b5c6d7e8f9012345abcd")


def test_value_pattern_matches_openai_sk() -> None:
    assert ams.value_hits("sk-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789aBcDeFgH")


def test_value_pattern_matches_github_ghp() -> None:
    assert ams.value_hits("ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789")


def test_value_pattern_rejects_generic_alnum() -> None:
    """軸 7 round 3 NEW NG の物理 fix: 緩い [A-Za-z0-9._-]{20,} に hit していた汎用 alnum を
    今回の strict shape では reject する (= CI 恒常 fail 化防止)。"""
    # package 名 (= dash + 数字混在、 hex/base64/sk-/ghp_ 形ではない)
    assert not ams.value_hits("package-name-with-version-1.2.3")
    # URL path (= slash 含む、 token shape ではない)
    assert not ams.value_hits("/some/path/here/file-name-12345.html")
    # 普通の英文 (= スペース含む、 token shape ではない)
    assert not ams.value_hits("This is just a sentence with words")
    # short hex (= 31 chars、 32 未満)
    assert not ams.value_hits('"a1b2c3d4e5f60718293a4b5c6d7e8f9"')


# ---------- SKIP_LINE_RE: diff metadata の skip ----------

def test_skip_line_re_matches_file_headers() -> None:
    assert ams.SKIP_LINE_RE.match("+++ b/path/with/long_name_xxxxxxxx.js")
    assert ams.SKIP_LINE_RE.match("--- a/path/old.js")


def test_skip_line_re_matches_hunk_header() -> None:
    assert ams.SKIP_LINE_RE.match("@@ -1,5 +1,7 @@")


def test_skip_line_re_matches_diff_header() -> None:
    assert ams.SKIP_LINE_RE.match("diff --git a/foo b/foo")


def test_skip_line_re_matches_commit_metadata() -> None:
    assert ams.SKIP_LINE_RE.match("commit a1b2c3d4e5f60718293a4b5c6d7e8f9012345abcd")
    assert ams.SKIP_LINE_RE.match("Author: name <email>")
    assert ams.SKIP_LINE_RE.match("Date:   Mon Jan 1 00:00:00 2025 +0000")
    assert ams.SKIP_LINE_RE.match("Merge: aaa bbb")
    assert ams.SKIP_LINE_RE.match("index 1234abc..5678def 100644")


def test_skip_line_re_does_not_match_diff_addition() -> None:
    """+...という形の diff 追加行は skip しない (= scan 対象に残す)。"""
    assert ams.SKIP_LINE_RE.match("+normal addition") is None
    # ただし `+++` は file header なので skip 対象
    assert ams.SKIP_LINE_RE.match("+++ b/path") is not None


# ---------- is_diff_addition ----------

def test_is_diff_addition_excludes_file_header() -> None:
    assert not ams.is_diff_addition("+++ b/path")


def test_is_diff_addition_excludes_context_line() -> None:
    assert not ams.is_diff_addition(" context line")
    assert not ams.is_diff_addition("-removed line")


def test_is_diff_addition_accepts_real_addition() -> None:
    assert ams.is_diff_addition("+client_secret: 'xxx'")


# ---------- scan_diff_stream の 2-line window scan ----------

def test_scan_diff_stream_hits_yaml_multiline_secret() -> None:
    stream = [
        "diff --git a/config.yml b/config.yml",
        "+++ b/config.yml",
        "@@ -1,2 +1,3 @@",
        "+client_secret:",
        '+  "a1b2c3d4e5f60718293a4b5c6d7e8f90"',
    ]
    hits = ams.scan_diff_stream(iter(stream))
    assert len(hits) == 1
    assert "client_secret" in hits[0]


def test_scan_diff_stream_skips_file_header() -> None:
    """軸 7 round 3 NEW NG の物理 fix: KEY 行直後に file header `+++` があっても false fire しない。"""
    stream = [
        "+client_secret:",
        "+++ b/path/with/long_name_xxxxxxxxxxxxxxxxxxxx.js",  # file header、 hit しないこと
    ]
    hits = ams.scan_diff_stream(iter(stream))
    assert hits == []


def test_scan_diff_stream_skips_commit_metadata() -> None:
    stream = [
        "commit aaaaabbbbbccccc1234567890abcdef12345678",
        "Author: test",
        "Date:   Mon Jan 1 00:00:00 2025",
        "    log message client_secret",  # 普通の context、 + prefix なし
        "+normal content",
    ]
    hits = ams.scan_diff_stream(iter(stream))
    assert hits == []


def test_scan_diff_stream_no_hit_when_clean() -> None:
    stream = [
        "+def hello():",
        "+    return 1",
    ]
    hits = ams.scan_diff_stream(iter(stream))
    assert hits == []


def test_scan_diff_stream_window_resets_on_unrelated_line() -> None:
    """window=2 の境界: key 行と value 行の間に他 line が入ったら hit しない (= acceptable scope-limit)。"""
    stream = [
        "+client_secret:",
        "+# comment in between (= prev リセット)",
        '+  "a1b2c3d4e5f60718293a4b5c6d7e8f90"',
    ]
    hits = ams.scan_diff_stream(iter(stream))
    assert hits == []
