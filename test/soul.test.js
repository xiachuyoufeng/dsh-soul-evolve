import test from "node:test";
import assert from "node:assert/strict";

import { defaultState, decay, applyDelta, migrate, STATE_VERSION } from "../src/state.js";
import { reflex, modulate, describe } from "../src/reflex.js";
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
  assert.equal(s.version, 1);
  assert.equal(s.energy, defaultState().energy);
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
