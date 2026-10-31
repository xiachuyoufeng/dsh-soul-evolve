import { loadState, saveState, applyDelta, pushEvent, decay } from "../src/state.js";
import { reflex, modulate } from "../src/reflex.js";
import { synthesize } from "../src/evolve.js";

const now = Date.now();
let state = await loadState(now);
let d = reflex("你每次回复都这么长，人类不会这样", { now, lastAt: state.updatedAt });
state = applyDelta(state, d, now);
state = pushEvent(state, { at: now, note: "用户嫌长", delta: d });
d = reflex("不过分析挺有用的，谢谢", { now: now + 60_000, lastAt: now });
state = applyDelta(state, d, now + 60_000);
console.log("状态已保存:", await saveState(state));
console.log("调制:", modulate(decay(state, Date.now())));
console.log("合成:", synthesize([
  { kind: "correction", userExplicit: true, date: "2026-10-29", event: "用户嫌回复长", learned: "信息给全不是礼貌", next: "默认短说" },
]).entries.map((e) => e.line));
