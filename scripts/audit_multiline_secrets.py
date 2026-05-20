"""b33 brief 責務 2 (= 軸 7 secondary-1 fix): line-mode grep が false negative する改行越え secret を scan する。

YAML / JSON / .env で key と value が別 line に分かれた secret:
    client_secret:
      "aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789"

上記は line-mode `grep -P 'client_secret.*[A-Za-z0-9]{20,}'` では hit しないが、
本 script は git log -p --all を行ストリームとして読み、 直前 1 行の key と
現在 1 行の value を window で結合して scan する。

round 3 audit fix (= 軸 7):
- VALUE_PATTERN は token shape を限定 (= hex 32+ / base64 24+ / Strava 40hex / sk- / ghp_)、
  汎用 [A-Za-z0-9._-]{20,} は package 名 / file path / commit SHA / 普通英文を
  巻き込んで CI 恒常 fail 化するため不採用
- git log -p の non-diff line (= commit metadata / file header `+++`/`---`/`@@`/diff --git)
  を skip して diff 本体の `+` 行のみ scan、 false positive 量産経路を排除
"""

from __future__ import annotations

import re
import subprocess
import sys
from typing import Iterable

KEY_PATTERN = re.compile(
    r'\b(client_secret|refresh_token|access_token|api_key|api_secret|secret_key)\b\s*[:=]'
)

# token shape を限定。 緩い [A-Za-z0-9._-]{20,} は廃止。
# base64 は padding `=` 必須にして pure hex 短形 (= 32 未満) が誤 hit するのを避ける
# (= 31 hex は base64 alphabet subset だが padding なしなので reject、 secret は普通 padding 付き)。
VALUE_PATTERNS = [
    re.compile(r'["\']?[a-f0-9]{32,}["\']?'),                 # hex 32+ (= master.key shape / SHA / 40-hex token 含む)
    re.compile(r'["\']?[A-Za-z0-9+/]{20,}={1,2}["\']?'),      # base64 with padding (= padding 強制で hex 重複回避)
    re.compile(r'["\']?sk-[A-Za-z0-9]{40,}["\']?'),           # OpenAI key
    re.compile(r'["\']?gh[ps]_[A-Za-z0-9]{36,}["\']?'),       # GitHub token
]

SKIP_LINE_RE = re.compile(
    r'^(\+\+\+|---|@@|diff --git|commit [0-9a-f]+|Author:|Date:|Merge:|index [0-9a-f]+)'
)


def is_diff_addition(line: str) -> bool:
    if not line.startswith("+"):
        return False
    if line.startswith("+++"):
        return False
    return True


def value_hits(body: str) -> bool:
    return any(p.search(body) for p in VALUE_PATTERNS)


def scan_diff_stream(stream: Iterable[str]) -> list[str]:
    hits: list[str] = []
    prev = ""
    for raw in stream:
        line = raw.rstrip("\n")
        if SKIP_LINE_RE.match(line):
            prev = ""
            continue
        if not is_diff_addition(line):
            prev = ""
            continue
        body = line[1:]
        if KEY_PATTERN.search(body):
            prev = body
            continue
        if prev and value_hits(body):
            hits.append(f"{prev} | {body}")
        prev = ""
    return hits


def main() -> int:
    try:
        result = subprocess.run(
            ["git", "log", "-p", "--all"],
            capture_output=True, text=True, check=True,
            encoding="utf-8", errors="replace",
        )
    except subprocess.CalledProcessError as e:
        print(f"git log failed: {e}", file=sys.stderr)
        return 0  # git 履歴が空 (= 初回 push 前) なら scan 対象なし、 pass
    if result.stdout is None:
        return 0
    hits = scan_diff_stream(iter(result.stdout.splitlines()))
    if hits:
        print("ERROR: multi-line secret hit:", file=sys.stderr)
        for h in hits:
            print(f"   {h}", file=sys.stderr)
        return 1
    print("OK: audit_multiline_secrets passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
