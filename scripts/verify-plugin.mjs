/**
 * verify-plugin.mjs —— 安装前预检（零风险，不碰 DSH 配置）
 *
 * 覆盖三件事：
 * 1. 包声明：dsh.bundle.patch 是否指向真实存在的 cordis.patch.yml
 * 2. 挂载声明：patch 里的 insert 条目 id/name 是否与包名一致
 * 3. 运行时：主入口能否 import，apply 是否会抛错，工具是否注册
 */
import { readFile } from "node:fs/promises";
import { mkdtempSync, existsSync, copyFileSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 预检不读真实状态文件：指向一个空临时目录，渲染回落默认状态
process.env.DSH_SOUL_HOME = mkdtempSync(join(tmpdir(), "dsh-soul-evolve-verify-"));

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const fails = [];

const ok = (cond, msg) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) fails.push(msg);
};

// 1. 包声明
ok(pkg.name === "dsh-soul-evolve", `包名: ${pkg.name}`);
ok(pkg.type === "module", `模块类型: ${pkg.type}`);
const patchRef = pkg.dsh?.bundle?.patch;
ok(Boolean(patchRef), `dsh.bundle.patch 已声明: ${patchRef ?? "缺失"}`);
ok(!pkg.dsh?.profile, "没有误写 dsh.profile（那会让 DSH 读不到挂载声明）");

// 2. 挂载声明
let patchText = "";
try {
  patchText = await readFile(join(root, patchRef ?? "cordis.patch.yml"), "utf8");
  ok(true, "cordis.patch.yml 可读取");
} catch {
  ok(false, "cordis.patch.yml 缺失");
}
ok(/-\s*insert:/.test(patchText), "patch 含 insert 段");
ok(new RegExp(`id:\\s*${pkg.name}\\b`).test(patchText), `entry id 与包名一致（${pkg.name}）`);
ok(new RegExp(`name:\\s*['"]?${pkg.name}['"]?`).test(patchText), `entry name 指向包入口（${pkg.name}）`);
ok(!/\|\s*#|id:\s*\S+\s+#/.test(patchText), "entry 行没有行尾注释（商城预检要求）");

// 2b. 客户端半侧（升级按钮）
ok(pkg.exports?.["./client"] === "./client.js", `exports 暴露 ./client: ${pkg.exports?.["./client"] ?? "缺失"}`);
ok(pkg.dsh?.client?.platform === "web", `dsh.client.platform: ${pkg.dsh?.client?.platform ?? "缺失"}`);
ok(existsSync(join(root, "client.js")), "client.js 存在");
let clientText = "";
try {
  clientText = await readFile(join(root, "client.js"), "utf8");
  ok(clientText.includes("window.__ModuleLoader__.load"), "client.js 是 ModuleLoader 形态");
  ok(clientText.includes("plugins.detail.actions"), "client.js 注册 plugins.detail.actions 插槽");
  ok(clientText.includes("plugins.bundle.config"), "client.js 注册插件配置面板（plugins.bundle.config）");
  ok(clientText.includes('PREFIX = "/dsh-soul-evolve"'), "client.js 使用正确 API 前缀");
  ok(clientText.includes("/api/upgrade"), "client.js 调用升级接口");
  ok(clientText.includes("/api/personas"), "client.js 调用 Soul 接口");
  ok(clientText.includes("x-soul-action"), "client.js 写操作带 CSRF 防护头");
  ok(clientText.includes("/api/personas/entries"), "client.js 支持增删演化条目");
  ok(clientText.includes("/api/personas/rollback"), "client.js 支持回滚历史版本");
  ok(clientText.includes("超预算"), "client.js 显示注入预算占用");
  ok(clientText.includes("SCENE_LABELS"), "client.js 显示当前场景");
} catch {
  ok(false, "client.js 不可读");
}

// 3. 运行时
try {
  const mod = await import(join(root, pkg.main));
  ok(typeof mod.apply === "function", "导出 apply");
  ok(typeof mod.name === "string", "导出 name");
  ok(Array.isArray(mod.inject), "导出 inject");
  ok(!("Config" in mod) || typeof mod.Config?.validate === "function",
    "若导出 Config，必须有 validate 方法（否则框架调用会崩）");

  const registered = [];
  const sections = [];
  const contexts = [];
  let sessionHandler = null;
  const ctx = {
    tools: { register: (t) => registered.push(t) },
    systemPrompt: { section: (s) => sections.push(s), context: (c) => contexts.push(c) },
    effect: (fn, label) => {
      const dispose = fn();
      return () => dispose?.();
    },
    on: (name, fn) => {
      if (name === "session/event") sessionHandler = fn;
      return () => {
        sessionHandler = null;
      };
    },
  };
  const res = mod.apply(ctx, {});
  ok(Array.isArray(res?.warnings), "apply 返回 warnings");
  ok(registered.length === 3, `注册工具数: ${registered.length}（期望 3）`);
  ok(registered.every((t) => t?.name && t?.description), "工具含 name/description");
  ok(contexts.length === 2, `注册动态上下文数: ${contexts.length}（期望 2：Soul + 状态）`);
  ok(contexts.every((c) => typeof c.text === "function"), "两个上下文都用函数文本（每轮重算）");
  const byName = Object.fromEntries(contexts.map((c) => [c.name, c]));
  ok(byName["soul:persona"] !== undefined && byName["soul:state"] !== undefined, "分别注册了 Soul 段与状态段");
  ok(sections.length === 0, `有 context 时不再注册静态段: ${sections.length}（期望 0）`);
  ok(typeof sessionHandler === "function", "挂载了 session/event 自动更新监听");
  let rendered = "";
  try {
    rendered = byName["soul:state"].text({});
    ok(typeof rendered === "string" && rendered.includes("人格状态"), "状态上下文文本可渲染且含状态段");
  } catch (err) {
    ok(false, `上下文文本渲染失败: ${err.message}`);
  }

  // 3b. 自动更新端到端：模拟一条真人消息，状态应该被反射弧改写
  if (typeof sessionHandler === "function") {
    const stateFile = join(process.env.DSH_SOUL_HOME, "state.json");
    sessionHandler(
      { header: { id: "verify-session" } },
      { type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "谢谢你，太好了" }] } }
    );
    await new Promise((r) => setTimeout(r, 200));
    try {
      const st = JSON.parse(readFileSync(stateFile, "utf8"));
      ok(st.mood.valence > 0, `自动更新写入了状态（valence=${st.mood.valence}）`);
      ok(Array.isArray(st.events) && st.events.length >= 1, "自动更新记录了事件");
      const before = st.events.length;

      // 非真人来源（goal / 团队注入）不该改动状态
      sessionHandler({}, { type: "user/message", data: { source: { kind: "goal" }, content: [{ type: "text", text: "系统注入" }] } });
      await new Promise((r) => setTimeout(r, 150));
      const st2 = JSON.parse(readFileSync(stateFile, "utf8"));
      ok(st2.events.length === before, "goal 来源消息被忽略");
    } catch (err) {
      ok(false, `自动更新校验失败: ${err.message}`);
    }
  }
} catch (err) {
  ok(false, `运行时加载失败: ${err.message}`);
}

// 4. Soul 面板：存储 → 注入文本 → 校验（含 {{ }} 拒绝）
try {
  const persona = await import(join(root, "src/persona.js"));
  let doc = persona.loadPersonas();
  ok(doc.active === persona.DEFAULT_CARD_NAME, `首次安装种入默认人格（激活 ${persona.DEFAULT_CARD_NAME}）`);
  ok(Object.keys(doc.cards).length === 1, "首次安装只有一张默认卡");
  ok(doc.cards[doc.active].content.includes("## Identity"), "默认人格带 Identity 段，开箱可用");
  doc = persona.putPersona(doc, "测试 Soul", "## Identity\n你是测试助手。\n\n## Personality\n- 简洁");
  persona.savePersonas(doc);
  const injected = persona.readActivePersona();
  ok(injected.includes("## Identity"), "Soul 注入文本包含正文");
  ok(injected.includes("Soul 面板"), "Soul 段带标题");
  ok(persona.listPersonas(doc).length === 2, "Soul 列表可读（默认卡 + 新建卡）");

  let rejected = false;
  try {
    persona.validateContent("坏内容 {{x}}");
  } catch {
    rejected = true;
  }
  ok(rejected, "拒绝含 {{ }} 的 Soul 内容（会破坏提示词组装）");

  const renamed = persona.setActive(doc, null);
  ok(persona.renderPersonaSection(renamed) === "", "停用后注入为空串");

  // 清理预检自己写的内容（临时 DSH_SOUL_HOME）
  persona.savePersonas({ version: 1, active: null, cards: {} });
} catch (err) {
  ok(false, `Soul 面板失败: ${err.message}`);
}

// 5. 升级逻辑端到端：把本包复制成一份"已安装副本"，再从源码同步过去
try {
  const { syncFromSource } = await import(join(root, "src/upgrade.js"));
  const fake = mkdtempSync(join(tmpdir(), "dsh-soul-evolve-install-"));
  for (const f of ["package.json", "cordis.patch.yml", "client.js"]) {
    copyFileSync(join(root, f), join(fake, f));
  }
  cpSync(join(root, "src"), join(fake, "src"), { recursive: true });
  // 模拟旧版浏览器半侧：升级必须覆盖 client.js，否则配置面板不会出现
  writeFileSync(join(fake, "client.js"), "// stale client", "utf8");
  const result = syncFromSource({ source: root, target: fake });
  ok(result.ok === true, "升级同步返回成功");
  ok(result.restartRequired === true, "升级后标记需要重启");
  ok(result.files > 0, `同步文件数: ${result.files}`);
  ok(readFileSync(join(fake, "client.js"), "utf8").includes("plugins.bundle.config"), "升级会同步 client.js（浏览器半侧）");
  ok(existsSync(join(fake, "templates", "default-soul.md")), "升级会同步默认人格模板（少了它首次安装就没有开箱内容）");
  ok(existsSync(join(fake, "LICENSE")), "升级会同步 LICENSE");
  ok(existsSync(join(result.backup, "src")), "升级前生成了备份");
  ok(existsSync(join(result.backup, "client.js")), "升级前备份了 client.js");
} catch (err) {
  ok(false, `升级逻辑失败: ${err.message}`);
}

// 6. 观测层：turns.jsonl 写入 + 去重 + 统计脚本可用
try {
  const trace = await import(join(root, "src/trace.js"));
  const modality = await import(join(root, "src/index.js"));
  const traceFile = join(process.env.DSH_SOUL_HOME, "turns.jsonl");
  ok(existsSync(traceFile), "观测层写入了 turns.jsonl");

  const before = trace.readTurns().length;
  // 同一次请求里渲染可能被调用多次；去重后最多只应多 1 行
  modality.renderSoulContextWithTrace();
  modality.renderSoulContextWithTrace();
  const after = trace.readTurns().length;
  ok(after - before <= 1, `重复渲染最多多记 1 行（去重生效，+${after - before}）`);

  const rows = trace.readTurns();
  const last = rows[rows.length - 1] ?? {};
  ok(typeof last.scene === "string", `记录里带场景字段: ${last.scene}`);
  ok(last.knobs && typeof last.knobs.warmth === "number", "记录里带调制旋钮");
  ok(typeof last.panelLen === "number", "记录里带面板注入长度");

  const statsMod = await import(join(root, "scripts/stats.mjs"));
  const stats = statsMod.computeStats(rows);
  const checks = statsMod.judge(stats);
  ok(Array.isArray(checks) && checks.length === 4, `统计脚本输出 ${checks?.length} 条验收项`);
} catch (err) {
  ok(false, `观测层校验失败: ${err.message}`);
}

// 6b. 状态作用域：global / workspace 切换
try {
  const stateMod = await import(join(root, "src/state.js"));
  stateMod.setStateScope("global");
  const globalPath = stateMod.statePath();
  ok(!globalPath.includes("workspaces"), `global 作用域路径: ${globalPath}`);
  stateMod.setStateScope("workspace");
  const wsPath = stateMod.statePath();
  ok(wsPath.includes("workspaces"), `workspace 作用域按工作目录分桶: ${wsPath}`);
  ok(stateMod.getStateScope() === "workspace", "作用域可读取");
  ok(stateMod.legacyStatePath() === null || !stateMod.legacyStatePath()?.includes("dsh-soul/"), "workspace 模式不回退读旧全局状态");
  stateMod.setStateScope("global");
  ok(stateMod.statePath() === globalPath, "可以切回 global");
} catch (err) {
  ok(false, `状态作用域校验失败: ${err.message}`);
}

// 7. 后端路由端到端：Soul 面板的条目 / 回滚 / 观测接口
try {
  const { createHandler } = await import(join(root, "src/api.js"));
  const handler = createHandler();
  const call = async ({ method = "GET", url = "/", headers = {}, body = null }) => {
    const chunks = body === null ? [] : [Buffer.from(JSON.stringify(body))];
    const req = {
      method,
      url,
      headers,
      async *[Symbol.asyncIterator]() {
        for (const c of chunks) yield c;
      },
    };
    const res = {
      code: 0,
      payload: "",
      writeHead(code) {
        this.code = code;
      },
      end(payload) {
        this.payload = payload;
      },
    };
    await handler(req, res);
    return { code: res.code, body: JSON.parse(res.payload || "{}") };
  };
  const H = { "x-soul-action": "1" };
  const P = "/dsh-soul-evolve/api";

  const created = await call({ method: "PUT", url: `${P}/personas`, headers: H, body: { name: "预检卡", content: "# 预检卡\n\n## Identity\n测试" } });
  ok(created.code === 200 && created.body.ok, "PUT /personas 建卡成功");

  const added = await call({ method: "POST", url: `${P}/personas/entries`, headers: H, body: { name: "预检卡", text: "用户嫌长，以后默认短说", category: "correction" } });
  ok(added.code === 200 && added.body.added === true, "POST /personas/entries 加入条目");
  ok(added.body.card?.inject?.budget === 4000, `注入预算暴露给前端: ${added.body.card?.inject?.budget}`);

  const dup = await call({ method: "POST", url: `${P}/personas/entries`, headers: H, body: { name: "预检卡", text: "嫌长，以后默认短说", category: "correction" } });
  ok(dup.code === 200 && dup.body.added === false, "近似条目按命中处理（不重复新增）");

  const detail = await call({ method: "GET", url: `${P}/personas/${encodeURIComponent("预检卡")}` });
  ok(detail.code === 200 && detail.body.entries.length === 1, `GET /personas/<name> 返回条目数 ${detail.body.entries?.length}`);
  ok(detail.body.entries[0].injected === true, "条目默认在预算内（injected=true）");

  const noHeader = await call({ method: "POST", url: `${P}/personas/entries`, body: { name: "预检卡", text: "无头" } });
  ok(noHeader.code === 403, "写接口缺 x-soul-action 头被拒（CSRF）");

  const rid = detail.body.entries[0].id;
  const delEntry = await call({ method: "DELETE", url: `${P}/personas/entries?name=${encodeURIComponent("预检卡")}&id=${encodeURIComponent(rid)}`, headers: H });
  ok(delEntry.code === 200 && delEntry.body.card.entries.length === 0, "DELETE /personas/entries 删除条目");

  const hist = await call({ method: "PUT", url: `${P}/personas`, headers: H, body: { name: "预检卡", content: "# 预检卡 v2" } });
  ok(hist.code === 200, "再次 PUT 覆盖正文");
  const detail2 = await call({ method: "GET", url: `${P}/personas/${encodeURIComponent("预检卡")}` });
  ok(detail2.body.history.length === 1, `历史版本数 ${detail2.body.history?.length}`);
  const rb = await call({ method: "POST", url: `${P}/personas/rollback`, headers: H, body: { name: "预检卡", index: 0 } });
  ok(rb.code === 200 && rb.body.card.content.includes("## Identity"), "POST /personas/rollback 回滚正文");

  const traceRes = await call({ method: "GET", url: `${P}/trace?limit=5` });
  ok(traceRes.code === 200 && Array.isArray(traceRes.body.turns), `GET /trace 返回 ${traceRes.body.total} 条观测`);

  /* 交互沉淀：预览只读、写入要动作头、证据能回到面板 */
  const pats = await call({ method: "GET", url: `${P}/patterns` });
  ok(pats.code === 200 && pats.body.stats && Array.isArray(pats.body.ready), "GET /patterns 返回统计与候选");
  ok(typeof pats.body.gates?.minDays === "number", `沉淀门槛暴露给前端（跨天 ≥ ${pats.body.gates?.minDays}）`);
  const patsNoHeader = await call({ method: "POST", url: `${P}/patterns/sediment` });
  ok(patsNoHeader.code === 403, "沉淀写接口缺 x-soul-action 头被拒（CSRF）");

  /* 源码升级是开发通道：没配 DSH_SOUL_SOURCE 时必须干净关闭，而不是指向不存在的目录 */
  const savedSource = process.env.DSH_SOUL_SOURCE;
  delete process.env.DSH_SOUL_SOURCE;
  const statusNoSource = await call({ method: "GET", url: `${P}/status` });
  ok(statusNoSource.body.upgradeAvailable === false, "非本地链接安装时不提供源码升级入口");
  ok(statusNoSource.body.source === null, "未配源码时 status.source 为 null（前端据此隐藏入口）");
  const upgradeDenied = await call({
    method: "POST",
    url: `${P}/upgrade`,
    headers: { "x-soul-action": "1" },
  });
  ok(upgradeDenied.code === 400, `未配源码时升级接口返回 400（实际 ${upgradeDenied.code}）`);
  ok(/DSH_SOUL_SOURCE/.test(upgradeDenied.body.error || ""), "错误信息说明该如何打开这个开发通道");
  if (savedSource !== undefined) process.env.DSH_SOUL_SOURCE = savedSource;

  // 清掉预检建的东西
  const { savePersonas } = await import(join(root, "src/persona.js"));
  savePersonas({ version: 2, active: null, cards: {} });
} catch (err) {
  ok(false, `后端路由校验失败: ${err.message}`);
}

console.log(`\n${fails.length === 0 ? "预检通过，可以安装" : `预检失败 ${fails.length} 项，禁止安装`}`);
process.exit(fails.length === 0 ? 0 : 1);
