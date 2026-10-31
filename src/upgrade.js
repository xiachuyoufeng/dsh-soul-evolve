/**
 * upgrade.js —— 「点击升级」的后端：把本地源码目录同步到当前安装位置。
 *
 * 只替换包文件（src/*.js、package.json、cordis.patch.yml、README.md）：
 * 不动 profile 依赖、不动 generation 元数据，所以不会触发依赖重装，
 * 也不会让启动校验失败。改到的文件要重启 DSH 才会被重新加载。
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, existsSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

/** 当前安装位置：agent 侧加载的就是这个目录 */
export const INSTALL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

/** 默认源码目录（可用 DSH_SOUL_SOURCE 覆盖） */
export const DEFAULT_SOURCE = "/Users/xiachu/deepseek-harness/soul-workspace";

export function sourceDir() {
  return process.env.DSH_SOUL_SOURCE || DEFAULT_SOURCE;
}

/** 包根下需要随升级同步的文件（client.js 是浏览器半侧，漏了它面板不会更新） */
const ROOT_FILES = ["package.json", "cordis.patch.yml", "README.md", "CHANGELOG.md", "client.js"];

function srcFiles(dir) {
  return readdirSync(join(dir, "src")).filter((f) => f.endsWith(".js"));
}

export function readInfo(dir = INSTALL_DIR) {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return { name: pkg.name, version: pkg.version, dir };
  } catch {
    return null;
  }
}

/** 备份目录：与状态文件同源（DSH_SOUL_HOME 可覆盖，预检/测试用临时目录） */
export function backupRoot() {
  const base = process.env.DSH_SOUL_HOME || join(homedir(), ".dsh-soul-evolve");
  return join(base, "upgrade-backups", String(Date.now()));
}

/** 把当前安装目录的包文件复制到备份目录 */
export function backup(target = INSTALL_DIR, dest = backupRoot()) {
  mkdirSync(join(dest, "src"), { recursive: true });
  for (const rel of ROOT_FILES) {
    const p = join(target, rel);
    if (existsSync(p)) copyFileSync(p, join(dest, rel));
  }
  for (const f of srcFiles(target)) {
    copyFileSync(join(target, "src", f), join(dest, "src", f));
  }
  return dest;
}

/** 用备份覆盖回安装目录（升级失败时回滚） */
export function restore(backupDir, target = INSTALL_DIR) {
  for (const rel of ROOT_FILES) {
    const p = join(backupDir, rel);
    if (existsSync(p)) copyFileSync(p, join(target, rel));
  }
  const srcBak = join(backupDir, "src");
  if (existsSync(srcBak)) {
    for (const f of readdirSync(srcBak)) copyFileSync(join(srcBak, f), join(target, "src", f));
  }
}

/**
 * 同步：校验源 → 备份当前 → 逐文件原子写；任何一步失败用备份回滚。
 * @param {{source?: string, target?: string}} options
 */
export function syncFromSource(options = {}) {
  const source = options.source ?? sourceDir();
  const target = options.target ?? INSTALL_DIR;

  const srcInfo = readInfo(source);
  if (!srcInfo || srcInfo.name !== "dsh-soul-evolve") {
    throw new Error(`源目录不是 dsh-soul-evolve 包：${source}`);
  }
  const tgtInfo = readInfo(target);
  if (!tgtInfo || tgtInfo.name !== "dsh-soul-evolve") {
    throw new Error(`目标目录不是 dsh-soul-evolve 包：${target}`);
  }

  const saved = backup(target);
  const written = [];
  const writeAtomic = (abs, content) => {
    const tmp = `${abs}.upgrade-${process.pid}.tmp`;
    writeFileSync(tmp, content, "utf8");
    renameSync(tmp, abs);
    written.push(abs);
  };

  try {
    for (const f of srcFiles(source)) {
      writeAtomic(join(target, "src", f), readFileSync(join(source, "src", f)));
    }
    for (const rel of ROOT_FILES) {
      const p = join(source, rel);
      if (existsSync(p)) writeAtomic(join(target, rel), readFileSync(p));
    }
  } catch (err) {
    try {
      restore(saved, target);
    } catch {
      /* 回滚失败时保留原始错误，备份路径随错误信息一起返回 */
    }
    throw new Error(`同步失败（已尝试回滚，备份在 ${saved}）：${err?.message ?? err}`);
  }

  return {
    ok: true,
    source,
    target,
    from: tgtInfo.version ?? null,
    to: srcInfo.version ?? null,
    files: written.length,
    backup: saved,
    restartRequired: true,
  };
}
