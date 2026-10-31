/**
 * reflex.js —— 反射弧：输入 → 状态增量 → 表达调制（纯函数）
 */
const PRAISE = ["谢谢", "太好了", "不错", "厉害", "喜欢", "可以", "赞", "哈哈"];
const BLAME = ["不对", "错了", "太长", "又", "怎么还", "不是这样", "太慢", "失望"];
const CURIOUS = ["吗", "?", "？", "为什么", "怎么", "能不能", "是否"];
const HOUR = 1000 * 60 * 60;

export function reflex(text = "", ctx = {}) {
  const now = ctx.now ?? Date.now();
  const delta = { valence: 0, arousal: 0, energy: 0, intimacy: 0, focus: 0 };
  const t = String(text);
  const len = t.length;

  const hasPraise = PRAISE.some((w) => t.includes(w)) && !t.startsWith("不对");
  const hasBlame = BLAME.some((w) => t.includes(w));

  if (hasPraise && !hasBlame) { delta.valence += 0.12; delta.intimacy += 0.03; }
  if (hasBlame) { delta.valence -= 0.18; delta.focus += 0.08; }
  if (CURIOUS.some((w) => t.includes(w))) delta.focus += 0.05;
  if (len > 300) { delta.arousal += 0.06; delta.focus += 0.06; }
  if (len > 0 && len < 10) delta.arousal -= 0.02;

  const h = new Date(now).getHours();
  if (h >= 23 || h < 6) delta.energy -= 0.08;
  if (h >= 9 && h < 12) delta.energy += 0.03;

  if (ctx.lastAt && now - ctx.lastAt > 6 * HOUR) { delta.intimacy += 0.02; delta.arousal += 0.03; }
  if (ctx.sameTopicRepeat) delta.arousal -= 0.04;
  return delta;
}

export function describe(state) {
  const moodWord = state.mood.valence > 0.25 ? "偏亮" : state.mood.valence < -0.25 ? "偏沉" : "平";
  const energyWord = state.energy > 0.7 ? "有劲" : state.energy < 0.4 ? "疲惫" : "中等";
  const relWord = state.intimacy > 0.6 ? "熟" : state.intimacy > 0.3 ? "渐熟" : "尚生";
  return `${moodWord}·${energyWord}·${relWord}`;
}

export function modulate(state) {
  const { valence } = state.mood;
  const { energy, intimacy, focus } = state;
  const verbosity = Math.round(Math.min(1, Math.max(0.25, 0.55 + energy * 0.25 + valence * 0.15 + focus * 0.1)) * 100) / 100;
  const warmth = Math.round(Math.min(1, Math.max(0, intimacy * 0.9 + valence * 0.1)) * 100) / 100;
  const patience = Math.round(Math.min(1, Math.max(0.2, energy * 0.6 + focus * 0.4)) * 100) / 100;
  return {
    verbosity, warmth, patience,
    label: describe(state),
    hint: `表达调制：长度≈${verbosity}、温度≈${warmth}、耐心≈${patience}。状态「${describe(state)}」，只影响措辞，不要直接说出来。`,
  };
}
