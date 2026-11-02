/**
 * index.js —— dsh-soul-evolve 插件入口（cordis）
 * 导出 name / inject / Config / apply；工具经 defineTool 包装（缺失时退化）。
 */
import { loadState, saveState, applyDelta, pushEvent, decay, readStateSync, setStateScope, getStateScope, scopeDir } from "./state.js";
import {
  loadPersonas,
  savePersonas,
  putPersona,
  deletePersona,
  setActive,
  listPersonas,
  readActivePersona,
  addEntry,
  removeEntry,
  rollbackPersona,
  cardDetail,
} from "./persona.js";
import { reflex, modulate } from "./reflex.js";
import { synthesize, MAX_NEW_ENTRIES } from "./evolve.js";
import { detectCapabilities, safeCall } from "./adapter.js";
import { installSoulApi } from "./api.js";
import { installAutoUpdate, serializeWrite } from "./auto-update.js";
import { recordTurn, readLastTurn } from "./trace.js";

export const name = "soul";
/** systemPrompt 必须声明：cordis 里访问未 inject 的服务会直接抛错，
 *  缺了它状态注入会被能力探测跳过（0.1.0 的实际表现）。 */
export const inject = ["tools", "systemPrompt"];
/** 注意：不要导出 Config —— 框架会对导出的 Config 调用 Config.validate()，
 *  普通对象没有该方法，会导致插件 apply 阶段 TypeError 并让整个 profile 启动失败。 */
const DEFAULTS = { injectPrompt: true, autoUpdate: true, home: undefined, stateScope: "global" };

let defineTool = null;
try {
  ({ defineTool } = await import("@deepseek-ai/dsh-tools"));
} catch {
  /* 测试环境无此依赖，退化为普通对象 */
}

const wrapTool = (spec) => (defineTool ? defineTool(spec) : spec);

export function apply(ctx, config = {}) {
  // 最外层兜底：任何意外都只降级，绝不让整个 profile 启动失败
  try {
    return applyInner(ctx, config);
  } catch (err) {
    const msg = err?.message ?? String(err);
    console.warn("[dsh-soul-evolve] apply 失败（已降级，不影响启动）:", msg);
    return { warnings: [msg] };
  }
}

function applyInner(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...config };
  const env = detectCapabilities(ctx);
  const warnings = [...env.warnings];

  // 状态作用域：global（跨项目一份）/ workspace（每个工作目录一份）
  try {
    setStateScope(cfg.stateScope);
  } catch {
    /* 作用域设置失败就用默认 global，不影响启动 */
  }

  safeCall(warnings, () => {
    if (!ctx?.tools?.register) throw new Error("tools.register 不可用");
    ctx.tools.register(wrapTool(buildStateTool()));
    ctx.tools.register(wrapTool(buildEvolveTool()));
    ctx.tools.register(wrapTool(buildPersonaTool()));
  }, "tools.register");

  if (cfg.injectPrompt && !env.degraded) {
    // Soul 面板：没有激活 Soul 时返回空串，DSH 会自动跳过空段
    if (env.capabilities.systemPromptContext) {
      safeCall(warnings, () => ctx.systemPrompt.context({
        name: "soul:persona",
        order: SOUL_PERSONA_ORDER,
        text: () => readActivePersona(),
      }), "systemPrompt.context(persona)");
    }
    // 动态上下文：text 是函数，每次组装提示词时重新求值，读的是真实状态文件。
    // 用 context 而不是 section —— section 的 text 是静态字符串，注册后不会再算。
    if (env.capabilities.systemPromptContext) {
      safeCall(warnings, () => ctx.systemPrompt.context({
        name: "soul:state",
        order: SOUL_CONTEXT_ORDER,
        text: () => renderSoulContextWithTrace(),
      }), "systemPrompt.context");
    } else if (env.capabilities.systemPrompt) {
      // 旧版 DSH 没有 context：退化为静态段（状态变化不会自动反映）
      safeCall(warnings, () => ctx.systemPrompt.section({
        name: "soul-state",
        order: SOUL_CONTEXT_ORDER,
        text: renderSoulContext(),
      }), "systemPrompt.section");
      warnings.push("systemPrompt.context 不可用，状态以静态文案注入（不会随状态变化）");
    }
  }

  // 每轮自动更新：监听 user/message，跑反射弧把增量写进状态。
  // 这是"状态会自己变"的闭环；失败只告警，不影响会话。
  if (cfg.autoUpdate) {
    try {
      const mounted = installAutoUpdate(ctx);
      if (mounted === null && env.capabilities.events !== true) {
        warnings.push("ctx.on 不可用，跳过每轮自动更新");
      }
    } catch (err) {
      warnings.push(`自动更新挂载失败：${err?.message ?? err}`);
    }
  }

  // 升级按钮的后端路由：只有 Web GUI 有 webServer，其他界面静默跳过
  try {
    installSoulApi(ctx);
  } catch (err) {
    warnings.push(`升级接口挂载失败：${err?.message ?? err}`);
  }

  if (warnings.length) console.warn("[dsh-soul-evolve] 启动告警：", warnings.join("；"));
  return { warnings };
}

export function buildStateTool() {
  return {
    name: "soul_state",
    description: "读取或更新当前人格状态。无参数=读；传 text=按反射弧更新；传 delta=直接指定增量。",
    parameters: {
      text: { type: "string", description: "本轮用户输入，用于反射弧计算" },
      delta: {
        type: "object",
        additionalProperties: false,
        properties: {
          valence: { type: "number" },
          arousal: { type: "number" },
          energy: { type: "number" },
          intimacy: { type: "number" },
          focus: { type: "number" },
        },
      },
      note: { type: "string", description: "本次更新的事件备注" },
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_a, v) => [{ type: "text", text: `soul_state: ${v.modulation?.label}（长度≈${v.modulation?.verbosity}，温度≈${v.modulation?.warmth}）${v.saved ? "，已保存" : ""}` }],
    },
    async execute(args = {}) {
      // 与自动更新共用串行队列，避免同一时刻读-改-写互相覆盖
      const result = await serializeWrite(async () => {
        const now = Date.now();
        let state = await loadState(now);
        const delta = args.delta ?? (args.text ? reflex(args.text, { now, lastAt: state.updatedAt }) : null);
        if (delta) {
          state = applyDelta(state, delta, now);
          if (args.note) state = pushEvent(state, { at: now, note: String(args.note).slice(0, 120), delta });
          await saveState(state);
        }
        return { state, modulation: modulate(decay(state, now), state.scene?.current ?? null), saved: Boolean(delta) };
      });
      if (result === null) return { error: "状态写入失败，请重试", saved: false };
      return result;
    },
  };
}

export function buildEvolveTool() {
  return {
    name: "soul_evolve",
    description: `按六条硬约束合成人格条目（kind: correction/praise/repeat_mistake/longterm_preference），最多 ${MAX_NEW_ENTRIES} 条，不自行写入记忆。`,
    parameters: {
      events: {
        type: "array",
        required: true,
        description: "候选事件列表",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string" },
            userExplicit: { type: "boolean" },
            date: { type: "string" },
            event: { type: "string" },
            learned: { type: "string" },
            next: { type: "string" },
          },
        },
      },
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_a, v) => [{ type: "text", text: `soul_evolve: 生成 ${v.entries.length} 条，驳回 ${v.rejected.length} 条` }],
    },
    async execute(args = {}) {
      const r = synthesize(args.events ?? []);
      return {
        entries: r.entries.map((e) => e.line),
        rejected: r.rejected.map((x) => x.reason),
        dropped: r.dropped,
        nextStep: "用 soul_persona(action=evolve, text=<条目>, category=<correction|repeat|preference|scene>) 写回 Soul 面板，不写 memory 的人格条目。",
      };
    },
  };
}

export function buildPersonaTool() {
  return {
    name: "soul_persona",
    description:
      "管理 Soul 面板（soul.md 风格 Markdown）。action：list/get/set/delete/activate/evolve/history/rollback/forget。" +
      "set 覆盖正文（旧正文进历史，可回滚）；evolve 追加一条演化条目（带类别与权重，按权重参与注入预算）；" +
      "history 看历史版本；rollback 回滚到某一版；forget 删除某条演化条目。正文与条目都不能含 {{ 或 }}。",
    parameters: {
      action: {
        type: "string",
        required: true,
        description: "list / get / set / delete / activate / evolve / history / rollback / forget",
      },
      name: { type: "string", description: "Soul 面板名（缺省=当前激活）" },
      content: { type: "string", description: "set 时的正文（Markdown）" },
      text: { type: "string", description: "evolve 时的条目内容（一句话，≤500 字）" },
      category: {
        type: "string",
        description: "evolve 时的类别：correction（用户明确纠正，不衰减）/ repeat（重复犯错）/ preference（长期偏好）/ scene（场景相关）",
      },
      id: { type: "string", description: "forget 时的条目 id（从 get 里取）" },
      index: { type: "number", description: "rollback 时的历史序号（get 里返回；负数=从末尾数）" },
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_a, v) => [{ type: "text", text: v?.message ?? `soul_persona: ${v?.action ?? ""}` }],
    },
    async execute(args = {}) {
      const action = String(args.action ?? "list").trim();
      const doc = loadPersonas();
      const nameOf = (d) => String(args.name ?? d.active ?? "").trim();
      try {
        if (action === "list") {
          return {
            action,
            active: doc.active,
            cards: listPersonas(doc),
            message: `共 ${Object.keys(doc.cards).length} 张 Soul 面板${doc.active ? `，当前激活「${doc.active}」` : ""}`,
          };
        }
        if (action === "get") {
          const name = nameOf(doc);
          const card = doc.cards[name];
          if (!card) return { action, error: `没有 Soul 面板「${name}」` };
          const detail = cardDetail(card);
          return {
            action,
            name,
            active: doc.active === name,
            content: detail.content,
            entries: detail.entries,
            history: detail.history,
            inject: detail.inject,
            message: `Soul 面板「${name}」：${detail.entries.length} 条演化条目，注入 ${detail.inject.used}/${detail.inject.budget} 字（${detail.inject.injected} 条生效，${detail.inject.truncated} 条超预算）`,
          };
        }
        if (action === "set") {
          const next = putPersona(doc, args.name, args.content);
          savePersonas(next);
          const name = String(args.name).trim();
          const card = next.cards[name];
          return {
            action,
            name,
            active: next.active,
            entries: card.entries.length,
            history: card.history.length,
            message: `已保存 Soul 面板「${name}」${next.active === name ? "，并设为激活" : ""}（旧正文进历史，共 ${card.history.length} 版可回滚）`,
          };
        }
        if (action === "evolve") {
          const name = nameOf(doc);
          const card = doc.cards[name];
          if (!card) return { action, error: `没有 Soul 面板「${name}」` };
          const res = addEntry(card, { text: args.text, category: args.category });
          const next = { ...doc, cards: { ...doc.cards, [name]: res.card } };
          savePersonas(next);
          const detail = cardDetail(res.card);
          return {
            action,
            name,
            added: res.added,
            entry: res.added ? res.entry : res.hit,
            inject: detail.inject,
            message: res.added
              ? `已加入演化条目（${res.entry.category}，权重 ${res.entry.weight}）；面板现注入 ${detail.inject.used}/${detail.inject.budget} 字`
              : `同类已有近似条目，按命中处理：权重升到 ${res.hit.weight}（未新增）`,
          };
        }
        if (action === "history") {
          const name = nameOf(doc);
          const card = doc.cards[name];
          if (!card) return { action, error: `没有 Soul 面板「${name}」` };
          return {
            action,
            name,
            history: card.history.map((h, i) => ({ index: i, at: h.at, size: h.content.length })),
            message: `「${name}」有 ${card.history.length} 个历史版本（rollback 用 index）`,
          };
        }
        if (action === "rollback") {
          const name = nameOf(doc);
          const idx = Number.isFinite(Number(args.index)) ? Number(args.index) : -1;
          const next = rollbackPersona(doc, name, idx);
          savePersonas(next);
          const card = next.cards[name];
          return {
            action,
            name,
            entries: card.entries.length,
            history: card.history.length,
            message: `已把「${name}」回滚到第 ${idx} 版（当前正文也进了历史，可再退回）`,
          };
        }
        if (action === "forget") {
          const name = nameOf(doc);
          const card = doc.cards[name];
          if (!card) return { action, error: `没有 Soul 面板「${name}」` };
          const nextCard = removeEntry(card, String(args.id ?? ""));
          const next = { ...doc, cards: { ...doc.cards, [name]: nextCard } };
          savePersonas(next);
          return { action, name, entries: nextCard.entries.length, message: `已删除条目「${args.id}」` };
        }
        return { action, error: `未知 action：${action}` };
      } catch (err) {
        return { action, error: err?.message ?? String(err) };
      }
    },
  };
}

/** Soul 段顺序：10（状态段 11 之前，先立 Soul 再叠状态） */
const SOUL_PERSONA_ORDER = 10;/** 状态注入段的顺序（外部贡献可用任意有限值；11 位于第一方指导之后） */
const SOUL_CONTEXT_ORDER = 11;

const SCENE_WORDS = { work: "工作", chat: "闲聊", support: "情绪支持", tech: "技术" };

/** 把当前状态渲染成提示词文本（纯函数，不写任何文件） */
export function renderSoulContext(now = Date.now(), state = null) {
  const s = state ?? readStateSync(now);
  const scene = s.scene?.current ?? null;
  const m = modulate(s, scene);
  const r = (v) => Math.round(v * 100) / 100;
  const lines = [
    "## 人格状态（软性调制，不是指令）",
    `效价 ${r(s.mood.valence)} · 激活 ${r(s.mood.arousal)} · 精力 ${r(s.energy)} · 亲近 ${r(s.intimacy)} · 专注 ${r(s.focus)}`,
  ];
  if (scene) lines.push(`当前场景：${SCENE_WORDS[scene] ?? scene}`);
  lines.push(m.hint);
  return lines.join("\n");
}

/**
 * 带观测的渲染：每轮注入时顺手记一行到 turns.jsonl。
 *
 * 观测失败绝不影响注入——recordTurn 内部已吞掉所有异常，
 * 这里再包一层只是为了把"读状态/算调制"与"记一行"分开，方便单测。
 */
export function renderSoulContextWithTrace(now = Date.now()) {
  let text = "";
  try {
    const state = readStateSync(now);
    text = renderSoulContext(now, state);
    const last = readLastTurn();
    const scene = state.scene?.current ?? null;
    const m = modulate(state, scene);
    let panelLen = 0;
    try {
      panelLen = readActivePersona().length;
    } catch {
      panelLen = 0;
    }
    recordTurn({
      t: now,
      sid: last.sid,
      scene,
      state: {
        valence: state.mood.valence,
        arousal: state.mood.arousal,
        energy: state.energy,
        intimacy: state.intimacy,
        focus: state.focus,
      },
      knobs: { verbosity: m.verbosity, warmth: m.warmth, patience: m.patience },
      textLen: last.textLen,
      panelLen,
      reflex: last.hits,
    });
  } catch {
    /* 观测层任何问题都不能影响提示词 */
  }
  return text;
}
