---
brief: 20-measurement-substrate
title: 計測 substrate (GPU polling + FPS HUD + tile fetch カウンタ)
parent_project: ~/fujihc-trainer/
created: 2026-05-15
depends_on: [18-js-test-infra]
blocks: [13-prefetch-emergency-fix, 17b-viewer-tile-endpoint]
priority: HIGH  # 計測無しで改善判定不可、 全 ride 走行で必須
---

# Brief 20: 計測 substrate

## はじめに

「計測しながらやっていく」が user 方針 (2026-05-15)。 brief 13 (prefetch 停止) / brief 17b (ローカル DB 経路) の効果を **数字で見ながら**改善判定する。 計測無しでは「ファンの音が静かになった気がする」止まり = subjective evidence で landing 判断は不可。

具体的に計測するもの 3 種:
1. **GPU**: nvidia-smi を 1Hz で叩いて温度 / fan / 利用率 / memory / power
2. **FPS**: viewer の `performance.now()` 差分の rolling avg、 HUD 表示 + ride log CSV append
3. **tile fetch**: brief 17a の tile_server.py が捌いた件数を期間集計

各々 jsonl で `data/measurements/` に保存、 ride 前後を diff する script で比較表示。

baseline 履歴 (= 計測の連続性):
- 2026-05-14 23:30 (idle): 47℃ / fan 40% / util 17% / 1317 MiB / 12.17W
- 2026-05-15 朝 (fan 物理確認後 idle): **41℃ / fan 35% / util 22% / 856 MiB / 7.35W** (= 物理点検で改善か、 アプリ closed の bias か区別必要、 これも brief 20 の計測で識別)

## 何を作るか

### 1. `scripts/gpu_poll.py` (= GPU polling)

```python
"""nvidia-smi を 1Hz で叩いて jsonl に追記.

usage:
    python scripts/gpu_poll.py --output data/measurements/gpu-baseline-idle.jsonl --duration 60
    python scripts/gpu_poll.py --output data/measurements/gpu-ride-prefix-on.jsonl  # 無期限、 Ctrl+C で stop
"""
import argparse, json, subprocess, sys, time
from datetime import datetime, timezone
from pathlib import Path

QUERY = 'name,temperature.gpu,fan.speed,utilization.gpu,memory.used,memory.total,power.draw,power.limit'

def query_nvidia_smi():
    """nvidia-smi を 1 回叩いて dict 返す. ない / error なら None."""
    try:
        r = subprocess.run(
            ['nvidia-smi', f'--query-gpu={QUERY}', '--format=csv,noheader,nounits'],
            capture_output=True, text=True, timeout=2,
        )
        if r.returncode != 0:
            return None
        parts = [p.strip() for p in r.stdout.strip().split(',')]
        keys = QUERY.split(',')
        return {
            'ts': datetime.now(timezone.utc).isoformat(),
            **dict(zip(keys, parts)),
        }
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--interval', type=float, default=1.0)
    parser.add_argument('--duration', type=int, default=0, help='0 = until Ctrl+C')
    parser.add_argument('--label', default='', help='this run の識別ラベル (= "idle" / "ride" / "prefix-on" 等)')
    args = parser.parse_args()

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    f = open(args.output, 'a', encoding='utf-8')
    start = time.time()
    print(f'polling -> {args.output} every {args.interval}s, label={args.label!r}')
    try:
        while True:
            sample = query_nvidia_smi()
            if sample is None:
                print('nvidia-smi unavailable, abort'); sys.exit(1)
            sample['label'] = args.label
            f.write(json.dumps(sample) + '\n')
            f.flush()
            if args.duration and time.time() - start >= args.duration:
                break
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print('stopped')
    finally:
        f.close()

if __name__ == '__main__':
    main()
```

### 2. `scripts/measurement_diff.py` (= 期間比較)

```python
"""2 つの jsonl を読んで temp / fan / util / power の平均 + max + p95 を比較表示."""
import argparse, json, statistics
from pathlib import Path

KEYS = ['temperature.gpu', 'fan.speed', 'utilization.gpu', 'memory.used', 'power.draw']

def load_samples(path):
    return [json.loads(l) for l in Path(path).read_text().splitlines() if l.strip()]

def summarize(samples, key):
    vals = [float(s[key]) for s in samples if key in s]
    if not vals:
        return None
    return {
        'mean': statistics.mean(vals),
        'max': max(vals),
        'p95': statistics.quantiles(vals, n=20)[-1] if len(vals) > 20 else max(vals),
        'n': len(vals),
    }

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--before', required=True)
    parser.add_argument('--after', required=True)
    args = parser.parse_args()

    before = load_samples(args.before)
    after = load_samples(args.after)
    print(f'before: {len(before)} samples ({args.before})')
    print(f'after:  {len(after)} samples ({args.after})')
    print()
    print(f'{"key":<22} {"before_mean":>12} {"after_mean":>12} {"delta":>10}')
    for k in KEYS:
        b = summarize(before, k)
        a = summarize(after, k)
        if b is None or a is None:
            continue
        delta = a['mean'] - b['mean']
        print(f'{k:<22} {b["mean"]:>12.2f} {a["mean"]:>12.2f} {delta:>+10.2f}')

if __name__ == '__main__':
    main()
```

### 3. FPS HUD lib (`web/lib/fps_meter.js`)

```js
/**
 * rolling 平均 FPS を計算する pure module.
 * viewer から requestAnimationFrame の callback で tick() を呼ぶ、
 * 任意のタイミングで getStats() を呼ぶ.
 */
export function createFpsMeter(windowSize = 60) {
  let last = null;
  const dts = [];

  function tick(now = performance.now()) {
    if (last !== null) {
      dts.push(now - last);
      if (dts.length > windowSize) dts.shift();
    }
    last = now;
  }

  function getStats() {
    if (dts.length === 0) return { fps: 0, frameMs: 0, n: 0 };
    const mean = dts.reduce((a, b) => a + b, 0) / dts.length;
    const sorted = [...dts].sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    return {
      fps: 1000 / mean,
      frameMs: mean,
      frameMsP95: p95,
      n: dts.length,
    };
  }

  function reset() {
    last = null;
    dts.length = 0;
  }

  return { tick, getStats, reset };
}
```

viewer 側で 1Hz で `getStats()` を HUD に表示、 ride log CSV にも 1Hz で append (= brief 17b の HUD / CSV append 処理に絡める)。

### 4. tile_server.py の fetch カウンタ (= brief 17a に追加)

brief 17a の handler dict に `metrics` を追加、 source 別 hit / miss count を保持:

```python
# tile_server.py に追加
_metrics = {'osm': {'200': 0, '404': 0}, 'gsi_dem': {'200': 0, '404': 0}}

def get_tile(db_path, source, z, x, y):
    # 既存実装
    result = ...
    if source in _metrics:
        _metrics[source][str(result[0])] = _metrics[source].get(str(result[0]), 0) + 1
    return result

def get_metrics():
    return dict(_metrics)

def reset_metrics():
    for src in _metrics:
        _metrics[src] = {'200': 0, '404': 0}
```

bridge.py 側に `GET /tiles/_metrics` route を追加、 viewer や `gpu_poll.py` から定期取得して jsonl に同期記録。

## 使い方 (典型的 1 ride の計測フロー)

```bash
# 1. ride 開始前: GPU polling daemon を起動
python scripts/gpu_poll.py \
    --output data/measurements/2026-05-15-ride-prefix-on.jsonl \
    --label "prefix-on" &
GPU_PID=$!

# 2. bridge 起動 + browser で viewer 開く + ride 1 周
python -m fujihc.bridge --dummy   # or 実トレーナー
# ... ride ...

# 3. ride 終了後: polling daemon 停止
kill $GPU_PID

# 4. 比較 (= 旧 ride との diff)
python scripts/measurement_diff.py \
    --before data/measurements/2026-05-15-ride-prefix-on.jsonl \
    --after data/measurements/2026-05-16-ride-prefix-off.jsonl

# 5. tile fetch 件数 (= viewer 動作中に取得)
curl http://127.0.0.1:8000/tiles/_metrics
```

## やらないこと

- ride 中の自動 polling 起動 (= 手動 `&` で十分、 cron / daemon 化は別 brief)
- ブラウザ DevTools の WebVitals 計測 (= 別軸、 ride 視点では FPS だけで十分)
- GPU 以外の system metrics (= CPU temp / fan / メモリ / SSD)、 必要が出たら別 brief
- ride 中のリアルタイム警告 (= 計測 → 事後分析、 リアルタイム alarming は別 brief)
- 計測値の可視化 GUI (= jsonl + diff script で十分、 plotly 等は別 brief)

## 完了条件

1. `scripts/gpu_poll.py` landed、 nvidia-smi 不在環境でも abort で error 返す
2. `scripts/measurement_diff.py` landed
3. `web/lib/fps_meter.js` landed、 export 済
4. brief 17a の tile_server.py に `_metrics` / `get_metrics()` / `reset_metrics()` 追加 (= brief 17a 実装時に追加 atom として組み込み、 本 brief 完了時には skeleton のみ landed)
5. `data/measurements/.gitkeep`、 `.gitignore` に `data/measurements/*.jsonl` 追加
6. `tests/test_gpu_poll.py` に **全関数 mandate** で 4-5 件:
   - `query_nvidia_smi` happy: subprocess mock で出力 parse → dict
   - `query_nvidia_smi` 不在: FileNotFoundError → None
   - `query_nvidia_smi` timeout: TimeoutExpired → None
   - `query_nvidia_smi` returncode 非 0 → None
7. `tests/test_measurement_diff.py` に 3-4 件:
   - `load_samples` happy
   - `summarize` happy / 空入力で None
   - `main` smoke (= 2 jsonl から表出力)
8. `web/tests/fps_meter.test.js` に 4-5 件:
   - `tick` 60 回後の `getStats().n` = 60
   - 等間隔 16.67ms → fps ≈ 60
   - 等間隔 33.33ms → fps ≈ 30
   - `reset` 後 n=0
9. `pytest` 全 green (= brief 14 + 18 + 本 brief = 計約 20 件 Python)、 `npm test` 全 green (= brief 18 26 件 + 本 brief 4-5 件 = 30-31 件 JS)
10. **実走 baseline 取得**: 現状コード (= prefetch 有効、 zoom 14-18 並走) で 1 ride 計測 → `data/measurements/2026-05-15-baseline-prefetch-on.jsonl` に保存
11. README に「計測手順」「ride 前後の diff コマンド」追加
12. ローカル commit、 push しない

## ハマる罠

- nvidia-smi は Windows 環境では PATH 通ってないと subprocess で見つからない、 `C:\Windows\System32\` の `nvidia-smi.exe` を fallback で探す挙動も検討 (= 本 brief では default の PATH 依存で良、 通らなければ手動 PATH 追加を README に書く)
- jsonl の追記は `open('a')` だが atomic ではない、 ride 中 crash したら不完全行が残る可能性、 各行 `f.flush()` で被害最小化
- `data/measurements/` を git に含めない (= 物理 PC 依存、 比較は手元のみ)
- FPS HUD の rolling window 60 = 約 1 秒分 (60fps 前提)、 30fps 環境なら 2 秒分、 これで十分
- nvidia-smi 1Hz は GPU 自身に対する負荷ほぼゼロ、 ただし ride 全期間 90 分で 5400 行 = 数 MB、 jsonl で十分

## まとめ

完了条件: 3 script / 1 JS lib + skeleton tile_server metrics / 4 種 test + 全 green / baseline 1 ride 計測 jsonl / README 計測手順。

ship される: 「ride 中に温度 N℃ / fan N% / FPS N」が数字で出る基盤、 brief 13 / 17b 等の改善 atom ごとに before/after diff で効果判定可能、 「ファンの音が変」を subjective から objective に翻訳できる。
ship されない: ride 中 リアルタイム警告、 可視化 GUI、 CPU / system metrics、 自動 daemon 化。

次の atom: brief 13 / 17b に **計測併走** が組み込まれる、 brief 14 の zoom 17 単一化の効果 (= 旧 5 段並走との比較) も本 substrate で判定。
