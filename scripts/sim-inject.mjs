const m = await import("dsh-soul-evolve");
const registered = [];
const ctx = {
  tools: { register: (t) => registered.push(t.name) },
  get systemPrompt() { throw new Error('cannot get property "systemPrompt" without inject'); },
};
const r = m.apply(ctx, {});
console.log("注册工具:", registered.join(",") || "(无)");
console.log("warnings 数:", r.warnings.length);
