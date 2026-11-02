/**
 * reflex.js —— 反射弧：输入 → 状态增量 → 表达调制（纯函数）
 */
const PRAISE = ["谢谢", "太好了", "不错", "厉害", "喜欢", "可以", "赞", "哈哈"];
const BLAME = ["不对", "错了", "太长", "又", "怎么还", "不是这样", "太慢", "失望"];
const CURIOUS = ["吗", "?", "？", "为什么", "怎么", "能不能", "是否"];
const HOUR = 1000 * 60 * 60;

/**
 * 反射弧明细：返回 { delta, hits }。
 * hits 用于观测层统计"哪条规则在真正起作用"，不影响状态计算本身。
 */
export function reflexDetail(text = "", ctx = {}) {
  const now = ctx.now ?? Date.now();
  const delta = { valence: 0, arousal: 0, energy: 0, intimacy: 0, focus: 0 };
  const hits = [];
  const t = String(text);
  const len = t.length;

  const hasPraise = PRAISE.some((w) => t.includes(w)) && !t.startsWith("不对");
  const hasBlame = BLAME.some((w) => t.includes(w));

  if (hasPraise && !hasBlame) {
    delta.valence += 0.12;
    delta.intimacy += 0.03;
    hits.push("praise");
  }
  if (hasBlame) {
    delta.valence -= 0.18;
    delta.focus += 0.08;
    hits.push("blame");
  }
  if (CURIOUS.some((w) => t.includes(w))) {
    delta.focus += 0.05;
    hits.push("curious");
  }
  if (len > 300) {
    delta.arousal += 0.06;
    delta.focus += 0.06;
    hits.push("long");
  }
  if (len > 0 && len < 10) {
    delta.arousal -= 0.02;
    hits.push("short");
  }

  const h = new Date(now).getHours();
  if (h >= 23 || h < 6) {
    delta.energy -= 0.08;
    hits.push("late");
  }
  if (h >= 9 && h < 12) {
    delta.energy += 0.03;
    hits.push("morning");
  }

  if (ctx.lastAt && now - ctx.lastAt > 6 * HOUR) {
    delta.intimacy += 0.02;
    delta.arousal += 0.03;
    hits.push("gap");
  }
  if (ctx.sameTopicRepeat) {
    delta.arousal -= 0.04;
    hits.push("repeat");
  }
  return { delta, hits };
}

/** 只要增量（绝大多数调用方需要的是这个） */
export function reflex(text = "", ctx = {}) {
  return reflexDetail(text, ctx).delta;
}

export function describe(state) {
  const moodWord = state.mood.valence > 0.25 ? "偏亮" : state.mood.valence < -0.25 ? "偏沉" : "平";
  const energyWord = state.energy > 0.7 ? "有劲" : state.energy < 0.4 ? "疲惫" : "中等";
  const relWord = state.intimacy > 0.6 ? "熟" : state.intimacy > 0.3 ? "渐熟" : "尚生";
  return `${moodWord}·${energyWord}·${relWord}`;
}

/**
 * 状态 → 表达旋钮。
 *
 * @param {object} state 状态
 * @param {string|null} scene 场景（v0.8 起生效；null = 不做场景偏移，保持旧行为）
 *
 * 场景基准表存在的理由：同一个状态在"改代码"和"深夜闲聊"里该有不同的表达，
 * 但状态本身不该为此分叉——所以偏移放在调制这一层。
 */
export const SCENE_OFFSETS = {
  work: { warmth: 0, verbosity: -0.1, patience: 0.15 },
  chat: { warmth: 0.25, verbosity: 0.05, patience: -0.1 },
  support: { warmth: 0.3, verbosity: -0.15, patience: 0.2 },
  tech: { warmth: 0, verbosity: 0.1, patience: 0.1 },
};

const round2 = (v) => Math.round(v * 100) / 100;
const clamp01 = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

export function modulate(state, scene = null) {
  const { valence } = state.mood;
  const { energy, intimacy, focus } = state;

  const baseVerbosity = 0.55 + energy * 0.25 + valence * 0.15 + focus * 0.1;
  const baseWarmth = intimacy * 0.9 + valence * 0.1;
  const basePatience = energy * 0.6 + focus * 0.4;

  const off = (scene && SCENE_OFFSETS[scene]) || { warmth: 0, verbosity: 0, patience: 0 };

  const verbosity = round2(clamp01(baseVerbosity + off.verbosity, 0.25, 1));
  const warmth = round2(clamp01(baseWarmth + off.warmth, 0, 1));
  const patience = round2(clamp01(basePatience + off.patience, 0.2, 1));

  // 副语言不是随机插入的修饰，而是状态的外显：
  // 精力低才有犹豫，专注低才句子碎；状态高的时候这些字段为 false，就不该出现。
  const prosody = {
    hesitation: energy < 0.35,
    fragmented: focus < 0.4,
  };

  return {
    verbosity,
    warmth,
    patience,
    scene: scene ?? null,
    prosody,
    label: describe(state),
    hint: buildHint({ verbosity, warmth, patience, scene, prosody, state }),
  };
}

function buildHint({ verbosity, warmth, patience, scene, prosody, state }) {
  const parts = [
    `表达调制：长度≈${verbosity}、温度≈${warmth}、耐心≈${patience}。状态「${describe(state)}」，只影响措辞，不要直接说出来。`,
  ];
  if (scene) {
    const sceneWord = { work: "工作", chat: "闲聊", support: "情绪支持", tech: "技术" }[scene] ?? scene;
    parts.push(`当前场景判断：${sceneWord}（据此调整语气强度，不要念出场景名）。`);
  }
  if (prosody.hesitation) parts.push("你现在精力偏低，表达可以更短、更犹豫，不必把句子写齐。");
  if (prosody.fragmented) parts.push("你现在的专注度不高，句子可以更碎一些。");
  return parts.join("");
}
