/**
 * sediment.js —— 交互沉淀的编排层。
 *
 * 纯计算在 pattern.js，本文件只负责三件 IO：读观测、写人格卡、记账防重复。
 * 之所以单独一层：沉淀失败绝不能影响会话，调用方只需 try/catch 这一处。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { dataDir, readTurns } from "./trace.js";
import { MAX_PER_RUN, MIN_DAYS, MIN_SESSIONS, MIN_TURNS, evidenceKey, gateOf, mine, shouldRevalidate } from "./pattern.js";
import { buildEntry, qualifiesInferred } from "./evolve.js";
import { addEntry, loadPersonas, savePersonas } from "./persona.js";

export const PATTERNS_VERSION = 1;
/** 两次自动沉淀之间的最小间隔：避免连续几轮就把多个模式一次性写成条目 */
export const GLOBAL_COOLDOWN_DAYS = 1;

export function patternsPath() {
  return join(dataDir(), "patterns.json");
}

/** 读记账文件；损坏或缺失都当成空账本，不抛 */
export function loadPatternState() {
  try {
    const raw = JSON.parse(readFileSync(patternsPath(), "utf8"));
    if (!raw || raw.version !== PATTERNS_VERSION || typeof raw.patterns !== "object") {
      return { version: PATTERNS_VERSION, patterns: {}, lastRun: 0 };
    }
    return { version: PATTERNS_VERSION, patterns: raw.patterns ?? {}, lastRun: Number(raw.lastRun) || 0 };
  } catch {
    return { version: PATTERNS_VERSION, patterns: {}, lastRun: 0 };
  }
}

export function savePatternState(state) {
  const p = patternsPath();
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmp, p);
  return p;
}

/**
 * 只读预览：算出当前够格的模式，不写任何文件。面板与调试用。
 */
export function preview(turns = readTurns(), opts = {}) {
  const r = mine(turns, opts);
  const gates = { minSessions: opts.minSessions ?? MIN_SESSIONS, minDays: opts.minDays ?? MIN_DAYS, minTurns: opts.minTurns ?? MIN_TURNS };
  return {
    stats: {
      turns: r.stats.total,
      sessions: r.stats.sessions,
      days: r.stats.days,
      topScene: r.stats.topScene,
      topSceneShare: Math.round(r.stats.topSceneShare * 100) / 100,
      textMedian: r.stats.textMedian,
      turnsPerSession: r.stats.turnsPerSession,
      switchesPerSession: Math.round(r.stats.switchesPerSession * 100) / 100,
      since: r.stats.since,
      until: r.stats.until,
    },
    gates,
    ready: r.candidates
      .filter((c) => gateOf(c, gates).ok && qualifiesInferred(c, gates))
      .map((c) => ({ key: c.key, event: c.event, evidence: c.evidence })),
    blocked: r.candidates
      .filter((c) => !gateOf(c, gates).ok)
      .map((c) => ({ key: c.key, event: c.event, missing: gateOf(c, gates).missing })),
    candidates: r.candidates,
  };
}

/**
 * 跑一次沉淀：够格、未在冷却期内、且证据有变化的模式，升级成性格条目。
 *
 * @param {object} opts now / dryRun / 门槛覆盖
 * @returns {{written: Array, skipped: Array, preview: object}}
 */
export function sediment({ now = Date.now(), dryRun = false, force = false, max = MAX_PER_RUN, ...gates } = {}) {
  const p = preview(readTurns(), { now, ...gates });
  const written = [];
  const skipped = [];
  if (p.ready.length === 0) return { written, skipped, preview: p };

  const state = loadPatternState();
  // 全局冷却：自动通道一次最多一条、一天最多一轮，避免几天量一次堆出来
  if (!force && state.lastRun && now - state.lastRun < GLOBAL_COOLDOWN_DAYS * 86400000) {
    const hours = Math.ceil((state.lastRun + GLOBAL_COOLDOWN_DAYS * 86400000 - now) / 3600000);
    return { written, skipped: [{ key: "*", reason: `距上次沉淀约 ${hours} 小时，冷却中` }], preview: p };
  }
  const eligible = [];
  for (const c of p.candidates) {
    if (!gateOf(c, p.gates).ok || !qualifiesInferred(c, p.gates)) continue;
    const rec = state.patterns[c.key];
    if (rec && !shouldRevalidate(rec, now)) {
      skipped.push({ key: c.key, reason: `冷却中（${Math.ceil((Number(rec.emittedAt) + 14 * 86400000 - now) / 86400000)} 天后可再验证）` });
      continue;
    }
    eligible.push(c);
  }
  if (eligible.length === 0) return { written, skipped, preview: p };
  if (dryRun) return { written: [], skipped, preview: p, wouldWrite: eligible.map((c) => c.key) };

  // 一次最多写 max 条：宁可慢，也不要一次堆出好几条没人认过的
  for (const c of eligible.slice(0, max)) {
    let line = "";
    try {
      line = buildEntry({ date: c.date, event: c.event, learned: c.learned, next: c.next });
    } catch (err) {
      skipped.push({ key: c.key, reason: `条目不合法：${err.message}` });
      continue;
    }
    const doc = loadPersonas();
    const name = doc.active;
    const card = name ? doc.cards[name] : null;
    if (!card) {
      skipped.push({ key: c.key, reason: "没有激活的 Soul 面板" });
      continue;
    }
    const r = addEntry(card, { text: line, category: "pattern", now, evidence: c.evidence, patternKey: c.key });
    doc.cards[name] = r.card;
    doc.updatedAt = now;
    savePersonas(doc);
    state.patterns[c.key] = {
      emittedAt: now,
      evidenceKey: evidenceKey(c),
      count: (Number(state.patterns[c.key]?.count) || 0) + 1,
    };
    written.push({ key: c.key, text: line, added: r.added, weight: (r.added ? r.entry : r.hit)?.weight ?? 0 });
  }

  if (written.length > 0) {
    state.lastRun = now;
    savePatternState(state);
  }
  return { written, skipped, preview: p };
}

/** 当前已沉淀过哪些模式（面板展示用） */
export function listPatterns() {
  const state = loadPatternState();
  return Object.entries(state.patterns).map(([key, rec]) => ({ key, ...rec }));
}
