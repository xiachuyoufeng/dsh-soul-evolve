# dsh-soul-evolve

人格状态与缓慢演化插件（DeepSeek Harness）。

- **状态层**：情绪效价/激活/能量/亲近度，随时间衰减、随交互累积
- **反射弧**：输入 → 状态增量 → 表达调制（长度/温度/耐心旋钮，不宣告情绪）
- **每轮自动更新**：监听真人 `user/message`，自动跑反射弧累积状态（0.4.0 起）
- **合成引擎**：C1–C6 六条硬约束把事件提炼成人格条目
- **场景切面**：work / 技术 / 情绪支持 / 闲聊 四类场景，带滞回（1.0.0 起）
- **观测层**：每轮追加一行 JSON，`scripts/stats.mjs` 直接算验收指标（1.0.0 起）
- **注入预算**：演化条目按权重衰减排序，整段硬顶 4000 字（1.0.0 起）
- **适配层**：DSH 依赖收敛到 adapter.js，升级只改这一处

## 结构

```
src/state.js        状态存储：schema 版本、原子写入、衰减、作用域、旧路径回退
src/reflex.js       反射弧与表达调制（纯函数）
src/scene.js        场景判定（打分 + 滞回，纯函数）
src/trace.js        每轮观测（JSONL 追加、去重、轮转）
src/persona.js      Soul 面板：正文 + 演化条目 + 权重 + 注入预算 + 历史
src/evolve.js       六条约束（入口/格式/频率/冲突/体量/禁止）
src/adapter.js      版本探测、能力检测、降级
src/auto-update.js  每轮自动更新（session/event → 反射弧 → 场景 → 状态文件）
src/api.js          配置面板与升级按钮的后端路由
src/upgrade.js      升级：源码 → 已装副本的原子同步
src/index.js        cordis 入口：soul_state / soul_evolve 两个工具 + 动态状态注入
client.js           浏览器半侧：插件详情页的「从本地源码升级」按钮
cordis.patch.yml    挂载声明（DSH 按它把插件挂进配置树）
```

## 安装（重要）

插件包**必须**这样声明，否则 DSH 启动时读不到挂载声明：

```json
"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
```

`cordis.patch.yml` 内容：

```yaml
- insert:
    - id: dsh-soul-evolve
      name: 'dsh-soul-evolve'
```

安装：

```bash
dsh plugin add dsh-soul-evolve
```

装之前先跑预检（零风险，不碰 DSH 配置）：

```bash
node scripts/verify-plugin.mjs   # 74 项断言，全过才装
node --test test/soul.test.js    # 35 个用例
```

## 数据

- 状态文件：`~/.dsh-soul-evolve/state.json`（`DSH_SOUL_HOME` 可覆盖）
- `version` 字段 + `migrate()`：结构升级时写迁移分支
- 写文件用临时文件 + rename，避免崩溃损坏

## 升级（开发通道，默认关闭）

插件详情页的「从本地源码升级」按钮走这条路：

1. 校验源码目录与已装副本都是 `dsh-soul-evolve` 包
2. 把已装副本备份到 `~/.dsh-soul-evolve/upgrade-backups/<时间戳>/`
3. 把 `src/*.js`、`package.json`、`cordis.patch.yml`、`README.md` 逐文件原子写过去（临时文件 + rename）
4. 失败自动回滚，并返回备份路径
5. 完成后提示「重启 DSH 生效」

它只同步包文件，**不碰** profile 依赖、不改 generation 元数据，所以不会触发依赖重装，也不会让启动校验失败。

> 背景：官方「更新」按钮要求包有 `installTarget`，而它只对 DSH 内置的官方目录生成，第三方本地包永远没有——所以这里在 `plugins.detail.actions` 插槽里自备一个入口。

这条通道**只给开发用**，公开发布版默认关闭：没有设置 `DSH_SOUL_SOURCE` 时，接口返回不可用，配置面板不渲染「升级」区块、插件详情页也不出现按钮——不会留一个点下去就报错的入口。

自己开发时这样打开：

```bash
export DSH_SOUL_SOURCE=/path/to/dsh-soul-evolve
```

接口：

- `GET  /dsh-soul-evolve/api/status` — 已装版本 / 源码版本 / 源码目录
- `POST /dsh-soul-evolve/api/upgrade` — 执行同步（要求 `x-soul-upgrade: 1` 头）

## 数据

- 状态文件：`~/.dsh-soul-evolve/state.json`（`DSH_SOUL_HOME` 可覆盖）
- 改名前的旧状态：`~/.dsh-soul/state.json` 仍会被读取（新路径为空时回退，下次保存写入新路径）
- 升级备份：`~/.dsh-soul-evolve/upgrade-backups/<时间戳>/`
- `version` 字段 + `migrate()`：结构升级时写迁移分支
- 写文件用临时文件 + rename，避免崩溃损坏

## 每轮自动更新

0.4.0 起监听 `session/event` 里的 `user/message`：

1. 只处理 `source.kind === "user"` 的真人消息（跳过 goal / 团队 / 系统注入）
2. 取出文本块 → `reflex()` 算增量 → `applyDelta` → `pushEvent` → 原子写
3. 所有写入走同一个串行队列，避免多条消息并发读-改-写互相覆盖
4. 任何异常只告警，不影响会话

效果：状态会自己变——下一轮请求组装的提示词里读到的是新状态。
可用 `apply(ctx, { autoUpdate: false })` 关闭。

## 交互沉淀（1.1.0）

性格不只由「用户明确纠正」驱动，也会从交互本身慢慢长出来。

每 15 轮真人输入（`sedimentEvery` 可调）跑一次沉淀：把 `turns.jsonl` 里的逐轮观测聚合成候选，
够格的升级成 `pattern` 类演化条目，写回 Soul 面板：

| 模式 | 判据 | 生成的条目在说什么 |
|---|---|---|
| `scene:<场景>` | 某场景占比高、跨多个会话 | 默认基调落在这一档 |
| `input:short` | 输入中位长度 ≤ 25 字 | 回答默认就该短 |
| `scene:stable` | 每会话平均场景切换 ≤ 0.5 次 | 一次会话里口风稳住 |
| `session:long` | 每会话轮次中位 ≥ 12 | 这是连续协作，不是一次性问答 |

**三道闸，防止它给自己编人格：**

1. **证据门槛**：独立会话 ≥ 3、跨天 ≥ 3、相关轮次 ≥ 12，缺一不可。单次或单天出现的多半是任务要求，不是模式。
2. **模型写不进去**：`qualifies()` 明确拒绝 `kind: "pattern"`，只有插件自己的沉淀通道能产出这类条目（`qualifiesInferred()`）。模型不能自造证据。
3. **低权重 + 快半衰**：`pattern` 初始权重 0.45、半衰 45 天。推断错了会自己淡出；被反复验证（同一 `patternKey` 再次沉淀）权重 +0.1 才慢慢坐实。

另外两条节制：一次最多写 1 条、两次自动沉淀至少隔 1 天；同一 `patternKey` 冷却期内不重复写。

**看得见也能催**：配置面板「交互沉淀」区块显示观测统计、够格的候选、以及「还差几天」的候选（例如 `跨天 1/3`），旁边一个「立即沉淀」按钮（`POST /api/patterns/sediment`，`force` 可绕过全局冷却）。

条目上的 `evidence`（会话数/天数/轮次/起止时间）会存进卡片并在面板显示为「依据 3 会话/30 轮」，删除照旧走 `soul_persona(action=forget)` 或面板上的「删」。


## Soul 面板（0.5.0）

Soul 是"静态骨架"，状态是"动态血肉"：Soul 面板负责「我是谁、说话什么风格」，状态层负责「今天累不累、跟你熟不熟」。

- **格式**：`soul.md` 风格 Markdown（与市场里 soul-md 系 Soul 面板互通，可直接导入/导出）
- **存储**：`~/.dsh-soul-evolve/personas.json`（多张卡 + 当前激活）
- **注入**：激活卡作为 `soul:persona` 段（order 10）注入提示词，改完下一轮请求生效，无需重启
- **硬约束**：正文不能含 `{{` / `}}`（DSH 提示词变量语法，否则整个提示词组装会失败），保存时直接拒绝
- **工具**：`soul_persona`（list / get / set / delete / activate / evolve / forget / history / rollback），AI 可读写但不会自动改
- **开箱内容**：首次安装会自动种入一份通用默认人格（`templates/default-soul.md`），面板不是空白的；改它就是自己的，删掉不会自动长回来

### 正文与演化条目（1.0.0）

一张卡分两半：

| 部分 | 内容 | 谁写 | 注入策略 |
|---|---|---|---|
| `content` | 手写基底（Identity / Personality / Boundaries…） | 用户或 `set` | 优先完整保留 |
| `entries[]` | 演化条目（一条一句，带类别与权重） | `evolve` | 按权重排序，预算内取 Top-N |

权重与半衰期：`correction` 1.0 不衰减、`repeat` 0.9 不衰减、`preference` 0.6（90 天）、`scene` 0.4（30 天）。
写入时判重：同类别 Jaccard ≥ 0.5 视为再次命中，旧条目权重 +0.1，不新增。

整段注入硬顶 **4000 字**；被截掉的条目仍留在存储里，面板标灰「未注入」，权重回升后会自动回来。
`set` 覆盖正文时旧正文进历史（保留 10 版），可一键回滚。

### 场景切面（1.0.0）

四类场景 `work` / `tech` / `support` / `chat`，**默认 work**——判错场景比不判更糟。
滞回规则：新场景连续两轮占优，或单轮得分 ≥ max(2, 当前场景分 × 1.5) 才切换；间隔 6 小时以上连续计数清零。
场景偏移加在调制层（温度/长度/耐心），状态本身不分叉。

副语言是状态外显，不是开关：精力 < 0.35 才 `hesitation`，专注 < 0.4 才 `fragmented`，状态高时为 false 就不会出现。

## 配置面板（0.5.0）

插件页 → dsh-soul-evolve → 配置（`plugins.bundle.config` 插槽）：

| 区块 | 内容 |
|---|---|
| 人格状态 | 五维数值 + 条形图 + 表达旋钮 + 最近 6 条事件，可手动刷新 |
| Soul 面板 | 下拉选择 / 新建 / 编辑 / 保存 / 设为激活 / 停用 / 删除 / 导入 .md / 导出 .md |
| Evolved 条目 | 注入预算占用（X/4000 字）、条目列表（类别 · 有效权重 · 未注入标灰）、新增 / 删除、历史版本回滚 |
| 升级 | 从本地源码同步到已安装副本（点完重启生效） |

## 接口

- `GET  /dsh-soul-evolve/api/state` — 状态与调制
- `POST /dsh-soul-evolve/api/state` — `{ delta }` 手动调整
- `GET  /dsh-soul-evolve/api/personas` — Soul 列表
- `GET  /dsh-soul-evolve/api/personas/<name>` — 单张 Soul 正文 + 条目 + 历史 + 注入占用
- `POST /dsh-soul-evolve/api/personas/entries` — `{ name, text, category }` 加条目
- `DELETE /dsh-soul-evolve/api/personas/entries?name=<n>&id=<id>` — 删条目
- `POST /dsh-soul-evolve/api/personas/rollback` — `{ name, index }` 回滚正文
- `GET  /dsh-soul-evolve/api/trace?limit=<n>` — 观测记录
- `PUT  /dsh-soul-evolve/api/personas` — `{ name, content }` 新建/覆盖
- `PUT  /dsh-soul-evolve/api/personas/active` — `{ name }` 切换激活（null = 停用）
- `DELETE /dsh-soul-evolve/api/personas?name=<n>` — 删除
- `POST /dsh-soul-evolve/api/upgrade` — 同步源码到已装副本

写操作要求 `x-soul-action: 1` 头（跨域预检挡 CSRF）。

## 已知限制

- 自动更新只覆盖真人输入；工具结果、模型回复不会改变状态
- 多会话共用一个状态文件（未按会话隔离）；跨项目可用 `stateScope: "workspace"` 按工作目录分桶，但**同一目录下的多个会话仍共用一份**
- Soul 只有"全局激活一张"，尚未做按工作区/会话分档（人格连续性本身就是跨项目的，所以没做）
- 场景判定靠关键词与长度特征，反讽、长句闲聊这类边界情况会判错；判错时的代价是语气略偏，不是内容出错
- 「点击升级」只同步包文件，不更新 profile 里记录的依赖版本（`visibleVersion` 仍为安装时版本；插件页显示的版本读的是包内 `package.json`，会正常变化）

## 开发与同步（迁移后工作流）

```bash
node --test test/soul.test.js          # 36 个单元测试
node scripts/verify-plugin.mjs         # 安装前预检（不碰 DSH 配置）
node scripts/stats.mjs                 # 观测数据验收（场景温差/切换率/面板预算）
node scripts/check-define.mjs          # 用真实 defineTool 校验工具定义
bash scripts/sync-to-profile.sh        # 同步到 DSH profile（自动备份）
```

卸载：`dsh plugin remove dsh-soul-evolve`。状态与 Soul 面板数据留在 `~/.dsh-soul-evolve/`，不会被删——重装就接上。

## License

MIT

发布与上架的完整步骤见 [PUBLISHING.md](PUBLISHING.md)。
