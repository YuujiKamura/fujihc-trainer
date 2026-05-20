"""brief 33 責務 1: scripts/build_pages.py の単体 test (= 全関数 mandate)。

各関数を fixture 駆動で個別 pin、 happy / edge / error path を網羅。
ダミー web/ を tmp_path に組み立てて _site/ 生成後の状態を verify する。
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import build_pages  # noqa: E402


# ---------- fixture ----------

REAL_INDEX_CSP = (
    '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; '
    "connect-src 'self' https://www.strava.com https://*.strava.com https://cyberjapandata.gsi.go.jp; "
    "script-src 'self' 'sha256-ams4LJMCHZGQskrbmkRXJOLWiK7NRUBvM4eTtE/MsaQ='; "
    "worker-src 'self' blob:; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: https://*.strava.com; "
    "object-src 'none'; "
    'base-uri \'self\'">'
)

REAL_INDEX_BODY = (
    "<body class=\"state-checking\">"
    "<div id=\"hud\">HUD</div>"
    "<div id=\"rider-hud\">rider HUD</div>"
    "<div id=\"minimap-container\">minimap</div>"
    "<section id=\"strava-section\"><h3>履歴 / Strava 連携</h3>"
    "<button id=\"btnStravaConnect\">connect</button>"
    "<button id=\"btnStravaDisconnect\" hidden>disconnect</button>"
    "<details id=\"strava-fold\"><summary>fold</summary>"
    "<div class=\"strava-status\" id=\"strava-status\">未連携</div>"
    "</details></section>"
    "<div id=\"strava-setup-overlay\">"
    "<input id=\"stravaClientIdInput\">"
    "<button id=\"btnStravaSetupSave\">save</button>"
    "<button id=\"btnStravaSetupCancel\">cancel</button>"
    "</div>"
    "<div id=\"postride-overlay\">"
    "<details id=\"postride-strava-fold\">"
    "<button id=\"btnStravaUpload\">upload</button>"
    "</details>"
    "<div id=\"postride-upload-status\">status</div>"
    "</div>"
    "<input type=\"checkbox\" id=\"chkConsentStrava\">"
    "<div id=\"consent-overlay\">consent</div>"
    "<div id=\"intro-overlay\">intro</div>"
    "<div id=\"history-overlay\"><div id=\"history-panel\">history</div></div>"
    "<div id=\"section-list-panel\">sections</div>"
    "</body>"
)


@pytest.fixture
def fake_web(tmp_path: Path) -> Path:
    """tmp_path に最小限の web/ を構築 (= index.html + sw.js + lib/strava_*.js + oauth-callback.html + archived/)"""
    web = tmp_path / "web"
    (web / "lib").mkdir(parents=True)
    (web / "lib" / "strava_oauth.js").write_text("// strava oauth", encoding="utf-8")
    (web / "lib" / "strava_upload.js").write_text("// strava upload", encoding="utf-8")
    (web / "lib" / "ride_state.js").write_text("// ride state", encoding="utf-8")
    (web / "oauth-callback.html").write_text("<html>oauth</html>", encoding="utf-8")
    (web / "index.html").write_text(
        f"<!doctype html><html><head>{REAL_INDEX_CSP}</head>{REAL_INDEX_BODY}</html>",
        encoding="utf-8",
    )
    (web / "sw.js").write_text(
        "const CACHE_NAME = 'fujihc-v13';\nconst PRECACHE_URLS = ['./'];\n",
        encoding="utf-8",
    )
    (web / "course.json").write_text("[]", encoding="utf-8")
    (web / "static").mkdir()
    (web / "static" / ".gitkeep").write_text("", encoding="utf-8")
    # archived / tests は除外対象なので作って残しておく
    (web / "archived").mkdir()
    (web / "archived" / "old.html").write_text("<html>old</html>", encoding="utf-8")
    (web / "tests").mkdir()
    (web / "tests" / "smoke.test.js").write_text("// test", encoding="utf-8")
    return web


# ---------- clean ----------

def test_clean_removes_existing_site_dir(tmp_path: Path) -> None:
    site = tmp_path / "_site"
    site.mkdir()
    (site / "leftover.txt").write_text("old", encoding="utf-8")
    build_pages.clean(site)
    assert not site.exists()


def test_clean_idempotent_on_missing_dir(tmp_path: Path) -> None:
    site = tmp_path / "_site"
    assert not site.exists()
    build_pages.clean(site)  # 例外なし
    assert not site.exists()


# ---------- copy_tree ----------

def test_copy_tree_excludes_archived_and_tests(fake_web: Path, tmp_path: Path) -> None:
    site = tmp_path / "_site"
    n = build_pages.copy_tree(fake_web, site)
    assert (site / "index.html").exists()
    assert (site / "sw.js").exists()
    assert (site / "lib" / "strava_oauth.js").exists()  # まだ strip 前
    assert (site / "oauth-callback.html").exists()
    assert not (site / "archived").exists()
    assert not (site / "tests").exists()
    assert n > 0  # 少なくとも 1 件はコピー


def test_copy_tree_fails_on_existing_dst(fake_web: Path, tmp_path: Path) -> None:
    site = tmp_path / "_site"
    site.mkdir()
    with pytest.raises((FileExistsError,)):
        build_pages.copy_tree(fake_web, site)


# ---------- strip_strava_files ----------

def test_strip_strava_files_removes_oauth_callback_only(fake_web: Path, tmp_path: Path) -> None:
    # 2026-05-20 fix: viewer-maplibre.js が strava_oauth.js を import するため source 配信維持、
    # 削除対象は oauth-callback.html のみ。 Strava endpoint 通信は CSP rewrite で block する 2 段。
    site = tmp_path / "_site"
    build_pages.copy_tree(fake_web, site)
    removed = build_pages.strip_strava_files(site)
    assert len(removed) == 1
    assert (site / "lib" / "strava_oauth.js").exists()  # source 配信維持 (= viewer import 経路)
    assert (site / "lib" / "strava_upload.js").exists()  # 同上
    assert not (site / "oauth-callback.html").exists()  # entry point は削除維持
    assert (site / "lib" / "ride_state.js").exists()  # 過削除なし


def test_strip_strava_files_idempotent(fake_web: Path, tmp_path: Path) -> None:
    site = tmp_path / "_site"
    build_pages.copy_tree(fake_web, site)
    build_pages.strip_strava_files(site)
    removed2 = build_pages.strip_strava_files(site)  # 2 度目は 0 件
    assert removed2 == []


# ---------- rewrite_dom ----------

def test_rewrite_dom_removes_13_strava_ids(fake_web: Path, tmp_path: Path) -> None:
    site = tmp_path / "_site"
    build_pages.copy_tree(fake_web, site)
    out = build_pages.rewrite_dom(site / "index.html")
    for dom_id in build_pages.STRAVA_DOM_IDS:
        assert f'id="{dom_id}"' not in out, f"{dom_id} が残存"


def test_rewrite_dom_keeps_non_strava_ids(fake_web: Path, tmp_path: Path) -> None:
    site = tmp_path / "_site"
    build_pages.copy_tree(fake_web, site)
    out = build_pages.rewrite_dom(site / "index.html")
    # 残すもの (= 過削除防止)
    for keep_id in ("hud", "rider-hud", "minimap-container",
                    "consent-overlay", "intro-overlay",
                    "history-overlay", "history-panel", "section-list-panel"):
        assert f'id="{keep_id}"' in out, f"{keep_id} が誤削除"


# ---------- rewrite_csp ----------

def test_rewrite_csp_strips_strava_and_keeps_importmap_hash() -> None:
    out = build_pages.rewrite_csp(f"<head>{REAL_INDEX_CSP}</head>")
    assert "strava.com" not in out
    assert "'sha256-ams4LJMCHZGQskrbmkRXJOLWiK7NRUBvM4eTtE/MsaQ='" in out
    assert "frame-ancestors 'none'" in out
    assert "form-action 'self'" in out
    assert "worker-src 'self' blob:" in out


def test_rewrite_csp_idempotent() -> None:
    once = build_pages.rewrite_csp(f"<head>{REAL_INDEX_CSP}</head>")
    twice = build_pages.rewrite_csp(once)
    assert once == twice


# ---------- bump_sw_cache ----------

def test_bump_sw_cache_v13_to_v14(fake_web: Path, tmp_path: Path) -> None:
    site = tmp_path / "_site"
    build_pages.copy_tree(fake_web, site)
    before, after = build_pages.bump_sw_cache(site / "sw.js")
    assert before == "fujihc-v13"
    assert after == "fujihc-v14"
    text = (site / "sw.js").read_text(encoding="utf-8")
    assert "fujihc-v14" in text
    assert "fujihc-v13" not in text


def test_bump_sw_cache_idempotent_on_v14(tmp_path: Path) -> None:
    sw = tmp_path / "sw.js"
    sw.write_text("const CACHE_NAME = 'fujihc-v14';\n", encoding="utf-8")
    before, after = build_pages.bump_sw_cache(sw)
    assert before == "fujihc-v14"
    assert after == "fujihc-v14"


def test_bump_sw_cache_raises_when_pattern_missing(tmp_path: Path) -> None:
    sw = tmp_path / "sw.js"
    sw.write_text("// no CACHE_NAME here\n", encoding="utf-8")
    with pytest.raises(SystemExit):
        build_pages.bump_sw_cache(sw)


# ---------- verify_no_dem ----------

def test_verify_no_dem_passes_when_absent(tmp_path: Path) -> None:
    site = tmp_path / "_site"
    site.mkdir()
    build_pages.verify_no_dem(site)  # 例外なし


def test_verify_no_dem_raises_when_present(tmp_path: Path) -> None:
    site = tmp_path / "_site"
    dem = site / "static" / "tiles" / "gsi_dem"
    dem.mkdir(parents=True)
    (dem / "fake.png").write_text("x", encoding="utf-8")
    with pytest.raises(SystemExit):
        build_pages.verify_no_dem(site)


# ---------- main orchestrator ----------

def test_main_orchestrator_runs_all_steps(fake_web: Path, tmp_path: Path) -> None:
    site = tmp_path / "_site"
    rc = build_pages.main(["--src", str(fake_web), "--dst", str(site)])
    assert rc == 0
    # 全 step の効果が _site/ に表れている
    assert site.exists()
    # 2026-05-20 fix: viewer import 経路維持で source 配信、 削除は oauth-callback.html のみ
    assert (site / "lib" / "strava_oauth.js").exists()
    assert (site / "lib" / "strava_upload.js").exists()
    assert not (site / "oauth-callback.html").exists()
    html = (site / "index.html").read_text(encoding="utf-8")
    assert "strava.com" not in html
    for dom_id in build_pages.STRAVA_DOM_IDS:
        assert f'id="{dom_id}"' not in html
    assert "fujihc-v14" in (site / "sw.js").read_text(encoding="utf-8")
    assert "frame-ancestors 'none'" in html


# ---------- grep gate: 外部 URL ゼロ規律 (= export_static.py と同型) ----------

def test_build_pages_no_http_url_in_source() -> None:
    """build_pages.py source 内に外部 http(s)://URL を含まない (= 外部 fetch ゼロ規律)。
    Strava ToS / GSI 等の URL は brief / docs に置く、 script source には書かない。"""
    src = (REPO_ROOT / "scripts" / "build_pages.py").read_text(encoding="utf-8")
    # cyberjapandata.gsi.go.jp は CSP_STRIPPED の中に文字列として現れる (= http(s)://prefix なし)
    # 完全な URL prefix (http:// or https://) を grep して unhit を確認
    for line in src.splitlines():
        # CSP_STRIPPED 内の "https://cyberjapandata.gsi.go.jp" は url scheme 付きで含まれる、
        # ただしこれは Pages 配信物の CSP に書き出す物であり script の外部 fetch ではない。
        # よって CSP_STRIPPED の定義 line に限定して例外扱い。
        if "CSP_STRIPPED" in line and line.lstrip().startswith("CSP_STRIPPED"):
            continue
        if "cyberjapandata" in line:
            continue  # CSP_STRIPPED 内の文字列分割行
        assert "http://" not in line, f"http:// が現れた: {line!r}"
        assert "https://" not in line, f"https:// が現れた: {line!r}"
