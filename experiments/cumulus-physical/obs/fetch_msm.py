"""MSM-GPV (= 気象庁メソ数値予報) を RISH archive から fetch + SQLite cache。

配布元配慮 (= 最重要、 obs/README.md ToS section に従う):
- **default は dry_run=True** = URL 構成 + cache 確認のみ、 実 fetch しない
- **実 fetch は user の明示 --no-dry-run trigger 時のみ**
  → AI sub-agent / CI / cron / push 連動の自動 fetch は禁止
  → 2026-05-20 user 訂正 「test 自動化で実 endpoint 叩くな」 の延長
- User-Agent: `fujihc-trainer/0.x (yuujikamura@gmail.com)` 必須
- sleep 1s / request、 並列禁止
- SQLite UNIQUE 制約で同 (source, valid_time, var) の重複 INSERT を物理層 reject
  (= cognition で 「同 day 再取得禁止」 を memory rule にしても context window で
   負ける、 物理層 = DB schema で止める = Rule 9 「memory では止まらない」)

仕様:
- RISH URL: http://database.rish.kyoto-u.ac.jp/arch/jmadata/data/gpv/original/
            {YYYY}/{MM}/{DD}/Z__C_RJTD_{YYYYMMDDHHMM}00_MSM_GPV_Rjp_{...}_grib2.bin
- init: 03 / 09 / 15 / 21 UTC = 1 日 4 回 (= 3h ごと、 +33h or +39h forecast)
- 富士山 bbox 切り出しは decode 側 (= decode_msm.py)、 本 script は raw blob を保存
- 富士山 bbox: lon 138.5-139.0, lat 35.1-35.6 (= ±20km)

CLI:
- `python obs/fetch_msm.py --date 2026-05-25`                 = dry-run、 URL list + cache 確認
- `python obs/fetch_msm.py --date 2026-05-25 --no-dry-run`    = 実 fetch (= user 明示 trigger 専用)
- `python obs/fetch_msm.py --self-test`                       = UNIQUE 制約 + cache 動作 verify
"""
from __future__ import annotations

import argparse
import logging
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, NamedTuple

# 配布元への自己申告 (= GSI ルールと同思想、 配布元が heavy user に連絡可能にする)
USER_AGENT = "fujihc-trainer/0.1 (yuujikamura@gmail.com)"

# RISH MSM archive base
RISH_BASE = "http://database.rish.kyoto-u.ac.jp/arch/jmadata/data/gpv/original"

# MSM-GPV init 時刻 (= UTC、 1 日 4 回 = 03/09/15/21、 3h forecast cycle は別 ProductCode)
# 本 script は init = 00/03/06/09/12/15/18/21 UTC の 8 回を扱う設定 (= RISH archive 仕様準拠)
MSM_INIT_HOURS_UTC = (0, 3, 6, 9, 12, 15, 18, 21)

# RISH の MSM-GPV ファイル名末尾は仕様により複数 ProductCode が存在する
# 代表的なもの: Lsurf (surface, 0.05deg) / L-pall (pressure levels)
# 本 script は両方を URL list に含める (= cache key の var で区別)
MSM_PRODUCT_VARS = (
    "Lsurf",   # 地表 + 0.05° 水平
    "L-pall",  # 等圧面 (= 16 layers、 風 u,v,w / T / RH / Z)
)

# 富士山 bbox (= decode 側で切り出し、 fetch では使わない、 metadata 用に保持)
FUJI_BBOX = {
    "lon_min": 138.5,
    "lon_max": 139.0,
    "lat_min": 35.1,
    "lat_max": 35.6,
}

# fetch 間隔 (= 配布元負荷軽減、 並列禁止と同思想)
FETCH_SLEEP_SEC = 1.0

DEFAULT_CACHE = Path(__file__).parent / "cache.sqlite"

CACHE_SCHEMA = """
CREATE TABLE IF NOT EXISTS msm_raw (
    source     TEXT NOT NULL,
    valid_time TEXT NOT NULL,
    var        TEXT NOT NULL,
    blob       BLOB,
    fetched_at TEXT NOT NULL,
    url        TEXT NOT NULL,
    PRIMARY KEY (source, valid_time, var)
);
CREATE INDEX IF NOT EXISTS idx_msm_raw_valid_time
    ON msm_raw(valid_time);
"""

logger = logging.getLogger("fetch_msm")


class FetchPlan(NamedTuple):
    """1 件の fetch 計画 (= 実 fetch せずに URL + cache 状態を返すための struct)。"""
    source: str          # "MSM-GPV"
    valid_time: str      # ISO8601 UTC、 e.g. "2026-05-25T03:00:00Z"
    var: str             # "Lsurf" / "L-pall"
    url: str             # RISH archive URL
    cached: bool         # cache に既に存在するか


def ensure_cache(db_path: Path) -> sqlite3.Connection:
    """SQLite cache を open、 schema 適用、 UNIQUE 制約を物理層 enforce。"""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(db_path))
    con.executescript(CACHE_SCHEMA)
    con.commit()
    return con


def build_url(init_dt: datetime, var: str) -> str:
    """RISH archive URL を組み立て (= init_dt は UTC)。"""
    if init_dt.tzinfo is None:
        init_dt = init_dt.replace(tzinfo=timezone.utc)
    init_utc = init_dt.astimezone(timezone.utc)
    yyyy = init_utc.strftime("%Y")
    mm = init_utc.strftime("%m")
    dd = init_utc.strftime("%d")
    stamp = init_utc.strftime("%Y%m%d%H%M")
    # RISH 命名規約に従う、 末尾 ProductCode は var で切替
    fname = f"Z__C_RJTD_{stamp}00_MSM_GPV_Rjp_{var}_grib2.bin"
    return f"{RISH_BASE}/{yyyy}/{mm}/{dd}/{fname}"


def plan_fetches(date: datetime, con: sqlite3.Connection) -> list[FetchPlan]:
    """指定 date (UTC 0:00-23:59) の MSM-GPV 全 init × 全 var を URL list 化、 cache 状態付き。"""
    plans: list[FetchPlan] = []
    cur = con.cursor()
    base = date.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=timezone.utc)
    for hh in MSM_INIT_HOURS_UTC:
        init_dt = base.replace(hour=hh)
        valid_time = init_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        for var in MSM_PRODUCT_VARS:
            url = build_url(init_dt, var)
            cached = cur.execute(
                "SELECT 1 FROM msm_raw WHERE source = ? AND valid_time = ? AND var = ?",
                ("MSM-GPV", valid_time, var),
            ).fetchone() is not None
            plans.append(FetchPlan(
                source="MSM-GPV",
                valid_time=valid_time,
                var=var,
                url=url,
                cached=cached,
            ))
    return plans


def fetch_msm(
    date: datetime,
    cache_path: Path = DEFAULT_CACHE,
    dry_run: bool = True,
) -> list[FetchPlan]:
    """MSM-GPV を fetch (= dry_run=True なら URL 構成 + cache 確認のみ、 実 fetch しない)。

    Args:
        date: 取得対象日 (UTC、 時分は 0:00 に正規化される)
        cache_path: SQLite cache path
        dry_run: True (= default) = URL 構成 + cache 確認のみ。
                 False = 実 fetch (= user の明示 trigger 専用、 sub-agent 起動禁止)

    Returns:
        FetchPlan list (= 計画された URL + cache 状態)。 実 fetch 結果は SQLite cache に蓄積。
    """
    con = ensure_cache(cache_path)
    try:
        plans = plan_fetches(date, con)

        logger.info(
            "[fetch_msm] date=%s dry_run=%s cache=%s total=%d cached=%d to_fetch=%d",
            date.date().isoformat(),
            dry_run,
            cache_path,
            len(plans),
            sum(1 for p in plans if p.cached),
            sum(1 for p in plans if not p.cached),
        )

        for plan in plans:
            mark = "CACHED" if plan.cached else "MISS  "
            logger.info("  %s %s %s -> %s", mark, plan.valid_time, plan.var, plan.url)

        if dry_run:
            logger.info("[fetch_msm] dry_run=True、 実 fetch しない (= 配布元配慮)")
            logger.info("[fetch_msm] 実 fetch するには --no-dry-run を user が明示 trigger")
            return plans

        # === 実 fetch path (= user 明示 trigger 専用) ===
        # 配布元配慮: sleep 1s / request、 並列禁止、 User-Agent 自己申告
        try:
            import urllib.request
            import urllib.error
        except ImportError:  # pragma: no cover (stdlib なので来ない)
            logger.error("[fetch_msm] urllib 不在、 実 fetch 不能")
            return plans

        for plan in plans:
            if plan.cached:
                logger.info("[fetch_msm] skip CACHED %s %s", plan.valid_time, plan.var)
                continue
            req = urllib.request.Request(
                plan.url,
                headers={"User-Agent": USER_AGENT},
            )
            logger.info("[fetch_msm] FETCH %s %s", plan.valid_time, plan.var)
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    blob = resp.read()
            except urllib.error.HTTPError as e:
                logger.warning("  HTTP %s %s: %s", e.code, plan.url, e.reason)
                time.sleep(FETCH_SLEEP_SEC)
                continue
            except urllib.error.URLError as e:
                logger.warning("  URLError %s: %s", plan.url, e.reason)
                time.sleep(FETCH_SLEEP_SEC)
                continue

            fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            try:
                con.execute(
                    "INSERT INTO msm_raw (source, valid_time, var, blob, fetched_at, url) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (plan.source, plan.valid_time, plan.var, blob, fetched_at, plan.url),
                )
                con.commit()
                logger.info("  stored %d bytes", len(blob))
            except sqlite3.IntegrityError as e:
                # UNIQUE 制約 reject = 想定動作 (= 物理層 enforce)
                logger.info("  UNIQUE reject (= 物理層 enforce): %s", e)

            time.sleep(FETCH_SLEEP_SEC)

        return plans
    finally:
        con.close()


def self_test(cache_path: Path = DEFAULT_CACHE) -> int:
    """mock test: dummy blob を 1 件 INSERT、 重複 INSERT が UNIQUE 制約で reject されることを確認。

    Returns:
        0 = success, 非 0 = failure
    """
    # self-test 用に専用 cache を切る (= 本 cache.sqlite を汚さない)
    test_db = cache_path.parent / "cache_selftest.sqlite"
    if test_db.exists():
        test_db.unlink()

    con = ensure_cache(test_db)
    try:
        # 1 件目 INSERT (= 通る)
        con.execute(
            "INSERT INTO msm_raw (source, valid_time, var, blob, fetched_at, url) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            ("MSM-GPV", "2026-05-25T03:00:00Z", "Lsurf",
             b"DUMMY_GRIB2_BLOB", "2026-05-25T10:00:00Z", "http://example/dummy"),
        )
        con.commit()
        count = con.execute("SELECT COUNT(*) FROM msm_raw").fetchone()[0]
        if count != 1:
            logger.error("[self-test] 初回 INSERT 後 count != 1: %d", count)
            return 1
        logger.info("[self-test] 1st INSERT OK, count=%d", count)

        # 2 件目 INSERT (= 同 PK、 UNIQUE 制約で reject されるべき)
        rejected = False
        try:
            con.execute(
                "INSERT INTO msm_raw (source, valid_time, var, blob, fetched_at, url) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                ("MSM-GPV", "2026-05-25T03:00:00Z", "Lsurf",
                 b"DUMMY_GRIB2_BLOB_2", "2026-05-25T10:00:01Z", "http://example/dummy2"),
            )
            con.commit()
        except sqlite3.IntegrityError as e:
            rejected = True
            logger.info("[self-test] 2nd INSERT rejected (= 物理層 enforce OK): %s", e)

        if not rejected:
            logger.error("[self-test] 2nd INSERT が reject されなかった = UNIQUE 制約 動作不良")
            return 2

        # 異 var なら通る (= PK は (source, valid_time, var) なので var 違えば別 row)
        con.execute(
            "INSERT INTO msm_raw (source, valid_time, var, blob, fetched_at, url) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            ("MSM-GPV", "2026-05-25T03:00:00Z", "L-pall",
             b"DUMMY_GRIB2_BLOB_PALL", "2026-05-25T10:00:02Z", "http://example/dummy3"),
        )
        con.commit()
        count = con.execute("SELECT COUNT(*) FROM msm_raw").fetchone()[0]
        if count != 2:
            logger.error("[self-test] 異 var INSERT 後 count != 2: %d", count)
            return 3
        logger.info("[self-test] 異 var INSERT OK, count=%d (= PK が (source,valid_time,var) で正しく分離)", count)

        # 検索動作確認 (= cache 確認 path が機能するか)
        hit = con.execute(
            "SELECT 1 FROM msm_raw WHERE source=? AND valid_time=? AND var=?",
            ("MSM-GPV", "2026-05-25T03:00:00Z", "Lsurf"),
        ).fetchone()
        if hit is None:
            logger.error("[self-test] cache lookup HIT 期待だが None")
            return 4
        miss = con.execute(
            "SELECT 1 FROM msm_raw WHERE source=? AND valid_time=? AND var=?",
            ("MSM-GPV", "2026-05-25T06:00:00Z", "Lsurf"),
        ).fetchone()
        if miss is not None:
            logger.error("[self-test] cache lookup MISS 期待だが HIT")
            return 5
        logger.info("[self-test] cache lookup HIT/MISS 動作 OK")

        logger.info("[self-test] ALL PASSED")
        return 0
    finally:
        con.close()
        if test_db.exists():
            test_db.unlink()


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--date", type=str, default=None,
                        help="取得対象日 (YYYY-MM-DD、 UTC)、 未指定なら今日")
    parser.add_argument("--no-dry-run", dest="dry_run", action="store_false",
                        help="実 fetch を有効化 (= user 明示 trigger 専用、 default は dry_run)")
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE,
                        help=f"SQLite cache path (= default: {DEFAULT_CACHE})")
    parser.add_argument("--self-test", action="store_true",
                        help="UNIQUE 制約 + cache 動作 verify を走らせて exit")
    parser.add_argument("-v", "--verbose", action="store_true")
    parser.set_defaults(dry_run=True)
    args = parser.parse_args(list(argv) if argv is not None else None)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(message)s",
    )

    if args.self_test:
        return self_test(args.cache)

    if args.date is None:
        date = datetime.now(timezone.utc)
    else:
        date = datetime.strptime(args.date, "%Y-%m-%d").replace(tzinfo=timezone.utc)

    fetch_msm(date=date, cache_path=args.cache, dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
