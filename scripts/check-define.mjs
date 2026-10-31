const TOOLS = "file:///Users/xiachu/.dsh/profiles/node_modules/@deepseek-ai/dsh-tools/lib/index.js";
const { defineTool } = await import(TOOLS);
const mod = await import("../src/index.js");
for (const factory of ["buildStateTool", "buildEvolveTool"]) {
  try {
    const tool = defineTool(mod[factory]());
    console.log(`✓ ${factory} 通过 defineTool 校验（name=${tool.name}）`);
  } catch (err) {
    console.log(`✗ ${factory} 校验失败: ${err.message}`);
  }
}
