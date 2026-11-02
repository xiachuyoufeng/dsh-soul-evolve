import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defaultState, decay, applyDelta, migrate, STATE_VERSION } from "../src/state.js";
import { reflex, reflexDetail, modulate, describe } from "../src/reflex.js";
import { detectScene, pickScene, nextScene, scoreScenes } from "../src/scene.js";
import { recordTurn, readTurns, resetTraceCache } from "../src/trace.js";
import * as P from "../src/persona.js";
import { qualifies, buildEntry, limitEntries, markConflict, splitArchive, synthesize } from "../src/evolve.js";
import { majorOf } from "../src/adapter.js";

test("state: 默认状态结构合法", () => {
  const s = defaultState(1_000_000);
  assert.equal(s.version, STATE_VERSION);
  assert.equal(s.mood.valence, 0);
  assert.ok(s.energy > 0 && s.energy <= 1);
});

test("state: 衰减把情绪拉回中位，但不倒退亲密", () => {
  const base = { ...defaultState(0), mood: { valence: 0.8, arousal: 0.9 }, intimacy: 0.5, updatedAt: 0 };
  const d = decay(base, 1000 * 60 * 60 * 48);
  assert.ok(d.mood.valence < 0.8);
  assert.ok(Math.abs(d.mood.valence) < 0.1);
  assert.equal(d.intimacy, 0.5);
});

test("state: applyDelta 会夹紧范围", () => {
  const s = defaultState(0);
  assert.equal(applyDelta(s, { valence: 5, energy: 9, intimacy: 5 }).mood.valence, 1);
  assert.equal(applyDelta(s, { valence: -5 }).mood.valence, -1);
});

test("state: migrate 兼容缺失版本", () => {
  const s = migrate({ mood: { valence: 0.2, arousal: 0.3 } });
  assert.equal(s.version, STATE_VERSION);
  assert.equal(s.energy, defaultState().energy);
});

test("state: v1 老文件迁移后补上场景状态", () => {
  const s = migrate({ version: 1, mood: { valence: 0.2, arousal: 0.3 }, energy: 0.5, intimacy: 0.1, focus: 0.5, updatedAt: 0 });
  assert.equal(s.version, STATE_VERSION);
  assert.equal(s.scene.current, "work");
  assert.equal(s.scene.streak, 0);
});

test("reflex: 表扬提升效价与亲近，批评降低效价", () => {
  const praise = reflex("太好了，谢谢！", { now: new Date("2026-10-28T10:00:00").getTime() });
  assert.ok(praise.valence > 0 && praise.intimacy > 0);
  const blame = reflex("不对，这个错了", { now: new Date("2026-10-28T10:00:00").getTime() });
  assert.ok(blame.valence < 0);
});

test("reflex: 深夜降能量", () => {
  const night = reflex("随便聊聊", { now: new Date("2026-10-28T02:00:00").getTime() });
  const day = reflex("随便聊聊", { now: new Date("2026-10-28T10:00:00").getTime() });
  assert.ok(night.energy < day.energy);
});

test("reflex: modulate 输出在合理区间", () => {
  const m = modulate(defaultState());
  for (const k of ["verbosity", "warmth", "patience"]) assert.ok(m[k] >= 0 && m[k] <= 1);
  assert.equal(typeof describe(defaultState()), "string");
});

test("evolve: C1 只收三类事件", () => {
  assert.equal(qualifies({ kind: "correction", userExplicit: true }), true);
  assert.equal(qualifies({ kind: "repeat_mistake" }), true);
  assert.equal(qualifies({ kind: "longterm_preference" }), true);
  assert.equal(qualifies({ kind: "chitchat" }), false);
  assert.equal(qualifies({ kind: "correction", userExplicit: false }), false);
});

test("evolve: C2 三段式且拒绝过长", () => {
  const line = buildEntry({ date: "2026-10-28", event: "用户嫌长", learned: "完整不等于礼貌", next: "默认短说" });
  assert.match(line, /^\[2026-10-28\] .+ → .+ → .+$/);
  assert.throws(() => buildEntry({ date: "2026-10-28", event: "x".repeat(200), learned: "a", next: "b" }), /C2/);
});

test("evolve: C6 拒绝情绪表演与自我评价", () => {
  assert.throws(() => buildEntry({ date: "2026-10-28", event: "我太开心了", learned: "a", next: "b" }), /C6/);
  assert.throws(() => buildEntry({ date: "2026-10-28", event: "我这次表现得很好", learned: "a", next: "b" }), /C6/);
});

test("evolve: C3 每次最多两条", () => {
  assert.equal(limitEntries(["1", "2", "3", "4"]).length, 2);
});

test("evolve: C4 冲突标记不删除旧条目", () => {
  const merged = markConflict("[2026-10-01] 旧 → 旧 → 旧", "[2026-10-28] 新 → 新 → 新", "2026-10-28");
  assert.ok(merged.includes("已修正 2026-10-28"));
  assert.ok(merged.includes("旧 → 旧 → 旧"));
});

test("evolve: C5 超出十条归档", () => {
  const entries = Array.from({ length: 13 }, (_, i) => `e${i}`);
  const { active, archived } = splitArchive(entries);
  assert.equal(active.length, 10);
  assert.equal(archived.length, 3);
  assert.equal(active[0], "e3");
});

test("evolve: synthesize 端到端", () => {
  const res = synthesize([
    { kind: "correction", userExplicit: true, date: "2026-10-28", event: "说太长", learned: "完整不是礼貌", next: "默认短" },
    { kind: "chitchat", date: "2026-10-28", event: "闲聊", learned: "x", next: "y" },
    { kind: "repeat_mistake", date: "2026-10-28", event: "又用表格", learned: "微信难读", next: "少用表格" },
    { kind: "praise", userExplicit: true, date: "2026-10-28", event: "说好", learned: "方向对", next: "保持" },
  ]);
  assert.equal(res.entries.length, 2);
  assert.equal(res.dropped, 1);
});

test("adapter: 版本主号解析", () => {
  assert.equal(majorOf("0.1.0-rc.6"), 0);
  assert.equal(majorOf("1.2.3"), 1);
  assert.equal(majorOf(null), null);
});

/* ---------------- v0.8 场景切面 ---------------- */

test("scene: 默认工作，指令与代码信号足够强才离开默认", () => {
  const r = detectScene("帮我改一下这个函数", { now: new Date("2026-11-02T10:00:00").getTime() });
  assert.equal(r.scene, "work");
});

test("scene: 情绪词判为情绪支持", () => {
  const r = detectScene("今天有点累", { now: new Date("2026-11-02T10:00:00").getTime(), prev: "work" });
  assert.equal(r.scene, "support");
  assert.ok(r.signals.includes("support:word"));
});

test("scene: 闲聊信号够强时立即切", () => {
  const r = detectScene("在吗，聊聊", { now: new Date("2026-11-02T10:00:00").getTime(), prev: "work" });
  assert.equal(r.scene, "chat");
});

test("scene: 滞回——信号不够强不切，连续两轮才切", () => {
  const now = new Date("2026-11-02T10:00:00").getTime();
  // TypeError 类消息：tech 分数略高于 work，但不到 1.5 倍
  const first = detectScene("这个 TypeError 是什么问题", { now, prev: "work", streak: 0 });
  assert.equal(first.scene, "work");
  assert.ok(first.streak >= 1);
  const second = detectScene("这个 TypeError 是什么问题", { now, prev: first.scene, streak: first.streak });
  assert.equal(second.scene, "tech");
});

test("scene: 隔太久不算同一段对话（衰减时清零连续计数）", () => {
  const s = { ...defaultState(0), scene: { current: "work", candidate: "chat", streak: 5 }, updatedAt: 0 };
  const d = decay(s, 8 * 60 * 60 * 1000);
  assert.equal(d.scene.streak, 0);
  assert.equal(d.scene.candidate, null);
});

/* ---------------- v0.8 调制与副语言 ---------------- */

test("modulate: 场景偏移改变温度与长度", () => {
  const s = { ...defaultState(0), energy: 0.6, focus: 0.6, intimacy: 0.4, mood: { valence: 0, arousal: 0.4 } };
  const work = modulate(s, "work");
  const chat = modulate(s, "chat");
  assert.ok(chat.warmth > work.warmth);
  assert.ok(chat.verbosity > work.verbosity);
});

test("modulate: 不传场景时保持旧行为（向后兼容）", () => {
  const s = defaultState(0);
  const a = modulate(s);
  const b = modulate(s, null);
  assert.equal(a.warmth, b.warmth);
  assert.equal(a.verbosity, b.verbosity);
  assert.equal(a.patience, b.patience);
});

test("modulate: 副语言由状态驱动，不是常量", () => {
  const tired = modulate({ ...defaultState(0), energy: 0.2, focus: 0.3 }, "work");
  const fresh = modulate({ ...defaultState(0), energy: 0.9, focus: 0.9 }, "work");
  assert.equal(tired.prosody.hesitation, true);
  assert.equal(tired.prosody.fragmented, true);
  assert.equal(fresh.prosody.hesitation, false);
  assert.equal(fresh.prosody.fragmented, false);
  assert.ok(tired.hint.includes("精力偏低"));
  assert.ok(!fresh.hint.includes("精力偏低"));
});

/* ---------------- v0.7 观测层 ---------------- */

function withTempHome() {
  const dir = mkdtempSync(join(tmpdir(), "soul-trace-"));
  process.env.DSH_SOUL_HOME = dir;
  resetTraceCache();
  return dir;
}

test("trace: 同秒同输入长度只记一行（渲染可能被重复调用）", () => {
  withTempHome();
  const t = 1_700_000_000_000;
  assert.equal(recordTurn({ t, sid: "abc", textLen: 10, scene: "work" }), true);
  assert.equal(recordTurn({ t, sid: "abc", textLen: 10, scene: "work" }), false);
  assert.equal(recordTurn({ t, sid: "abc", textLen: 11, scene: "work" }), true);
  assert.equal(readTurns().length, 2);
});

test("trace: 换会话或换秒可以再记", () => {
  withTempHome();
  const t = 1_700_000_000_000;
  assert.equal(recordTurn({ t, sid: "abc", textLen: 10 }), true);
  assert.equal(recordTurn({ t, sid: "def", textLen: 10 }), true);
  assert.equal(recordTurn({ t: t + 1000, sid: "abc", textLen: 10 }), true);
  assert.equal(readTurns().length, 3);
});

test("trace: 坏输入不抛异常（观测层绝不影响注入）", () => {
  withTempHome();
  assert.doesNotThrow(() => recordTurn(null));
  assert.doesNotThrow(() => recordTurn({ sid: {}, textLen: "x" }));
  assert.doesNotThrow(() => recordTurn({ t: NaN }));
});

test("trace: 记录字段完整", () => {
  withTempHome();
  recordTurn({
    t: 1_700_000_000_000,
    sid: "a434b84c-full-id",
    scene: "chat",
    state: { valence: 0.1, arousal: 0.2, energy: 0.3, intimacy: 0.4, focus: 0.5 },
    knobs: { verbosity: 0.5, warmth: 0.6, patience: 0.7 },
    textLen: 12,
    panelLen: 800,
    reflex: ["praise"],
  });
  const [row] = readTurns();
  assert.equal(row.sid, "a434b84c");
  assert.equal(row.scene, "chat");
  assert.equal(row.knobs.warmth, 0.6);
  assert.deepEqual(row.reflex, ["praise"]);
});

/* ---------------- v0.9 演化条目加权 + 注入预算 + 历史 ---------------- */

const DAY_MS = 24 * 60 * 60 * 1000;

test("persona: 老文件的 ## Evolved 段迁移成结构化条目", () => {
  const base = "# 海拉\n\n## Identity\n你是海拉。\n\n## Evolved\n- 〔已修正〕旧条目一\n- 长期偏好条目二\n";
  const raw = { version: 1, active: "海拉", cards: { 海拉: { content: base, updatedAt: 1 } } };
  // migrateDoc 不是导出的，直接走 loadPersonas 的路径：用 splitEvolved 验证拆分逻辑
  const { base: b, evolved } = P.splitEvolved(base);
  assert.equal(evolved.length, 2);
  assert.ok(!b.includes("## Evolved"));
  assert.ok(b.includes("## Identity"));
  assert.ok(raw.cards.海拉.content.includes("## Evolved"));
});

test("persona: correction 不衰减，preference 会衰减", () => {
  const now = 1_700_000_000_000;
  const correction = { category: "correction", weight: 1, lastHit: now - 300 * DAY_MS, createdAt: now };
  const pref = { category: "preference", weight: 0.6, lastHit: now - 300 * DAY_MS, createdAt: now };
  assert.equal(P.effectiveWeight(correction, now), 1);
  assert.ok(P.effectiveWeight(pref, now) < 0.2);
});

test("persona: 相似度能识别同一件事的复述", () => {
  const a = "用户嫌回复太长，以后默认短说";
  const b = "回复太长被嫌，以后默认短说";
  assert.ok(P.similarity(a, b) >= P.SIMILAR_THRESHOLD);
  assert.ok(P.similarity(a, "不要把状态数值念给用户听") < P.SIMILAR_THRESHOLD);
});

test("persona: 命中已有条目只升权重不新增", () => {
  const card = { content: "x", entries: [], history: [] };
  const first = P.addEntry(card, { text: "用户嫌回复太长，以后默认短说", category: "preference", now: 1000 });
  assert.equal(first.added, true);
  const second = P.addEntry(first.card, { text: "回复太长被嫌，以后默认短说", category: "preference", now: 2000 });
  assert.equal(second.added, false);
  assert.equal(second.card.entries.length, 1);
  assert.ok(second.hit.weight > first.entry.weight);
});

test("persona: 注入有硬预算，超出的条目被截断但保留在存储里", () => {
  const entries = Array.from({ length: 30 }, (_, i) => ({
    id: `e${i}`,
    text: `第${i}条演化条目，内容长度大致相同用来把预算吃满。`,
    category: "preference",
    weight: 0.6,
    lastHit: 1_700_000_000_000,
    createdAt: 1_700_000_000_000,
  }));
  const card = { content: "x".repeat(500), entries, history: [] };
  const r = P.renderCard(card, { budget: 1000, now: 1_700_000_000_000 });
  assert.ok(r.used <= 1000);
  assert.ok(r.injected.length > 0);
  assert.ok(r.truncated.length > 0);
  assert.equal(r.injected.length + r.truncated.length, 30);
});

test("persona: 正文优先级高于条目（正文吃满预算时条目不注入）", () => {
  const entries = [{ id: "e1", text: "条目", category: "correction", weight: 1, lastHit: 1, createdAt: 1 }];
  const card = { content: "字".repeat(900), entries, history: [] };
  const r = P.renderCard(card, { budget: 500, now: 1000 });
  assert.equal(r.injected.length, 0);
  assert.ok(r.text.includes("字"));
});

test("persona: set 覆盖正文会把旧正文推进历史，可回滚", () => {
  const dir = mkdtempSync(join(tmpdir(), "soul-persona-"));
  process.env.DSH_SOUL_HOME = dir;
  let doc = P.defaultPersonaDoc();
  doc = P.putPersona(doc, "测试", "第一版");
  doc = P.putPersona(doc, "测试", "第二版");
  assert.equal(doc.cards["测试"].history.length, 1);
  assert.equal(doc.cards["测试"].history[0].content, "第一版");
  const rolled = P.rollbackPersona(doc, "测试", 0);
  assert.equal(rolled.cards["测试"].content, "第一版");
  assert.equal(rolled.cards["测试"].history.length, 2);
});
