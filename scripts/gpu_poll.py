"""nvidia-smi を 1Hz で叩いて jsonl に追記する計測 substrate (brief 20).

usage:
    python scripts/gpu_poll.py --output data/measurements/gpu-idle.jsonl --duration 60
    python scripts/gpu_poll.py --output data/measurements/gpu-ride.jsonl  # 無期限、 Ctrl+C で stop
"""
import argparse
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

QUERY = 'name,temperature.gpu,fan.speed,utilization.gpu,memory.used,memory.total,power.draw,power.limit'

# jsonl の schema version. QUERY 列 / 構造を変更したら bump して、
# measurement_diff.py が古い jsonl も区別できるようにする (= Round 3 マイグレ可逆軸).
SCHEMA_VERSION = 1


def query_nvidia_smi():
    """nvidia-smi を 1 回叩いて dict 返す. 不在 / error なら None."""
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
            'schema_version': SCHEMA_VERSION,
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
    parser.add_argument('--label', default='', help='this run の識別ラベル')
    args = parser.parse_args()

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    start = time.time()
    print(f'polling -> {args.output} every {args.interval}s, label={args.label!r}')
    n = 0
    with open(args.output, 'a', encoding='utf-8') as f:
        try:
            while True:
                sample = query_nvidia_smi()
                if sample is None:
                    print('nvidia-smi unavailable, abort')
                    sys.exit(1)
                sample['label'] = args.label
                f.write(json.dumps(sample) + '\n')
                f.flush()
                n += 1
                if args.duration and time.time() - start >= args.duration:
                    break
                time.sleep(args.interval)
        except KeyboardInterrupt:
            print(f'\nstopped after {n} samples')
    print(f'wrote {n} samples')


if __name__ == '__main__':
    main()
