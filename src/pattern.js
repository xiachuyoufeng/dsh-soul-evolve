/**
 * pattern.js —— 交互沉淀：把逐轮观测聚合成「可核查的性格候选」。
 *
 * 与 evolve.js 的分工：
 *   evolve.js  管「用户明说」的事件（C1 的 explicit 入口，模型可调）
 *   本文件     管「交互里反复出现」的模式（inferred 入口，只由插件自己调）
 *
 * 这一层不放松防编造，只换了证据形式：
 *   明说入口的证据是「用户说过」，推断入口的证据是「会话数 + 跨天 + 轮次」。
 *
 * 门槛缺一不可（默认）：独立会话 ≥ 3、跨天 ≥ 3、相关轮次 ≥ 12。
 * 单次或单天出现的多半是任务本身的要求，不是模式——慢是特性，不是缺陷。
 */

const DAY = 24 * 60 * 60 * 1000;

/** 默认门槛 */
export const MIN_SESSIONS = 3;
export const MIN_DAYS = 3;
export const MIN_TURNS = 12;

/** 每次沉淀最多写几条（低权重快半衰，宁可少写） */
export const MAX_PER_RUN = 1;

/** 同一条模式多久之后允许重新验证（重新验证=权重 +0.1，不新增条目） */
export const REVALIDATE_DAYS = 14;

/** 短输入判定的中位长度阈值（字） */
export const SHORT_INPUT_MEDIAN = 25;

/** 场景稳定判定的每会话平均切换上限 */
export const MAX_SWITCH_PER_SESSION = 0.5;

/** 长会话判定的每会话轮次中位下限 */
export const LONG_SESSION_MEDIAN = 12;

const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

function median(nums) {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * 统计一轮观测的特征。纯函数，方便单测。
 * @param {Array<{t:number,sid:string,scene:string|null,textLen:number}>} turns
 */
export function analyze(turns = []) {
  const rows = (turns ?? []).filter((r) => r && Number.isFinite(Number(r.t)));
  const sessions = new Set();
  const days = new Set();
  const sceneTurns = new Map();
  const sceneSessions = new Map();
  const turnsPerSid = new Map();
  const switchesPerSid = new Map();

  for (const r of rows) {
    const sid = String(r.sid ?? "-");
    sessions.add(sid);
    days.add(dayOf(Number(r.t)));
    const scene = r.scene ?? "unknown";
    sceneTurns.set(scene, (sceneTurns.get(scene) ?? 0) + 1);
    if (!sceneSessions.has(scene)) sceneSessions.set(scene, new Set());
    sceneSessions.get(scene).add(sid);
    turnsPerSid.set(sid, (turnsPerSid.get(sid) ?? 0) + 1);
  }

  // 逐会话数场景切换：相邻两轮 scene 变化记一次
  const bySid = new Map();
  for (const r of rows) {
    const sid = String(r.sid ?? "-");
    if (!bySid.has(sid)) bySid.set(sid, []);
    bySid.get(sid).push(r);
  }
  for (const [sid, list] of bySid) {
    list.sort((a, b) => Number(a.t) - Number(b.t));
    let sw = 0;
    for (let i = 1; i < list.length; i += 1) {
      const prev = list[i - 1].scene ?? null;
      const cur = list[i].scene ?? null;
      if (prev !== null && cur !== null && prev !== cur) sw += 1;
    }
    switchesPerSid.set(sid, sw);
  }

  const total = rows.length;
  const topScene = [...sceneTurns.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["unknown", 0];
  const switches = [...switchesPerSid.values()].reduce((a, b) => a + b, 0);
  const times = rows.map((r) => Number(r.t)).sort((a, b) => a - b);

  return {
    total,
    sessions: sessions.size,
    days: days.size,
    since: times[0] ?? 0,
    until: times[times.length - 1] ?? 0,
    sceneTurns,
    sceneSessions,
    topScene: topScene[0],
    topSceneTurns: topScene[1],
    topSceneShare: total > 0 ? topScene[1] / total : 0,
    textMedian: median(rows.map((r) => Number(r.textLen) || 0)),
    turnsPerSession: median([...turnsPerSid.values()]),
    switches,
    switchesPerSession: sessions.size > 0 ? switches / sessions.size : 0,
    sids: [...sessions],
  };
}

/**
 * 从统计里挑出够格的模式，生成候选事件（尚未成条目）。
 * 每个候选自带 evidence，用于面板展示与后续重复验证。
 */
export function candidates(stats, opts = {}) {
  const out = [];
  const minSessions = opts.minSessions ?? MIN_SESSIONS;
  const minTurns = opts.minTurns ?? MIN_TURNS;
  const now = opts.now ?? Date.now();
  if (!stats || stats.total === 0) return out;

  const base = () => ({
    kind: "pattern",
    userExplicit: false,
    date: dayOf(now),
    sessions: stats.sessions,
    days: stats.days,
    since: stats.since,
    until: stats.until,
  });
  // 候选只做结构性判断（"可能是个模式"）；够不够格由 gateOf/qualifiesInferred 判，
  // 这样面板能显示"还差几天"，而不是一片空白。
  const gate = (sceneTurns, sceneSessions) => sceneTurns >= minTurns && sceneSessions >= minSessions;

  // 1. 场景主导：长期停在某一档
  if (stats.topScene !== "unknown") {
    const sceneSessions = stats.sceneSessions.get(stats.topScene)?.size ?? 0;
    if (gate(stats.topSceneTurns, sceneSessions)) {
      const pct = Math.round(stats.topSceneShare * 100);
      out.push({
        ...base(),
        key: `scene:${stats.topScene}`,
        event: `${stats.topScene} 场景占 ${stats.topSceneTurns}/${stats.total} 轮（${pct}%）、${sceneSessions} 个会话`,
        learned: "默认基调就落在这一档，不必每次重新判断",
        next: "遇到其它场景先按这一档起步，信号明显了再切",
        evidence: {
          sessions: sceneSessions,
          days: stats.days,
          turns: stats.topSceneTurns,
          since: stats.since,
          until: stats.until,
        },
      });
    }
  }

  // 2. 输入偏短：回复也应偏短
  if (stats.textMedian > 0 && stats.textMedian <= SHORT_INPUT_MEDIAN) {
    if (stats.sessions >= minSessions && stats.total >= minTurns) {
      out.push({
        ...base(),
        key: "input:short",
        event: `输入中位 ${stats.textMedian} 字（${stats.total} 轮）`,
        learned: "回答本来就该短，先结论再依据",
        next: "超过约五行字的具体展开，等明确要求再做",
        evidence: {
          sessions: stats.sessions,
          days: stats.days,
          turns: stats.total,
          since: stats.since,
          until: stats.until,
        },
      });
    }
  }

  // 3. 场景稳定：会话内不来回换口风
  if (stats.sessions >= minSessions && stats.total >= minTurns && stats.switchesPerSession <= MAX_SWITCH_PER_SESSION) {
    out.push({
      ...base(),
      key: "scene:stable",
      event: `${stats.sessions} 个会话共 ${stats.switches} 次场景切换`,
      learned: "一次会话里口风本来就该稳住",
      next: "同一会话保持一种基调，不要几轮就改调子",
      evidence: {
        sessions: stats.sessions,
        days: stats.days,
        turns: stats.total,
        since: stats.since,
        until: stats.until,
      },
    });
  }

  // 4. 长会话：这是连续协作，不是一次性问答
  if (stats.sessions >= minSessions && stats.total >= minTurns && stats.turnsPerSession >= LONG_SESSION_MEDIAN) {
    out.push({
      ...base(),
      key: "session:long",
      event: `会话中位 ${stats.turnsPerSession} 轮、共 ${stats.sessions} 个会话`,
      learned: "这里是连续协作，不是一次性问答",
      next: "不要每轮重述上下文或重新确认同一件事",
      evidence: {
        sessions: stats.sessions,
        days: stats.days,
        turns: stats.total,
        since: stats.since,
        until: stats.until,
      },
    });
  }

  return out;
}

/**
 * 一次沉淀的纯计算入口：观测 → 候选。
 * IO（读文件、写卡、记账）留在调用方，方便单测。
 */
export function mine(turns = [], opts = {}) {
  const stats = analyze(turns);
  return { stats, candidates: candidates(stats, opts) };
}

/**
 * 门槛判定：返回缺哪几项，便于面板直接显示"还差几天"。
 */
export function gateOf(c, gates = {}) {
  const minSessions = gates.minSessions ?? MIN_SESSIONS;
  const minDays = gates.minDays ?? MIN_DAYS;
  const minTurns = gates.minTurns ?? MIN_TURNS;
  const e = c?.evidence ?? {};
  const missing = [];
  if ((Number(e.sessions) || 0) < minSessions) missing.push(`会话 ${e.sessions ?? 0}/${minSessions}`);
  if ((Number(e.days) || 0) < minDays) missing.push(`跨天 ${e.days ?? 0}/${minDays}`);
  if ((Number(e.turns) || 0) < minTurns) missing.push(`轮次 ${e.turns ?? 0}/${minTurns}`);
  return { ok: missing.length === 0, missing };
}

/** 证据指纹：用于判断「模式是否又有新证据」，避免重复沉淀 */
export function evidenceKey(c) {
  const e = c?.evidence ?? {};
  return [e.sessions ?? 0, e.days ?? 0, e.turns ?? 0].join("|");
}

/** 是否到了可以重新验证的时间（重复验证让权重 +0.1，条目不会重复） */
export function shouldRevalidate(record, now = Date.now(), afterDays = REVALIDATE_DAYS) {
  if (!record || !record.emittedAt) return true;
  return now - Number(record.emittedAt) >= afterDays * DAY;
}
