/**
 * persona.js —— Soul 面板（soul.md 风格）。
 *
 * 存储：`~/.dsh-soul-evolve/personas.json`（DSH_SOUL_HOME 可覆盖）
 *   {
 *     version: 2,
 *     active: "默认人格",
 *     cards: {
 *       "默认人格": {
 *         content:   "手写基底（Identity / Personality / …）",
 *         entries:   [{ id, text, category, weight, lastHit, createdAt }],
 *         history:   [{ at, content }],   // 最近 10 版，可回滚
 *         updatedAt: 123
 *       }
 *     }
 *   }
 *
 * 两条硬约束：
 * 1. 正文不能含 `{{` / `}}`——那是 DSH 提示词变量语法，会让整个提示词组装失败。
 * 2. 注入有字数预算。演化条目只增不减，不加预算的话面板会一路涨到 2 万字上限，
 *    之后新条目写不进去、每轮 token 还一直在涨。所以注入按权重排序取 Top-N。
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

export const PERSONA_VERSION = 2;
export const MAX_CONTENT = 20000;
export const MAX_NAME = 40;
/** 单张卡最多存多少条演化条目（存储上限；注入另有预算） */
export const MAX_ENTRIES = 200;
/** 注入预算：整段 Soul 面板注入的字符上限 */
export const INJECT_BUDGET = 4000;
/** 每张卡保留多少个历史版本 */
export const MAX_HISTORY = 10;

const DAY = 24 * 60 * 60 * 1000;

/** 各类条目的初始权重 */
export const INITIAL_WEIGHT = {
  correction: 1.0, // 用户明确纠正 —— 满权重且不衰减
  repeat: 0.9, // 重复犯错
  preference: 0.6, // 长期偏好
  pattern: 0.45, // 交互沉淀的推断条目 —— 低权重起步，靠重复验证坐实
  scene: 0.4, // 场景相关
};

/** 半衰期（毫秒）；Infinity = 不衰减 */
export const HALF_LIFE = {
  correction: Infinity,
  repeat: Infinity,
  preference: 90 * DAY,
  pattern: 45 * DAY, // 推断错了会自己淡出，不需要有人来删
  scene: 30 * DAY,
};

export function dataDir() {
  return process.env.DSH_SOUL_HOME || join(homedir(), ".dsh-soul-evolve");
}

export function personaPath() {
  return join(dataDir(), "personas.json");
}

/** 首次安装自动种入的默认 Soul 面板名 */
export const DEFAULT_CARD_NAME = "默认人格";

/** 随包分发的默认人格模板 */
const DEFAULT_TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), "..", "templates", "default-soul.md");

/**
 * 首次安装的初始文档。
 *
 * 空面板对新用户没有意义——装完打开只看到一块空白，既不知道格式也不知道能做什么。
 * 所以种一份通用的默认人格（随包的 templates/default-soul.md）并设为激活；
 * 用户改它就是自己的了，删掉也不会再被种回来（loadPersonas 只在文件不存在时走这里）。
 */
export function defaultPersonaDoc(now = Date.now()) {
  let content = "";
  try {
    content = readFileSync(DEFAULT_TEMPLATE, "utf8").trim();
  } catch {
    return { version: PERSONA_VERSION, active: null, cards: {} };
  }
  if (!content) return { version: PERSONA_VERSION, active: null, cards: {} };
  return {
    version: PERSONA_VERSION,
    active: DEFAULT_CARD_NAME,
    cards: {
      [DEFAULT_CARD_NAME]: {
        content,
        entries: [],
        history: [],
        updatedAt: now,
      },
    },
  };
}

/* ---------------- 迁移 ---------------- */

/** 把正文末尾的 `## Evolved` 段拆出来变成结构化条目（v1 → v2） */
export function splitEvolved(content) {
  const marker = "## Evolved";
  const i = content.indexOf(marker);
  if (i < 0) return { base: content.trim(), evolved: [] };
  const base = content.slice(0, i).trim();
  const section = content.slice(i + marker.length);
  const evolved = section
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim())
    .filter(Boolean);
  return { base, evolved };
}

function guessCategory(text) {
  if (/已修正|纠正|误|不是这样/.test(text)) return "correction";
  if (/反复|又|还是/.test(text)) return "repeat";
  return "preference";
}

function migrateDoc(raw) {
  if (!raw || typeof raw !== "object") return defaultPersonaDoc();
  const cards = raw.cards && typeof raw.cards === "object" ? raw.cards : {};
  const clean = {};
  for (const [name, card] of Object.entries(cards)) {
    if (!card || typeof card.content !== "string") continue;
    const prevEntries = Array.isArray(card.entries) ? card.entries : null;
    let base = card.content;
    let entries = prevEntries ? prevEntries.map(normalizeEntry).filter(Boolean) : [];

    // v1 的演化条目写在正文的 `## Evolved` 段里，升级时搬进结构体
    if (!prevEntries) {
      const split = splitEvolved(card.content);
      base = split.base;
      entries = split.evolved.map((text, idx) =>
        normalizeEntry({ id: `e_migrate_${idx}`, text, category: guessCategory(text), weight: undefined, createdAt: card.updatedAt })
      ).filter(Boolean);
    }

    const history = Array.isArray(card.history)
      ? card.history.filter((h) => h && typeof h.content === "string").slice(-MAX_HISTORY)
      : [];
    clean[name] = {
      content: base,
      entries: entries.slice(-MAX_ENTRIES),
      history,
      updatedAt: Number(card.updatedAt) || 0,
    };
  }
  const active = typeof raw.active === "string" && clean[raw.active] ? raw.active : null;
  return { version: PERSONA_VERSION, active, cards: clean };
}

function normalizeEntry(e) {
  if (!e || typeof e.text !== "string" || !e.text.trim()) return null;
  const category = INITIAL_WEIGHT[e.category] !== undefined ? e.category : "preference";
  const createdAt = Number(e.createdAt) || Date.now();
  const weight = Number.isFinite(Number(e.weight)) ? Number(e.weight) : INITIAL_WEIGHT[category];
  const out = {
    id: String(e.id || `e_${createdAt.toString(36)}_${Math.random().toString(36).slice(2, 6)}`),
    text: e.text.trim(),
    category,
    weight: Math.min(1, Math.max(0, weight)),
    lastHit: Number(e.lastHit) || createdAt,
    createdAt,
  };
  // 推断条目带着证据指针，重载时必须保住，否则面板上就查不了依据
  const evidence = normalizeEvidence(e.evidence);
  if (evidence) out.evidence = evidence;
  if (typeof e.patternKey === "string" && e.patternKey) out.patternKey = e.patternKey;
  return out;
}

/** 证据结构校验：只留可核查的计数与时间，多一个字段都不收 */
export function normalizeEvidence(raw) {
  if (!raw || typeof raw !== "object") return null;
  const sessions = Number(raw.sessions) || 0;
  const days = Number(raw.days) || 0;
  const turns = Number(raw.turns) || 0;
  if (sessions <= 0) return null;
  return {
    sessions,
    days,
    turns,
    since: Number(raw.since) || 0,
    until: Number(raw.until) || 0,
  };
}

/* ---------------- 读写 ---------------- */

/** 同步读取（提示词组装里必须同步且不能抛） */
export function loadPersonas() {
  try {
    return migrateDoc(JSON.parse(readFileSync(personaPath(), "utf8")));
  } catch {
    return defaultPersonaDoc();
  }
}

export function savePersonas(doc) {
  const p = personaPath();
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(doc, null, 2), "utf8");
  renameSync(tmp, p);
  return p;
}

/* ---------------- 校验 ---------------- */

export function validateName(name) {
  const n = String(name ?? "").trim();
  if (!n) throw new Error("Soul 名不能为空");
  if (n.length > MAX_NAME) throw new Error(`Soul 名过长（上限 ${MAX_NAME} 字）`);
  return n;
}

function rejectVariables(text) {
  if (text.includes("{{") || text.includes("}}")) {
    throw new Error("Soul 内容不能包含 {{ 或 }}：那是 DSH 的提示词变量语法，会破坏提示词组装");
  }
  return text;
}

export function validateContent(content) {
  const text = String(content ?? "");
  if (!text.trim()) throw new Error("Soul 内容不能为空");
  if (text.length > MAX_CONTENT) throw new Error(`Soul 内容过长（上限 ${MAX_CONTENT} 字）`);
  return rejectVariables(text);
}

export function validateEntryText(text) {
  const t = String(text ?? "").trim();
  if (!t) throw new Error("演化条目不能为空");
  if (t.length > 500) throw new Error("演化条目过长（上限 500 字）");
  return rejectVariables(t);
}

/* ---------------- 权重 ---------------- */

/** 当前有效权重（按类别半衰期衰减） */
export function effectiveWeight(entry, now = Date.now()) {
  const hl = HALF_LIFE[entry.category] ?? HALF_LIFE.preference;
  if (!Number.isFinite(hl)) return entry.weight;
  const last = entry.lastHit || entry.createdAt || now;
  const elapsed = Math.max(0, now - last);
  const factor = 0.5 ** (elapsed / hl);
  return Math.round(entry.weight * factor * 1000) / 1000;
}

/** 按有效权重排序（降序） */
export function rankEntries(entries, now = Date.now()) {
  return [...entries]
    .map((e) => ({ ...e, effective: effectiveWeight(e, now) }))
    .sort((a, b) => b.effective - a.effective || b.createdAt - a.createdAt);
}

/* ---------------- 相似度（写入时判重，取代逐轮语义匹配） ---------------- */

const STOP = new Set(["的", "了", "是", "在", "我", "你", "他", "和", "就", "不", "也", "都", "要", "会", "有"]);

function tokens(text) {
  const out = new Set();
  const t = String(text);
  for (const word of t.match(/[a-zA-Z0-9_]+/g) ?? []) if (word.length > 2) out.add(word.toLowerCase());
  const cjk = t.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const seg of cjk) {
    for (let i = 0; i < seg.length - 1; i += 1) {
      const bi = seg.slice(i, i + 2);
      if (!STOP.has(bi[0]) || !STOP.has(bi[1])) out.add(bi);
    }
  }
  return out;
}

/** Jaccard 相似度 0..1 */
export function similarity(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}

export const SIMILAR_THRESHOLD = 0.5;

/* ---------------- 条目操作 ---------------- */

/**
 * 加一条演化条目。
 * 若同类别里已有高度相似的条目，视为"再次命中"：旧条目权重 +0.1，不新增。
 * @returns {{added: boolean, entry?: object, hit?: object}}
 */
export function addEntry(card, { text, category = "preference", now = Date.now(), evidence = null, patternKey = "" } = {}) {
  const t = validateEntryText(text);
  const cat = INITIAL_WEIGHT[category] !== undefined ? category : "preference";
  const ev = normalizeEvidence(evidence);
  const entries = Array.isArray(card.entries) ? [...card.entries] : [];

  let best = null;
  let bestSim = 0;
  for (const e of entries) {
    if (e.category !== cat) continue;
    // 同一条模式重新验证时按 key 收敛，避免措辞漂移导致重复条目
    if (cat === "pattern" && patternKey && e.patternKey === patternKey) {
      best = e;
      bestSim = 1;
      break;
    }
    const s = similarity(e.text, t);
    if (s > bestSim) {
      bestSim = s;
      best = e;
    }
  }

  if (best && bestSim >= SIMILAR_THRESHOLD) {
    const idx = entries.findIndex((e) => e.id === best.id);
    entries[idx] = {
      ...best,
      weight: Math.min(1, Math.round((best.weight + 0.1) * 100) / 100),
      lastHit: now,
      ...(ev ? { evidence: ev } : {}),
      ...(patternKey ? { patternKey } : {}),
    };
    return { added: false, hit: entries[idx], card: { ...card, entries } };
  }

  const entry = {
    id: `e_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    text: t,
    category: cat,
    weight: INITIAL_WEIGHT[cat],
    lastHit: now,
    createdAt: now,
    ...(ev ? { evidence: ev } : {}),
    ...(patternKey ? { patternKey } : {}),
  };
  const next = [...entries, entry].slice(-MAX_ENTRIES);
  return { added: true, entry, card: { ...card, entries: next } };
}

export function removeEntry(card, id) {
  const entries = (card.entries ?? []).filter((e) => e.id !== id);
  if (entries.length === (card.entries ?? []).length) throw new Error(`没有条目「${id}」`);
  return { ...card, entries };
}

/* ---------------- 渲染 ---------------- */

/**
 * 渲染一张卡为注入文本。
 * 正文（手写基底）优先完整保留；剩余预算按权重给演化条目，超出的截断。
 * @returns {{text: string, injected: string[], truncated: string[], used: number}}
 */
export function renderCard(card, { budget = INJECT_BUDGET, now = Date.now() } = {}) {
  const header = "## Soul 面板";
  const body = (card.content ?? "").trim();
  if (!body) return { text: "", injected: [], truncated: [], used: 0 };

  const parts = [header, "", body];
  let used = header.length + 2 + body.length;

  const ranked = rankEntries(card.entries ?? [], now);
  const injected = [];
  const truncated = [];

  if (ranked.length) {
    const evolveHeader = "\n\n## Evolved";
    let lines = [];
    let lineCost = evolveHeader.length;
    for (const e of ranked) {
      const line = `- ${e.text}`;
      const cost = line.length + 1;
      if (used + lineCost + cost <= budget) {
        lines.push(line);
        lineCost += cost;
        injected.push(e.id);
      } else {
        truncated.push(e.id);
      }
    }
    if (lines.length) {
      parts.push("", "## Evolved", ...lines);
      used += lineCost;
    }
  }

  return { text: parts.join("\n"), injected, truncated, used };
}

/** 渲染成注入提示词的段落；没有激活卡时返回空串（DSH 会跳过空段） */
export function renderPersonaSection(doc = loadPersonas(), opts = {}) {
  if (!doc.active) return "";
  const card = doc.cards[doc.active];
  if (!card) return "";
  return renderCard(card, opts).text;
}

/** 供 context.text 使用的同步读取入口 */
export function readActivePersona() {
  return renderPersonaSection(loadPersonas());
}

/* ---------------- 写入与历史 ---------------- */

function pushHistory(card, now) {
  const history = Array.isArray(card.history) ? [...card.history] : [];
  history.push({ at: now, content: card.content });
  return history.slice(-MAX_HISTORY);
}

/** 新建或覆盖一张卡（覆盖时旧正文进历史） */
export function putPersona(doc, name, content, now = Date.now()) {
  const n = validateName(name);
  const text = validateContent(content);
  const prev = doc.cards[n];
  const card = {
    content: text,
    entries: prev?.entries ?? [],
    history: prev ? pushHistory(prev, now) : [],
    updatedAt: now,
  };
  const next = { ...doc, cards: { ...doc.cards, [n]: card } };
  if (!next.active) next.active = n;
  return next;
}

/** 把历史里的某个版本恢复成正文（当前正文会进历史，可再退回） */
export function rollbackPersona(doc, name, index = -1, now = Date.now()) {
  const n = validateName(name);
  const card = doc.cards[n];
  if (!card) throw new Error(`没有 Soul 面板「${n}」`);
  const history = card.history ?? [];
  const i = index < 0 ? history.length + index : index;
  const target = history[i];
  if (!target) throw new Error(`没有第 ${index} 个历史版本`);
  const next = {
    ...card,
    content: target.content,
    history: pushHistory(card, now),
    updatedAt: now,
  };
  return { ...doc, cards: { ...doc.cards, [n]: next } };
}

export function deletePersona(doc, name) {
  const n = validateName(name);
  if (!doc.cards[n]) throw new Error(`没有 Soul 面板「${n}」`);
  const cards = { ...doc.cards };
  delete cards[n];
  return { ...doc, cards, active: doc.active === n ? Object.keys(cards)[0] ?? null : doc.active };
}

export function setActive(doc, name) {
  if (name === null || name === "") return { ...doc, active: null };
  const n = validateName(name);
  if (!doc.cards[n]) throw new Error(`没有 Soul 面板「${n}」`);
  return { ...doc, active: n };
}

export function listPersonas(doc, now = Date.now()) {
  return Object.entries(doc.cards).map(([name, card]) => {
    const r = renderCard(card, { now });
    return {
      name,
      active: doc.active === name,
      size: card.content.length,
      entries: (card.entries ?? []).length,
      injected: r.injected.length,
      truncated: r.truncated.length,
      injectSize: r.used,
      history: (card.history ?? []).length,
      updatedAt: card.updatedAt || 0,
      summary: card.content.split("\n").filter((l) => l.trim()).slice(0, 2).join(" / ").slice(0, 80),
    };
  });
}

/** 卡片的可读详情（面板用） */
export function cardDetail(card, now = Date.now()) {
  const r = renderCard(card, { now });
  const ranked = rankEntries(card.entries ?? [], now);
  return {
    content: card.content,
    entries: ranked.map((e) => ({
      id: e.id,
      text: e.text,
      category: e.category,
      weight: e.weight,
      effective: e.effective,
      createdAt: e.createdAt,
      lastHit: e.lastHit,
      injected: r.injected.includes(e.id),
      ...(e.evidence ? { evidence: e.evidence } : {}),
      ...(e.patternKey ? { patternKey: e.patternKey } : {}),
    })),
    history: (card.history ?? []).map((h, i) => ({ index: i, at: h.at, size: h.content.length })),
    inject: { used: r.used, budget: INJECT_BUDGET, injected: r.injected.length, truncated: r.truncated.length },
  };
}
