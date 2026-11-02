#!/usr/bin/env node
/**
 * stats.mjs —— 观测数据的验收计算器。
 *
 * 读 `~/.dsh-soul-evolve/turns.jsonl`，输出后续版本要走过的验收线：
 *   1. 场景分离度（工作/闲聊温差 > 0.15）
 *   2. 场景切换率（< 15%）
 *   3. 面板注入长度趋势（< 4000 字，4 周增长 < 5%）
 *   4. 反射弧规则命中分布
 *
 * 用法：
 *   node scripts/stats.mjs              # 全部数据
 *   node scripts/stats.mjs --days 7     # 只看最近 7 天
 *   node scripts/stats.mjs --json       # 机器可读
 */
import { readTurns, tracePath } from "../src/trace.js";

const THRESHOLDS = {
  sceneWarmthGap: 0.15, // 闲聊 − 工作 的温度差
  sceneSwitchRate: 0.15, // 切换次数 / 总轮次
  panelChars: 4000, // 注入面板字数上限
  panelGrowth: 0.05, // 4 周增长上限
};

function parseArgs(argv) {
  const out = { days: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--days") out.days = Number(argv[++i]);
  }
  return out;
}

const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
const round = (v, n = 3) => Math.round(v * 10 ** n) / 10 ** n;

function groupByScene(turns) {
  const groups = new Map();
  for (const t of turns) {
    const scene = t.scene ?? "unknown";
    if (!groups.has(scene)) groups.set(scene, []);
    groups.get(scene).push(t);
  }
  return groups;
}

export function computeStats(turns) {
  const sorted = [...turns].sort((a, b) => a.t - b.t);

  // 1. 场景分组均值
  const byScene = {};
  for (const [scene, list] of groupByScene(sorted)) {
    const knobs = list.map((t) => t.knobs).filter(Boolean);
    byScene[scene] = {
      turns: list.length,
      warmth: round(mean(knobs.map((k) => k.warmth ?? 0))),
      patience: round(mean(knobs.map((k) => k.patience ?? 0))),
      verbosity: round(mean(knobs.map((k) => k.verbosity ?? 0))),
    };
  }

  const warmthGap =
    byScene.chat && byScene.work ? round(byScene.chat.warmth - byScene.work.warmth) : null;

  // 2. 场景切换率
  let switches = 0;
  let prev = null;
  for (const t of sorted) {
    if (t.scene && prev && t.scene !== prev) switches += 1;
    if (t.scene) prev = t.scene;
  }
  const switchRate = sorted.length > 1 ? round(switches / sorted.length) : 0;

  // 3. 面板注入长度
  const panelLens = sorted.map((t) => t.panelLen ?? 0).filter((n) => n > 0);
  const panelMax = panelLens.length ? Math.max(...panelLens) : 0;
  const panelLast = panelLens.length ? panelLens[panelLens.length - 1] : 0;
  const panelFirst = panelLens.length ? panelLens[0] : 0;
  const panelGrowth = panelFirst > 0 ? round((panelLast - panelFirst) / panelFirst) : 0;

  // 4. 反射弧命中分布
  const hits = {};
  for (const t of sorted) {
    for (const h of t.reflex ?? []) hits[h] = (hits[h] ?? 0) + 1;
  }

  // 5. 状态分布
  const states = sorted.map((t) => t.state).filter(Boolean);
  const stateMeans = {};
  for (const key of ["valence", "arousal", "energy", "intimacy", "focus"]) {
    stateMeans[key] = round(mean(states.map((s) => s[key] ?? 0)));
  }

  return {
    total: sorted.length,
    from: sorted.length ? new Date(sorted[0].t).toISOString() : null,
    to: sorted.length ? new Date(sorted[sorted.length - 1].t).toISOString() : null,
    byScene,
    warmthGap,
    switches,
    switchRate,
    panelMax,
    panelGrowth,
    hits,
    stateMeans,
  };
}

export function judge(stats) {
  const checks = [];
  const push = (name, value, ok, hint) => checks.push({ name, value, ok, hint });

  push(
    "工作/闲聊温差 > 0.15",
    stats.warmthGap === null ? "数据不足（需要 work 与 chat 两类都跑过）" : stats.warmthGap,
    stats.warmthGap !== null && stats.warmthGap >= THRESHOLDS.sceneWarmthGap,
    "run `node scripts/stats.mjs`"
  );
  push(
    "场景切换率 < 15%",
    `${(stats.switchRate * 100).toFixed(1)}%`,
    stats.switchRate < THRESHOLDS.sceneSwitchRate,
    "切换太频繁 = 滞回参数不够狠"
  );
  push(
    "面板注入 ≤ 4000 字",
    stats.panelMax || 0,
    (stats.panelMax || 0) <= THRESHOLDS.panelChars,
    "超出说明 Top-N 截断没生效"
  );
  push(
    "面板长度增长 < 5%",
    `${(stats.panelGrowth * 100).toFixed(1)}%`,
    Math.abs(stats.panelGrowth) < THRESHOLDS.panelGrowth,
    "增长快说明权重不衰减"
  );
  return checks;
}

function printHuman(stats) {
  const line = (s = "") => console.log(s);
  line(`观测记录：${tracePath()}`);
  if (stats.total === 0) {
    line("还没有数据。跑几轮对话后回来看——空表不代表通过。");
    return;
  }
  line(`轮次：${stats.total}　区间：${stats.from} → ${stats.to}`);
  line();

  line("── 场景分布 ──");
  for (const [scene, v] of Object.entries(stats.byScene)) {
    line(
      `  ${scene.padEnd(8)} ${String(v.turns).padStart(4)} 轮   温度 ${v.warmth}   耐心 ${v.patience}   长度 ${v.verbosity}`
    );
  }
  line(`  温差（闲聊 − 工作）：${stats.warmthGap === null ? "数据不足" : stats.warmthGap}`);
  line(`  切换：${stats.switches} 次 / ${stats.total} 轮 = ${(stats.switchRate * 100).toFixed(1)}%`);
  line();

  line("── 面板注入 ──");
  line(`  当前 ${stats.panelMax} 字（上限 ${THRESHOLDS.panelChars}）　增长 ${(stats.panelGrowth * 100).toFixed(1)}%`);
  line();

  line("── 反射弧命中 ──");
  const hitEntries = Object.entries(stats.hits).sort((a, b) => b[1] - a[1]);
  if (!hitEntries.length) line("  （无）");
  for (const [k, v] of hitEntries) line(`  ${k.padEnd(10)} ${v}`);
  line();

  line("── 状态均值 ──");
  line(`  ${Object.entries(stats.stateMeans).map(([k, v]) => `${k} ${v}`).join("　")}`);
  line();

  line("── 验收 ──");
  for (const c of judge(stats)) {
    line(`  ${c.ok ? "✓" : "✗"} ${c.name}　当前：${c.value}`);
  }
}

// 作为 CLI 运行时才输出
const isCli = process.argv[1] ? process.argv[1].replace(/\\/g, "/").endsWith("stats.mjs") : false;
if (isCli) {
  const args = parseArgs(process.argv.slice(2));
  let turns = readTurns();
  if (args.days) {
    const since = Date.now() - args.days * 24 * 60 * 60 * 1000;
    turns = turns.filter((t) => t.t >= since);
  }
  const stats = computeStats(turns);
  if (args.json) {
    console.log(JSON.stringify({ stats, checks: judge(stats) }, null, 2));
  } else {
    printHuman(stats);
  }
}
