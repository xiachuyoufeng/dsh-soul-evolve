/**
 * auto-update.js —— 每轮自动更新状态。
 *
 * 监听 `session/event` 里的 `user/message`（只认真人来源），跑反射弧，
 * 把增量累积进状态文件。这样状态才会"自己变"，而不是等模型主动调工具。
 *
 * 三条安全约束：
 * 1. 只处理 source.kind === "user" 的消息（跳过 goal / 团队 / 系统注入）；
 * 2. 状态写串行化，避免同一时刻多条消息读-改-写互相覆盖；
 * 3. 任何异常只告警，绝不影响会话本身。
 */
import { loadState, saveState, applyDelta, pushEvent } from "./state.js";
import { reflexDetail } from "./reflex.js";
import { detectScene } from "./scene.js";
import { noteUserTurn } from "./trace.js";

const MAX_NOTE = 80;

/** 从 session 对象里尽量取出一个稳定 id（不同版本字段名不同） */
export function sessionIdOf(session) {
  if (!session) return "-";
  const raw =
    session.id ?? session.sessionId ?? session.key ?? session.uuid ?? session.header?.id ?? session.header?.sessionId ?? "-";
  return String(raw);
}

/** 串行队列：所有自动更新排同一队，避免并发丢更新 */
let chain = Promise.resolve();

export function serializeWrite(fn) {
  const next = chain.then(fn).catch((err) => {
    console.warn("[dsh-soul-evolve] 状态自动更新失败：", err?.message ?? err);
    return null;
  });
  chain = next;
  return next;
}

/** 从消息 content 中提取纯文本（忽略图片/工具块） */
export function extractUserText(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/**
 * 用一条用户输入更新状态。
 * @returns {Promise<{delta: object, note: string, scene: string}|null>}
 */
export async function updateFromUserText(text, now = Date.now(), sid = "-") {
  const source = String(text ?? "").trim();
  if (!source) return null;
  return serializeWrite(async () => {
    let state = await loadState(now); // loadState 内部已做时间衰减
    const { delta, hits } = reflexDetail(source, { now, lastAt: state.updatedAt });

    // 场景判定：滞回状态存在 state 里，跨轮次才有"惯性"
    const prevScene = state.scene?.current ?? "work";
    const prevStreak = state.scene?.streak ?? 0;
    const sceneResult = detectScene(source, { now, prev: prevScene, streak: prevStreak });

    state = applyDelta(state, delta, now);
    state = {
      ...state,
      scene: { current: sceneResult.scene, candidate: sceneResult.candidate, streak: sceneResult.streak },
    };
    state = pushEvent(state, { at: now, note: source.slice(0, MAX_NOTE), delta, scene: sceneResult.scene });
    noteUserTurn({ sid, textLen: source.length, hits, at: now, scene: sceneResult.scene });
    await saveState(state);
    return { delta, note: source.slice(0, MAX_NOTE), scene: sceneResult.scene, signals: sceneResult.signals };
  });
}

/** 事件是否算"真人一轮输入" */
export function isUserTurn(event) {
  if (!event || event.type !== "user/message") return false;
  const kind = event.data?.source?.kind;
  // 有明确来源时只认真人；来源缺失（旧会话格式）时放行
  return kind === undefined || kind === "user";
}

/**
 * 挂载每轮自动更新。宿主没有 events 能力时静默跳过。
 * @param {object} ctx cordis 上下文
 * @returns {(() => void)|null} disposer
 */
export function installAutoUpdate(ctx) {
  if (!ctx || typeof ctx.on !== "function") return null;
  const attach = () =>
    ctx.on("session/event", (session, event) => {
      try {
        if (!isUserTurn(event)) return;
        const text = extractUserText(event.data?.content);
        if (!text) return;
        void updateFromUserText(text, Date.now(), sessionIdOf(session));
      } catch (err) {
        console.warn("[dsh-soul-evolve] 会话事件处理失败：", err?.message ?? err);
      }
    });

  if (typeof ctx.effect === "function") {
    return ctx.effect(() => {
      const dispose = attach();
      return () => dispose?.();
    }, "dsh-soul-evolve: auto-update");
  }
  return attach();
}
