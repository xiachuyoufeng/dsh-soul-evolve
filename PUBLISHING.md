# 发布与上架

三条路，按"别人怎么装到你"排序。上架市场只要第一条走通。

## 0. 上架前必须先做的事

- [ ] GitHub 仓库建好（`xiachuyoufeng/dsh-soul-evolve`，公开，不要勾 Add README），把下面两处 `xiachuyoufeng` 换成真实用户名：
  - `package.json` 的 `repository` / `homepage` / `bugs`
  - `marketplace/entry.json` 的 `repo`
- [ ] npm 发布（可选，见下）
- [ ] 提交市场 PR（已代做，见 PR #206）
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

## 3. 提市场条目

市场是用 [dshworks/awesome-dsh-plugins](https://github.com/dshworks/awesome-dsh-plugins) 的 `data/plugins.json` 做登记的，**不是** README，也不是单个 yml 文件。

```bash
gh repo clone dshworks/awesome-dsh-plugins
cd awesome-dsh-plugins
# 把 ../soul-workspace/marketplace/entry.json 的内容追加到 data/plugins.json 的 plugins 数组
node scripts/validate.mjs
node scripts/render.mjs
git checkout -b add-dsh-soul-evolve
git commit -am "Add dsh-soul-evolve"
gh pr create
```

条目字段说明（全部已填在 `marketplace/entry.json`）：

| 字段 | 值 | 说明 |
|---|---|---|
| `category` | `bundle` | 有 `dsh.bundle` 清单、以 patch 层挂载的 npm 包 |
| `tags` | `memory`, `ui` | 功能域，最多 2 个 |
| `verifiedAgainst` | `0.2.1-rc.3` | 本机 dsh 内核版本，实测过的 |
| `status` | `verified` | 配套 `evidence` 必须是可核查的文件位置 |
| `evidence` | `package.json#dsh.bundle` | 证明"确实有安装路径" |

`status: verified` 是**承诺**：审的人会去你的仓库翻 `package.json` 确认 `dsh.bundle` 存在。没把握就写 `unverified`（也收，只是不显示验证标记）。

## 版本门禁（最容易被打回的一条）

dsh 0.2.1-alpha.4 起只读包自己的 `engines.dsh` 决定兼不兼容，且 `engines` 必须是对象。当前声明：

```json
"engines": { "node": ">=20", "dsh": ">=0.2.1-rc.2" }
```

改这个值要同时改 `marketplace/entry.json` 的 `verifiedAgainst`，否则就是自相矛盾的声明。
