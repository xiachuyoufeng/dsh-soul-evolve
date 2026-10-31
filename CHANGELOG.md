# Changelog

## 0.6.0 — 2026-10-30

改名：人设卡 → **Soul 面板**。

- 「人设卡」统一改称「Soul 面板」（UI 标题、按钮、提示、错误信息、README）；注入段标题改为 `## Soul 面板`
- 内部标识保持不变：`soul_persona` 工具、`/api/personas*` 接口、`soul:persona` 提示词段名——改名只影响显示文案
- 配合方案 B：人格从 memory 轨迁到 Soul 面板；面板正文内含 `## Evolution` 段，演化写入目标是 Soul 面板（`soul_persona set`），不再是 memory 人格条目
- 预检：47 项全过

## 0.5.1 — 2026-10-30

修复：升级漏同步 `client.js`。

- **修复**：`src/upgrade.js` 的同步清单补上 `client.js`——此前升级只同步服务端代码，浏览器半侧仍是旧文件，导致「配置面板」不出现（升级按钮在，面板不在）
- 备份与回滚同步覆盖 `client.js`
- 预检：新增「升级会同步 client.js」「备份含 client.js」两项，共 47 项

## 0.5.0 — 2026-10-30

人设卡 + 配置面板。

- **新增：人设卡**（`src/persona.js`）——soul.md 风格 Markdown，多张卡 + 激活一张；注入 `soul:persona` 段（order 10，状态段之前）；`{{`/`}}` 直接拒绝保存；支持导入/导出 .md
- **新增：`soul_persona` 工具**——list / get / set / delete / activate
- **新增：配置面板**（`plugins.bundle.config`）——状态五维数值 + 事件列表、人设卡管理（选择/编辑/保存/激活/停用/删除/导入/导出）、升级入口
- **新增：状态与人设接口**——`GET/POST /api/state`、`GET/PUT/DELETE /api/personas*`；写操作要求 `x-soul-action: 1` 头防 CSRF
- 重构：同步状态读取收敛到 `state.js: readStateSync`，api 与 index 共用
- 预检：扩到 45 项（人设存储/注入文本/`{{}}` 拒绝/停用为空/面板断言）

## 0.4.0 — 2026-10-30

改名 + 状态自己会变。

- **改名**：`dsh-soul` → `dsh-soul-evolve`（npm 上 `dsh-soul` 已被占用）。包名、挂载 id、API 前缀（`/dsh-soul-evolve`）、client bundle id、日志前缀全部更新
- **新增：每轮自动更新**（`src/auto-update.js`）——监听 `session/event` 的 `user/message`，只认真人来源，跑反射弧把增量写进状态；写串行化避免并发丢更新；异常只告警
- **新增：手动工具与自动更新共用同一串行队列**，避免读-改-写竞争
- **兼容**：状态目录迁到 `~/.dsh-soul-evolve/`，新路径为空时回退读旧 `~/.dsh-soul/state.json`，不丢历史
- 配置：`apply(ctx, { autoUpdate: false })` 可关闭自动更新
- 预检：新增自动更新端到端断言（模拟真人消息 / goal 消息被忽略）

## 0.3.0 — 2026-10-30

支持"点击升级"（插件详情页按钮）。

- 新增：`plugins.detail.actions` 插槽里的「从本地源码升级」按钮（`client.js`）——官方「更新」按钮只对内置目录的包生成，第三方本地包只能自备入口
- 新增：后端升级路由 `POST /dsh-soul-evolve/api/upgrade`、`GET /dsh-soul-evolve/api/status`（`src/api.js`），只挂载在有 `webServer` 的界面
- 新增：`src/upgrade.js`——校验源/目标都是 dsh-soul-evolve 包 → 备份当前副本 → 逐文件原子写（临时文件 + rename），失败自动回滚
- 安全：升级接口要求 `x-soul-upgrade: 1` 自定义头（跨域预检挡住 CSRF）
- 变更：升级只同步包文件（`src/*.js`、`package.json`、`cordis.patch.yml`、`README.md`），不碰 profile 依赖与 generation 元数据，因此不会触发依赖重装
- 预检：扩到 30 项，新增客户端 bundle 形态与升级端到端断言

## 0.2.0 — 2026-10-30

状态注入真正接通。

- 修复：`inject` 补 `systemPrompt`——此前没声明，cordis 访问即抛错，注入被能力探测静默跳过
- 修复：注入内容改读真实状态文件（此前用 `defaultState()`，每轮都是同一段假文案）
- 修复：机制从 `systemPrompt.section`（静态字符串）换成 `systemPrompt.context({ text: () => … })`，每次组装提示词重新求值
- 新增：无 context 的旧版 DSH 退化为静态 section，并给出降级告警
- 预检：从 16 项扩到 20 项，新增"动态上下文注册 / 函数文本 / 可渲染"断言
- 已知限制不变：仍无每轮自动写入（靠模型主动调用工具），仍无并发写锁

## 0.1.0 — 2026-10-29

重建版。首个可运行版本。

- 状态层：情绪效价/激活/能量/亲近度，含时间衰减与范围夹紧
- 反射弧：规则驱动输入→增量→调制
- 合成引擎：C1–C6 六条硬约束，含驳回原因
- 适配层：版本探测、能力检测、降级
- 入口：soul_state / soul_evolve 两工具 + 状态调制提示注入
- 修正：插件包声明改为 `dsh.bundle.patch`，补 `cordis.patch.yml`（此前误写 dsh.profile 导致 DSH 启动崩溃）
- 新增：`scripts/verify-plugin.mjs` 安装前预检（16 项）
- 测试：15 个用例通过
