import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  analyze,
  mine,
  evidenceKey,
  gateOf,
  dimensionOf,
  shouldRevalidate,
  MIN_SESSIONS,
  MIN_DAYS,
  DIMENSIONS,
} from "../src/pattern.js";
import { qualifies, qualifiesInferred, buildEntry, INFERRED_DIMENSIONS } from "../src/evolve.js";
import * as P from "../src/persona.js";
import { preview, sediment, coverageOf, patternsPath, loadPatternState, COVERED_THRESHOLD } from "../src/sediment.js";

const DAY = 24 * 60 * 60 * 1000;

/**
 * 造一批观测：days 天、sessions 个会话，每会话 perSession 轮。
 * hits 用来注入反射弧命中（short / curious / praise 才会触发信号型检测器）。
 */
function makeTurns({ days = 4, sessions = 4, perSession = 16, scene = "work", textLen = 15, hits = { short: 0.2, curious: 0.1, praise: 0.1 } } = {}) {
  const out = [];
  const base = Date.UTC(2026, 10, 1, 2, 0, 0);
  let n = 0;
  for (let s = 0; s < sessions; s += 1) {
    const day = s % days;
    for (let i = 0; i < perSession; i += 1) {
      n += 1;
      const reflex = Object.entries(hits)
        .filter(([, rate]) => rate > 0 && n % Math.max(1, Math.round(1 / rate)) === 0)
        .map(([name]) => name);
      out.push({ t: base + day * DAY + i * 60000, sid: `s${s}`, scene, textLen, reflex });
    }
  }
  return out;
}

test("pattern: 只有一天时候选存在但过不了门槛（跨天才是模式）", () => {
  const turns = makeTurns({ days: 1, sessions: 4 });
  const r = mine(turns);
  assert.equal(r.stats.days, 1);
  // 候选照常算出来（面板要能显示"还差几天"），但不该有任何一条够格
  assert.equal(r.candidates.filter((c) => gateOf(c, {}).ok).length, 0);
  for (const c of r.candidates) {
    assert.deepEqual(gateOf(c, {}).missing, ["跨天 1/3"]);
  }
});

test("pattern: 跨天且会话够多才产出候选", () => {
  const r = mine(makeTurns({ days: 4, sessions: 4 }));
  assert.ok(r.stats.days >= MIN_DAYS);
  assert.ok(r.stats.sessions >= MIN_SESSIONS);
  const keys = r.candidates.map((c) => c.key);
  assert.ok(keys.includes("habit:ongoing"));
  assert.ok(keys.includes("character:scene:work"));
});

test("pattern: 候选分两条轨道，互不混写", () => {
  const r = mine(makeTurns({ days: 4, sessions: 4, perSession: 40, hits: { short: 0.25, curious: 0.2, praise: 0.2 } }));
  assert.ok(r.candidates.length >= 4, `实际 ${r.candidates.map((c) => c.key)}`);
  for (const c of r.candidates) {
    assert.ok(INFERRED_DIMENSIONS.includes(c.dimension), `维度不合法：${c.dimension}`);
    assert.equal(dimensionOf(c.key), c.dimension, "key 前缀应与维度一致");
  }
  assert.ok(r.candidates.filter((c) => c.dimension === "habit").length > 0, "应有工作习惯候选");
  assert.ok(r.candidates.filter((c) => c.dimension === "character").length > 0, "应有性格表达候选");
});

test("pattern: 习惯轨只收带数字的观测结论（不再产出 brief）", () => {
  const r = mine(makeTurns({ days: 4, sessions: 4, perSession: 40, textLen: 15, hits: { short: 0.25 } }));
  const habit = r.candidates.filter((c) => c.dimension === "habit");
  const keys = habit.map((c) => c.key);
  assert.ok(keys.includes("habit:ongoing"), "长会话应产出 ongoing");
  assert.ok(keys.includes("habit:direct"), "一句话指令多应产出 direct");
  // "回复该短"面板正文已经手写了，统计版是重复建设
  assert.ok(!keys.includes("habit:brief"), "brief 已移除");
  for (const c of habit) {
    assert.ok(/\d/.test(c.event), `习惯条目必须带数字：${c.key} → ${c.event}`);
  }
});

test("pattern: 表达检测器看姿态（基调/口风/追问/反馈）", () => {
  const r = mine(makeTurns({ days: 4, sessions: 4, perSession: 40, hits: { curious: 0.2, praise: 0.2 } }));
  const keys = r.candidates.filter((c) => c.dimension === "character").map((c) => c.key);
  assert.ok(keys.includes("character:scene:work"), "主场景应产出基调候选");
  assert.ok(keys.includes("character:steady"), "切换少应产出口风稳候选");
  assert.ok(keys.includes("character:curious"), "追问多应产出 curious");
  assert.ok(keys.includes("character:feedback"), "正面反馈多应产出 feedback");
});

test("persona: 覆盖查重能挡住「把面板里已有的话重说一遍」", () => {
  const card = { content: "# 测试\n- 默认短：够用就停（用户明确嫌长过）", entries: [] };
  const dup = {
    key: "habit:brief",
    event: "输入中位 18 字",
    learned: "默认短，够用就停",
    next: "回复保持短",
  };
  const fresh = {
    key: "character:curious",
    event: "追问原因 62/728 轮",
    learned: "对方常追问为什么，结论本身不够",
    next: "先给机制和依据再落结论",
  };
  assert.ok(coverageOf(card, dup).sim >= COVERED_THRESHOLD, "重复的应判为已覆盖");
  assert.ok(coverageOf(card, fresh).sim < COVERED_THRESHOLD, "新的不该被误杀");
});

test("pattern: 统计口径（会话数、天数、中位长度、切换率、命中数）", () => {
  const turns = makeTurns({ days: 3, sessions: 3, perSession: 10, scene: "tech", textLen: 40, hits: { praise: 0.5 } });
  const s = analyze(turns);
  assert.equal(s.total, 30);
  assert.equal(s.sessions, 3);
  assert.equal(s.days, 3);
  assert.equal(s.textMedian, 40);
  assert.equal(s.topScene, "tech");
  assert.equal(s.switchesPerSession, 0);
  assert.equal(s.reflex.praise, 15);
});

test("pattern: 候选自带可核查证据", () => {
  const r = mine(makeTurns({ days: 3, sessions: 3 }));
  for (const c of r.candidates) {
    assert.equal(c.kind, "pattern");
    assert.equal(c.userExplicit, false);
    assert.ok(c.evidence.sessions >= MIN_SESSIONS);
    assert.ok(c.evidence.days >= MIN_DAYS);
    assert.ok(c.evidence.turns > 0);
    assert.ok(c.evidence.since > 0 && c.evidence.until >= c.evidence.since);
  }
});

test("pattern: 生成的条目能过 C2（三段式、≤160 字、无禁用词）", () => {
  const r = mine(makeTurns({ days: 5, sessions: 5, perSession: 20 }));
  for (const c of r.candidates) {
    const line = buildEntry({ date: c.date, event: c.event, learned: c.learned, next: c.next });
    assert.ok(line.length <= 160, `条目过长：${line.length}`);
  }
});

test("evolve: 模型不能通过 soul_evolve 自造推断条目", () => {
  const fake = {
    kind: "pattern",
    dimension: "habit",
    userExplicit: false,
    event: "x",
    learned: "y",
    next: "z",
    evidence: { sessions: 99, days: 99, turns: 999 },
  };
  assert.equal(qualifies(fake), false);
  assert.equal(qualifiesInferred(fake), true);
});

test("evolve: 推断入口要求证据达标且必须落在两条轨道上", () => {
  assert.equal(qualifiesInferred({ kind: "pattern", dimension: "habit", evidence: null }), false);
  assert.equal(qualifiesInferred({ kind: "pattern", dimension: "habit", evidence: { sessions: 1, days: 1, turns: 2 } }), false);
  assert.equal(
    qualifiesInferred({ kind: "pattern", dimension: "habit", userExplicit: true, evidence: { sessions: 9, days: 9, turns: 90 } }),
    false
  );
  // 没有维度（旧数据/野路子）一律不收
  assert.equal(qualifiesInferred({ kind: "pattern", evidence: { sessions: 9, days: 9, turns: 90 } }), false);
  assert.equal(qualifiesInferred({ kind: "pattern", dimension: "mood", evidence: { sessions: 9, days: 9, turns: 90 } }), false);
});

test("evolve: 推断条目不能声称内在状态", () => {
  assert.throws(() => buildEntry({ date: "2026-11-02", event: "追问很多", learned: "我越来越亲近对方", next: "多聊" }), /C6/);
  assert.throws(() => buildEntry({ date: "2026-11-02", event: "反馈正面", learned: "我开始喜欢这种配合", next: "保持" }), /C6/);
});

test("persona: 两类沉淀的权重与半衰期分开（习惯比表达更稳）", () => {
  assert.equal(P.INITIAL_WEIGHT.habit, 0.5);
  assert.equal(P.INITIAL_WEIGHT.character, 0.45);
  assert.equal(P.HALF_LIFE.habit, 60 * DAY);
  assert.equal(P.HALF_LIFE.character, 45 * DAY);
  assert.ok(P.HALF_LIFE.habit > P.HALF_LIFE.character);
  const now = Date.now();
  const r = P.addEntry({ content: "x", entries: [] }, { text: "习惯条目", category: "habit", now, evidence: { sessions: 3, days: 3, turns: 30 } });
  assert.equal(r.added, true);
  assert.equal(r.entry.weight, 0.5);
  assert.equal(r.entry.evidence.sessions, 3);
});

test("persona: 同一 patternKey 再次沉淀只升权重不新增", () => {
  const now = Date.now();
  let card = { content: "x", entries: [] };
  card = P.addEntry(card, { text: "条目 A", category: "habit", now, patternKey: "habit:brief" }).card;
  const before = card.entries.length;
  const r = P.addEntry(card, { text: "措辞完全不同的另一句", category: "habit", now: now + 1000, patternKey: "habit:brief" });
  assert.equal(r.added, false);
  assert.equal(r.card.entries.length, before);
  assert.ok(r.hit.weight > 0.5);
});

test("persona: 注入分成 Evolved / 工作习惯 / 性格表达 三段", () => {
  const now = Date.now();
  let card = { content: "# 测试", entries: [] };
  card = P.addEntry(card, { text: "明说的一条", category: "correction", now }).card;
  card = P.addEntry(card, { text: "习惯的一条", category: "habit", now, patternKey: "habit:brief" }).card;
  card = P.addEntry(card, { text: "表达的一条", category: "character", now, patternKey: "character:steady" }).card;
  const r = P.renderCard(card, { now });
  assert.ok(r.text.includes("## Evolved"));
  assert.ok(r.text.includes("## 工作习惯"));
  assert.ok(r.text.includes("## 性格表达"));
  assert.ok(r.text.indexOf("## Evolved") < r.text.indexOf("## 工作习惯"));
  assert.ok(r.text.indexOf("## 工作习惯") < r.text.indexOf("## 性格表达"));
  assert.equal(r.injected.length, 3);
  // 证据只在面板里，不污染注入文本
  assert.equal(r.text.includes("依据"), false);
});

test("persona: 证据指针能存活一次读写（否则面板查不了依据）", () => {
  const dir = mkdtempSync(join(tmpdir(), "soul-pattern-"));
  const old = process.env.DSH_SOUL_HOME;
  process.env.DSH_SOUL_HOME = dir;
  try {
    const doc = P.defaultPersonaDoc(Date.now());
    const name = doc.active;
    const r = P.addEntry(doc.cards[name], {
      text: "带证据的条目",
      category: "habit",
      evidence: { sessions: 4, days: 4, turns: 44, since: 1, until: 2 },
      patternKey: "habit:brief",
    });
    doc.cards[name] = r.card;
    P.savePersonas(doc);
    const loaded = P.loadPersonas();
    const e = loaded.cards[name].entries.find((x) => x.patternKey === "habit:brief");
    assert.ok(e, "条目丢了");
    assert.equal(e.category, "habit");
    assert.equal(e.evidence.sessions, 4);
    const d = P.cardDetail(loaded.cards[name]).entries.find((x) => x.patternKey === "habit:brief");
    assert.ok(d.evidence, "面板拿不到证据");
  } finally {
    if (old === undefined) delete process.env.DSH_SOUL_HOME;
    else process.env.DSH_SOUL_HOME = old;
  }
});

test("sediment: 预览只读，不写卡也不记账", () => {
  const dir = mkdtempSync(join(tmpdir(), "soul-sed-"));
  const old = process.env.DSH_SOUL_HOME;
  process.env.DSH_SOUL_HOME = dir;
  try {
    const p = preview(makeTurns({ days: 4, sessions: 4 }));
    assert.ok(p.stats.turns > 0);
    assert.ok(Array.isArray(p.ready));
    assert.ok(p.ready.length > 0, "跨天够格时应给 ready");
    assert.deepEqual(p.dimensions.map((d) => d.dimension), DIMENSIONS);
    assert.equal(existsSync(join(dir, "patterns.json")), false);
  } finally {
    if (old === undefined) delete process.env.DSH_SOUL_HOME;
    else process.env.DSH_SOUL_HOME = old;
  }
});

test("sediment: 两条轨道各写一条（互不挤占）", () => {
  const dir = mkdtempSync(join(tmpdir(), "soul-sed2-"));
  const old = process.env.DSH_SOUL_HOME;
  process.env.DSH_SOUL_HOME = dir;
  try {
    const turns = makeTurns({ days: 4, sessions: 4, perSession: 20 });
    writeFileSync(join(dir, "turns.jsonl"), turns.map((t) => JSON.stringify(t)).join("\n") + "\n", "utf8");
    const now = Date.now();
    const first = sediment({ now });
    assert.equal(first.written.length, 2, `应各写一条，实际 ${JSON.stringify(first.written.map((w) => w.key))}`);
    assert.deepEqual(first.written.map((w) => w.dimension).sort(), ["character", "habit"]);
    assert.equal(Object.keys(loadPatternState().patterns).length, 2);
    assert.ok(existsSync(patternsPath()));

    const second = sediment({ now: now + 1000 });
    assert.equal(second.written.length, 0, "冷却期内不该再写");
  } finally {
    if (old === undefined) delete process.env.DSH_SOUL_HOME;
    else process.env.DSH_SOUL_HOME = old;
  }
});

test("sediment: 一个维度缺信号也不挡另一个维度", () => {
  // 长输入 + 无命中：brief/direct/curious/feedback 都不该出
  const turns = makeTurns({ days: 4, sessions: 4, perSession: 20, textLen: 300, hits: {} });
  const p = preview(turns);
  const habitReady = p.ready.filter((c) => c.dimension === "habit").map((c) => c.key);
  const charReady = p.ready.filter((c) => c.dimension === "character").map((c) => c.key);
  assert.ok(habitReady.includes("habit:ongoing"), `习惯侧应含 ongoing，实际 ${habitReady}`);
  assert.ok(charReady.length > 0, "表达侧仍有候选");

  const dir = mkdtempSync(join(tmpdir(), "soul-sed3-"));
  const old = process.env.DSH_SOUL_HOME;
  process.env.DSH_SOUL_HOME = dir;
  try {
    writeFileSync(join(dir, "turns.jsonl"), turns.map((t) => JSON.stringify(t)).join("\n") + "\n", "utf8");
    const r = sediment({ now: Date.now() });
    assert.deepEqual(r.written.map((w) => w.dimension).sort(), ["character", "habit"]);
  } finally {
    if (old === undefined) delete process.env.DSH_SOUL_HOME;
    else process.env.DSH_SOUL_HOME = old;
  }
});

test("sediment: 写进卡片的类别就是维度（面板/注入据此分段）", () => {
  const dir = mkdtempSync(join(tmpdir(), "soul-sed4-"));
  const old = process.env.DSH_SOUL_HOME;
  process.env.DSH_SOUL_HOME = dir;
  try {
    const turns = makeTurns({ days: 4, sessions: 4, perSession: 20 });
    writeFileSync(join(dir, "turns.jsonl"), turns.map((t) => JSON.stringify(t)).join("\n") + "\n", "utf8");
    sediment({ now: Date.now() });
    const doc = P.loadPersonas();
    const card = doc.cards[doc.active];
    const cats = new Set(card.entries.map((e) => e.category));
    assert.ok(cats.has("habit"), `实际类别：${[...cats]}`);
    assert.ok(cats.has("character"));
    const text = P.renderCard(card).text;
    assert.ok(text.includes("## 工作习惯"));
    assert.ok(text.includes("## 性格表达"));
  } finally {
    if (old === undefined) delete process.env.DSH_SOUL_HOME;
    else process.env.DSH_SOUL_HOME = old;
  }
});

test("pattern: 证据指纹变化能反映新证据", () => {
  const a = { evidence: { sessions: 3, days: 3, turns: 30 } };
  const b = { evidence: { sessions: 4, days: 5, turns: 60 } };
  assert.notEqual(evidenceKey(a), evidenceKey(b));
});

test("pattern: 冷却期未到不让重复验证，到了就放行", () => {
  const now = Date.now();
  assert.equal(shouldRevalidate({ emittedAt: now - 1000 }, now), false);
  assert.equal(shouldRevalidate({ emittedAt: now - 15 * DAY }, now), true);
  assert.equal(shouldRevalidate(null, now), true);
});
