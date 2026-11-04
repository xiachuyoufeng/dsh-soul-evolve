import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createHandler } from "../src/api.js";

/**
 * API 层测试：纯函数测过的东西，经过路由之后还可能走样。
 * 这个文件存在的起因是一个真实 bug——POST /api/patterns/sediment 硬编码
 * sediment({ now })，请求体里的 dryRun 根本没被读，于是「空跑」照写不误。
 * 纯函数测试全绿，因为 sediment() 内部的 dryRun 是对的，断在路由这一层。
 */

function mockReq(url, method, body, headers = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), "utf8")];
  return {
    url,
    method,
    headers: { "x-soul-action": "1", ...headers },
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i >= chunks.length) return { value: undefined, done: true };
          return { value: chunks[i++], done: false };
        },
      };
    },
  };
}

function mockRes() {
  const out = { status: 0, json: null, raw: "" };
  return {
    out,
    writableEnded: false,
    headersSent: false,
    writeHead(code) {
      out.status = code;
      this.headersSent = true;
    },
    end(chunk) {
      out.raw = String(chunk ?? "");
      try {
        out.json = JSON.parse(out.raw);
      } catch {
        out.json = null;
      }
      this.writableEnded = true;
    },
  };
}

/** 造 4 天 / 4 会话 / 每会话 20 轮的观测，确保四条检测器里至少两条够格 */
function makeTurns() {
  const out = [];
  const base = Date.UTC(2026, 10, 1, 2, 0, 0);
  let n = 0;
  for (let s = 0; s < 4; s += 1) {
    for (let i = 0; i < 20; i += 1) {
      n += 1;
      out.push({
        t: base + (s % 4) * 86400000 + i * 60000,
        sid: `s${s}`,
        scene: "work",
        state: { valence: 0, arousal: 0.4, energy: 0.6, intimacy: 0.1, focus: 0.5 },
        knobs: {},
        textLen: 15,
        panelLen: 800,
        reflex: [n % 5 === 0 ? "short" : null, n % 9 === 0 ? "curious" : null].filter(Boolean),
      });
    }
  }
  return out;
}

/** 在隔离的 DSH_SOUL_HOME 里跑一段，跑完清理 */
async function withHome(fn) {
  const dir = mkdtempSync(join(tmpdir(), "soul-api-"));
  const old = process.env.DSH_SOUL_HOME;
  process.env.DSH_SOUL_HOME = dir;
  try {
    writeFileSync(join(dir, "turns.jsonl"), makeTurns().map((t) => JSON.stringify(t)).join("\n") + "\n", "utf8");
    return await fn(dir);
  } finally {
    if (old === undefined) delete process.env.DSH_SOUL_HOME;
    else process.env.DSH_SOUL_HOME = old;
    rmSync(dir, { recursive: true, force: true });
  }
}

async function post(handler, path, body, headers) {
  const res = mockRes();
  await handler(mockReq(path, "POST", body, headers), res);
  return res.out;
}

test("API: 沉淀接口的 dryRun 真的不写盘（回归：路由曾丢掉这个参数）", async () => {
  await withHome(async () => {
    const handler = createHandler();

    const dry = await post(handler, "/dsh-soul-evolve/api/patterns/sediment", { dryRun: true });
    assert.equal(dry.status, 200);
    assert.equal(dry.json.dryRun, true, "回包要如实说这是空跑");
    assert.equal(dry.json.written.length, 0, "空跑不该写条目");
    assert.ok(dry.json.wouldWrite.length > 0, "空跑要告诉调用方本来会写哪些");

    const real = await post(handler, "/dsh-soul-evolve/api/patterns/sediment", {});
    assert.equal(real.status, 200);
    assert.equal(real.json.dryRun, false);
    assert.equal(real.json.written.length, 2, `空跑不吃冷却，真跑应写两条，实际 ${real.json.written.length}`);
  });
});

test("API: 沉淀接口要求 x-soul-action 头", async () => {
  await withHome(async () => {
    const handler = createHandler();
    const res = await post(handler, "/dsh-soul-evolve/api/patterns/sediment", {}, { "x-soul-action": "" });
    assert.equal(res.status, 403, "缺行动头应 403");
  });
});

test("API: 预览接口只读且不需要行动头", async () => {
  await withHome(async (dir) => {
    const handler = createHandler();
    const res = mockRes();
    await handler(mockReq("/dsh-soul-evolve/api/patterns", "GET", undefined, { "x-soul-action": "" }), res);
    assert.equal(res.out.status, 200);
    assert.ok(res.out.json.stats.turns > 0);
    assert.ok(Array.isArray(res.out.json.ready));
    assert.equal(existsSync(join(dir, "patterns.json")), false, "预览不该落记账文件");
  });
});
