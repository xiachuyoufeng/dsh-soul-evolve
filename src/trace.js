/**
 * trace.js —— 每轮观测（只追加 JSONL）。
 *
 * 目的：让"改好了没有"从感觉变成数字。没有这一层，
 * 「工作/闲聊温差 > 0.15」这类验收标准根本算不出来。
 *
 * 存储：`~/.dsh-soul-evolve/turns.jsonl`（DSH_SOUL_HOME 可覆盖）
 *
 * 三条硬约束：
 * 1. 去重 —— 提示词渲染函数在一次请求里可能被调用多次（重试、多轮组装），
 *    不去重会把行数翻倍，统计全失真。按 (sid, 秒级时间, 输入长度) 去重。
 * 2. 绝不影响注入 —— 任何异常静默吞掉，trace 挂了也必须正常出提示词。
 * 3. 轮转 —— 超过 2 MB 或 5000 行就把当前文件挪成 turns.1.jsonl（只留 1 份历史）。
 */
import { appendFileSync, statSync, renameSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_LINES = 5000;
const DEDUPE_CAP = 500;

/** 与 persona.js 保持一致的数据目录（不 import 是为了避免模块间互相牵连） */
export function dataDir() {
  return process.env.DSH_SOUL_HOME || join(homedir(), ".dsh-soul-evolve");
}

export function tracePath() {
  return join(dataDir(), "turns.jsonl");
}

export function rotatePath() {
  return join(dataDir(), "turns.1.jsonl");
}

/* ---------------- 去重缓存 ---------------- */

const seen = new Set();
const seenOrder = [];

export function resetTraceCache() {
  seen.clear();
  seenOrder.length = 0;
}

function dedupeKey(sid, t, textLen) {
  return `${sid}|${Math.floor(t / 1000)}|${textLen}`;
}

/* ---------------- 轮转 ---------------- */

function rotateIfNeeded(path) {
  try {
    if (!existsSync(path)) return;
    const { size } = statSync(path);
    if (size < MAX_BYTES) return;
    renameSync(path, rotatePath());
  } catch {
    /* 轮转失败不影响追加 */
  }
}

function lineCountExceeded(path) {
  try {
    if (!existsSync(path)) return false;
    const text = readFileSync(path, "utf8");
    let n = 0;
    for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) n += 1;
    return n > MAX_LINES;
  } catch {
    return false;
  }
}

/* ---------------- 记录 ---------------- */

/**
 * 追加一行观测。永不抛异常，返回是否真的写入（去重命中时返回 false）。
 * @param {object} entry { t, sid, scene, state, knobs, textLen, panelLen, reflex, note }
 */
export function recordTurn(entry = {}) {
  try {
    const t = Number(entry.t) || Date.now();
    const sid = String(entry.sid ?? "-").slice(0, 8) || "-";
    const textLen = Number(entry.textLen) || 0;

    const key = dedupeKey(sid, t, textLen);
    if (seen.has(key)) return false;
    seen.add(key);
    seenOrder.push(key);
    if (seenOrder.length > DEDUPE_CAP) seen.delete(seenOrder.shift());

    const path = tracePath();
    rotateIfNeeded(path);

    const line = {
      t,
      sid,
      scene: entry.scene ?? null,
      state: entry.state ?? null,
      knobs: entry.knobs ?? null,
      textLen,
      panelLen: Number(entry.panelLen) || 0,
      reflex: Array.isArray(entry.reflex) ? entry.reflex : [],
    };
    appendFileSync(path, `${JSON.stringify(line)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * 记录一轮用户输入的特征（供后续注入时读取）。
 * 单独存内存即可：trace 只在本进程内使用，重启后重新积累。
 */
let lastTurn = { sid: "-", textLen: 0, hits: [], at: 0, scene: null };

export function noteUserTurn({ sid, textLen, hits, at, scene } = {}) {
  lastTurn = {
    sid: String(sid ?? "-").slice(0, 8) || "-",
    textLen: Number(textLen) || 0,
    hits: Array.isArray(hits) ? hits : [],
    at: Number(at) || Date.now(),
    scene: scene ?? null,
  };
  return lastTurn;
}

export function readLastTurn() {
  return { ...lastTurn };
}

/* ---------------- 读取（给 stats 脚本用） ---------------- */

/** 读取观测记录；文件不存在时返回空数组，损坏行跳过 */
export function readTurns() {
  const out = [];
  for (const path of [rotatePath(), tracePath()]) {
    if (!existsSync(path)) continue;
    let text = "";
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        /* 损坏行跳过 */
      }
    }
  }
  return out;
}
