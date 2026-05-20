#!/usr/bin/env bash
# b33 brief 責務 2 (= 軸 7 secondary-3 fix): CI 側 audit。
# pre-commit / pre-push hook が --no-verify で skip された場合の二重 gate。
# 同じ regex 群を git log -p --all 全範囲に対して再走査する。
# 追加: python helper audit_multiline_secrets.py で line-mode grep が false negative する
#       改行越え secret も覆う (= 軸 7 secondary-1 fix)。
set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

# scan range: default は origin/main / origin/master からの diff、 fallback で最近 20 commit。
# 全 history scan (= --full) は b34 § 経路 C で別途、 b33 の audit は「これから landing する物」 を gate する。
# 既存 history (= 2026-05-19 漏洩、 baseline 2ba47ed 以前) の漏洩は exception (= scope 外)。
SCAN_FLAG="${1:-}"
if [ "$SCAN_FLAG" = "--full" ]; then
  SCAN_RANGE=""  # 全 history
  echo "ℹ audit_history.sh: full history scan (--full)"
else
  # origin/main / origin/master を base に diff、 ない場合は HEAD~20
  base=""
  for candidate in main master; do
    if git rev-parse --verify "origin/$candidate" >/dev/null 2>&1; then
      base="origin/$candidate"
      break
    fi
  done
  if [ -z "$base" ]; then
    # remote 未確立 (= 初回 push 前) なら最近 20 commit
    SCAN_RANGE="HEAD~20..HEAD"
    git rev-parse --verify HEAD~20 >/dev/null 2>&1 || SCAN_RANGE="HEAD"
  else
    SCAN_RANGE="$base..HEAD"
  fi
  echo "ℹ audit_history.sh: scanning range $SCAN_RANGE"
fi

# 既知の正規パターン / 自己 test fixture / 過去 history は scan 対象外 (= b34 § 経路 C で別途)
EXCLUDE_ARGS=(
  ':!web/lib/strava_oauth.js'
  ':!web/lib/strava_upload.js'
  ':!web/oauth-callback.html'
  ':!tests/test_pre_commit_hook.py'
  ':!tests/test_pre_push_hook.py'
  ':!tests/test_audit_history.py'
  ':!scripts/hooks/pre-commit'
  ':!scripts/hooks/pre-push'
  ':!scripts/audit_history.sh'
  ':!scripts/audit_multiline_secrets.py'
  ':!rails-app/'
  ':!.agents/'
  ':!docs/'
)

fail=0
check() {
  local pattern="$1"
  local label="$2"
  local out
  if [ -z "$SCAN_RANGE" ]; then
    out=$(git log -p --all -- "${EXCLUDE_ARGS[@]}" 2>/dev/null)
  else
    out=$(git log -p $SCAN_RANGE -- "${EXCLUDE_ARGS[@]}" 2>/dev/null)
  fi
  # diff body の `+` 行のみ scan (= commit SHA / metadata 誤 hit 排除)
  if echo "$out" | grep '^+' | grep -v '^+++' | grep -P "$pattern" > /dev/null; then
    echo "ERROR: audit_history fail: $label" >&2
    fail=1
  fi
}

# pre-commit / pre-push hook と同一の regex set
check 'strava\.com/oauth' "Strava OAuth URL"
check '\b[a-f0-9]{40}\b' "40-hex token (Strava-shape)"
check 'Bearer\s+[A-Za-z0-9._-]{20,}' "Bearer token"
check 'sk-[A-Za-z0-9]{40,}' "OpenAI key shape"
check 'gh[ps]_[A-Za-z0-9]{36,}' "GitHub token"
check "(client_secret|refresh_token|access_token|api_key|api_secret)[\"'\\s:=]+[A-Za-z0-9._-]{20,}" "secret key=value"

# secret file 名 (= path で scan、 同じく SCAN_RANGE 内のみ + EXCLUDE_ARGS 適用)
files_in_range() {
  if [ -z "$SCAN_RANGE" ]; then
    git log --all --name-only --pretty=format: -- "${EXCLUDE_ARGS[@]}" 2>/dev/null
  else
    git log $SCAN_RANGE --name-only --pretty=format: -- "${EXCLUDE_ARGS[@]}" 2>/dev/null
  fi
}
if files_in_range | sort -u | grep -P '(^|/)(\.env(\.local|\.production|\.development\.local|\.test)?$|master\.key$|credentials\.yml\.enc$|config/credentials/.+\.yml\.enc$)' > /dev/null; then
  echo "ERROR: audit_history fail: secret file path in scanned range" >&2
  fail=1
fi

# 配布元再配布禁止 path
if files_in_range | sort -u | grep -P '^web/static/tiles/' > /dev/null; then
  echo "ERROR: audit_history fail: redistribution-restricted tile path in scanned range" >&2
  fail=1
fi

# multi-line scan (= YAML / JSON 改行越え secret、 軸 7 secondary-1 fix)
python3 "$REPO_ROOT/scripts/audit_multiline_secrets.py" || fail=1

if [ $fail -eq 1 ]; then
  echo "" >&2
  echo "audit_history.sh blocked: fix the leak (or revert the offending commit) and re-push" >&2
  exit 1
fi
echo "OK: audit_history passed"
