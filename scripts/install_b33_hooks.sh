#!/usr/bin/env bash
# b33 brief 責務 2: pre-commit + pre-push hook を install する setup script。
# CLAUDE.md Rule 9 (= 物理層 gate): commit / push を regex で block する。
#
# ~/scripts/install-protected-pre-push.sh は「全 push を hard exit 1 で止める」 用途
# (= sensitive class repo、 例: private_data / places-map / strava-collector)、
# 本 script は「regex 違反だけ block + 正常 push は通す」 という semantic 違い。
# このため共通化せず、 b33 で独立 script を持つ。
#
# 冪等性 (= b33 brief 軸 6 fix):
#  - 既存 hook あり (= 別 source) → .bak.<timestamp> に backup してから上書き
#  - 既存 hook が本 script 由来 (= "Auto-installed by scripts/install_b33_hooks.sh" 含む)
#    → 上書きするが backup は作らない (= 連続実行で .bak が増えない)
#
# 使い方: bash scripts/install_b33_hooks.sh
# 解除: rm .git/hooks/pre-commit .git/hooks/pre-push
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
SRC_DIR="$REPO_ROOT/scripts/hooks"

# core.hooksPath を respect (= user が global で別 path に設定済の場合)
CONFIGURED_HOOKS_PATH=$(git config --get core.hooksPath 2>/dev/null || echo "")
if [ -n "$CONFIGURED_HOOKS_PATH" ]; then
  # core.hooksPath は absolute or repo-relative
  case "$CONFIGURED_HOOKS_PATH" in
    /*|[A-Za-z]:/*|[A-Za-z]:\\*) HOOKS_DIR="$CONFIGURED_HOOKS_PATH" ;;
    *) HOOKS_DIR="$REPO_ROOT/$CONFIGURED_HOOKS_PATH" ;;
  esac
  echo "ℹ Using core.hooksPath: $HOOKS_DIR"
else
  HOOKS_DIR="$REPO_ROOT/.git/hooks"
fi
mkdir -p "$HOOKS_DIR"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
MARKER="Auto-installed by scripts/install_b33_hooks.sh"

install_one() {
  local name="$1"
  local src="$SRC_DIR/$name"
  local dst="$HOOKS_DIR/$name"
  if [ ! -f "$src" ]; then
    echo "ERROR: source hook not found: $src" >&2
    return 1
  fi
  if [ -e "$dst" ]; then
    if grep -q "$MARKER" "$dst" 2>/dev/null; then
      : # 自分由来、 backup 不要
    else
      cp "$dst" "$dst.bak.$TIMESTAMP"
      echo "✓ backed up existing hook: $dst.bak.$TIMESTAMP"
    fi
  fi
  cp "$src" "$dst"
  chmod +x "$dst"
  echo "✓ installed: $dst"
}

install_one pre-commit
install_one pre-push

echo ""
echo "done. To uninstall:"
echo "  rm $HOOKS_DIR/pre-commit $HOOKS_DIR/pre-push"
echo ""
echo "Note: --no-verify を override に使うのは git の標準機能 (= hashbang で塞げない)、"
echo "      CI 側 audit.yml (= GitHub Actions) で同じ regex を二重走査することで実効防御。"
