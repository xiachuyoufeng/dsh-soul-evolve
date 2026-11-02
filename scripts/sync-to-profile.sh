#!/bin/bash
# 把本包同步到 DSH profile 里已安装的副本（开发用）。
#
# 注意：这条路径只在开发时有用。公开发布版的正规做法是 `dsh plugin add`，
# 或者在插件详情的「升级」入口里点按钮（等价于 POST /dsh-soul-evolve/api/upgrade）。
#
# 用法：bash scripts/sync-to-profile.sh
# 目标目录自动探测：profiles/.generations/live/dsh-soul-evolve+<ver>+<hash>/node_modules/dsh-soul-evolve
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
HARNESS="${DSH_HARNESS_HOME:-$HOME/Library/Application Support/dsh-desktop/harness}"

echo "1/3 预检"
node "$HERE/scripts/verify-plugin.mjs" > /dev/null || { echo "预检未通过，已中止"; exit 1; }

echo "2/3 定位已安装副本"
TARGET="$(ls -d "$HARNESS"/profiles/.generations/live/dsh-soul-evolve+*/node_modules/dsh-soul-evolve 2>/dev/null | head -1 || true)"
if [ -z "${TARGET:-}" ]; then
  echo "  未找到已安装的 dsh-soul-evolve，先通过插件页安装一次" >&2
  exit 1
fi
echo "  $TARGET"

echo "3/3 备份并同步"
BK="$HERE/backup/upgrade-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BK"
cp -R "$TARGET" "$BK/dsh-soul-evolve.bak"

rm -rf "$TARGET/src"
cp -R "$HERE/src" "$HERE/client.js" "$HERE/templates" "$HERE/package.json" \
      "$HERE/cordis.patch.yml" "$HERE/README.md" "$HERE/CHANGELOG.md" "$HERE/LICENSE" "$TARGET/"

echo "  已同步，备份在 $BK"
echo "  重启 DSH 生效"
