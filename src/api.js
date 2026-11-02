/**
 * api.js —— Web GUI 的后端路由（设置页面板与升级按钮共用）。
 *
 *   GET    /dsh-soul-evolve/api/status              → 已安装 / 源码版本
 *   POST   /dsh-soul-evolve/api/upgrade             → 同步源码到已装副本（重启生效）
 *
 *   GET    /dsh-soul-evolve/api/state               → { state, modulation }
 *   POST   /dsh-soul-evolve/api/state               → { delta } 手动调整
 *
 *   GET    /dsh-soul-evolve/api/personas            → { active, cards: [...] }
 *   GET    /dsh-soul-evolve/api/personas/<name>     → { name, content }
 *   PUT    /dsh-soul-evolve/api/personas            → { name, content } 新建/覆盖
 *   DELETE /dsh-soul-evolve/api/personas?name=<n>   → 删除
 *   PUT    /dsh-soul-evolve/api/personas/active     → { name }
 *
 * 写操作都要求 `x-soul-action: 1` 头：自定义头会触发跨域预检，
 * 挡住其他网站对 localhost 的 CSRF 触发。
 *
 * 只在有 webServer 的界面注册（Web GUI）；TUI 等没有该服务时静默跳过。
 */
import { URL } from "node:url";
import { syncFromSource, readInfo, sourceDir, INSTALL_DIR } from "./upgrade.js";
import { saveState, applyDelta, readStateSync, getStateScope, scopeDir } from "./state.js";
import { modulate, describe } from "./reflex.js";
import { readTurns } from "./trace.js";
import {
  loadPersonas,
  savePersonas,
  putPersona,
  deletePersona,
  setActive,
  listPersonas,
  renderPersonaSection,
  validateName,
  addEntry,
  removeEntry,
  rollbackPersona,
  cardDetail,
  INJECT_BUDGET,
} from "./persona.js";

const PREFIX = "/dsh-soul-evolve";

function send(res, code, body) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req, maxBytes = 200_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("请求体过大");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("请求体不是合法 JSON");
  }
}

function requireActionHeader(req) {
  if (req.headers["x-soul-action"] !== "1") {
    throw Object.assign(new Error("缺少 x-soul-action 头"), { status: 403 });
  }
}

function stateView() {
  const state = readStateSync();
  return {
    ok: true,
    state,
    modulation: modulate(state, state.scene?.current ?? null),
    label: describe(state),
    scene: state.scene?.current ?? "work",
    stateScope: getStateScope(),
    stateDir: scopeDir(),
  };
}

export function createHandler() {
  return async function handler(req, res) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    try {
      /* ---------- 升级 ---------- */
      if (req.method === "GET" && path === `${PREFIX}/api/status`) {
        return send(res, 200, {
          ok: true,
          installed: readInfo(INSTALL_DIR),
          source: readInfo(sourceDir()),
          sourceDir: sourceDir(),
          stateScope: getStateScope(),
          stateDir: scopeDir(),
        });
      }
      if (req.method === "POST" && path === `${PREFIX}/api/upgrade`) {
        if (req.headers["x-soul-action"] !== "1" && req.headers["x-soul-upgrade"] !== "1") {
          return send(res, 403, { ok: false, error: "缺少 x-soul-action 头" });
        }
        const result = syncFromSource();
        console.info(`[dsh-soul-evolve] 已从 ${result.source} 同步 ${result.files} 个文件（v${result.from} → v${result.to}），重启生效`);
        return send(res, 200, result);
      }

      /* ---------- 状态 ---------- */
      if (path === `${PREFIX}/api/state` && req.method === "GET") {
        return send(res, 200, stateView());
      }
      if (path === `${PREFIX}/api/state` && req.method === "POST") {
        requireActionHeader(req);
        const body = await readJson(req);
        const delta = body?.delta ?? {};
        const parsed = {};
        for (const key of ["valence", "arousal", "energy", "intimacy", "focus"]) {
          const v = Number(delta[key]);
          if (Number.isFinite(v) && v !== 0) parsed[key] = v;
        }
        if (Object.keys(parsed).length === 0) throw new Error("没有有效的增量");
        const now = Date.now();
        const before = readStateSync();
        const next = applyDelta(before, parsed, now);
        const saved = await saveState(next);
        return send(res, 200, { ok: true, state: next, modulation: modulate(next), saved });
      }

      /* ---------- Soul ---------- */
      if (path === `${PREFIX}/api/personas` && req.method === "GET") {
        const doc = loadPersonas();
        return send(res, 200, { ok: true, active: doc.active, cards: listPersonas(doc), budget: INJECT_BUDGET });
      }
      if (path === `${PREFIX}/api/personas` && req.method === "PUT") {
        requireActionHeader(req);
        const body = await readJson(req);
        const doc = putPersona(loadPersonas(), body?.name, body?.content);
        savePersonas(doc);
        return send(res, 200, { ok: true, active: doc.active, cards: listPersonas(doc) });
      }
      if (path === `${PREFIX}/api/personas/active` && req.method === "PUT") {
        requireActionHeader(req);
        const body = await readJson(req);
        const doc = setActive(loadPersonas(), body?.name ?? null);
        savePersonas(doc);
        return send(res, 200, { ok: true, active: doc.active, cards: listPersonas(doc) });
      }
      if (path === `${PREFIX}/api/personas/entries` && req.method === "POST") {
        requireActionHeader(req);
        const body = await readJson(req);
        const doc = loadPersonas();
        const name = String(body?.name ?? doc.active ?? "").trim();
        const card = doc.cards[name];
        if (!card) return send(res, 404, { ok: false, error: `没有 Soul 面板「${name}」` });
        const result = addEntry(card, { text: body?.text, category: body?.category });
        savePersonas({ ...doc, cards: { ...doc.cards, [name]: result.card } });
        return send(res, 200, {
          ok: true,
          added: result.added,
          name,
          card: cardDetail(result.card),
        });
      }
      if (path === `${PREFIX}/api/personas/entries` && req.method === "DELETE") {
        requireActionHeader(req);
        const doc = loadPersonas();
        const name = String(url.searchParams.get("name") ?? doc.active ?? "").trim();
        const card = doc.cards[name];
        if (!card) return send(res, 404, { ok: false, error: `没有 Soul 面板「${name}」` });
        const nextCard = removeEntry(card, String(url.searchParams.get("id") ?? ""));
        savePersonas({ ...doc, cards: { ...doc.cards, [name]: nextCard } });
        return send(res, 200, { ok: true, name, card: cardDetail(nextCard) });
      }
      if (path === `${PREFIX}/api/personas/rollback` && req.method === "POST") {
        requireActionHeader(req);
        const body = await readJson(req);
        const doc = loadPersonas();
        const name = String(body?.name ?? doc.active ?? "").trim();
        const idx = Number.isFinite(Number(body?.index)) ? Number(body.index) : -1;
        const next = rollbackPersona(doc, name, idx);
        savePersonas(next);
        return send(res, 200, { ok: true, name, card: cardDetail(next.cards[name]), cards: listPersonas(next) });
      }
      if (path === `${PREFIX}/api/personas/preview` && req.method === "GET") {
        // 预览"当前会注入什么"，便于排错
        return send(res, 200, { ok: true, text: renderPersonaSection(loadPersonas()) });
      }
      if (path.startsWith(`${PREFIX}/api/personas/`) && req.method === "GET") {
        const name = decodeURIComponent(path.slice(`${PREFIX}/api/personas/`.length));
        const doc = loadPersonas();
        const card = doc.cards[name];
        if (!card) return send(res, 404, { ok: false, error: `没有 Soul 面板「${name}」` });
        return send(res, 200, { ok: true, name, active: doc.active === name, ...cardDetail(card) });
      }
      if (path === `${PREFIX}/api/personas` && req.method === "DELETE") {
        requireActionHeader(req);
        const name = url.searchParams.get("name");
        const doc = deletePersona(loadPersonas(), name);
        savePersonas(doc);
        return send(res, 200, { ok: true, active: doc.active, cards: listPersonas(doc) });
      }

      /* ---------- 观测 ---------- */
      if (path === `${PREFIX}/api/trace` && req.method === "GET") {
        const all = readTurns();
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 200), 1), 1000);
        return send(res, 200, { ok: true, total: all.length, turns: all.slice(-limit) });
      }

      return send(res, 404, { ok: false, error: "not found" });
    } catch (err) {
      const status = err?.status ?? 400;
      const message = err?.message ?? String(err);
      console.error("[dsh-soul-evolve] 接口失败：", message);
      try {
        send(res, status, { ok: false, error: message });
      } catch {
        /* 响应已发出时忽略 */
      }
    }
  };
}

/**
 * 挂载到 Web 服务。返回 disposer；宿主没有 webServer 时返回 null（不报错）。
 * @param {object} ctx cordis 上下文
 */
export function installSoulApi(ctx) {
  if (typeof ctx?.inject !== "function") return null;
  return ctx.inject(["webServer"], (webCtx) => {
    const dispose = webCtx.webServer.register({ kind: "prefix", path: PREFIX, handler: createHandler() });
    return () => dispose?.();
  });
}
