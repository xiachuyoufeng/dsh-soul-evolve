/**
 * 组件渲染冒烟测试。
 *
 * 存在的理由：1.3.0 改 PatternPanel 时漏了一个变量声明（emitted），
 * 一进面板就抛 ReferenceError，整个配置面板从界面上消失——而语法检查、
 * 单元测试、发布预检三样全绿，因为没有一个环节真的渲染过组件。
 *
 * 这里用 mock 的 React 把每个面板按「有数据」和「无数据」各渲染一遍，
 * 任何 ReferenceError / TypeError 都会当场抛出。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "client.js"), "utf8");

/** 把 client.js 装进一个假 window，取出 factory 产出的模块 */
function loadClient() {
  let captured = null;
  const fakeWindow = {
    __ModuleLoader__: {
      load(spec) {
        captured = spec;
      },
    },
  };
  const prevWindow = globalThis.window;
  globalThis.window = fakeWindow;
  try {
    // eslint-disable-next-line no-new-func
    new Function("window", "document", "fetch", source)(fakeWindow, undefined, async () => ({ ok: true, json: async () => ({ ok: true }) }));
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
  }
  assert.ok(captured, "client.js 没有调用 __ModuleLoader__.load");
  return captured;
}

/**
 * 构造 mock React。useState 的状态真的存在 cells 里，setter 会改它，
 * 所以「点一下 → 重渲染 → 断言变化」这种交互也能测。
 * injects 按 useState 的调用顺序注入初始值（用来喂不同面板的初始 view）。
 */
function makeReact(injects) {
  var cells = [];
  var cursor = 0;
  function Component(props) {
    this.props = props;
  }
  Component.prototype.setState = function (next) {
    Object.assign(this.state || {}, next);
  };
  var react = {
    Component: Component,
    Fragment: Symbol("Fragment"),
    createElement(type, props, ...children) {
      // 惰性：只记录，由 walk() 真正调用组件。直接在这里调用组件的话，
      // 子组件的异常会抛到错误边界外面，边界就测不出来了。
      return { type, props: props || {}, children };
    },
    useState(init) {
      var i = cursor;
      cursor += 1;
      if (!(i in cells)) {
        cells[i] = injects && i < injects.length ? injects[i] : typeof init === "function" ? init() : init;
      }
      return [
        cells[i],
        function (next) {
          cells[i] = typeof next === "function" ? next(cells[i]) : next;
        },
      ];
    },
    useCallback(fn) {
      return fn;
    },
    useEffect() {},
    useMemo(fn) {
      return fn();
    },
    useRef(v) {
      return { current: v };
    },
  };
  return {
    react: react,
    resetCursor() {
      cursor = 0;
    },
  };
}

/** 把惰性树真正渲染一遍，并模拟 class 组件的错误边界 */
function walk(node) {
  if (node === null || node === undefined || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(walk);
  const type = node.type;
  if (typeof type !== "function") {
    return { type, props: node.props, children: (node.children || []).map(walk) };
  }
  if (type.prototype && typeof type.prototype.render === "function") {
    const inst = new type(node.props);
    inst.props = node.props;
    inst.state = { error: null };
    try {
      return walk(inst.render());
    } catch (err) {
      const derived = typeof type.getDerivedStateFromError === "function" ? type.getDerivedStateFromError(err) : null;
      if (!derived) throw err;
      Object.assign(inst.state, derived);
      return walk(inst.render());
    }
  }
  return walk(type(node.props));
}

const KEY = { config: "ConfigPanel", patterns: "PatternPanel", state: "StatePanel", personas: "PersonaPanel" };

/** 挂载一个面板：返回首棵渲染树 + 可反复调用的 rerender（状态会保留） */
function mount(component, injects) {
  const spec = loadClient();
  const box = makeReact(injects);
  const mod = spec.factory((name) => {
    if (name === "react") return box.react;
    throw new Error("未预期的依赖：" + name);
  });
  const Panel = mod.__components[KEY[component] || component];
  assert.ok(typeof Panel === "function", "拿不到组件 " + component);
  function rerender() {
    box.resetCursor();
    return walk(Panel({}));
  }
  return { tree: rerender(), rerender };
}

function render(component, injects) {
  if (injects === undefined) return mount(component, undefined).tree;
  // 单个对象 = 只注入第一个 useState；数组 = 按顺序注入多个
  return mount(component, Array.isArray(injects) ? injects : [injects]).tree;
}

/** 深度找第一个满足条件的节点 */
function find(node, pred) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, pred);
      if (hit) return hit;
    }
    return null;
  }
  if (pred(node)) return node;
  for (const child of node.children || []) {
    const hit = find(child, pred);
    if (hit) return hit;
  }
  return null;
}

/** 收集树里所有字符串，用来断言按钮/文案存在 */
function texts(node, out = []) {
  if (node === null || node === undefined) return out;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((c) => texts(c, out));
    return out;
  }
  if (typeof node === "object") (node.children || []).forEach((c) => texts(c, out));
  return out;
}

test("client: ConfigPanel 在无数据时能渲染", () => {
  const tree = render("config");
  assert.ok(tree, "渲染结果为空");
});

test("client: 每个子面板在有数据时都能渲染（catch 未声明变量这类崩溃）", () => {
  const patterns = {
    ok: true,
    stats: {
      turns: 1419, sessions: 16, days: 2, topScene: "work", topSceneShare: 0.5,
      textMedian: 18, turnsPerSession: 49, switchesPerSession: 0.7,
      reflex: { praise: 64, blame: 0, curious: 119, short: 349, long: 0, repeat: 0 },
      daily: [{ date: "2026-11-02", turns: 812 }, { date: "2026-11-03", turns: 607 }],
      since: 1, until: 2,
    },
    gates: { minSessions: 3, minDays: 3, minTurns: 12 },
    dimensions: [{ dimension: "habit", label: "工作习惯" }, { dimension: "character", label: "性格表达" }],
    ready: [],
    blocked: [{
      key: "habit:direct", dimension: "habit", event: "一句话指令 349/1419 轮（25%）",
      missing: ["跨天 2/3（还差 1 天）"],
      gate: { have: { sessions: 16, days: 2, turns: 349 }, need: { sessions: 3, days: 3, turns: 12 } },
    }],
    candidates: [{ key: "habit:direct", dimension: "habit", event: "一句话指令 349/1419 轮（25%）" }],
    emitted: [{ key: "habit:direct", dimension: "habit" }],
  };
  const tree = render("patterns", { status: "ready", data: patterns, error: "", message: "测试" });
  assert.ok(tree, "渲染结果为空");
});

test("client: 沉淀面板在「够格」状态下也能渲染", () => {
  const patterns = {
    ok: true,
    stats: {
      turns: 100, sessions: 9, days: 5, topScene: "work", topSceneShare: 0.6, textMedian: 20,
      turnsPerSession: 30, switchesPerSession: 0.2,
      reflex: { short: 30, curious: 20, praise: 10, blame: 0, long: 0, repeat: 0 },
      daily: [{ date: "2026-11-01", turns: 40 }], since: 1, until: 2,
    },
    gates: { minSessions: 3, minDays: 3, minTurns: 12 },
    dimensions: [{ dimension: "habit", label: "工作习惯" }],
    ready: [{
      key: "habit:direct", dimension: "habit", event: "一句话指令 30/100 轮",
      evidence: { sessions: 9, days: 5, turns: 30 },
      gate: { have: { sessions: 9, days: 5, turns: 30 }, need: { sessions: 3, days: 3, turns: 12 } },
    }],
    blocked: [], candidates: [{ key: "habit:direct", dimension: "habit", event: "x" }], emitted: [],
  };
  const tree = render("patterns", { status: "ready", data: patterns, error: "", message: "" });
  assert.ok(tree);
});

test("client: 状态面板在无数据/有数据时都能渲染", () => {
  assert.ok(render("state", { status: "ready", data: null, error: "" }));
  assert.ok(
    render("state", {
      status: "ready",
      error: "",
      data: {
        ok: true,
        state: { mood: { valence: 0.41, arousal: 0.08 }, energy: 0.9, intimacy: 0.52, focus: 1, events: [{ at: 1, note: "x" }] },
        modulation: { verbosity: 0.84, warmth: 0.51, patience: 1 },
        baseline: { valence: 0, arousal: 0.4, energy: 0.6, intimacy: 0.1, focus: 0.5 },
        label: "偏亮·有劲", scene: "work", stateScope: "global",
      },
    })
  );
});

/* ------------------------------------------------------------------ */
/* Soul 面板：不提供切换、正文默认收起、导出在顶部                       */
/* ------------------------------------------------------------------ */

const PERSONA_VIEW = {
  status: "ready",
  active: "海拉",
  cards: [{ name: "海拉", active: true }],
  error: "",
  notice: "",
};
const PERSONA_DRAFT = { name: "海拉", content: "# 海拉\n\n## Identity\n你是海拉。\n\n## Personality\n- 默认短\n" };

test("Soul 面板: 不再提供人格切换", () => {
  const tree = render("personas", [PERSONA_VIEW, PERSONA_DRAFT]);
  // 注意：演化条目的「类别」还是个 select，所以不能按标签名断言，
  // 要认那个下拉框的占位文案
  assert.ok(
    !texts(tree).some((t) => t.includes("选择 Soul 面板")),
    "不该再有切换人格的下拉框"
  );
  const all = texts(tree);
  assert.ok(!all.includes("设为激活"), "不该再有「设为激活」按钮");
  assert.ok(!all.includes("停用"), "不该再有「停用」按钮");
});

test("Soul 面板: 导出按钮在顶部且可用", () => {
  const tree = render("personas", [PERSONA_VIEW, PERSONA_DRAFT]);
  const btn = find(tree, (n) => n.props && n.props.onClick && texts(n).includes("导出 .md"));
  assert.ok(btn, "应该有「导出 .md」按钮");
  assert.equal(btn.props.disabled, false, "有正文时导出不该是禁用的");
});

test("Soul 面板: 正文默认收起，点了才展开", () => {
  const m = mount("personas", [PERSONA_VIEW, PERSONA_DRAFT]);
  assert.equal(find(m.tree, (n) => n.type === "textarea"), null, "默认不该直接把 soul 全文摊在面板上");
  assert.ok(texts(m.tree).includes("展开编辑"), "收起时应给出展开提示");

  const head = find(m.tree, (n) => n.props && String(n.props.className || "").includes("__ds_foldHead"));
  assert.ok(head, "应有可点的折叠标题行");
  head.props.onClick();

  const tree2 = m.rerender();
  const box = find(tree2, (n) => n.type === "textarea");
  assert.ok(box, "点击展开后应出现正文编辑区");
  assert.equal(box.props.value, PERSONA_DRAFT.content, "展开后应是当前正文");
  assert.ok(texts(tree2).includes("收起"), "展开后应能收起");
});

test("Soul 面板: 收起时给出篇幅摘要", () => {
  const tree = render("personas", [PERSONA_VIEW, PERSONA_DRAFT]);
  const all = texts(tree).join(" ");
  assert.ok(/\d+ 行 · \d+ 字/.test(all), "收起态应显示行数与字数，不然不知道正文多大：" + all.slice(0, 120));
});
