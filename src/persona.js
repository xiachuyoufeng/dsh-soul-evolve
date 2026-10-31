/**
 * persona.js —— Soul 面板（soul.md 风格）。
 *
 * 存储：`~/.dsh-soul-evolve/personas.json`（DSH_SOUL_HOME 可覆盖）
 *   { version, active, cards: { [name]: { content, updatedAt } } }
 *
 * Soul 内容就是 Markdown（与市场里 soul.md 风格的 Soul 面板互通），
 * 唯一硬约束是不能含 `{{` / `}}`——那是 DSH 提示词变量语法，
 * 出现在注入文本里会让整个提示词组装失败。
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

export const PERSONA_VERSION = 1;
export const MAX_CONTENT = 20000;
export const MAX_NAME = 40;

export function dataDir() {
  return process.env.DSH_SOUL_HOME || join(homedir(), ".dsh-soul-evolve");
}

export function personaPath() {
  return join(dataDir(), "personas.json");
}

export function defaultPersonaDoc() {
  return { version: PERSONA_VERSION, active: null, cards: {} };
}

function migrateDoc(raw) {
  if (!raw || typeof raw !== "object") return defaultPersonaDoc();
  const cards = raw.cards && typeof raw.cards === "object" ? raw.cards : {};
  const clean = {};
  for (const [name, card] of Object.entries(cards)) {
    if (!card || typeof card.content !== "string") continue;
    clean[name] = { content: card.content, updatedAt: Number(card.updatedAt) || 0 };
  }
  const active = typeof raw.active === "string" && clean[raw.active] ? raw.active : null;
  return { version: PERSONA_VERSION, active, cards: clean };
}

/** 同步读取（提示词组装里必须同步且不能抛） */
export function loadPersonas() {
  try {
    return migrateDoc(JSON.parse(readFileSync(personaPath(), "utf8")));
  } catch {
    return defaultPersonaDoc();
  }
}

export function savePersonas(doc) {
  const p = personaPath();
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(doc, null, 2), "utf8");
  renameSync(tmp, p);
  return p;
}

export function validateName(name) {
  const n = String(name ?? "").trim();
  if (!n) throw new Error("Soul 名不能为空");
  if (n.length > MAX_NAME) throw new Error(`Soul 名过长（上限 ${MAX_NAME} 字）`);
  return n;
}

export function validateContent(content) {
  const text = String(content ?? "");
  if (!text.trim()) throw new Error("Soul 内容不能为空");
  if (text.length > MAX_CONTENT) throw new Error(`Soul 内容过长（上限 ${MAX_CONTENT} 字）`);
  if (text.includes("{{") || text.includes("}}")) {
    throw new Error("Soul 内容不能包含 {{ 或 }}：那是 DSH 的提示词变量语法，会破坏提示词组装");
  }
  return text;
}

/** 新建或覆盖一张卡 */
export function putPersona(doc, name, content, now = Date.now()) {
  const n = validateName(name);
  const text = validateContent(content);
  const next = { ...doc, cards: { ...doc.cards, [n]: { content: text, updatedAt: now } } };
  if (!next.active) next.active = n;
  return next;
}

export function deletePersona(doc, name) {
  const n = validateName(name);
  if (!doc.cards[n]) throw new Error(`没有 Soul 面板「${n}」`);
  const cards = { ...doc.cards };
  delete cards[n];
  return { ...doc, cards, active: doc.active === n ? Object.keys(cards)[0] ?? null : doc.active };
}

export function setActive(doc, name) {
  if (name === null || name === "") return { ...doc, active: null };
  const n = validateName(name);
  if (!doc.cards[n]) throw new Error(`没有 Soul 面板「${n}」`);
  return { ...doc, active: n };
}

export function listPersonas(doc) {
  return Object.entries(doc.cards).map(([name, card]) => ({
    name,
    active: doc.active === name,
    size: card.content.length,
    updatedAt: card.updatedAt || 0,
    summary: card.content.split("\n").filter((l) => l.trim()).slice(0, 2).join(" / ").slice(0, 80),
  }));
}

/** 渲染成注入提示词的段落；没有激活卡时返回空串（DSH 会跳过空段） */
export function renderPersonaSection(doc = loadPersonas()) {
  if (!doc.active) return "";
  const card = doc.cards[doc.active];
  if (!card || !card.content.trim()) return "";
  return ["## Soul 面板", "", card.content.trim()].join("\n");
}

/** 供 context.text 使用的同步读取入口 */
export function readActivePersona() {
  return renderPersonaSection(loadPersonas());
}
