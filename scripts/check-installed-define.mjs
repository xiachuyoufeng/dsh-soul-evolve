const TOOLS = "file:///Users/xiachu/.dsh/profiles/node_modules/@deepseek-ai/dsh-tools/lib/index.js";
const INSTALLED = "file:///Users/xiachu/Library/Application%20Support/dsh-desktop/harness/profiles/web/node_modules/dsh-soul-evolve/src/index.js";
const { defineTool } = await import(TOOLS);
const mod = await import(INSTALLED);
for (const f of ["buildStateTool", "buildEvolveTool"]) {
  const t = defineTool(mod[f]());
  console.log(`✓ 安装目录 ${f} 通过校验（${t.name}）`);
}
