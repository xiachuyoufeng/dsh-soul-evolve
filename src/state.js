/**
 * state.js —— 人格状态存储
 * schema 带版本；原子写入；衰减与夹紧为纯函数。
 */
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

export const STATE_VERSION = 2;

/* ---------------- 状态作用域 ---------------- */

/**
 * global（默认）：跨项目同一份状态，人格连续。
 * workspace：每个工作目录一份状态，项目之间互不串味。
 *
 * 做成可切换而不是二选一，是因为两种诉求都真：跨项目身份连续要 global，
 * 但同时跑几个不相干的活时，情绪被别的项目牵动又很怪。
 */
let scopeMode = "global";

export function setStateScope(mode) {
  const next = mode === "workspace" ? "workspace" : "global";
  scopeMode = next;
  return next;
}

export function getStateScope() {
  return scopeMode;
}

export function baseDir() {
  return process.env.DSH_SOUL_HOME || join(homedir(), ".dsh-soul-evolve");
}

/** 状态实际所在目录（workspace 模式下按 cwd 哈希分桶） */
export function scopeDir() {
  const base = baseDir();
  if (scopeMode !== "workspace") return base;
  const cwd = process.cwd();
  const hash = createHash("sha1").update(cwd).digest("hex").slice(0, 8);
  return join(base, "workspaces", hash);
}

export function defaultState(now = Date.now()) {
  return {
    version: STATE_VERSION,
    mood: { valence: 0, arousal: 0.4 },
    energy: 0.6,
    intimacy: 0.1,
    focus: 0.5,
    /** 场景状态：当前场景 + 滞回用的连续占优计数（v0.8 起） */
    scene: { current: "work", candidate: null, streak: 0 },
    updatedAt: now,
    events: [],
    milestones: [],
  };
}

export function statePath() {
  return join(scopeDir(), "state.json");
}

/** 改名前的旧状态路径（0.3.0 及以前叫 dsh-soul）；只在未显式指定 DSH_SOUL_HOME 时回退读取 */
export function legacyStatePath() {
  if (process.env.DSH_SOUL_HOME) return null;
  // workspace 模式下不读全局旧文件，避免把别的项目的状态当成这个项目的
  if (scopeMode === "workspace") return null;
  return join(homedir(), ".dsh-soul", "state.json");
}

/** 时间衰减：不聊会淡，情绪回中位；亲密不倒退 */
export function decay(state, now = Date.now(), tauMs = 1000 * 60 * 60 * 12) {
  const elapsed = Math.max(0, now - state.updatedAt);
  // 隔了 6 小时以上不再算"同一段连续对话"，场景滞回的连续计数清零
  const sceneBase =
    state.scene && elapsed > 6 * 60 * 60 * 1000 ? { ...state.scene, streak: 0, candidate: null } : state.scene;
  if (elapsed < 60_000) return { ...state, scene: sceneBase, updatedAt: now };
  const k = Math.exp(-elapsed / tauMs);
  const pull = (v, target) => target + (v - target) * k;
  return {
    ...state,
    mood: { valence: pull(state.mood.valence, 0), arousal: pull(state.mood.arousal, 0.35) },
    energy: pull(state.energy, 0.65),
    focus: pull(state.focus, 0.5),
    intimacy: state.intimacy,
    scene: sceneBase,
    updatedAt: now,
  };
}

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

export function applyDelta(state, delta, now = Date.now()) {
  return {
    ...state,
    mood: {
      valence: clamp(state.mood.valence + (delta.valence ?? 0), -1, 1),
      arousal: clamp(state.mood.arousal + (delta.arousal ?? 0)),
    },
    energy: clamp(state.energy + (delta.energy ?? 0)),
    intimacy: clamp(state.intimacy + (delta.intimacy ?? 0)),
    focus: clamp(state.focus + (delta.focus ?? 0)),
    updatedAt: now,
  };
}

export function pushEvent(state, event, maxEvents = 50) {
  return { ...state, events: [...state.events, event].slice(-maxEvents) };
}

/** 结构迁移：未来加字段在此升版，保证老文件能打开 */
export function migrate(raw) {
  if (!raw || typeof raw !== "object") return defaultState();
  let s = { ...raw };
  if (!s.version || s.version < 1) s = { ...defaultState(), ...s, version: 1 };
  if (s.version < 2) {
    // v1 → v2：补场景状态；老文件没有 scene，一律从默认 work 起
    s = { ...s, version: 2, scene: s.scene && typeof s.scene === "object" ? s.scene : defaultState().scene };
  }
  if (s.version > STATE_VERSION) {
    throw new Error(`state version ${s.version} 高于插件支持的 ${STATE_VERSION}`);
  }
  return s;
}

/** 读取状态；新路径没有文件时回退读改名前的旧路径（下次保存会写到新路径） */
export async function loadState(now = Date.now()) {
  try {
    const raw = JSON.parse(await readFile(statePath(), "utf8"));
    return decay(migrate(raw), now);
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.warn("[dsh-soul-evolve] 状态读取失败，使用默认状态:", err.message);
      return defaultState(now);
    }
    const legacy = legacyStatePath();
    if (legacy) {
      try {
        const raw = JSON.parse(await readFile(legacy, "utf8"));
        return decay(migrate(raw), now);
      } catch {
        /* 没有旧状态，走默认 */
      }
    }
    return defaultState(now);
  }
}

export async function saveState(state) {
  const p = statePath();
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
  await rename(tmp, p);
  return p;
}

/**
 * 同步读取状态（提示词组装与面板 GET 用）：
 * 先读新路径，缺失时回退改名前的旧路径；读失败/损坏一律回落默认状态，绝不抛。
 */
export function readStateSync(now = Date.now()) {
  for (const p of [statePath(), legacyStatePath()]) {
    if (!p) continue;
    try {
      return decay(migrate(JSON.parse(readFileSync(p, "utf8"))), now);
    } catch {
      /* 试下一个候选 */
    }
  }
  return defaultState(now);
}
