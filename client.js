/**
 * client.js —— dsh-soul-evolve 浏览器半侧。
 *
 * 两块界面：
 * 1. `plugins.bundle.config`：插件配置面板
 *    - 状态：五个维度数值 + 表达旋钮 + 最近事件
 *    - Soul：Soul 面板列表 / 编辑 / 新建 / 删除 / 激活 / 导入 .md / 导出 .md
 *    - 升级：从本地源码同步到已安装副本
 * 2. `plugins.detail.actions`：插件详情页的「从本地源码升级」按钮
 *
 * 手写 ModuleLoader bundle，无构建步骤。所有写操作带 `x-soul-action: 1` 头
 * （自定义头触发跨域预检，挡住其他网站的 CSRF 触发）。
 */
window.__ModuleLoader__.load({
  id: "dsh-soul-evolve",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var h = React.createElement;

    var PREFIX = "/dsh-soul-evolve";
    var STYLE_ATTR = "data-dsh-soul-evolve-css";

    var CSS =
      ".__ds_root{display:flex;flex-direction:column;gap:14px;max-width:720px}" +
      ".__ds_card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-layer-2)}" +
      ".__ds_head{display:flex;align-items:center;justify-content:space-between;gap:8px}" +
      ".__ds_title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:6px}" +
      ".__ds_hint{font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:1.5}" +
      ".__ds_row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}" +
      ".__ds_metric{display:flex;flex-direction:column;gap:2px;min-width:104px}" +
      ".__ds_metricLabel{font-size:11px;color:var(--dsw-alias-label-secondary)}" +
      ".__ds_metricValue{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}" +
      ".__ds_bar{height:4px;border-radius:2px;background:var(--dsw-alias-border-l2);overflow:hidden}" +
      ".__ds_barFill{height:100%;border-radius:2px;background:var(--dsw-alias-state-business-primary,#3964fe)}" +
      ".__ds_btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 12px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}" +
      ".__ds_btn:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary,#3964fe)}" +
      ".__ds_btn:disabled{opacity:.5;cursor:default}" +
      ".__ds_btnPrimary{border-color:var(--dsw-alias-state-business-primary,#3964fe);background:var(--dsw-alias-state-business-primary,#3964fe);color:#fff}" +
      ".__ds_btnDanger{border-color:var(--dsw-alias-state-error-primary,#f85149);color:var(--dsw-alias-state-error-primary,#f85149)}" +
      ".__ds_input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 9px;font:inherit;font-size:12px;box-sizing:border-box}" +
      ".__ds_textarea{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:8px 10px;font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.6;box-sizing:border-box;width:100%;min-height:180px;resize:vertical}" +
      ".__ds_select{min-width:180px;max-width:100%}" +
      ".__ds_events{display:flex;flex-direction:column;gap:4px;max-height:132px;overflow:auto}" +
      ".__ds_event{font-size:11px;color:var(--dsw-alias-label-secondary);display:flex;gap:8px;align-items:baseline}" +
      ".__ds_eventTime{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;flex:none}" +
      ".__ds_status{font-size:11px;color:var(--dsw-alias-label-tertiary)}" +
      ".__ds_error{font-size:11px;color:var(--dsw-alias-state-error-primary)}" +
      ".__ds_ok{font-size:11px;color:var(--dsw-alias-state-success-primary,#3c9a5f)}";

    function injectStyles() {
      if (typeof document === "undefined") return function () {};
      if (document.querySelector("style[" + STYLE_ATTR + "]") !== null) return function () {};
      var tag = document.createElement("style");
      tag.setAttribute(STYLE_ATTR, "1");
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return function () {
        tag.remove();
      };
    }

    async function api(path, options) {
      var init = options || {};
      var headers = Object.assign({ "content-type": "application/json" }, init.headers || {});
      if (init.method && init.method !== "GET") headers["x-soul-action"] = "1";
      var res = await fetch(PREFIX + path, {
        method: init.method || "GET",
        headers: headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      var body = null;
      try {
        body = await res.json();
      } catch (e) {
        body = null;
      }
      if (!res.ok || !body || body.ok !== true) {
        throw new Error((body && body.error) || "HTTP " + res.status);
      }
      return body;
    }

    function fmtTime(ts) {
      if (!ts) return "";
      var d = new Date(ts);
      var pad = function (n) {
        return String(n).padStart(2, "0");
      };
      return pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
    }

    var SCENE_LABELS = { work: "工作", chat: "闲聊", support: "情绪支持", tech: "技术求助" };

    function Metric(props) {
      var value = Math.max(0, Math.min(1, Number(props.value) || 0));
      var display = props.signed ? (value > 0 ? "+" : "") + value.toFixed(2) : value.toFixed(2);
      return h(
        "div",
        { className: "__ds_metric" },
        h("span", { className: "__ds_metricLabel" }, props.label),
        h("span", { className: "__ds_metricValue" }, display),
        h("div", { className: "__ds_bar" }, h("div", { className: "__ds_barFill", style: { width: Math.round(value * 100) + "%" } }))
      );
    }

    /* ------------------------------------------------------------------ */
    /* 状态面板                                                           */
    /* ------------------------------------------------------------------ */

    function StatePanel() {
      var st = React.useState({ status: "loading", data: null, error: "" });
      var view = st[0];
      var setView = st[1];

      var load = React.useCallback(function () {
        setView(function (prev) {
          return { status: prev.data === null ? "loading" : prev.status, data: prev.data, error: "" };
        });
        api("/api/state")
          .then(function (body) {
            setView({ status: "ready", data: body, error: "" });
          })
          .catch(function (err) {
            setView({ status: "error", data: null, error: err.message || String(err) });
          });
      }, []);

      React.useEffect(function () {
        load();
      }, [load]);

      var state = view.data && view.data.state;
      var mod = view.data && view.data.modulation;
      var events = (state && state.events) || [];
      var recent = events.slice(-6).reverse();

      return h(
        "section",
        { className: "__ds_card" },
        h(
          "div",
          { className: "__ds_head" },
          h("span", { className: "__ds_title" }, "人格状态"),
          h(
            "button",
            { type: "button", className: "__ds_btn", onClick: load, disabled: view.status === "loading" },
            view.status === "loading" ? "读取中…" : "刷新"
          )
        ),
        view.status === "error" ? h("span", { className: "__ds_error" }, "读取失败：" + view.error) : null,
        state
          ? h(
              React.Fragment,
              null,
              h(
                "div",
                { className: "__ds_row" },
                h(Metric, { label: "效价", value: state.mood.valence, signed: true }),
                h(Metric, { label: "激活", value: state.mood.arousal }),
                h(Metric, { label: "精力", value: state.energy }),
                h(Metric, { label: "亲近", value: state.intimacy }),
                h(Metric, { label: "专注", value: state.focus })
              ),
              h(
                "div",
                { className: "__ds_hint" },
                "当前：" +
                  ((view.data && view.data.label) || "—") +
                  "　表达旋钮：长度≈" +
                  (mod ? mod.verbosity : "—") +
                  "、温度≈" +
                  (mod ? mod.warmth : "—") +
                  "、耐心≈" +
                  (mod ? mod.patience : "—") +
                  "　场景：" +
                  (SCENE_LABELS[(view.data && view.data.scene) || "work"] || "工作")
              ),
              recent.length > 0
                ? h(
                    "div",
                    { className: "__ds_events" },
                    recent.map(function (ev, index) {
                      return h(
                        "div",
                        { className: "__ds_event", key: index },
                        h("span", { className: "__ds_eventTime" }, fmtTime(ev.at)),
                        h("span", null, ev.note || "（无备注）")
                      );
                    })
                  )
                : h("span", { className: "__ds_hint" }, "还没有事件——发一条消息后会自动记录"),
              h(
                "span",
                { className: "__ds_hint" },
                "状态由真人消息自动累积；改动在下一轮请求组装时生效。" +
                  (view.data && view.data.stateScope
                    ? "　作用域：" + (view.data.stateScope === "workspace" ? "每工作目录独立" : "全局共享")
                    : "")
              )
            )
          : null
      );
    }

    /* ------------------------------------------------------------------ */
    /* Soul 面板                                                           */
    /* ------------------------------------------------------------------ */

    function PersonaPanel() {
      var st = React.useState({ status: "loading", active: null, cards: [], error: "", notice: "" });
      var view = st[0];
      var setView = st[1];
      var draft = React.useState({ name: "", content: "" });
      var d = draft[0];
      var setDraft = draft[1];
      var busy = React.useState(false);
      var isBusy = busy[0];
      var setBusy = busy[1];
      var detailState = React.useState({ entries: [], history: [], inject: null });
      var detail = detailState[0];
      var setDetail = detailState[1];
      var entryDraft = React.useState({ text: "", category: "preference" });
      var ed = entryDraft[0];
      var setEntryDraft = entryDraft[1];

      var setErr = function (message) {
        setView(function (prev) {
          return Object.assign({}, prev, { error: message, notice: "" });
        });
      };
      var setNotice = function (message) {
        setView(function (prev) {
          return Object.assign({}, prev, { notice: message, error: "" });
        });
      };

      var applyCardDetail = function (body) {
        setDetail({
          entries: body.entries || [],
          history: body.history || [],
          inject: body.inject || null,
        });
        if (Array.isArray(body.history)) {
          /* history 里只有摘要，正文按需回滚 */
        }
      };

      var refresh = React.useCallback(function () {
        api("/api/personas")
          .then(function (body) {
            setView({ status: "ready", active: body.active, cards: body.cards, error: "", notice: "" });
          })
          .catch(function (err) {
            setView({ status: "error", active: null, cards: [], error: err.message || String(err), notice: "" });
          });
      }, []);

      React.useEffect(function () {
        refresh();
      }, [refresh]);

      var loadDetail = function (name) {
        if (!name) return;
        api("/api/personas/" + encodeURIComponent(name))
          .then(function (body) {
            applyCardDetail(body);
          })
          .catch(function () {
            /* 详情读不到不影响编辑正文 */
          });
      };

      var pick = function (name) {
        if (!name) {
          setDraft({ name: "", content: "" });
          setDetail({ entries: [], history: [], inject: null });
          return;
        }
        api("/api/personas/" + encodeURIComponent(name))
          .then(function (body) {
            setDraft({ name: body.name, content: body.content });
            applyCardDetail(body);
            setNotice("已载入「" + body.name + "」");
          })
          .catch(function (err) {
            setErr(err.message || String(err));
          });
      };

      var reloadCard = function (name, message) {
        refresh();
        if (!name) return;
        api("/api/personas/" + encodeURIComponent(name))
          .then(function (body) {
            applyCardDetail(body);
            if (message) setNotice(message);
          })
          .catch(function (err) {
            setErr(err.message || String(err));
          });
      };

      var save = function () {
        var name = (d.name || "").trim();
        if (!name) {
          setErr("请先填 Soul 名");
          return;
        }
        setBusy(true);
        api("/api/personas", { method: "PUT", body: { name: name, content: d.content } })
          .then(function (body) {
            setView({ status: "ready", active: body.active, cards: body.cards, error: "", notice: "已保存「" + name + "」" });
            reloadCard(name, "已保存「" + name + "」（旧正文已进历史）");
          })
          .catch(function (err) {
            setErr(err.message || String(err));
          })
          .then(function () {
            setBusy(false);
          });
      };

      var addEntry = function () {
        var name = (d.name || "").trim();
        var text = (ed.text || "").trim();
        if (!name) {
          setErr("先选择一个 Soul 面板");
          return;
        }
        if (!text) {
          setErr("演化条目不能为空");
          return;
        }
        setBusy(true);
        api("/api/personas/entries", { method: "POST", body: { name: name, text: text, category: ed.category } })
          .then(function (body) {
            setEntryDraft({ text: "", category: ed.category });
            applyCardDetail(body.card || {});
            refresh();
            setNotice(body.added ? "已加入一条演化条目" : "已有近似条目，按命中处理（权重 +0.1）");
          })
          .catch(function (err) {
            setErr(err.message || String(err));
          })
          .then(function () {
            setBusy(false);
          });
      };

      var forgetEntry = function (id) {
        if (typeof window !== "undefined" && !window.confirm("删除这条演化条目？")) return;
        setBusy(true);
        api("/api/personas/entries?name=" + encodeURIComponent(d.name) + "&id=" + encodeURIComponent(id), { method: "DELETE" })
          .then(function (body) {
            applyCardDetail(body.card || {});
            refresh();
            setNotice("已删除条目");
          })
          .catch(function (err) {
            setErr(err.message || String(err));
          })
          .then(function () {
            setBusy(false);
          });
      };

      var rollback = function (index) {
        if (typeof window !== "undefined" && !window.confirm("回滚到这个历史版本？（当前正文也会进历史，可再退回）")) return;
        setBusy(true);
        api("/api/personas/rollback", { method: "POST", body: { name: d.name, index: index } })
          .then(function (body) {
            setDraft({ name: d.name, content: (body.card && body.card.content) || "" });
            applyCardDetail(body.card || {});
            refresh();
            setNotice("已回滚");
          })
          .catch(function (err) {
            setErr(err.message || String(err));
          })
          .then(function () {
            setBusy(false);
          });
      };

      var create = function () {
        setDraft({ name: "", content: "" });
        setDetail({ entries: [], history: [], inject: null });
        setNotice("已清空草稿，填好名字和正文后点「保存」");
      };

      /* 首次进来自动载入当前激活的 Soul 面板，省一次点击 */
      React.useEffect(function () {
        api("/api/personas")
          .then(function (body) {
            if (body.active) pick(body.active);
          })
          .catch(function () {
            /* 读不到就算了，用户可以手选 */
          });
      }, []);

      var remove = function () {
        var name = (d.name || "").trim();
        if (!name) return;
        if (typeof window !== "undefined" && !window.confirm("删除 Soul 面板「" + name + "」？")) return;
        setBusy(true);
        api("/api/personas?name=" + encodeURIComponent(name), { method: "DELETE" })
          .then(function (body) {
            setView({ status: "ready", active: body.active, cards: body.cards, error: "", notice: "已删除「" + name + "」" });
            setDraft({ name: "", content: "" });
            setDetail({ entries: [], history: [], inject: null });
          })
          .catch(function (err) {
            setErr(err.message || String(err));
          })
          .then(function () {
            setBusy(false);
          });
      };

      var activate = function () {
        var name = (d.name || "").trim();
        if (!name) return;
        setBusy(true);
        api("/api/personas/active", { method: "PUT", body: { name: name } })
          .then(function (body) {
            setView({ status: "ready", active: body.active, cards: body.cards, error: "", notice: "已激活「" + name + "」" });
            reloadCard(name);
          })
          .catch(function (err) {
            setErr(err.message || String(err));
          })
          .then(function () {
            setBusy(false);
          });
      };

      var deactivate = function () {
        setBusy(true);
        api("/api/personas/active", { method: "PUT", body: { name: null } })
          .then(function (body) {
            setView({ status: "ready", active: body.active, cards: body.cards, error: "", notice: "已停用 Soul" });
          })
          .catch(function (err) {
            setErr(err.message || String(err));
          })
          .then(function () {
            setBusy(false);
          });
      };

      var importFile = function (event) {
        var file = event.target && event.target.files && event.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          var text = String(reader.result || "");
          var base = String(file.name || "导入的 Soul").replace(/\.[^.]+$/, "");
          setDraft({ name: base, content: text });
          setNotice("已载入文件「" + file.name + "」，确认后点「保存」");
        };
        reader.readAsText(file);
        event.target.value = "";
      };

      var exportFile = function () {
        if (!d.content) {
          setErr("没有可导出的内容");
          return;
        }
        var name = (d.name || "persona").trim() || "persona";
        var blob = new Blob([d.content], { type: "text/markdown;charset=utf-8" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = name + ".md";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 1000);
        setNotice("已导出 " + name + ".md");
      };

      var cards = view.cards || [];

      return h(
        "section",
        { className: "__ds_card" },
        h(
          "div",
          { className: "__ds_head" },
          h("span", { className: "__ds_title" }, "Soul 面板"),
          h(
            "div",
            { className: "__ds_row" },
            h("button", { type: "button", className: "__ds_btn", onClick: refresh }, "刷新"),
            h("button", { type: "button", className: "__ds_btn", onClick: create }, "新建")
          )
        ),
        view.error ? h("span", { className: "__ds_error" }, view.error) : null,
        view.notice ? h("span", { className: "__ds_ok" }, view.notice) : null,
        h(
          "div",
          { className: "__ds_row" },
          h(
            "select",
            {
              className: "__ds_input __ds_select",
              value: d.name,
              onChange: function (event) {
                pick(event.target.value);
              },
            },
            h("option", { value: "" }, cards.length === 0 ? "（还没有 Soul 面板）" : "选择 Soul 面板…"),
            cards.map(function (card) {
              return h("option", { value: card.name, key: card.name }, (card.active ? "● " : "") + card.name);
            })
          ),
          h("input", {
            className: "__ds_input",
            style: { width: "180px" },
            placeholder: "Soul 面板名",
            value: d.name,
            onChange: function (event) {
              setDraft(Object.assign({}, d, { name: event.target.value }));
            },
          }),
          h(
            "label",
            { className: "__ds_btn", style: { display: "inline-flex", alignItems: "center" } },
            "导入 .md",
            h("input", { type: "file", accept: ".md,.markdown,.txt", style: { display: "none" }, onChange: importFile })
          )
        ),
        h("textarea", {
          className: "__ds_textarea",
          placeholder:
            "Soul 正文（Markdown，soul.md 风格）：\n\n## Identity\n你是……\n\n## Personality\n- ……\n\n注意：不能包含 {{ 或 }}",
          value: d.content,
          onChange: function (event) {
            setDraft(Object.assign({}, d, { content: event.target.value }));
          },
        }),

        /* ---- 演化条目：带权重，按预算注入 ---- */
        h(
          "div",
          { className: "__ds_head" },
          h("span", { className: "__ds_title", style: { fontSize: "13px" } }, "Evolved 演化条目"),
          detail.inject
            ? h(
                "span",
                { className: "__ds_hint" },
                "注入 " + detail.inject.used + "/" + detail.inject.budget + " 字 · 生效 " +
                  detail.inject.injected + " 条 · 超预算 " + detail.inject.truncated + " 条"
              )
            : null
        ),
        h(
          "div",
          { className: "__ds_row" },
          h("input", {
            className: "__ds_input",
            placeholder: "新增一条演化条目（一句话）",
            value: ed.text,
            onChange: function (event) {
              setEntryDraft(Object.assign({}, ed, { text: event.target.value }));
            },
          }),
          h(
            "select",
            {
              className: "__ds_input __ds_select",
              style: { width: "150px" },
              value: ed.category,
              onChange: function (event) {
                setEntryDraft(Object.assign({}, ed, { category: event.target.value }));
              },
            },
            h("option", { value: "correction" }, "纠正（不衰减）"),
            h("option", { value: "repeat" }, "重复犯错"),
            h("option", { value: "preference" }, "长期偏好"),
            h("option", { value: "scene" }, "场景相关")
          ),
          h("button", { type: "button", className: "__ds_btn", onClick: addEntry, disabled: isBusy || !ed.text }, "加入")
        ),
        (detail.entries || []).length === 0
          ? h("span", { className: "__ds_hint" }, "还没有演化条目。soul_evolve 产出的条目会写到这里。")
          : h(
              "div",
              { style: { display: "flex", flexDirection: "column", gap: "3px" } },
              detail.entries.map(function (e) {
                return h(
                  "div",
                  {
                    key: e.id,
                    style: {
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      opacity: e.injected ? 1 : 0.45,
                      padding: "2px 0",
                    },
                  },
                  h(
                    "span",
                    { className: "__ds_hint", style: { minWidth: "104px", whiteSpace: "nowrap" } },
                    e.category + " · " + e.effective + (e.injected ? "" : " · 未注入")
                  ),
                  h("span", { style: { flex: "1", fontSize: "12px", lineHeight: "1.5" } }, e.text),
                  h(
                    "button",
                    {
                      type: "button",
                      className: "__ds_btn",
                      onClick: function () {
                        forgetEntry(e.id);
                      },
                      disabled: isBusy,
                    },
                    "删"
                  )
                );
              })
            ),

        /* ---- 历史版本 ---- */
        (detail.history || []).length
          ? h(
              "div",
              { className: "__ds_row", style: { flexWrap: "wrap" } },
              h("span", { className: "__ds_hint" }, "历史：" + detail.history.length + " 版"),
              detail.history.map(function (hi) {
                return h(
                  "button",
                  {
                    type: "button",
                    className: "__ds_btn",
                    key: "h" + hi.index,
                    disabled: isBusy,
                    onClick: function () {
                      rollback(hi.index);
                    },
                    title: "回滚到这一版",
                  },
                  "#" + hi.index + " " + fmtTime(hi.at)
                );
              })
            )
          : null,
        h(
          "div",
          { className: "__ds_row" },
          h("button", { type: "button", className: "__ds_btn __ds_btnPrimary", onClick: save, disabled: isBusy }, "保存"),
          h("button", { type: "button", className: "__ds_btn", onClick: activate, disabled: isBusy || !d.name }, "设为激活"),
          h("button", { type: "button", className: "__ds_btn", onClick: deactivate, disabled: isBusy }, "停用"),
          h("button", { type: "button", className: "__ds_btn", onClick: exportFile, disabled: !d.content }, "导出 .md"),
          h("button", { type: "button", className: "__ds_btn __ds_btnDanger", onClick: remove, disabled: isBusy || !d.name }, "删除"),
          h("span", { className: "__ds_status" }, view.active ? "当前激活：" + view.active : "当前未激活任何 Soul")
        ),
        h(
          "span",
          { className: "__ds_hint" },
          "Soul 会作为提示词段注入；改完在下一轮请求生效，无需重启。正文不能含 {{ 或 }}（DSH 变量语法）。"
        )
      );
    }

    /* ------------------------------------------------------------------ */
    /* 升级面板 / 详情页按钮                                              */
    /* ------------------------------------------------------------------ */

    /**
     * 源码升级是开发通道：后端只有配了 DSH_SOUL_SOURCE 才报告可用。
     * 不可用时整块不渲染——公开发布版里不该出现一个点下去会报错的按钮。
     */
    function useUpgradeAvailable() {
      var st = React.useState(false);
      var setAvailable = st[1];
      React.useEffect(function () {
        api("/api/status")
          .then(function (body) {
            setAvailable(Boolean(body.upgradeAvailable));
          })
          .catch(function () {
            /* 探测失败按不可用处理 */
          });
      }, []);
      return st[0];
    }

    function UpgradeBody() {
      var st = React.useState({ phase: "idle", message: "", version: null });
      var view = st[0];
      var setView = st[1];

      React.useEffect(function () {
        api("/api/status")
          .then(function (body) {
            setView(function (prev) {
              return Object.assign({}, prev, { version: body.installed ? body.installed.version : null });
            });
          })
          .catch(function () {
            /* 状态读不到不影响升级 */
          });
      }, []);

      var run = function () {
        setView({ phase: "running", message: "", version: view.version });
        api("/api/upgrade", { method: "POST" })
          .then(function (body) {
            setView({
              phase: "done",
              message: "已同步 " + body.files + " 个文件（v" + body.from + " → v" + body.to + "），重启 DSH 生效",
              version: body.to,
            });
          })
          .catch(function (err) {
            setView({ phase: "error", message: err.message || String(err), version: view.version });
          });
      };

      var label = view.phase === "running" ? "升级中…" : view.phase === "done" ? "已升级" : "从本地源码升级";
      return h(
        "div",
        { className: "__ds_row" },
        h("button", { type: "button", className: "__ds_btn", onClick: run, disabled: view.phase === "running", "data-soul-upgrade": "1" }, label),
        h("span", { className: "__ds_status" }, view.version ? "已装 v" + view.version : ""),
        view.message ? h("span", { className: view.phase === "error" ? "__ds_error" : "__ds_ok" }, view.message) : null
      );
    }

    function UpgradePanel() {
      if (!useUpgradeAvailable()) return null;
      return h(
        "section",
        { className: "__ds_card" },
        h(
          "div",
          { className: "__ds_head" },
          h("span", { className: "__ds_title" }, "升级"),
          h("span", { className: "__ds_hint" }, "把本地源码目录的最新版本同步到已安装副本")
        ),
        h(UpgradeBody, null)
      );
    }

    function ConfigPanel() {
      return h(
        "div",
        { className: "__ds_root", "data-dsh-soul-evolve": "config" },
        h(StatePanel, null),
        h(PersonaPanel, null),
        h(UpgradePanel, null)
      );
    }

    /** 插件详情页右上角的升级按钮（保留原入口） */
    function UpgradeAction(props) {
      var available = useUpgradeAvailable();
      var state = React.useState({ phase: "idle", message: "" });
      var view = state[0];
      var setView = state[1];

      var pkg = null;
      if (props) {
        var subject = props.subject ? props.subject : props;
        pkg = subject ? subject.pkg : null;
      }

      var run = React.useCallback(async function () {
        setView({ phase: "running", message: "" });
        try {
          var body = await api("/api/upgrade", { method: "POST" });
          setView({
            phase: "done",
            message: "已同步 " + body.files + " 个文件（v" + body.from + " → v" + body.to + "），重启 DSH 生效",
          });
        } catch (err) {
          setView({ phase: "error", message: (err && err.message) || String(err) });
        }
      }, []);

      if (!pkg || pkg.name !== "dsh-soul-evolve") return null;
      if (!available) return null;

      var label = view.phase === "running" ? "升级中…" : view.phase === "done" ? "已升级" : "从本地源码升级";
      var tone =
        view.phase === "error"
          ? "var(--dsw-alias-state-error-primary,#f85149)"
          : view.phase === "done"
          ? "var(--dsw-alias-state-success-primary,#3c9a5f)"
          : "inherit";

      return h(
        "div",
        { style: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "2px" } },
        h(
          "button",
          {
            type: "button",
            onClick: run,
            disabled: view.phase === "running",
            "data-soul-upgrade": "1",
            className: "__ds_btn",
            title: "把本地源码目录的最新版本同步到已安装副本，重启后生效",
          },
          label
        ),
        view.message ? h("span", { style: { fontSize: "11px", color: tone, maxWidth: "320px", textAlign: "right" } }, view.message) : null
      );
    }

    var inject = ["slots"];

    function apply(ctx) {
      if (!ctx || !ctx.slots) return;
      if (typeof ctx.effect === "function") {
        ctx.effect(function () {
          return injectStyles();
        }, "dsh-soul-evolve: styles");
      }
      ctx.slots.inject("plugins.bundle.config", function () {
        return ctx.slots.register({ name: "plugins.bundle.config", key: "dsh-soul-evolve" }, ConfigPanel);
      });
      ctx.slots.inject("plugins.detail.actions", function () {
        return ctx.slots.register({ name: "plugins.detail.actions", id: "soul-upgrade", order: 90 }, UpgradeAction);
      });
    }

    module.exports = { apply: apply, inject: inject };
    return module.exports;
  },
});
