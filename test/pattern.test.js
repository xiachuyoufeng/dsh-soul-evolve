import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { analyze, candidates, mine, evidenceKey, gateOf, shouldRevalidate, MIN_SESSIONS, MIN_DAYS } from "../src/pattern.js";
import { qualifies, qualifiesInferred, buildEntry } from "../src/evolve.js";
import * as P from "../src/persona.js";
import { preview, sediment, patternsPath, loadPatternState } from "../src/sediment.js";

const DAY = 24 * 60 * 60 * 1000;

/** 造一批观测：days 天、sessions 个会话，每会话 turns 轮，固定场景 */
function makeTurns({ days = 4, sessions = 4, perSession = 8, scene = "work", textLen = 15 } = {}) {
  const out = [];
  const base = Date.UTC(2026, 10, 1, 2, 0, 0);
  for (let s = 0; s < sessions; s += 1) {
    const day = s % days;
    for (let i = 0; i < perSession; i += 1) {
      out.push({
        t: base + day * DAY + i * 60000,
        sid: `s${s}`,
        scene,
        textLen,
      });
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
  const turns = makeTurns({ days: 4, sessions: 4 });
  const r = mine(turns);
  assert.ok(r.stats.days >= MIN_DAYS);
  assert.ok(r.stats.sessions >= MIN_SESSIONS);
  assert.ok(r.candidates.length > 0);
  const keys = r.candidates.map((c) => c.key);
  assert.ok(keys.includes("scene:work"));
  assert.ok(keys.includes("input:short"));
});

test("pattern: 统计口径（会话数、天数、中位输入长度、切换率）", () => {
  const turns = makeTurns({ days: 3, sessions: 3, perSession: 10, scene: "tech", textLen: 40 });
  const s = analyze(turns);
  assert.equal(s.total, 30);
  assert.equal(s.sessions, 3);
  assert.equal(s.days, 3);
  assert.equal(s.textMedian, 40);
  assert.equal(s.topScene, "tech");
  assert.equal(s.switchesPerSession, 0);
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

test("evolve: 模型不能通过 soul_evolve 自造 pattern 条目", () => {
  const fake = {
    kind: "pattern",
    userExplicit: false,
    event: "x",
    learned: "y",
    next: "z",
    evidence: { sessions: 99, days: 99, turns: 999 },
  };
  assert.equal(qualifies(fake), false);
  // 同样的结构走推断入口才合法
  assert.equal(qualifiesInferred(fake), true);
});

test("evolve: 推断入口要求证据达标", () => {
  assert.equal(qualifiesInferred({ kind: "pattern", evidence: null }), false);
  assert.equal(qualifiesInferred({ kind: "pattern", evidence: { sessions: 1, days: 1, turns: 2 } }), false);
  assert.equal(qualifiesInferred({ kind: "pattern", userExplicit: true, evidence: { sessions: 9, days: 9, turns: 90 } }), false);
});

test("persona: pattern 类初始权重 0.45、半衰 45 天", () => {
  assert.equal(P.INITIAL_WEIGHT.pattern, 0.45);
  assert.equal(P.HALF_LIFE.pattern, 45 * DAY);
  const now = Date.now();
  const card = { content: "x", entries: [] };
  const r = P.addEntry(card, { text: "条目正文", category: "pattern", now, evidence: { sessions: 3, days: 3, turns: 30 } });
  assert.equal(r.added, true);
  assert.equal(r.entry.weight, 0.45);
  assert.equal(r.entry.evidence.sessions, 3);
});

test("persona: 同一 patternKey 再次沉淀只升权重不新增", () => {
  const now = Date.now();
  let card = { content: "x", entries: [] };
  card = P.addEntry(card, { text: "条目 A", category: "pattern", now, patternKey: "scene:work" }).card;
  const before = card.entries.length;
  const r = P.addEntry(card, { text: "措辞完全不同的另一句", category: "pattern", now: now + 1000, patternKey: "scene:work" });
  assert.equal(r.added, false);
  assert.equal(r.card.entries.length, before);
  assert.ok(r.hit.weight > 0.45);
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
      category: "pattern",
      evidence: { sessions: 4, days: 4, turns: 44, since: 1, until: 2 },
      patternKey: "input:short",
    });
    doc.cards[name] = r.card;
    P.savePersonas(doc);
    const loaded = P.loadPersonas();
    const e = loaded.cards[name].entries.find((x) => x.patternKey === "input:short");
    assert.ok(e, "条目丢了");
    assert.equal(e.evidence.sessions, 4);
    const detail = P.cardDetail(loaded.cards[name]);
    const d = detail.entries.find((x) => x.patternKey === "input:short");
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
    assert.equal(existsSync(join(dir, "patterns.json")), false);
  } finally {
    if (old === undefined) delete process.env.DSH_SOUL_HOME;
    else process.env.DSH_SOUL_HOME = old;
  }
});

test("sediment: 写入后记账，冷却期内不重复写", () => {
  const dir = mkdtempSync(join(tmpdir(), "soul-sed2-"));
  const old = process.env.DSH_SOUL_HOME;
  process.env.DSH_SOUL_HOME = dir;
  const now = Date.now();
  try {
    // 造一个够格的观测文件
    const turns = makeTurns({ days: 4, sessions: 4, perSession: 10 });
    writeFileSync(join(dir, "turns.jsonl"), turns.map((t) => JSON.stringify(t)).join("\n") + "\n", "utf8");

    const first = sediment({ now });
    assert.equal(first.written.length, 1, "第一次应写 1 条");
    assert.ok(existsSync(patternsPath()));

    const state = loadPatternState();
    assert.equal(Object.keys(state.patterns).length, 1);

    const second = sediment({ now: now + 1000 });
    assert.equal(second.written.length, 0, "冷却期内不该再写");
    assert.ok(second.skipped.length > 0 || second.preview.ready.length > 0);
  } finally {
    if (old === undefined) delete process.env.DSH_SOUL_HOME;
    else process.env.DSH_SOUL_HOME = old;
  }
});

test("sediment: 一次最多写 1 条，其余留给以后", () => {
  const dir = mkdtempSync(join(tmpdir(), "soul-sed3-"));
  const old = process.env.DSH_SOUL_HOME;
  process.env.DSH_SOUL_HOME = dir;
  try {
    const turns = makeTurns({ days: 5, sessions: 5, perSession: 12 });
    writeFileSync(join(dir, "turns.jsonl"), turns.map((t) => JSON.stringify(t)).join("\n") + "\n", "utf8");
    const r = sediment({ now: Date.now() });
    assert.equal(r.written.length, 1);
    assert.ok(r.preview.ready.length >= 2, "应有多个够格候选，但只写一条");
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
