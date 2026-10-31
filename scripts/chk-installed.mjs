const mod = "file:///Users/xiachu/Library/Application%20Support/dsh-desktop/harness/profiles/web/node_modules/dsh-soul-evolve/src/index.js";
const m = await import(mod);
const tools = [];
const ctx = {
  tools: { register: (t) => tools.push(t) },
  get systemPrompt() { throw new Error('cannot get property "systemPrompt" without inject'); },
};
const r = m.apply(ctx, {});
console.log("工具:", tools.map((t) => `${t.name}(render:${typeof t.output?.render})`).join(", "));
console.log("warnings:", r.warnings.length);
