/**
 * evolve.js —— 人格合成引擎：六条硬约束 C1–C6
 */
export const MAX_NEW_ENTRIES = 2;
export const MAX_ACTIVE_ENTRIES = 10;

const BANNED = [
  /我(太|好|真)(开心|难过|激动|愤怒)/,
  /我(这次|今天)表现得?(很好|不错|出色)/,
  /我感觉到你/,
  /我(真的)?很(爱你|想你)/,
];

/** C1：只收三类事件 */
export function qualifies(event) {
  if (!event || typeof event !== "object") return false;
  const { kind, userExplicit } = event;
  if (kind === "correction" && userExplicit) return true;
  if (kind === "praise" && userExplicit) return true;
  if (kind === "repeat_mistake") return true;
  if (kind === "longterm_preference") return true;
  return false;
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
