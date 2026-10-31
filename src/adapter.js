/**
 * adapter.js —— DSH 版本适配层：所有 DSH 内部依赖收敛于此
 */
import { createRequire } from "node:module";

const requireFromHere = createRequire(import.meta.url);
export const SUPPORTED_DSH_MAJOR = 0;

export function detectDshVersion() {
  for (const pkg of ["@deepseek-ai/dsh", "@deepseek-ai/dsh-base"]) {
    try {
      const json = requireFromHere(requireFromHere.resolve(`${pkg}/package.json`));
      if (json?.version) return { package: pkg, version: json.version };
    } catch { /* 下一候选 */ }
  }
  return null;
}

export function majorOf(version) {
  if (!version) return null;
  const n = Number.parseInt(String(version).split(".")[0], 10);
  return Number.isFinite(n) ? n : null;
}

/** 访问未 inject 的服务时 cordis 会抛 "cannot get property X without inject"，这里逐项兜住 */
function probe(ctx, get, label, warnings) {
  try { return Boolean(get()); }
  catch (err) {
    warnings.push(`能力探测跳过 ${label}：${err?.message ?? err}`);
    return false;
  }
}

export function detectCapabilities(ctx) {
  const warnings = [];
  const capabilities = {
    systemPrompt: probe(ctx, () => ctx?.systemPrompt?.section, "systemPrompt.section", warnings),
    systemPromptContext: probe(ctx, () => ctx?.systemPrompt?.context, "systemPrompt.context", warnings),
    tools: probe(ctx, () => ctx?.tools, "tools", warnings),
    events: typeof ctx?.on === "function",
    effect: typeof ctx?.effect === "function",
  };
  const version = detectDshVersion();
  const major = majorOf(version?.version);
  const versionOk = major === null || major === SUPPORTED_DSH_MAJOR;

  if (!version) warnings.push("未能探测 DSH 版本，按未知版本降级运行");
  if (!versionOk) warnings.push(`DSH 主版本 ${major} 与适配版本 ${SUPPORTED_DSH_MAJOR} 不符，已降级`);
  if (!capabilities.systemPromptContext && capabilities.systemPrompt) {
    warnings.push("systemPrompt.context 不可用，状态以静态文案注入（不随状态变化）");
  }
  if (!capabilities.systemPrompt) warnings.push("systemPrompt 服务不可用，跳过状态注入");
  if (!capabilities.tools) warnings.push("tools 服务不可用，跳过工具注册");

  return { version, major, versionOk, capabilities, degraded: !versionOk, warnings };
}

export function safeCall(warnings, fn, label) {
  try { fn(); return true; }
  catch (err) { warnings.push(`${label} 调用失败：${err?.message ?? err}`); return false; }
}
