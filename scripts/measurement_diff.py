"""2 つの jsonl を読んで temp / fan / util / memory / power の mean + max + p95 を比較表示 (brief 20).

usage:
    python scripts/measurement_diff.py \
        --before data/measurements/2026-05-15-ride-prefix-on.jsonl \
        --after  data/measurements/2026-05-16-ride-prefix-off.jsonl
"""
import argparse
import json
import statistics
from pathlib import Path

KEYS = ['temperature.gpu', 'fan.speed', 'utilization.gpu', 'memory.used', 'power.draw']


def load_samples(path):
    """jsonl を読んで dict list を返す. 空行は skip, 空 file は []."""
    text = Path(path).read_text(encoding='utf-8')
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def summarize(samples, key):
    """samples から key の float vals を抽出して mean/max/p95/n を返す. 空なら None."""
    vals = [float(s[key]) for s in samples if key in s]
    if not vals:
        return None
    # statistics.quantiles は n=20 で最低 2 sample 要求 + p95 は 19 番目の cut、
    # サンプル数が少ない時は max を fallback として使う
    if len(vals) > 20:
        p95 = statistics.quantiles(vals, n=20)[-1]
    else:
        p95 = max(vals)
    return {
        'mean': statistics.mean(vals),
        'max': max(vals),
        'p95': p95,
        'n': len(vals),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
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
