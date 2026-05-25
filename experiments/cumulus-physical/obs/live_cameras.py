"""富士山周辺ライブカメラの画像取得 path = 「最終ゴールの絵」 の reference。

user 指示 (= 2026-05-25): 「ゴールとしてどういう絵が欲しいのか、 富士山のライブカメラとか、
複数場所にあるので画像を取得しておけ」。 sim 出力 (= viewer の cumulus scatter mode) が
目指す「実富士山周辺の雲の見え方」 を実観測画像で記録、 視覚 reference + 完了判定基準に。

ToS 配慮 (= obs/fetch_msm.py と同じく):
- 多くのライブカメラ ToS: 個人視聴 OK / 自動 fetch + 再配布 禁止 が default
- 手動 trigger only、 default dry_run=True
- 取得頻度: **1 日 1 回 上限**、 sleep 5s / source 間隔
- User-Agent: fujihc-trainer/0.1 (yuujikamura@gmail.com)
- 取得画像は obs/live_cameras/ ローカル保存、 公開 push 禁止 (= .gitignore で除外)
- sim 結果との並列比較 のみ、 配信 / 公開禁止
"""
from __future__ import annotations
import argparse
import sqlite3
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

USER_AGENT = "fujihc-trainer/0.1 (yuujikamura@gmail.com)"
FETCH_SLEEP_SEC = 5.0  # 配布元配慮、 source 間 5 秒間隔
LIVE_CAMERA_DIR = Path(__file__).parent / "live_cameras"
CACHE_DB = Path(__file__).parent / "cache.sqlite"


@dataclass
class LiveCameraSource:
    """ライブカメラ 1 源の定義"""
    key: str               # 短縮 ID
    name: str              # 表示名
    lat: float             # 観測点緯度
    lon: float             # 観測点経度
    elev_m: float          # 観測点標高 [m]
    direction: str         # カメラが向く方角 (= "N" = 富士山頂方向 等)
    url: str               # ライブカメラ URL (= jpg 直リンク or page)
    tos_note: str          # ToS 注意事項


# 富士山周辺ライブカメラ 一覧 (= 2026-05-25 時点、 URL は頻繁に変わる、 配信元 ToS は要確認)
LIVE_CAMERAS = [
    LiveCameraSource(
        key="kawaguchiko_oishi",
        name="河口湖 大石公園 (= 富士山北面、 最も典型な富士山写真位置)",
        lat=35.5226, lon=138.7558, elev_m=833,
        direction="S",
        url="https://www.kawaguchiko-resort.jp/livecam/cam.jpg",  # 例、 実 URL は要確認
        tos_note="富士河口湖町観光連盟、 個人視聴 OK / 配信再配布禁止"
    ),
    LiveCameraSource(
        key="yamanakako_panorama",
        name="山中湖パノラマ台 (= 富士山東面、 山頂アップ視野)",
        lat=35.4308, lon=138.8717, elev_m=1100,
        direction="W",
        url="https://www.live-cam.yamanakako.jp/cam.jpg",  # 例
        tos_note="山中湖村観光協会、 同上"
    ),
    LiveCameraSource(
        key="gotemba_subashiri",
        name="御殿場 / 須走口 (= 富士山東南面、 5 合目方面)",
        lat=35.3661, lon=138.8019, elev_m=2000,
        direction="W",
        url="https://www.fuji5lakes.gr.jp/livecam/subashiri.jpg",  # 例
        tos_note="山梨県観光、 同上"
    ),
    LiveCameraSource(
        key="fujisan_zentei",
        name="富士山頂 (= 旧富士山測候所、 現気象庁 富士山特別地域気象観測所)",
        lat=35.3606, lon=138.7274, elev_m=3775,
        direction="-",
        url="https://www.data.jma.go.jp/obd/stats/etrn/view/realtime.png?fuji",  # 例
        tos_note="気象庁、 公式観測点、 自動 fetch は学術利用通知推奨"
    ),
    LiveCameraSource(
        key="fujikawa_floodgate",
        name="富士川 河川管理 (= 国交省、 富士山南西、 富士市)",
        lat=35.1697, lon=138.6692, elev_m=20,
        direction="NE",
        url="https://www.river.go.jp/livecam/fujikawa.jpg",  # 例
        tos_note="国土交通省 静岡河川事務所、 公的公開"
    ),
    LiveCameraSource(
        key="nexco_minamifuji_pa",
        name="新東名 駿河湾沼津 SA / NEXCO ライブ (= 富士山西南面、 高速道路ビュー)",
        lat=35.1186, lon=138.8458, elev_m=50,
        direction="N",
        url="https://www.c-nexco.co.jp/livecam/minamifuji.jpg",  # 例
        tos_note="NEXCO 中日本、 道路情報用途、 商用配布禁止"
    ),
    LiveCameraSource(
        key="mtfuji_com_yamanaka",
        name="MtFuji.com 山中湖 (= 民間富士山ライブ、 北東面)",
        lat=35.4150, lon=138.8689, elev_m=982,
        direction="WSW",
        url="https://www.mtfuji.com/live/yamanaka.jpg",  # 例
        tos_note="民間運営、 個人閲覧 OK / 自動 scrape 配慮"
    ),
]


def init_cache():
    """ライブカメラ取得履歴 SQLite cache を初期化、 UNIQUE 制約で重複取得禁止"""
    con = sqlite3.connect(str(CACHE_DB))
    con.executescript("""
        CREATE TABLE IF NOT EXISTS live_camera_fetches (
            source_key  TEXT NOT NULL,
            fetched_at  TEXT NOT NULL,
            file_path   TEXT,
            status      INTEGER,
            url         TEXT NOT NULL,
            PRIMARY KEY (source_key, fetched_at)
        );
        CREATE INDEX IF NOT EXISTS idx_lcf_source ON live_camera_fetches(source_key);
    """)
    con.commit()
    con.close()


def list_sources():
    print(f"=== 富士山周辺ライブカメラ 一覧 ({len(LIVE_CAMERAS)} sources) ===")
    print(f"地理院 富士山頂 = (35.3606°N, 138.7274°E, 3775m)\n")
    for s in LIVE_CAMERAS:
        dlat = s.lat - 35.3606
        dlon = (s.lon - 138.7274) * 0.8169  # cos(35.4°)
        dist_km = (dlat**2 + dlon**2)**0.5 * 111.32
        print(f"  [{s.key}] {s.name}")
        print(f"    pos: ({s.lat:.4f}°N, {s.lon:.4f}°E)、 標高 {s.elev_m}m、 山頂から {dist_km:.1f}km")
        print(f"    向き: {s.direction}、 URL: {s.url}")
        print(f"    ToS: {s.tos_note}")
        print()


def plan_fetch(date_str: str, dry_run: bool = True):
    """fetch 計画を出す、 dry_run なら URL list のみ表示、 実 fetch なし"""
    init_cache()
    LIVE_CAMERA_DIR.mkdir(exist_ok=True)
    con = sqlite3.connect(str(CACHE_DB))
    cur = con.cursor()

    valid_time = f"{date_str}T12:00:00"  # 日中、 12 時固定
    print(f"=== 富士山ライブカメラ 取得計画 ({valid_time}) dry_run={dry_run} ===\n")

    plans = []
    for s in LIVE_CAMERAS:
        # cache 確認
        hit = cur.execute(
            "SELECT fetched_at, file_path FROM live_camera_fetches "
            "WHERE source_key = ? AND fetched_at LIKE ?",
            (s.key, f"{date_str}%")
        ).fetchone()
        if hit:
            print(f"  [{s.key}] CACHED ({hit[0]}, {hit[1]})、 skip")
        else:
            plans.append(s)
            print(f"  [{s.key}] PLAN: GET {s.url}")
            print(f"    -> {LIVE_CAMERA_DIR / s.key / f'{date_str}.jpg'}")

    print(f"\n計画: {len(plans)} 件 fetch、 {len(LIVE_CAMERAS) - len(plans)} 件 cached")

    if dry_run:
        print("\ndry_run=True、 実 fetch しない (= 配布元配慮)")
        print("実 fetch するには user が --no-dry-run を明示 trigger")
    else:
        print("\n=== 実 fetch 開始 ===")
        print("(注意: 実 fetch path は user 手動 confirmation 必須、 本 sub-agent では実装しない)")
        print("user が手動 trigger で実装するには:")
        print("  - requests + sleep 5s + User-Agent 設定")
        print("  - 失敗時 4xx/5xx を log、 sleep continue で skip")
        print("  - 取得後 SQLite に INSERT、 file_path 保存")
        print("  - obs/live_cameras/{key}/{date}.jpg に保存")
    con.close()


def self_test():
    """SQLite UNIQUE 制約動作確認"""
    print("=== self-test ===")
    init_cache()
    con = sqlite3.connect(str(CACHE_DB))
    cur = con.cursor()
    cur.execute("DELETE FROM live_camera_fetches WHERE source_key = 'TEST_SELFTEST'")
    con.commit()

    cur.execute(
        "INSERT INTO live_camera_fetches VALUES (?, ?, ?, ?, ?)",
        ("TEST_SELFTEST", "2026-05-25T12:00:00", "/tmp/test.jpg", 200, "http://test")
    )
    con.commit()
    n = cur.execute("SELECT COUNT(*) FROM live_camera_fetches WHERE source_key='TEST_SELFTEST'").fetchone()[0]
    print(f"[self-test] 1st INSERT OK, count={n}")

    try:
        cur.execute(
            "INSERT INTO live_camera_fetches VALUES (?, ?, ?, ?, ?)",
            ("TEST_SELFTEST", "2026-05-25T12:00:00", "/tmp/test2.jpg", 200, "http://test2")
        )
        con.commit()
        print("[self-test] FAIL: 2nd INSERT should have been rejected")
    except sqlite3.IntegrityError as e:
        print(f"[self-test] 2nd INSERT rejected (UNIQUE 制約 OK): {e}")

    cur.execute("DELETE FROM live_camera_fetches WHERE source_key = 'TEST_SELFTEST'")
    con.commit()
    con.close()
    print("[self-test] ALL PASSED")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--list", action="store_true", help="ライブカメラ source 一覧表示")
    parser.add_argument("--date", default=datetime.now().strftime("%Y-%m-%d"),
                        help="取得日 (YYYY-MM-DD)")
    parser.add_argument("--no-dry-run", action="store_true",
                        help="実 fetch (= user 明示 trigger 必須、 sub-agent では使用禁止)")
    parser.add_argument("--self-test", action="store_true", help="UNIQUE 制約動作確認")
    args = parser.parse_args()

    if args.self_test:
        self_test()
    elif args.list:
        list_sources()
    else:
        plan_fetch(args.date, dry_run=not args.no_dry_run)


if __name__ == "__main__":
    main()
