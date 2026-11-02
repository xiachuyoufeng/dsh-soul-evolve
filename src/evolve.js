/**
 * evolve.js —— 人格合成引擎：六条硬约束 C1–C6
 */
export const MAX_NEW_ENTRIES = 2;
export const MAX_ACTIVE_ENTRIES = 10;

/** 推断条目允许落的两个维度（与 pattern.js 的 DIMENSIONS 对应） */
export const INFERRED_DIMENSIONS = ["habit", "character"];

const BANNED = [
  /我(太|好|真)(开心|难过|激动|愤怒)/,
  /我(这次|今天)表现得?(很好|不错|出色)/,
  /我感觉到你/,
  /我(真的)?很(爱你|想你)/,
  // 推断条目只能写"以后怎么做"，不能声称自己有什么内在状态
  /我(开始)?(喜欢|享受|偏爱)(这种|被|你)/,
  /我(越来越|变得更)(亲近|喜欢|依赖)/,
];

/**
 * C1（明说入口）：只收模型能提供的四类事件。
 *
 * pattern 类被明确挡在门外：推断条目只能由 pattern.js 从观测里生成，
 * 模型不能借 soul_evolve 自造证据给自己写性格。
 */
export function qualifies(event) {
  if (!event || typeof event !== "object") return false;
  const { kind, userExplicit } = event;
  if (kind === "pattern") return false;
  if (kind === "correction" && userExplicit) return true;
  if (kind === "praise" && userExplicit) return true;
  if (kind === "repeat_mistake") return true;
  if (kind === "longterm_preference") return true;
  return false;
}

/**
 * C1（推断入口）：只给插件自己的沉淀通道用，不暴露给工具。
 * 证据门槛由 pattern.js 的统计保证，这里只做结构校验。
 */
export function qualifiesInferred(event, { minSessions = 3, minDays = 3, minTurns = 12 } = {}) {
  if (!event || typeof event !== "object") return false;
  if (event.kind !== "pattern") return false;
  if (event.userExplicit === true) return false;
  // 必须落在两条轨道之一：习惯与表达分开写，混在一起的条目会互相打架
  if (!INFERRED_DIMENSIONS.includes(event.dimension)) return false;
  const e = event.evidence;
  if (!e || typeof e !== "object") return false;
  const sessions = Number(e.sessions) || 0;
  const days = Number(e.days) || 0;
  const turns = Number(e.turns) || 0;
  return sessions >= minSessions && days >= minDays && turns >= minTurns;
}

/** C2 + C6：一行三段格式化 + 禁用词检查 */
export function buildEntry(event) {
  if (!event.event || !event.learned || !event.next) throw new Error("C2：三段式不完整");
  const line = `[${event.date}] ${event.event} → ${event.learned} → ${event.next}`;
  if (line.length > 160) throw new Error("C2：条目过长（上限 160 字）");
  if (BANNED.some((re) => re.test(line))) throw new Error("C6：条目含情绪表演/自我评价/虚构感受");
  return line;
}

/** C3：每次最多 2 条 */
export function limitEntries(entries) {
  return entries.slice(0, MAX_NEW_ENTRIES);
}

/** C4：冲突不删，标〔已修正〕 */
export function markConflict(oldLine, newLine, date) {
  return `${oldLine.replace(/〔已修正[^〕]*〕$/, "")}〔已修正 ${date}〕\n${newLine}`;
}

/** C5：超出上限部分归档 */
export function splitArchive(entries, max = MAX_ACTIVE_ENTRIES) {
  if (entries.length <= max) return { active: entries, archived: [] };
  return { active: entries.slice(-max), archived: entries.slice(0, entries.length - max) };
}

export function synthesize(events, today = new Date().toISOString().slice(0, 10)) {
  const accepted = events.filter(qualifies);
  const built = [];
  const rejected = [];
  for (const e of accepted) {
    try {
      built.push({ line: buildEntry({ ...e, date: e.date ?? today }), source: e });
    } catch (err) {
      rejected.push({ source: e, reason: err.message });
    }
  }
  return { entries: limitEntries(built), rejected, dropped: events.length - accepted.length };
}
