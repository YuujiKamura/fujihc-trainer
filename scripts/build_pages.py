"""brief 33: Pages 配信物 (= _site/) を web/ から生成し、 Strava 関連を物理除外する。

責務 1 (= b33 brief §6): 関数分離して各々 pytest で個別 pin。
順序: clean → copy_tree → strip_strava_files → rewrite_dom → rewrite_csp →
      bump_sw_cache → verify_no_dem

build 後の _site/ は viewer_url_audit.test.js (= 責務 3) で URL pin される。
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SRC = REPO_ROOT / "web"
DEFAULT_DST = REPO_ROOT / "_site"

STRAVA_FILES = (
    # viewer-maplibre.js が L48 で `import { ensureAccessToken, revokeLocalToken,
    # STRAVA_TOKEN_LS_KEY } from './lib/strava_oauth.js'` してるため、 source 自体を
    # _site/ から削除すると module evaluation が失敗して viewer boot がゼロになる
    # (= 2026-05-20 公開後発覚)。 strava_oauth.js / strava_upload.js は source 残置で、
    # Strava endpoint への通信は CSP rewrite で connect-src と img-src から外す物理 gate
    # (= rewrite_csp 関数で実装済) に任せる、 これで「endpoint 到達ゼロ」 を担保。
    # entry point として独立してる oauth-callback.html は削除維持 (= /oauth-callback が
    # 訪問者から触れない state を作る)。
    Path("oauth-callback.html"),
)

STRAVA_DOM_IDS = (
    "strava-section", "strava-fold", "strava-status",
    "btnStravaConnect", "btnStravaDisconnect",
    "strava-setup-overlay", "stravaClientIdInput",
    "btnStravaSetupSave", "btnStravaSetupCancel",
    "postride-strava-fold", "btnStravaUpload",
    "postride-upload-status", "chkConsentStrava",
)

EXCLUDED_TOPLEVEL = ("archived", "tests")

CSP_STRIPPED = (
    "default-src 'self'; "
    "connect-src 'self' https://cyberjapandata.gsi.go.jp; "
    "script-src 'self' 'sha256-ams4LJMCHZGQskrbmkRXJOLWiK7NRUBvM4eTtE/MsaQ='; "
    "worker-src 'self' blob:; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data:; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "frame-ancestors 'none'; "
    "form-action 'self'"
)

SW_CACHE_BEFORE = "fujihill-v13"
SW_CACHE_AFTER = "fujihill-v14"


def clean(site_dir: Path) -> None:
    """_site/ を rm -rf (= 部分残骸ゼロ、 決定論)"""
    if site_dir.exists():
        shutil.rmtree(site_dir)


def copy_tree(src: Path, dst: Path) -> int:
    """web/ → _site/ を再帰コピー、 archived/ と tests/ は除外。
    Returns: コピーした top-level entry 数"""
    dst.mkdir(parents=True, exist_ok=False)
    n = 0
    for entry in src.iterdir():
        if entry.name in EXCLUDED_TOPLEVEL:
            continue
        target = dst / entry.name
        if entry.is_dir():
            shutil.copytree(entry, target, dirs_exist_ok=False)
        else:
            shutil.copy2(entry, target)
        n += 1
    return n


def strip_strava_files(site_dir: Path) -> list[Path]:
    """_site/ から Strava 関連 3 file を削除。
    Returns: 削除した path 一覧"""
    removed: list[Path] = []
    for rel in STRAVA_FILES:
        p = site_dir / rel
        if p.exists():
            p.unlink()
            removed.append(p)
    return removed


def strip_redistribution_restricted(site_dir: Path) -> list[Path]:
    """配布元再配布禁止 path を _site/ から除外 (= class C1 統合)。
    web/static/tiles/gsi_dem/ は export_static.py が local SQLite から展開した artifact、
    Pages 配信物には流さない (= b31 で訪問者単位 runtime fetch に移行済)。
    Returns: 削除した path 一覧"""
    removed: list[Path] = []
    target = site_dir / "static" / "tiles" / "gsi_dem"
    if target.exists():
        shutil.rmtree(target)
        removed.append(target)
    return removed


def _bs4_or_die():
    try:
        from bs4 import BeautifulSoup, Comment
    except ImportError:
        raise SystemExit(
            "ERROR: beautifulsoup4 が必要です。 `pip install beautifulsoup4` を実行してください。"
        )
    return BeautifulSoup, Comment


def rewrite_dom(html_path: Path) -> str:
    """index.html から 13 個の Strava 関連 DOM + Strava href を持つ anchor を除去。
    Returns: 改変後の HTML 文字列 (= file にも書き戻す)。

    対象:
    - id 属性が STRAVA_DOM_IDS に含まれる要素 (= 13 id)
    - href が *.strava.com を指す <a> 要素 (= 「Strava 設定で revoke してください」 案内 link、
      Pages 版では Strava 連携自体がないので案内不要)
    """
    BeautifulSoup, Comment = _bs4_or_die()
    text = html_path.read_text(encoding="utf-8")
    soup = BeautifulSoup(text, "html.parser")
    for dom_id in STRAVA_DOM_IDS:
        for el in soup.find_all(id=dom_id):
            el.decompose()
    # anchor: href に strava.com を含む <a> を削除
    for a in soup.find_all("a", href=True):
        if "strava.com" in a["href"]:
            a.decompose()
    # comment: "strava" を含む HTML comment は extract (= source の言及まで消す)
    for c in list(soup.find_all(string=lambda t: isinstance(t, Comment))):
        if "strava" in str(c).lower():
            c.extract()
    out = str(soup)
    html_path.write_text(out, encoding="utf-8")
    return out


# meta tag は BS4 後の reorder で attribute 順が変わる (= content="..." http-equiv="..." の順)
# 両方の order を覆うため、 meta tag 全体を non-greedy で 1 個の match にして
# content 属性を捕捉、 ない attr 順序にも対応する 2 段 substitution。
_CSP_META_TAG_RE = re.compile(
    r'<meta\b[^>]*http-equiv\s*=\s*"Content-Security-Policy"[^>]*/?>',
    re.IGNORECASE,
)
_CONTENT_ATTR_RE = re.compile(r'content\s*=\s*"[^"]*"', re.IGNORECASE)


def rewrite_csp(html: str) -> str:
    """CSP meta tag を stripped 版に置換 (= strava 行を消す + frame-ancestors / form-action 追加)。
    Returns: 改変後の HTML 文字列。
    冪等: 既に stripped 済の CSP なら同じ結果を返す。
    attribute 順非依存: BS4 reorder 後の <meta content="..." http-equiv="..."> も覆う。"""
    def _replace_content(tag_match: re.Match) -> str:
        tag = tag_match.group(0)
        # tag 内の content="..." を stripped 版で置換
        return _CONTENT_ATTR_RE.sub(f'content="{CSP_STRIPPED}"', tag, count=1)
    return _CSP_META_TAG_RE.sub(_replace_content, html)


def rewrite_csp_in_file(html_path: Path) -> None:
    """rewrite_csp を file に適用する thin wrapper"""
    text = html_path.read_text(encoding="utf-8")
    out = rewrite_csp(text)
    html_path.write_text(out, encoding="utf-8")


SW_CACHE_RE = re.compile(r"const\s+CACHE_NAME\s*=\s*'([^']+)'")


def bump_sw_cache(sw_path: Path) -> tuple[str, str]:
    """sw.js の CACHE_NAME を bump (= fujihill-v13 → fujihill-v14)。
    Returns: (before, after) tuple。
    冪等: 既に v14 なら ('fujihill-v14', 'fujihill-v14') を返す。"""
    text = sw_path.read_text(encoding="utf-8")
    m = SW_CACHE_RE.search(text)
    if m is None:
        raise SystemExit(f"ERROR: CACHE_NAME pattern not found in {sw_path}")
    before = m.group(1)
    after = SW_CACHE_AFTER
    if before == SW_CACHE_AFTER:
        return (before, after)
    new_text = SW_CACHE_RE.sub(f"const CACHE_NAME = '{after}'", text, count=1)
    sw_path.write_text(new_text, encoding="utf-8")
    return (before, after)


def verify_no_dem(site_dir: Path) -> None:
    """_site/static/tiles/gsi_dem/ が存在しないことを assert (= 配布元 ToS 違反防止)。
    存在したら SystemExit。"""
    dem_dir = site_dir / "static" / "tiles" / "gsi_dem"
    if dem_dir.exists():
        raise SystemExit(
            f"ERROR: {dem_dir} が存在します (= 配布元 ToS 違反、 b31 で runtime fetch に移行済のはず)"
        )


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Build _site/ from web/ with Strava removed (= b33)")
    p.add_argument("--src", default=str(DEFAULT_SRC))
    p.add_argument("--dst", default=str(DEFAULT_DST))
    args = p.parse_args(argv)

    src = Path(args.src)
    dst = Path(args.dst)

    print(f"[build_pages] clean: {dst}")
    clean(dst)

    print(f"[build_pages] copy_tree: {src} -> {dst}")
    n = copy_tree(src, dst)
    print(f"[build_pages]   copied {n} top-level entries")

    print(f"[build_pages] strip_strava_files: {dst}")
    removed = strip_strava_files(dst)
    print(f"[build_pages]   removed {len(removed)} files: {[str(p.relative_to(dst)) for p in removed]}")

    print(f"[build_pages] strip_redistribution_restricted: {dst}")
    removed_tiles = strip_redistribution_restricted(dst)
    print(f"[build_pages]   removed {len(removed_tiles)} redistribution-restricted paths")

    index_path = dst / "index.html"
    print(f"[build_pages] rewrite_dom: {index_path}")
    rewrite_dom(index_path)

    print(f"[build_pages] rewrite_csp: {index_path}")
    rewrite_csp_in_file(index_path)

    sw_path = dst / "sw.js"
    if sw_path.exists():
        print(f"[build_pages] bump_sw_cache: {sw_path}")
        before, after = bump_sw_cache(sw_path)
        print(f"[build_pages]   {before} -> {after}")

    print(f"[build_pages] verify_no_dem: {dst}")
    verify_no_dem(dst)

    print("[build_pages] done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
