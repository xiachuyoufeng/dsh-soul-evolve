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

/**
 * 源码目录：只认两处，都指向"这台机器上真的有源码"的情形。
 *
 * 1. `DSH_SOUL_SOURCE` 环境变量（显式指定）
 * 2. 已装副本的 generation.json 写着 `sourceSpec: "link:<某目录>"`——只有用
 *    「添加插件 → 本地目录」装进来的包才是这样；从 npm 装的包这里写的是版本号。
 *
 * 所以公开发布版里，普通用户的 `/api/status` 拿到 source: null，面板不渲染
 * 升级区块；开发者照旧能用，且不需要在代码里硬编码任何路径。
 */
export function sourceDir() {
  const env = process.env.DSH_SOUL_SOURCE?.trim();
  if (env) return env;

  try {
    // <generation>/node_modules/dsh-soul-evolve → <generation>
    const generationDir = dirname(dirname(INSTALL_DIR));
    const meta = JSON.parse(readFileSync(join(generationDir, "generation.json"), "utf8"));
    const spec = String(meta?.sourceSpec ?? "");
    const m = /^(?:link|file):(.+)$/.exec(spec);
    if (!m) return null;
    const dir = m[1].trim();
    return dir || null;
  } catch {
    return null;
  }
}

/** 源码升级是否可用：源码目录存在且确实是个 dsh-soul-evolve 包 */
export function sourceAvailable() {
  const dir = sourceDir();
  if (!dir || !existsSync(dir)) return false;
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return pkg.name === "dsh-soul-evolve";
  } catch {
    return false;
  }
}

/** 包根下需要随升级同步的文件（client.js 是浏览器半侧，漏了它面板不会更新） */
const ROOT_FILES = ["package.json", "cordis.patch.yml", "README.md", "CHANGELOG.md", "client.js"];

function srcFiles(dir) {
  return readdirSync(join(dir, "src")).filter((f) => f.endsWith(".js"));
}

export function readInfo(dir = INSTALL_DIR) {
  if (!dir) return null;
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

  if (!source) {
    throw Object.assign(
      new Error("未配置源码目录：这个升级通道只在开发时可用，需要设置环境变量 DSH_SOUL_SOURCE 指向本包源码"),
      { status: 400 },
    );
  }

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
