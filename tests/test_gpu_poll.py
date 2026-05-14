"""brief 20: scripts/gpu_poll.py の unit test (全関数 mandate)."""
import json
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

# scripts/ を path に追加 (= pyproject から scripts は package 化されてない)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))
import gpu_poll  # noqa: E402


def _fake_completed(stdout, returncode=0):
    m = MagicMock()
    m.stdout = stdout
    m.returncode = returncode
    return m


def test_query_nvidia_smi_happy():
    """正常 output が dict に parse される."""
    fake_out = 'NVIDIA GeForce GTX 1650, 41, 35, 18, 919, 4096, 7.41, 75.00\n'
    with patch.object(gpu_poll.subprocess, 'run', return_value=_fake_completed(fake_out)):
        result = gpu_poll.query_nvidia_smi()
    assert result is not None
    assert result['name'] == 'NVIDIA GeForce GTX 1650'
    assert result['temperature.gpu'] == '41'
    assert result['fan.speed'] == '35'
    assert result['power.draw'] == '7.41'
    assert 'ts' in result  # timestamp が入っている


def test_query_nvidia_smi_not_found():
    """nvidia-smi が無い環境では None 返す."""
    with patch.object(gpu_poll.subprocess, 'run', side_effect=FileNotFoundError):
        result = gpu_poll.query_nvidia_smi()
    assert result is None


def test_query_nvidia_smi_timeout():
    """timeout でも None 返す (= raise しない)."""
    with patch.object(gpu_poll.subprocess, 'run',
                      side_effect=subprocess.TimeoutExpired(cmd='nvidia-smi', timeout=2)):
        result = gpu_poll.query_nvidia_smi()
    assert result is None


def test_query_nvidia_smi_returncode_nonzero():
    """returncode 非 0 でも None 返す."""
    with patch.object(gpu_poll.subprocess, 'run',
                      return_value=_fake_completed('error', returncode=1)):
        result = gpu_poll.query_nvidia_smi()
    assert result is None


def test_main_writes_jsonl(tmp_path):
    """main が duration 内に jsonl 書く."""
    out = tmp_path / 'gpu.jsonl'
    fake_out = 'NVIDIA GeForce GTX 1650, 41, 35, 18, 919, 4096, 7.41, 75.00\n'
    with patch.object(gpu_poll.subprocess, 'run', return_value=_fake_completed(fake_out)):
        with patch.object(gpu_poll.time, 'sleep'):  # no real sleep
            with patch.object(sys, 'argv',
                              ['gpu_poll.py', '--output', str(out),
                               '--interval', '0.01', '--duration', '0',
                               '--label', 'test']):
                # duration=0 だと無限 loop なので KeyboardInterrupt を 3 回目で raise
                call_count = {'n': 0}
                orig = gpu_poll.time.sleep

                def fake_sleep(s):
                    call_count['n'] += 1
                    if call_count['n'] >= 3:
                        raise KeyboardInterrupt

                with patch.object(gpu_poll.time, 'sleep', side_effect=fake_sleep):
                    gpu_poll.main()
    lines = out.read_text().splitlines()
    assert len(lines) >= 1
    sample = json.loads(lines[0])
    assert sample['label'] == 'test'
    assert sample['temperature.gpu'] == '41'
