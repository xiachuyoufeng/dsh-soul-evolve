#!/bin/bash
# 把当前工作区的插件同步到 DSH profile 的安装目录（需要写权限）
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PROF="/Users/xiachu/Library/Application Support/dsh-desktop/harness/profiles/web"
TARGET="$PROF/node_modules/dsh-soul"

echo "1/3 预检"
node "$HERE/scripts/verify-plugin.mjs" > /dev/null || { echo "预检未通过，已中止"; exit 1; }

echo "2/3 备份现有安装"
if [ -d "$TARGET" ]; then
  BK="$HERE/backup/$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$BK"
  cp -R "$TARGET" "$BK/dsh-soul.bak"
  cp "$PROF/package.json" "$BK/package.json.bak"
  echo "  备份到 $BK"
fi

echo "3/3 同步"
rm -rf "$TARGET"
mkdir -p "$TARGET"
cp -R "$HERE/src" "$HERE/package.json" "$HERE/cordis.patch.yml" "$HERE/README.md" "$TARGET/"
node -e '
const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const b=p.dsh.profile.bundles; if(!b.includes("dsh-soul")) b.push("dsh-soul");
fs.writeFileSync(process.argv[1],JSON.stringify(p,null,2)+"\n");
' "$PROF/package.json"
echo "同步完成。重启 DSH 后生效。"
