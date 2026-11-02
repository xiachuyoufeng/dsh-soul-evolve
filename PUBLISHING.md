# 发布与上架

三条路，按"别人怎么装到你"排序。上架市场只要第一条走通。

## 0. 上架前必须先做的事

- [ ] GitHub 仓库建好（`xiachuyoufeng/dsh-soul-evolve`，公开，不要勾 Add README），把下面两处 `xiachuyoufeng` 换成真实用户名：
  - `package.json` 的 `repository` / `homepage` / `bugs`
  - `marketplace/entry.json` 的 `repo`
- [ ] npm 发布（可选，见下）
- [ ] 提交市场 PR（精选列表 PR #11315，待审）
- [ ] 确认 `LICENSE` 里的版权人署名要不要换（现在是 `dsh-soul-evolve contributors`）

## 1. 发 npm（可选）

不发 npm 也能上架：市场里 14965 个条目没有 `npm` 字段，安装走仓库。

要发的话，在自己的终端里跑（**不用 sudo**）：

```bash
cd ~/deepseek-harness/soul-workspace
bash scripts/publish-npm.sh
```

> 注意：如果是在 DSH 的沙箱里执行 npm，会报 `Your cache folder contains root-owned files`——
> 那是沙箱挡了 `~/.npm` 写入，不是真的有 root 文件（`find ~/.npm -user root` 结果是 0 个）。
> 在系统终端里跑就没有这个问题。

包名 `dsh-soul-evolve` 在 npm 上未被占用（已查，404）。

## 2. 建仓并推上去

```bash
git remote add origin https://github.com/xiachuyoufeng/dsh-soul-evolve.git
git push -u origin main
```

仓库的 topics 加上 `dsh-plugin`（市场的自动发现会扫这个 topic，PR 也能走人工）。

## 3. 提市场条目（进 DSH 应用内插件市场的那一条）

应用内插件市场是 [dsh-market/dsh-market](https://github.com/dsh-market/dsh-market)，它每次打开都实时拉
`https://awesome-dsh-plugin.com/plugins.json`，那份数据来自精选列表
[awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)。

**所以真正的入口是那个精选列表**，而且一个插件一个文件：

```
data/plugins/<owner>__<repo>.yml
```

内容就是 `marketplace/awesome-dsh-plugin.yml`（已写好、已提 PR #11315）：

```yaml
url: https://github.com/xiachuyoufeng/dsh-soul-evolve
name: xiachuyoufeng/dsh-soul-evolve
category: identity
description:
  en: '...'
  zh: '...'
```

规则要点（全文见该仓库 `contributing.md`）：

| 项 | 要求 | 我们 |
|---|---|---|
| `dsh.bundle` | `package.json` 必须声明，只有 `dsh.client` 会被拒 | ✅ `{"patch": "./cordis.patch.yml"}` |
| 仓库年龄 | ≥ 1 天，CI 自动查 | 今天刚建，等 regate 自动翻绿 |
| topic | 加 `dsh-plugin` | ✅ |
| 描述 | 必须与代码对得上，夸大是主要打回原因 | 每条声明都注了对应文件 |
| PR 容量 | 一个 PR 最多 3 条 | 1 条 |
| README | 由脚本生成，**不要手改** | 没动 |
| npm / tarball | 可选；不发就从源码装（我们无构建步骤，不需要 allowBuilds） | 未发 |

合并后网站自动重建，市场隔天就能搜到。

> 补充：[dshworks/awesome-dsh-plugins](https://github.com/dshworks/awesome-dsh-plugins)（`data/plugins.json`
> 单文件、21929 条）是另一个开放数据登记表，**不进应用内市场**。PR #206 提的是那个。

## 版本门禁（最容易被打回的一条）

dsh 0.2.1-alpha.4 起只读包自己的 `engines.dsh` 决定兼不兼容，且 `engines` 必须是对象。当前声明：

```json
"engines": { "node": ">=20", "dsh": ">=0.2.1-rc.2" }
```

改这个值要同时改 `marketplace/entry.json` 的 `verifiedAgainst`，否则就是自相矛盾的声明。
