#!/usr/bin/env bash
# b36 配布元境界規律 ── pre-commit hook 物理 gate の install script。
# package.json `scripts.prepare` から `npm install` 時に自動実行、 fork 開発者が
# clone 後に何もしなくても hook が install される form。 既存 b34
# scripts/install-protected-pre-push.sh の延長 pattern。
#
# install 内容:
#   1. distributor courtesy gate の break-verify コメント物理 gate (= `// BREAK-VERIFY:`)
#   2. Issue close = docs/distributor-watch.md commit の物理 gate (= commit message `closes #N` + docs update の AND)
#
# 詳細: ~/.agents/scratch/fujihc-trainer-project/b36-tile-distributor-courtesy.md § 直すこと 3a, 6

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK_PATH="$REPO_ROOT/.git/hooks/pre-commit"
EXISTING_HOOK=""
if [ -f "$HOOK_PATH" ]; then
  EXISTING_HOOK="$(cat "$HOOK_PATH")"
fi

# 既存 hook (= b33/b34 由来) を保持しつつ、 b36 gate を append する idempotent install。
B36_MARKER="# === b36 courtesy gate (auto-installed by scripts/install-courtesy-gate-hook.sh) ==="
if echo "$EXISTING_HOOK" | grep -q "$B36_MARKER"; then
  echo "[b36] courtesy gate already installed, skip"
  exit 0
fi

mkdir -p "$REPO_ROOT/.git/hooks"
cat >> "$HOOK_PATH" <<'EOF'

# === b36 courtesy gate (auto-installed by scripts/install-courtesy-gate-hook.sh) ===
# b36 物理 gate 1: distributor_courtesy_gate.test.js を touch した時、 全 test 関数に
# `// BREAK-VERIFY:` コメントが含まれることを require (= 真正性確認の物理化)。
STAGED_GATE=$(git diff --cached --name-only | grep -E '^web/tests/distributor_courtesy_gate\.test\.js$' || true)
if [ -n "$STAGED_GATE" ]; then
  STAGED_CONTENT=$(git show ":$STAGED_GATE" 2>/dev/null || cat "$STAGED_GATE")
  TEST_COUNT=$(echo "$STAGED_CONTENT" | grep -cE "^\s+it\(" || echo 0)
  BREAK_COUNT=$(echo "$STAGED_CONTENT" | grep -cE "BREAK-VERIFY:" || echo 0)
  if [ "$BREAK_COUNT" -lt "$TEST_COUNT" ]; then
    echo "[b36] distributor_courtesy_gate.test.js: 全 test 関数に // BREAK-VERIFY: コメントが必要 (= $BREAK_COUNT / $TEST_COUNT)"
    echo "[b36] 真正性確認の物理 gate、 各 test が壊した時の検証手順を 1 行コメントで残せ"
    exit 1
  fi
fi

# b36 物理 gate 2: commit message に `closes #N` を含む時、 docs/distributor-watch.md の
# last_reviewer / last_reviewed_at 更新が staged 変更に含まれることを require。
COMMIT_MSG_FILE="${1:-}"
if [ -n "$COMMIT_MSG_FILE" ] && [ -f "$COMMIT_MSG_FILE" ]; then
  if grep -qE 'closes\s+#[0-9]+' "$COMMIT_MSG_FILE"; then
    DOCS_STAGED=$(git diff --cached --name-only | grep -E '^docs/distributor-watch\.md$' || true)
    if [ -z "$DOCS_STAGED" ]; then
      echo "[b36] commit message に 'closes #N' を含む時は docs/distributor-watch.md 更新が必須"
      echo "[b36] Issue close と docs commit の pair 規律 (= 軸 6 物理 gate)"
      exit 1
    fi
    DOCS_DIFF=$(git diff --cached docs/distributor-watch.md)
    if ! echo "$DOCS_DIFF" | grep -qE 'last_reviewer:|last_reviewed_at:'; then
      echo "[b36] docs/distributor-watch.md の last_reviewer / last_reviewed_at 更新が必須"
      exit 1
    fi
  fi
fi
EOF

chmod +x "$HOOK_PATH"
echo "[b36] courtesy gate installed to $HOOK_PATH"
