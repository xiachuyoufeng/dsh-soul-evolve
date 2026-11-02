#!/bin/bash
# 首次发布 / 后续版本发布到 npm。在系统终端里跑，不需要 sudo。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "1/4 预检"
node --test test/soul.test.js > /dev/null 2>&1 || { echo "单元测试未通过，已中止"; exit 1; }
node scripts/verify-plugin.mjs > /dev/null 2>&1 || { echo "预检未通过，已中止"; exit 1; }
echo "  单测 + 预检通过"

echo "2/4 打包清单"
npm pack --dry-run 2>&1 | grep -E "notice (total files|package size)"
read -r -p "  确认发布？(y/N) " ok
[ "$ok" = "y" ] || { echo "已取消"; exit 0; }

echo "3/4 登录（已登录会自动跳过）"
npm whoami > /dev/null 2>&1 || npm login --auth-type=legacy

echo "4/4 发布"
npm publish --access public
echo
echo "完成。市场条目补 npm 字段后，安装命令就是：dsh plugin add dsh-soul-evolve"
