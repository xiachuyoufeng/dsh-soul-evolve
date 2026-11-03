/**
 * sediment.js —— 交互沉淀的编排层。
 *
 * 纯计算在 pattern.js，本文件只负责三件 IO：读观测、写人格卡、记账防重复。
 * 之所以单独一层：沉淀失败绝不能影响会话，调用方只需 try/catch 这一处。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { dataDir, readTurns } from "./trace.js";
import {
  DIMENSION_LABEL,
  DIMENSIONS,
  MAX_PER_RUN,
  MIN_DAYS,
  MIN_SESSIONS,
  MIN_TURNS,
  evidenceKey,
  gateOf,
  mine,
  shouldRevalidate,
} from "./pattern.js";
import { buildEntry, qualifiesInferred } from "./evolve.js";
import { addEntry, loadPersonas, savePersonas, similarity } from "./persona.js";

export const PATTERNS_VERSION = 1;
/**
 * 与面板正文/已有条目的字面相似度达到这个值，就认为「已经写过了」。
 * 0.3 是实测出来的：同一句话说法的重述落在 45%（"默认短，够用就停" vs
 * "默认短：够用就停（用户明确嫌长过）"），而真实候选撞面板最高只有 9%。
 * 取 0.3 两边都留了余量。
 */
export const COVERED_THRESHOLD = 0.3;
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
 * 记忆插件写下的 markdown 条目（只读，尽力而为）。
 *
 * 为什么要读对方：两个插件各写各的，但都在改同一份「该怎么做事」。memory 存的
 * 是用户明说过的偏好，soul 存的是统计出来的模式——不查对方就会各写一条同义结论。
 * 读不到（对方改布局、路径不同）就当作没有，不报错、不阻断沉淀。
 */
export function memoryLines() {
  const roots = [];
  if (process.env.DSH_MEMORIES_DIR) roots.push(process.env.DSH_MEMORIES_DIR);
  const home = homedir();
  roots.push(
    join(home, "Library", "Application Support", "dsh-desktop", "harness", "memories"),
    join(home, ".dsh", "memories"),
    join(home, ".local", "share", "dsh-desktop", "harness", "memories")
  );
  const out = [];
  for (const root of roots) {
    for (const file of ["MEMORY.md", "USER.md", "MEMORY-archive.md", "USER-archive.md"]) {
      let text = "";
      try {
        text = readFileSync(join(root, file), "utf8");
      } catch {
        continue;
      }
      for (const raw of text.split("\n")) {
        // 去掉列表符号与自动盖上的时间戳前缀，只留内容
        const line = raw.replace(/^[-*\s#]+/, "").replace(/^\[\d{4}-\d{2}-\d{2}\]\s*/, "").trim();
        if (line.length >= 8) out.push({ by: `记忆 ${file}`, text: line });
      }
    }
    if (out.length) break; // 找到一份就够，不跨平台重复读
  }
  return out;
}

/**
 * 这一条是不是已经有人写过了？
 *
 * 只做字面比较——它挡得住"把面板里的『默认短』换个说法再说一遍"，
 * 但挡不住语义同义、措辞完全不同的重复。所以它是护栏，不是保证：
 * 真正防重复建设靠的是「habit 轨只收带数字的观测结论」这条选型。
 */
export function coverageOf(card, c) {
  // 只比我"学到了什么/以后怎么做"这两句：event 里的数字面板不会写，比进来只会稀释相似度
  const mine = [c.learned, c.next].join(" ");
  const learnt = String(c.learned ?? "");
  const targets = [];
  for (const raw of String(card?.content ?? "").split("\n")) {
    const t = raw.replace(/^[-*\s#]+/, "").trim();
    if (t.length >= 6) targets.push({ text: t, by: "面板正文" });
  }
  for (const e of card?.entries ?? []) targets.push({ text: String(e.text ?? ""), by: "已有条目" });
  // 记忆插件那边已经写过的偏好，不再由统计重说一遍
  for (const m of memoryLines()) targets.push(m);
  let best = { sim: 0, by: "", text: "" };
  for (const t of targets) {
    // learned 单独比一遍：有些重复就发生在这一句里，混进 next 会被拉低
    const sim = Math.max(similarity(mine, t.text), similarity(learnt, t.text));
    if (sim > best.sim) best = { sim, by: t.by, text: t.text };
  }
  return best;
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
      // 命中数是推断条目的直接依据，面板要能看见；漏掉它等于让人无法核对
      reflex: { ...r.stats.reflex },
      // 按天分布：面板画活跃度柱状图，也用来判断数据是不是一天灌进来的
      daily: (r.stats.daily || []).slice(-14),
      since: r.stats.since,
      until: r.stats.until,
    },
    gates,
    dimensions: DIMENSIONS.map((d) => ({ dimension: d, label: DIMENSION_LABEL[d] })),
    ready: r.candidates
      .filter((c) => gateOf(c, gates).ok && qualifiesInferred(c, gates))
      .map((c) => ({
        key: c.key, dimension: c.dimension, event: c.event, evidence: c.evidence,
        gate: (({ have, need }) => ({ have, need }))(gateOf(c, gates)),
      })),
    blocked: r.candidates
      .filter((c) => !gateOf(c, gates).ok)
      .map((c) => {
        const g = gateOf(c, gates);
        return { key: c.key, dimension: c.dimension, event: c.event, missing: g.missing, gate: { have: g.have, need: g.need } };
      }),
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

  // 每个维度各写 max 条：习惯与表达分开推进，一边不够格不影响另一边
  const picked = [];
  const perDim = new Map();
  for (const c of eligible) {
    const used = perDim.get(c.dimension) ?? 0;
    if (used >= max) {
      skipped.push({ key: c.key, reason: `本轮 ${DIMENSION_LABEL[c.dimension] ?? c.dimension} 已写满 ${max} 条，留到下次` });
      continue;
    }
    perDim.set(c.dimension, used + 1);
    picked.push(c);
  }

  for (const c of picked) {
    const doc = loadPersonas();
    const name = doc.active;
    const card = name ? doc.cards[name] : null;
    if (!card) {
      skipped.push({ key: c.key, reason: "没有激活的 Soul 面板" });
      continue;
    }
    // 面板正文或已有条目已经说过的，不再重说一遍
    const cov = coverageOf(card, c);
    if (cov.sim >= COVERED_THRESHOLD) {
      skipped.push({ key: c.key, reason: `已被${cov.by}覆盖（相似 ${Math.round(cov.sim * 100)}%）` });
      continue;
    }
    let line = "";
    try {
      line = buildEntry({ date: c.date, event: c.event, learned: c.learned, next: c.next });
    } catch (err) {
      skipped.push({ key: c.key, reason: `条目不合法：${err.message}` });
      continue;
    }
    // 维度直接落成条目的类别：注入与面板都按它分段
    const r = addEntry(card, { text: line, category: c.dimension, now, evidence: c.evidence, patternKey: c.key });
    doc.cards[name] = r.card;
    doc.updatedAt = now;
    savePersonas(doc);
    state.patterns[c.key] = {
      emittedAt: now,
      evidenceKey: evidenceKey(c),
      count: (Number(state.patterns[c.key]?.count) || 0) + 1,
    };
    written.push({
      key: c.key,
      dimension: c.dimension,
      text: line,
      added: r.added,
      weight: (r.added ? r.entry : r.hit)?.weight ?? 0,
    });
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
