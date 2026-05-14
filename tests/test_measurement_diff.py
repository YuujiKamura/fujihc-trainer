"""brief 20: scripts/measurement_diff.py の unit test (全関数 mandate)."""
import json
import sys
from pathlib import Path
from unittest.mock import patch

# scripts/ を path に追加 (= pyproject から scripts は package 化されてない)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))
import measurement_diff  # noqa: E402


def _write_jsonl(path, samples):
    path.write_text(
        '\n'.join(json.dumps(s) for s in samples) + '\n',
        encoding='utf-8',
    )


def test_load_samples_happy(tmp_path):
    """jsonl を読んで dict list として返る."""
    p = tmp_path / 'gpu.jsonl'
    _write_jsonl(p, [
        {'ts': '2026-05-15T00:00:00+00:00', 'temperature.gpu': '41', 'fan.speed': '35'},
        {'ts': '2026-05-15T00:00:01+00:00', 'temperature.gpu': '42', 'fan.speed': '36'},
    ])
    result = measurement_diff.load_samples(p)
    assert len(result) == 2
    assert result[0]['temperature.gpu'] == '41'
    assert result[1]['fan.speed'] == '36'


def test_load_samples_empty(tmp_path):
    """空 file は空 list 返す (= 空行のみも skip)."""
    p = tmp_path / 'empty.jsonl'
    p.write_text('', encoding='utf-8')
    assert measurement_diff.load_samples(p) == []

    p2 = tmp_path / 'blank.jsonl'
    p2.write_text('\n\n  \n', encoding='utf-8')
    assert measurement_diff.load_samples(p2) == []


def test_load_samples_schema_version_absent_warns(tmp_path, capsys):
    """schema_version 列無し (= 古い jsonl) は warning 付きで読込、 crash しない."""
    p = tmp_path / 'legacy.jsonl'
    _write_jsonl(p, [
        {'ts': '2026-05-15T00:00:00+00:00', 'temperature.gpu': '41', 'fan.speed': '35'},
        {'ts': '2026-05-15T00:00:01+00:00', 'temperature.gpu': '42', 'fan.speed': '36'},
    ])
    result = measurement_diff.load_samples(p)
    assert len(result) == 2
    assert result[0]['temperature.gpu'] == '41'
    captured = capsys.readouterr()
    assert 'WARNING' in captured.err
    assert 'schema_version' in captured.err


def test_load_samples_schema_version_1_no_warn(tmp_path, capsys):
    """schema_version=1 (= 現行) は warning 出さずに読む."""
    p = tmp_path / 'v1.jsonl'
    _write_jsonl(p, [
        {'schema_version': 1, 'ts': '2026-05-15T00:00:00+00:00', 'temperature.gpu': '41'},
        {'schema_version': 1, 'ts': '2026-05-15T00:00:01+00:00', 'temperature.gpu': '42'},
    ])
    result = measurement_diff.load_samples(p)
    assert len(result) == 2
    captured = capsys.readouterr()
    assert 'WARNING' not in captured.err


def test_load_samples_schema_version_future_warns(tmp_path, capsys):
    """schema_version=99 (= 未来) は warning 付きで forward-compat best-effort 読込."""
    p = tmp_path / 'future.jsonl'
    _write_jsonl(p, [
        {'schema_version': 99, 'ts': '2027-01-01T00:00:00+00:00', 'temperature.gpu': '50'},
    ])
    result = measurement_diff.load_samples(p)
    assert len(result) == 1
    captured = capsys.readouterr()
    assert 'WARNING' in captured.err
    assert '99' in captured.err


def test_summarize_happy():
    """既知 vals → mean / max / p95 / n が正しい."""
    # 25 sample で p95 が quantiles から計算される path を踏む
    samples = [{'temperature.gpu': str(40 + i)} for i in range(25)]
    result = measurement_diff.summarize(samples, 'temperature.gpu')
    assert result is not None
    assert result['n'] == 25
    assert result['max'] == 64.0  # 40..64
    assert result['mean'] == 52.0  # (40+64)/2
    # p95 は quantiles で 19 番目 cut、 max よりは小さく mean よりは大きい
    assert result['mean'] < result['p95'] <= result['max']


def test_summarize_empty():
    """空入力 → None."""
    assert measurement_diff.summarize([], 'temperature.gpu') is None
    # key 不在も同じ
    assert measurement_diff.summarize([{'other': '1'}], 'temperature.gpu') is None


def test_summarize_single_sample_p95_eq_max():
    """1 件のみ → p95 = max (= quantiles fallback path)."""
    result = measurement_diff.summarize([{'temperature.gpu': '42'}], 'temperature.gpu')
    assert result is not None
    assert result['n'] == 1
    assert result['mean'] == 42.0
    assert result['max'] == 42.0
    assert result['p95'] == 42.0


def test_main_smoke(tmp_path, capsys):
    """main が 2 jsonl から表を出力する (= 同 file 指定で delta 0)."""
    p = tmp_path / 'same.jsonl'
    _write_jsonl(p, [
        {'temperature.gpu': '41', 'fan.speed': '35', 'utilization.gpu': '18',
         'memory.used': '921', 'power.draw': '7.40'},
        {'temperature.gpu': '42', 'fan.speed': '35', 'utilization.gpu': '20',
         'memory.used': '921', 'power.draw': '7.50'},
    ])
    with patch.object(sys, 'argv',
                      ['measurement_diff.py', '--before', str(p), '--after', str(p)]):
        measurement_diff.main()
    captured = capsys.readouterr()
    assert 'before: 2 samples' in captured.out
    assert 'after:  2 samples' in captured.out
    assert 'temperature.gpu' in captured.out
    # 同 file → delta 0.00
    assert '+0.00' in captured.out or '-0.00' in captured.out or ' 0.00' in captured.out
