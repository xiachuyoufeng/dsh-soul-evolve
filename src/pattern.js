/**
 * pattern.js —— 交互沉淀：把逐轮观测聚合成「可核查的候选」。
 *
 * 与 evolve.js 的分工：
 *   evolve.js  管「用户明说」的事件（C1 的 explicit 入口，模型可调）
 *   本文件     管「交互里反复出现」的模式（inferred 入口，只由插件自己调）
 *
 * 两条沉淀轨道，分开算、分开写、分开注入：
 *   habit     —— 工作方法习惯：怎么干活（连续协作、要不要请示）
 *   character —— 性格表达：以什么姿态出现（基调、口风稳不稳、先给机制还是先给结论）
 * 两者混在一起写，条目会互相打架：习惯是"该这么做"，表达是"该这样说话"。
 *
 * habit 轨只收「带数字、memory 抓不到」的观测结论。像"回复该短"这种，面板正文
 * 早就手写了、memory 的 user 轨也存得下，再统计一遍只是把同一句话重说一次。
 *
 * 这一层不放松防编造，只换了证据形式：
 *   明说入口的证据是「用户说过」，推断入口的证据是「会话数 + 跨天 + 相关轮次」。
 *
 * 门槛缺一不可（默认）：独立会话 ≥ 3、跨天 ≥ 3、相关轮次 ≥ 12。
 * 单次或单天出现的多半是任务本身的要求，不是模式——慢是特性，不是缺陷。
 */

const DAY = 24 * 60 * 60 * 1000;

/** 默认门槛 */
export const MIN_SESSIONS = 3;
export const MIN_DAYS = 3;
export const MIN_TURNS = 12;

/** 每个维度每次沉淀最多写几条（低权重快半衰，宁可少写） */
export const MAX_PER_RUN = 1;

/** 同一条模式多久之后允许重新验证（重新验证=权重 +0.1，不新增条目） */
export const REVALIDATE_DAYS = 14;

/** 场景稳定判定的每会话平均切换上限 */
export const MAX_SWITCH_PER_SESSION = 0.5;

/** 长会话判定的每会话轮次中位下限 */
export const LONG_SESSION_MEDIAN = 12;

/** 信号型检测器（靠反射弧命中次数）的最低命中数 */
export const MIN_SIGNAL_HITS = 15;
/** 「一句话指令」判定的最低命中数与占比 */
export const DIRECT_HITS = 20;
export const DIRECT_RATE = 0.12;
/** 「追问原因」判定的最低命中数与占比 */
export const CURIOUS_HITS = 15;
export const CURIOUS_RATE = 0.05;
/** 「反馈基调」判定的最低反馈数与正面占比 */
export const FEEDBACK_HITS = 20;
export const FEEDBACK_POSITIVE = 0.6;
/** 主场景判定：占比下限 */
export const TOP_SCENE_SHARE = 0.5;

/** 两个沉淀维度 */
export const DIMENSIONS = ["habit", "character"];

export const DIMENSION_LABEL = {
  habit: "工作习惯",
  character: "性格表达",
};

const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

function median(nums) {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

const pct = (part, total) => (total > 0 ? Math.round((part / total) * 100) : 0);

/**
 * 统计一轮观测的特征。纯函数，方便单测。
 * @param {Array<{t:number,sid:string,scene:string|null,textLen:number,reflex?:string[]}>} turns
 */
export function analyze(turns = []) {
  const rows = (turns ?? []).filter((r) => r && Number.isFinite(Number(r.t)));
  const sessions = new Set();
  const days = new Set();
  const sceneTurns = new Map();
  const sceneSessions = new Map();
  const turnsPerSid = new Map();
  const switchesPerSid = new Map();
  const reflex = { praise: 0, blame: 0, curious: 0, short: 0, long: 0, repeat: 0 };

  for (const r of rows) {
    const sid = String(r.sid ?? "-");
    sessions.add(sid);
    days.add(dayOf(Number(r.t)));
    const scene = r.scene ?? "unknown";
    sceneTurns.set(scene, (sceneTurns.get(scene) ?? 0) + 1);
    if (!sceneSessions.has(scene)) sceneSessions.set(scene, new Set());
    sceneSessions.get(scene).add(sid);
    turnsPerSid.set(sid, (turnsPerSid.get(sid) ?? 0) + 1);
    for (const h of Array.isArray(r.reflex) ? r.reflex : []) {
      if (h in reflex) reflex[h] += 1;
    }
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
    reflex,
    sids: [...sessions],
  };
}

/**
 * 从统计里挑出模式，生成候选事件（尚未成条目）。
 * 候选只做结构性判断（"可能是个模式"）；够不够格由 gateOf/qualifiesInferred 判，
 * 这样面板能显示"还差几天"，而不是一片空白。
 */
export function candidates(stats, opts = {}) {
  const out = [];
  const minSessions = opts.minSessions ?? MIN_SESSIONS;
  const minTurns = opts.minTurns ?? MIN_TURNS;
  const now = opts.now ?? Date.now();
  if (!stats || stats.total === 0) return out;

  const enough = stats.sessions >= minSessions && stats.total >= minTurns;
  const reflex = stats.reflex ?? {};

  const push = (dimension, key, { event, learned, next, turns }) =>
    out.push({
      kind: "pattern",
      dimension,
      userExplicit: false,
      date: dayOf(now),
      key,
      event,
      learned,
      next,
      evidence: {
        sessions: stats.sessions,
        days: stats.days,
        turns,
        since: stats.since,
        until: stats.until,
      },
    });

  /* ---------- 轨道一：工作方法习惯 ---------- */

  // H2 长会话：这是连续协作，不是一次性问答
  if (enough && stats.turnsPerSession >= LONG_SESSION_MEDIAN) {
    push("habit", "habit:ongoing", {
      event: `会话中位 ${stats.turnsPerSession} 轮、共 ${stats.sessions} 个会话`,
      learned: "上下文在对方那边一直续着，不是每次从零开始",
      next: "不每轮重述背景，也不反复确认同一件事",
      turns: stats.total,
    });
  }

  // H3 一句话指令：少反问，先把能定的做掉
  const shortHits = Number(reflex.short) || 0;
  if (enough && shortHits >= DIRECT_HITS && shortHits / stats.total >= DIRECT_RATE) {
    push("habit", "habit:direct", {
      event: `一句话指令 ${shortHits}/${stats.total} 轮（${pct(shortHits, stats.total)}%）`,
      learned: "指令多是短句，等不到一段完整需求描述",
      next: "少反问，能自己定的先做掉；只在不可逆或代价大的地方确认",
      turns: shortHits,
    });
  }

  /* ---------- 轨道二：性格表达 ---------- */

  // C1 主场景主导：默认基调停在这一档
  if (stats.topScene !== "unknown" && stats.topSceneShare >= TOP_SCENE_SHARE) {
    const sceneSessions = stats.sceneSessions.get(stats.topScene)?.size ?? 0;
    if (stats.topSceneTurns >= minTurns && sceneSessions >= minSessions) {
      push("character", `character:scene:${stats.topScene}`, {
        event: `${stats.topScene} 场合占 ${stats.topSceneTurns}/${stats.total} 轮（${pct(stats.topSceneTurns, stats.total)}%）`,
        learned: "默认姿态就落在这一档，不用每轮重新判断",
        next: "换成别的场合再调口风；信号不明显时别一上来就改",
        turns: stats.topSceneTurns,
      });
    }
  }

  // C2 口风稳：一次会话里不来回换调子
  if (enough && stats.switchesPerSession <= MAX_SWITCH_PER_SESSION) {
    push("character", "character:steady", {
      event: `${stats.sessions} 个会话共 ${stats.switches} 次场合切换`,
      learned: "一次会话里姿态本来就该稳住",
      next: "同一会话保持一种调子；要变也得是真信号变了",
      turns: stats.total,
    });
  }

  // C3 爱追问原因：先给机制，再落结论
  const curiousHits = Number(reflex.curious) || 0;
  if (enough && curiousHits >= CURIOUS_HITS && curiousHits / stats.total >= CURIOUS_RATE) {
    push("character", "character:curious", {
      event: `追问原因 ${curiousHits}/${stats.total} 轮（${pct(curiousHits, stats.total)}%）`,
      learned: "对方常追问为什么，结论本身不够",
      next: "先给机制和依据再落结论，别先抛结论等人问",
      turns: curiousHits,
    });
  }

  // C4 反馈基调：现在这个语气是对方认的
  const praise = Number(reflex.praise) || 0;
  const blame = Number(reflex.blame) || 0;
  const feedback = praise + blame;
  if (enough && feedback >= FEEDBACK_HITS && praise / feedback >= FEEDBACK_POSITIVE) {
    push("character", "character:feedback", {
      event: `正面反馈 ${praise} 次、负向 ${blame} 次（共 ${feedback} 次）`,
      learned: "现在这个语气对方是认的",
      next: "别为了显得专业把语气磨平；温度有效，收着用就行",
      turns: feedback,
    });
  }

  return out;
}

/** 一次沉淀的纯计算入口：观测 → 候选。IO 留在调用方，方便单测。 */
export function mine(turns = [], opts = {}) {
  const stats = analyze(turns);
  return { stats, candidates: candidates(stats, opts) };
}

/** 从 key 前缀取维度（「habit:brief」→「habit」） */
export function dimensionOf(key) {
  const head = String(key ?? "").split(":")[0];
  return DIMENSIONS.includes(head) ? head : "";
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
