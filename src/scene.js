/**
 * scene.js —— 场景判定（纯函数）。
 *
 * 四类：work（工作）/ tech（技术求助）/ support（情绪支持）/ chat（闲聊）。
 *
 * 两条设计原则：
 * 1. **默认 work**。判错场景比不判更糟——在严肃话题里卖萌是最刺眼的错位，
 *    所以宁可少切，只在信号足够强时才离开默认值。
 * 2. **滞回**。场景不能逐句跳变：要么新场景连续占优，要么单轮得分压倒性领先。
 */

export const SCENES = ["work", "tech", "support", "chat"];

/** 需要连续多少轮占优才切换 */
export const SWITCH_STREAK = 2;
/** 单轮分数达到当前场景的多少倍才立即切换 */
export const SWITCH_RATIO = 1.5;
/** 单轮直接切换所需的最低分（防止"当前 0 分、对方 0.5 分"就跳走） */
export const SWITCH_MIN_SCORE = 2;

const WORK_VERBS = [
  "改", "修", "做", "查", "跑", "执行", "部署", "提交", "生成", "写", "实现",
  "重构", "测试", "构建", "安装", "配置", "优化", "看一下", "看下", "帮我", "处理",
  "分析", "整理", "导出", "合并", "删除", "新增", "添加", "替换", "更新",
];
const TECH_WORDS = [
  "报错", "错误", "异常", "bug", "Bug", "BUG", "函数", "接口", "变量", "依赖",
  "版本", "编译", "日志", "堆栈", "栈", "调用", "返回值", "类型", "参数", "语法",
  "Error", "Exception", "TypeError", "undefined", "null", "npm", "node", "git",
  "api", "API", "sql", "SQL", "json", "JSON", "docker", "python", "javascript",
];
const SUPPORT_WORDS = [
  "累", "烦", "难过", "焦虑", "压力", "不开心", "崩溃", "emo", "难受", "生气",
  "委屈", "孤独", "郁闷", "心累", "撑不住", "想放弃", "丧", "痛苦", "无助",
];
const CHAT_WORDS = [
  "哈哈", "嘿嘿", "呀", "嘛", "啦", "哦", "嗯", "诶", "欸", "嘿", "嘻嘻",
  "在吗", "睡了吗", "无聊", "聊聊", "陪我",
];

const has = (text, words) => words.some((w) => text.includes(w));

/** 看起来像文件路径或代码块 */
function looksLikeCode(text) {
  return /```/.test(text) || /\b[\w./-]+\.(js|mjs|cjs|ts|tsx|json|md|py|sh|yml|yaml|css|html)\b/.test(text) || /(^|\s)\/[\w./-]+/.test(text);
}

/**
 * 给四类场景打分。
 * @returns {{scores: Record<string, number>, signals: string[]}}
 */
export function scoreScenes(text = "", { now = Date.now() } = {}) {
  const t = String(text);
  const len = t.length;
  const scores = { work: 0, tech: 0, support: 0, chat: 0 };
  const signals = [];

  const workVerb = has(t, WORK_VERBS);
  const techWord = has(t, TECH_WORDS);
  const supportWord = has(t, SUPPORT_WORDS);
  const chatWord = has(t, CHAT_WORDS);
  const code = looksLikeCode(t);

  if (workVerb) {
    scores.work += 2;
    signals.push("work:verb");
  }
  if (code) {
    scores.work += 2;
    scores.tech += 1;
    signals.push("code");
  }
  if (len > 120) {
    scores.work += 1;
    signals.push("long");
  }

  if (techWord) {
    scores.tech += 2;
    signals.push("tech:word");
  }
  if (/报错|错误|异常|Error|Exception|失败|不工作/.test(t)) {
    scores.tech += 1;
    signals.push("tech:error");
  }

  if (supportWord) {
    scores.support += 2;
    signals.push("support:word");
  }
  if (/我.{0,6}(累|烦|难过|焦虑|不开心|难受)/.test(t)) {
    scores.support += 2;
    signals.push("support:self");
  }

  if (chatWord) {
    scores.chat += 1.5;
    signals.push("chat:word");
  }
  if (len > 0 && len < 30) {
    scores.chat += 1;
    signals.push("chat:short");
  }
  const h = new Date(now).getHours();
  if (h >= 23 || h < 6) {
    scores.chat += 1.5;
    signals.push("chat:late");
  }

  // 技术求助通常也在工作语境里，但它更具体，优先判定
  if (scores.tech > 0) scores.work = Math.max(scores.work, scores.tech * 0.8);

  return { scores, signals };
}

/** 从分数里挑最高的一类；全部为 0 时返回 null（交给默认值） */
export function pickScene(scores) {
  let best = null;
  let bestScore = 0;
  for (const scene of SCENES) {
    const s = scores[scene] ?? 0;
    if (s > bestScore) {
      bestScore = s;
      best = scene;
    }
  }
  if (!best || bestScore < 2) return null;
  return best;
}

/**
 * 滞回决策。
 * @param {string} prev 当前场景
 * @param {string|null} candidate 本轮最高分场景（null = 信号不足）
 * @param {number} streak 已经连续占优的轮次
 * @param {number} candidateScore 候选场景本轮得分
 * @param {number} prevScore 当前场景本轮得分
 */
export function nextScene(prev = "work", candidate = null, streak = 0, candidateScore = 0, prevScore = 0) {
  if (!candidate || candidate === prev) return { scene: prev, streak: 0, candidate: null };
  if (candidateScore >= Math.max(SWITCH_MIN_SCORE, prevScore * SWITCH_RATIO)) {
    return { scene: candidate, streak: 0, candidate: null };
  }
  const nextStreak = streak + 1;
  if (nextStreak >= SWITCH_STREAK) return { scene: candidate, streak: 0, candidate: null };
  return { scene: prev, streak: nextStreak, candidate };
}

/**
 * 一步到位：输入文本 + 上一轮场景 → 新场景。
 * @returns {{scene: string, candidate: string|null, streak: number, scores: object, signals: string[]}}
 */
export function detectScene(text, { now = Date.now(), prev = "work", streak = 0 } = {}) {
  const { scores, signals } = scoreScenes(text, { now });
  const candidate = pickScene(scores);
  const prevScore = scores[prev] ?? 0;
  const candidateScore = candidate ? scores[candidate] ?? 0 : 0;
  const next = nextScene(prev, candidate, streak, candidateScore, prevScore);
  return { ...next, scores, signals };
}
