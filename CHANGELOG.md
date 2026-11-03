# Changelog

## 1.3.1 — 2026-11-03

修一个让整个面板消失的崩溃，并补上本来该有的防线。

- **修：配置面板整个消失**。1.3.0 重写 PatternPanel 时漏了 `var emitted = ...` 一行，渲染到 `emitted.length` 抛 ReferenceError，React 卸掉整棵子树，用户看到的是「面板不见了」。语法检查、61 个单元测试、发布预检三样全绿——因为**没有一个环节真的渲染过组件**
- **加 `test/client-render.test.js`（4 例）**：mock React 的 hooks，把每个面板按「有数据 / 无数据 / 够格 / 不够格」各渲染一遍，并用惰性树 + walk 模拟真实渲染顺序。反向验证过：把漏掉的声明删掉，测试立刻红
- **加单块错误边界**：每块面板包一层，某块崩了只显示「加载失败 + 报错」并留一句提示，其余面板照常工作。上面的反向验证确认了它确实接住：同样的 bug 下 ConfigPanel 测试仍然通过（转成提示卡），而单独渲染 PatternPanel 的测试报错
- `module.exports` 增加 `__components` 供测试取子组件（生产只调 `apply`，无影响）

教训写在这里：`node --check` 只能查语法，单元测试只测纯函数，预检只测接口形状。**界面代码要测，就得真的渲染它一次。**

## 1.3.0 — 2026-11-03

面板从"五行文字"改成能看出量的图形。原则是不加动画、渐变、阴影，只用细线、单色填充和徽章。

- **状态条加基线刻度**：原来只有填充条和数字，`效价 0.41` 看不出偏高还是偏低。现在条上有一根竖线标基线，数字后面跟上偏离量（`+0.41`），效价这种带正负的维度从基线向两侧生长、负向转红
- **表达旋钮单独成条**：长度 / 温度 / 耐心三个系数原来挤在一行文字里，现在各占一根细条
- **观测改成四个数字块 + 按天柱状图**：一眼看出数据是均匀在聊，还是某一天一次灌进来的（当前 11-02 有 812 轮、11-03 有 607 轮）
- **反射弧命中改成横向条形**：短输入 / 追问 / 正反馈各命中几次，这是推断条目的直接依据；看不见就看不懂条目为什么长出来
- **沉淀候选合并成一张表**：原来「够格的」和「还差一点的」是两个文字列表，看不出还差多少。现在同一张表，每个候选一行，会话 / 跨天 / 轮次各一根进度条，达标的显示 ✓，最右列直接写「差 1 天」
- **演化条目加类别徽章和权重条**：类别用色块区分（工作习惯蓝、性格表达绿），细条是有效权重——权重越低越先被淡出，这件事原来只藏在一个数字里
- 后端配套：`gateOf()` 返回 `have`/`need` 原始数值（没有数值画不出比例）、`analyze()` 增加按天分布 `daily`、`/api/state` 暴露 `baseline`
- 测试 61 例

## 1.2.2 — 2026-11-03

一天后的真实观测（909 轮 / 10 会话）暴露出两个问题，都用真实数据跑出来才发现：

- **修 bug：面板看不到反射弧命中**。`preview()` 的 stats 是手工挑字段构造的，1.2.0 加 reflex 统计时漏了这一处，导致面板「观测统计」里命中数恒为空——而命中数正是推断条目的直接依据
- **移除 `character:scene:*` 检测器**。它产出的是「work 场合占 51% → 默认姿态落在 work」，同义反复：场景已由「人格状态」段每轮实时注入，而且 `work` 是内部枚举，写进条目没有指导意义。它还抢占了 character 轨唯一的写入名额，把 `curious` / `feedback` 挤掉
- **检测器按信息量排序**：`habit` 轨 `direct` 提到 `ongoing` 前（「少反问先做掉」能直接改行为，「会话长」只是对话事实）；`character` 轨改为 `curious` → `feedback` → `steady`（「别乱变」信息量最低，排最后）
- 删除两个已无引用的常量 `MIN_SIGNAL_HITS`、`TOP_SCENE_SHARE`
- 测试 61 例

实测效果对比（同一批真实观测，模拟跨天够格）：

```
改前：[character:scene:work] work 场合占 460/904 轮（51%）→ 默认姿态就落在这一档
改后：[character:curious]    追问原因 119/909 轮（13%）  → 先给机制和依据再落结论
```

## 1.2.1 — 2026-11-02

- **覆盖查重扩展到 memory-evolve**：新增 `memoryLines()`，只读 `MEMORY.md` / `USER.md`（含归档，支持 `DSH_MEMORIES_DIR` 覆盖）。两个插件都在改同一份"该怎么做事"，不查对方就会各写一条同义结论
- **门槛缺口写清还差多少**：`跨天 1/3` → `跨天 1/3（还差 2 天）`，面板上一眼知道要等多久
- README 补「与 memory-evolve 的分工」：memory 存用户明说过的，本插件存统计出来的；冲突时 memory 优先（后注入且经用户确认）
- 测试 59 例

## 1.2.0 — 2026-11-02

**两条沉淀轨道分开：工作方法习惯 / 性格表达**

原来一个 `pattern` 类混装所有推断条目，"该怎么做"和"该什么语气"写在同一段里，互相盖掉。
现在拆成两个维度，各自算、各自写、各自注入：

| 轨道 | 写什么 | 检测器 | 初始权重 / 半衰 |
|---|---|---|---|
| `habit` | 怎么干活（连续协作、要不要请示） | `habit:ongoing` `habit:direct` | 0.5 / 60 天 |
| `character` | 以什么姿态出现（基调、口风、追问、反馈） | `character:scene:*` `character:steady` `character:curious` `character:feedback` | 0.45 / 45 天 |

- `src/pattern.js`：`analyze()` 增加反射弧命中统计；候选带 `dimension`；新增 `dimensionOf()`、`DIMENSION_LABEL`
- `src/persona.js`：`INITIAL_WEIGHT`/`HALF_LIFE` 换成分维度；`renderCard()` 注入分成 `## Evolved` / `## 工作习惯` / `## 性格表达` 三段
- `src/sediment.js`：每个维度各写 1 条（一边不够格不挡另一边）；新增 `coverageOf()` 字面覆盖检查
- `src/evolve.js`：`qualifiesInferred()` 要求 `dimension` 落在两条轨道内；`BANNED` 增加"声称内在状态"两条
- `client.js`：面板条目显示中文类别名，候选按轨道分组
- **habit 轨只收带数字的观测结论**。`habit:brief`（"回复该短"）已移除——面板正文早就手写了"默认短"，memory 的 user 轨也存得下，再统计一遍只是把同一句话重说一次
- **覆盖查重**：写入前与面板正文、已有条目做字面相似度（阈值 0.3，实测重述 45% / 真实候选 ≤9%），撞了就跳过并记录原因
- 测试 58 例；预检 86 项

## 1.1.0 — 2026-11-02

**交互沉淀：性格从交互里长出来，不再只靠用户点名纠正**

- 新增 `src/pattern.js`：把逐轮观测聚合成候选模式（场景主导 / 输入偏短 / 场景稳定 / 长会话），每条候选自带 `evidence`（会话数、天数、轮次、起止时间）
- 新增 `src/sediment.js`：编排层，负责读观测、写卡、记账（`patterns.json`）；全局冷却 1 天、一次最多 1 条、同一 `patternKey` 冷却 14 天
- `src/evolve.js`：新增 `qualifiesInferred()`（推断入口，带证据门槛）；`qualifies()` 明确拒绝 `pattern`，**模型无法通过 soul_evolve 自造证据写性格**
- `src/persona.js`：新增 `pattern` 类（初始权重 0.45、半衰 45 天）、`evidence`/`patternKey` 字段与 `normalizeEvidence()`；`cardDetail` 暴露证据
- `src/auto-update.js`：每 `sedimentEvery`（默认 15）轮真人输入跑一次沉淀，排在状态写之后，失败只告警
- `src/api.js`：`GET /api/patterns`（只读预览）、`POST /api/patterns/sediment`（需 `x-soul-action`）
- `client.js`：新增「交互沉淀」面板（统计 / 够格候选 / 还差几天 / 立即沉淀），条目行显示「依据 N 会话/M 轮」
- 门槛：独立会话 ≥ 3、跨天 ≥ 3、相关轮次 ≥ 12。真实数据下只有一天时一条也不会写——这是设计，不是故障
- 测试：新增 `test/pattern.test.js`（15 例），`npm test` 51 例全绿；verify 预检 85 项

## 1.0.0 — 2026-11-02

四个层次一次落地：观测 → 场景 → 预算 → 作用域。

**v0.7 观测层（新增 `src/trace.js`）**
- 每轮注入时追加一行 JSON 到 `~/.dsh-soul-evolve/turns.jsonl`：时间、会话、场景、五维状态、三个旋钮、输入长度、面板注入长度、命中规则
- 去重按 `(会话, 秒, 输入长度)`：提示词渲染一次请求里可能被调用多次，不去重行数会翻倍
- 超 2 MB 轮转到 `turns.1.jsonl`；任何异常静默吞掉——观测坏了也不能影响注入
- 新增 `scripts/stats.mjs`：场景分组均值、温差、切换率、面板长度趋势、规则命中分布，以及四条验收线的 ✓/✗

**v0.8 场景切面（新增 `src/scene.js`，`reflex.modulate(state, scene)`）**
- 四场景 work / tech / support / chat，**默认 work**：判错场景比不判更糟
- 滞回：连续两轮占优，或单轮得分 ≥ max(2, 当前场景分 × 1.5) 才切换；隔 6 小时以上连续计数清零
- 场景偏移加在调制层而不是状态层：状态是同一份，表达才分场合
- 副语言作为状态外显：`hesitation`（精力 < 0.35）/ `fragmented`（专注 < 0.4），状态高时为 false，就不该出现

**v0.9 演化条目加权 + 注入预算（`src/persona.js` 升到 schema v2）**
- 卡片结构变 `{ content, entries[], history[] }`；正文（手写基底）与演化条目分开
- 权重：correction 1.0 / repeat 0.9（不衰减）、preference 0.6（90 天半衰期）、scene 0.4（30 天半衰期）
- 写入时判重：同类别 Jaccard ≥ 0.5 视为再次命中，旧条目权重 +0.1，不新增（避免逐轮语义匹配的开销）
- 注入硬预算 4000 字：正文优先完整保留，剩余按权重给条目；被截断的条目仍留在存储里，面板标灰「未注入」
- 历史：`set` 覆盖正文时旧正文进历史（保留 10 版），可一键回滚
- `soul_persona` 新增 action：`evolve`（加条目）/ `forget`（删条目）/ `history` / `rollback`
- 新增接口：`POST/DELETE /api/personas/entries`、`POST /api/personas/rollback`、`GET /api/trace`

**v1.0 状态作用域 + 主体性**
- 配置 `stateScope: "global" | "workspace"`（默认 global）；workspace 模式按工作目录哈希分桶，项目之间状态不串味
- 「主体性」不写成代码，落在 Soul 面板的 Boundaries（DSH 本身已有审批策略，插件重复实现只会打架）

**公开发布准备**
- **首次安装不再是空白**：自动种入 `templates/default-soul.md`（通用默认人格，已激活）；改它就是自己的，删掉不会自动长回来
- **源码升级改成本地链接才出现**：读 `generation.json` 的 `sourceSpec`，只有「本地目录安装」才提供这个开发通道；从 npm 装的用户拿到的 `source: null`，面板不渲染该区块，接口返回 400 带说明。不再有任何硬编码路径
- 补 `license: MIT`、`LICENSE`、`engines.dsh`（`>=0.2.1-rc.2`，对应 dsh 0.2.1-alpha.4 起的门禁规则）、`keywords`、`files`（含 templates）
- `scripts/sync-to-profile.sh` 改为自动探测安装位置（原先写死了一个早已失效的路径）

**其它**
- 状态 schema 升到 v2（补 `scene` 字段，老文件自动迁移）
- `soul_persona get` 现在返回条目、历史、注入占用
- 预检 80 项、单测 36 例全过

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
