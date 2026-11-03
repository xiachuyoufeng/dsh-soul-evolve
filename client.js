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
      ".__ds_ok{font-size:11px;color:var(--dsw-alias-state-success-primary,#3c9a5f)}" +
      /* ---- 可视化：进度条 / 柱状图 / 徽章 / 刻度。只用细线和单色填充，不加动画与渐变 ---- */
      ".__ds_metricBar{position:relative;height:4px;border-radius:2px;background:var(--dsw-alias-border-l2);overflow:visible}" +
      ".__ds_metricFill{position:absolute;left:0;top:0;height:100%;border-radius:2px;background:var(--dsw-alias-state-business-primary,#3964fe)}" +
      ".__ds_metricFillNeg{position:absolute;top:0;height:100%;border-radius:2px;background:var(--dsw-alias-state-error-primary,#f85149)}" +
      ".__ds_tick{position:absolute;top:-2px;width:1px;height:8px;background:var(--dsw-alias-label-tertiary);opacity:.75}" +
      ".__ds_metricDelta{font-size:10px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;margin-left:4px}" +
      ".__ds_prog{display:flex;align-items:center;gap:6px;min-width:0}" +
      ".__ds_progTrack{position:relative;flex:1;height:5px;border-radius:2px;background:var(--dsw-alias-border-l2);overflow:hidden;min-width:30px}" +
      ".__ds_progFill{height:100%;border-radius:2px;background:var(--dsw-alias-state-business-primary,#3964fe)}" +
      ".__ds_progFillOk{height:100%;border-radius:2px;background:var(--dsw-alias-state-success-primary,#3c9a5f)}" +
      ".__ds_progText{font-size:10px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap;min-width:40px;text-align:right}" +
      ".__ds_spark{display:flex;align-items:flex-end;gap:3px;height:34px;padding-top:2px}" +
      ".__ds_sparkCol{display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:2px;flex:1;min-width:0;height:100%}" +
      ".__ds_sparkBar{width:100%;border-radius:1px 1px 0 0;background:var(--dsw-alias-state-business-primary,#3964fe);opacity:.7;min-height:1px}" +
      ".__ds_sparkBarZero{width:100%;height:1px;background:var(--dsw-alias-border-l2)}" +
      ".__ds_sparkLabel{font-size:9px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;transform:scale(.92)}" +
      ".__ds_reflexRow{display:flex;align-items:center;gap:6px}" +
      ".__ds_reflexName{font-size:10px;color:var(--dsw-alias-label-tertiary);min-width:52px;white-space:nowrap}" +
      ".__ds_table{display:flex;flex-direction:column;gap:1px;font-size:12px}" +
      ".__ds_tr{display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:6px}" +
      ".__ds_tr:hover{background:var(--dsw-alias-bg-layer-3)}" +
      ".__ds_th{font-size:10px;color:var(--dsw-alias-label-tertiary);font-weight:500;padding:0 6px}" +
      ".__ds_colKey{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:0 0 118px}" +
      ".__ds_colNum{flex:0 0 82px}" +
      ".__ds_colNum2{flex:0 0 96px}" +
      ".__ds_colEvent{flex:1;font-size:11px;color:var(--dsw-alias-label-secondary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".__ds_badge{display:inline-flex;align-items:center;justify-content:center;border-radius:4px;padding:1px 5px;font-size:10px;line-height:1.5;white-space:nowrap;border:1px solid transparent}" +
      ".__ds_badgeHabit{background:rgba(57,100,254,.12);color:var(--dsw-alias-state-business-primary,#3964fe);border-color:rgba(57,100,254,.3)}" +
      ".__ds_badgeChar{background:rgba(60,154,95,.12);color:var(--dsw-alias-state-success-primary,#3c9a5f);border-color:rgba(60,154,95,.3)}" +
      ".__ds_badgeGrey{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-tertiary);border-color:var(--dsw-alias-border-l2)}" +
      ".__ds_weightBar{flex:0 0 44px;height:4px;border-radius:2px;background:var(--dsw-alias-border-l2);overflow:hidden}" +
      ".__ds_weightFill{height:100%;border-radius:2px;background:var(--dsw-alias-state-business-primary,#3964fe);opacity:.75}" +
      ".__ds_entryRow{display:flex;align-items:flex-start;gap:8px;padding:4px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}" +
      ".__ds_entryRow:last-child{border-bottom:none}" +
      ".__ds_entryText{flex:1;font-size:12px;line-height:1.5;min-width:0}" +
      ".__ds_sectionLabel{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);margin-top:2px}";

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

    /**
     * 单维状态：填充 = 当前值，竖线 = 基线。
     * 没有基线时，"0.41" 这个数字看不出偏高还是偏低，所以刻度比数字更有用。
     * 效价是 [-1,1] 的双向量，从基线向两侧长，负向用错误色。
     */
    function Metric(props) {
      var signed = !!props.signed;
      var clamp01 = function (x) {
        return Math.max(0, Math.min(1, x));
      };
      var lo = signed ? -1 : 0;
      var span = 1 - lo;
      var value = Number(props.value) || 0;
      var pos = clamp01((value - lo) / span);
      var base = props.baseline === undefined || props.baseline === null ? null : Number(props.baseline);
      var basePos = base === null ? null : clamp01((base - lo) / span);
      var delta = base === null ? null : value - base;
      var plain = props.display !== undefined && props.display !== null;
      var display = plain ? String(props.display) : signed ? (value > 0 ? "+" : "") + value.toFixed(2) : value.toFixed(2);
      var deltaText = delta === null || Math.abs(delta) < 0.005 ? "" : (delta > 0 ? "+" : "") + delta.toFixed(2);

      var fill;
      if (signed && basePos !== null) {
        var left = Math.min(pos, basePos);
        var width = Math.abs(pos - basePos);
        fill = h("div", {
          className: pos >= basePos ? "__ds_metricFill" : "__ds_metricFillNeg",
          style: { left: left * 100 + "%", width: width * 100 + "%" },
        });
      } else {
        fill = h("div", { className: "__ds_metricFill", style: { left: 0, width: pos * 100 + "%" } });
      }

      return h(
        "div",
        { className: "__ds_metric" },
        h("span", { className: "__ds_metricLabel" }, props.label),
        h(
          "span",
          { className: "__ds_metricValue" },
          display,
          deltaText ? h("span", { className: "__ds_metricDelta" }, deltaText) : null
        ),
        plain
          ? null
          : h(
              "div",
              { className: "__ds_metricBar" },
              fill,
              basePos === null ? null : h("div", { className: "__ds_tick", style: { left: basePos * 100 + "%" }, title: "基线 " + base.toFixed(2) })
            )
      );
    }

    /** 进度条：把 "2/3" 画成比例。够线就转成功色。 */
    function Progress(props) {
      var have = Number(props.have) || 0;
      var need = Number(props.need) || 0;
      var ratio = need > 0 ? Math.max(0, Math.min(1, have / need)) : 1;
      var ok = need > 0 && have >= need;
      return h(
        "div",
        { className: "__ds_prog" },
        h(
          "div",
          { className: "__ds_progTrack", title: (props.label || "") + " " + have + "/" + need },
          h("div", { className: ok ? "__ds_progFillOk" : "__ds_progFill", style: { width: ratio * 100 + "%" } })
        ),
        h("span", { className: "__ds_progText" }, have + "/" + need)
      );
    }

    /** 按天活跃度柱状图：看数据是均匀在聊，还是某一天一次灌进来的 */
    function Sparkline(props) {
      var rows = props.rows || [];
      if (rows.length === 0) return null;
      var max = rows.reduce(function (m, r) {
        return Math.max(m, Number(r.turns) || 0);
      }, 0);
      return h(
        "div",
        { className: "__ds_spark" },
        rows.map(function (r) {
          var turns = Number(r.turns) || 0;
          var pct = max > 0 ? Math.round((turns / max) * 100) : 0;
          var label = String(r.date || "").slice(5);
          return h(
            "div",
            { className: "__ds_sparkCol", key: r.date, title: r.date + "　" + turns + " 轮" },
            h("div", {
              className: turns > 0 ? "__ds_sparkBar" : "__ds_sparkBarZero",
              /* 用 px 而不是百分比：列里还有日期标签，百分比高度会把它挤出容器 */
              style: turns > 0 ? { height: Math.max(2, Math.round(pct * 0.24)) + "px" } : undefined,
            }),
            h("span", { className: "__ds_sparkLabel" }, label)
          );
        })
      );
    }

    /** 反射弧命中：横向条形。这是推断条目的直接依据，看得见才知道条目为什么长出来 */
    function ReflexBars(props) {
      var reflex = props.reflex || {};
      var names = { short: "短输入", curious: "追问", praise: "正反馈", blame: "负反馈", long: "长输入", repeat: "重复" };
      var order = ["short", "curious", "praise", "long", "blame", "repeat"];
      var entries = order
        .filter(function (k) {
          return Number(reflex[k]) > 0;
        })
        .map(function (k) {
          return { key: k, label: names[k] || k, count: Number(reflex[k]) };
        });
      if (entries.length === 0) return null;
      var max = entries.reduce(function (m, e) {
        return Math.max(m, e.count);
      }, 0);
      return h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "3px" } },
        entries.map(function (e) {
          return h(
            "div",
            { className: "__ds_reflexRow", key: e.key },
            h("span", { className: "__ds_reflexName" }, e.label),
            h(
              "div",
              { className: "__ds_progTrack", style: { flex: "1" } },
              h("div", { className: "__ds_progFill", style: { width: Math.round((e.count / max) * 100) + "%" } })
            ),
            h("span", { className: "__ds_progText", style: { minWidth: "52px" } }, e.count + " 次")
          );
        })
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
                { className: "__ds_row", style: { gap: "12px" } },
                h(Metric, { label: "效价", value: state.mood.valence, signed: true, baseline: (view.data && view.data.baseline || {}).valence }),
                h(Metric, { label: "激活", value: state.mood.arousal, baseline: (view.data && view.data.baseline || {}).arousal }),
                h(Metric, { label: "精力", value: state.energy, baseline: (view.data && view.data.baseline || {}).energy }),
                h(Metric, { label: "亲近", value: state.intimacy, baseline: (view.data && view.data.baseline || {}).intimacy }),
                h(Metric, { label: "专注", value: state.focus, baseline: (view.data && view.data.baseline || {}).focus })
              ),
              h(
                "div",
                { className: "__ds_row", style: { gap: "8px" } },
                h("span", { className: "__ds_badge __ds_badgeGrey" }, (view.data && view.data.label) || "—"),
                h("span", { className: "__ds_badge __ds_badgeGrey" }, "场景 " + (SCENE_LABELS[(view.data && view.data.scene) || "work"] || "工作")),
                h("span", { className: "__ds_hint", style: { opacity: 0.75 } }, "竖线是基线，填充是当前值")
              ),
              mod
                ? h(
                    "div",
                    { className: "__ds_row", style: { gap: "12px" } },
                    h(Metric, { label: "表达·长度", value: mod.verbosity }),
                    h(Metric, { label: "表达·温度", value: mod.warmth }),
                    h(Metric, { label: "表达·耐心", value: mod.patience })
                  )
                : null,
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
                var eff = Math.max(0, Math.min(1, Number(e.effective) || 0));
                var isDim = e.category === "habit" || e.category === "character";
                return h(
                  "div",
                  { key: e.id, className: "__ds_entryRow", style: { opacity: e.injected ? 1 : 0.45 } },
                  h(
                    "span",
                    {
                      className: "__ds_badge " + (e.category === "habit" ? "__ds_badgeHabit" : e.category === "character" ? "__ds_badgeChar" : "__ds_badgeGrey"),
                      style: { flex: "0 0 auto" },
                      title: "类别：" + (CATEGORY_LABEL[e.category] || e.category),
                    },
                    CATEGORY_LABEL[e.category] || e.category
                  ),
                  h(
                    "div",
                    { className: "__ds_weightBar", title: "有效权重 " + eff.toFixed(2) + "（越低越先被淡出）" },
                    h("div", { className: "__ds_weightFill", style: { width: Math.round(eff * 100) + "%" } })
                  ),
                  h(
                    "span",
                    { className: "__ds_entryText" },
                    e.text,
                    e.evidence
                      ? h(
                          "span",
                          { className: "__ds_hint", style: { display: "block", opacity: 0.8 } },
                          "依据 " + e.evidence.sessions + " 会话 / " + e.evidence.turns + " 轮" + (isDim ? "　统计推断" : "")
                        )
                      : null,
                    e.injected ? null : h("span", { className: "__ds_hint", style: { display: "block" } }, "未注入（超预算或权重过低）")
                  ),
                  h(
                    "button",
                    {
                      type: "button",
                      className: "__ds_btn",
                      style: { flex: "0 0 auto", padding: "3px 8px", fontSize: "11px" },
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

    /**
     * 交互沉淀面板：看观测里反复出现的模式（够格的/还差的），并可手动跑一次。
     * 自动通道每 15 轮真人输入自己跑；这里给的是"看得见 + 点一下就能催"。
     */
    function PatternPanel() {
      var state = React.useState({ status: "loading", data: null, error: "", message: "" });
      var view = state[0];
      var setView = state[1];

      var load = React.useCallback(function () {
        api("/api/patterns")
          .then(function (body) {
            setView(function (prev) {
              return { status: "ready", data: body, error: "", message: prev.message };
            });
          })
          .catch(function (err) {
            setView({ status: "error", data: null, error: (err && err.message) || String(err), message: "" });
          });
      }, []);

      React.useEffect(function () {
        load();
      }, [load]);

      var runSediment = function () {
        setView(function (prev) {
          return Object.assign({}, prev, { message: "沉淀中…" });
        });
        api("/api/patterns/sediment", { method: "POST" })
          .then(function (body) {
            var msg =
              body.written && body.written.length > 0
                ? "沉淀 " + body.written.length + " 条：" + body.written.map(function (w) { return w.key; }).join(", ")
                : body.ready && body.ready.length > 0
                ? "够格但都在冷却期，暂不重复写"
                : "还没有够格的模式（要跨 3 个会话、3 天以上）";
            setView({ status: "ready", data: null, error: "", message: msg });
            load();
          })
          .catch(function (err) {
            setView(function (prev) {
              return Object.assign({}, prev, { message: "沉淀失败：" + ((err && err.message) || String(err)) });
            });
          });
      };

      var d = view.data;
      var stats = (d && d.stats) || null;
      var dimLabel = {};
      var dimOrder = [];
      ((d && d.dimensions) || []).forEach(function (x) {
        dimLabel[x.dimension] = x.label;
        dimOrder.push(x.dimension);
      });
      if (dimOrder.length === 0) dimOrder = ["habit", "character"];

      /* 候选表：够格的和还差一点的放同一张表，只是状态列不同。
         原来分两个文字列表，看不出"还差多少"——进度条比文案直观。 */
      var byKey = {};
      ((d && d.ready) || []).forEach(function (c) {
        byKey[c.key] = { item: c, ready: true };
      });
      ((d && d.blocked) || []).forEach(function (c) {
        if (!byKey[c.key]) byKey[c.key] = { item: c, ready: false };
      });
      var rows = ((d && d.candidates) || [])
        .map(function (c) {
          return byKey[c.key] || null;
        })
        .filter(Boolean);

      var shortStatus = function (gate) {
        if (!gate || !gate.have || !gate.need) return "";
        var have = gate.have;
        var need = gate.need;
        if (have.days < need.days) return "差 " + (need.days - have.days) + " 天";
        if (have.sessions < need.sessions) return "差 " + (need.sessions - have.sessions) + " 会话";
        if (have.turns < need.turns) return "差 " + (need.turns - have.turns) + " 轮";
        return "可写";
      };

      var gateCell = function (gate, field, label) {
        if (!gate || !gate.have || !gate.need) return null;
        var have = gate.have[field] || 0;
        var need = gate.need[field] || 0;
        var ok = have >= need;
        return h(
          "div",
          { className: "__ds_colNum" + (field === "days" ? "2" : ""), title: label + " " + have + "/" + need },
          ok
            ? h(
                "div",
                { className: "__ds_prog" },
                h("span", { className: "__ds_badge __ds_badgeGrey", style: { minWidth: "26px" } }, "✓"),
                h("span", { className: "__ds_progText" }, have + "/" + need)
              )
            : h(Progress, { have: have, need: need, label: label })
        );
      };

      return h(
        "section",
        { className: "__ds_card" },
        h(
          "div",
          { className: "__ds_head" },
          h("span", { className: "__ds_title" }, "交互沉淀"),
          h(
            "div",
            { style: { display: "flex", gap: "6px" } },
            h("button", { type: "button", className: "__ds_btn", onClick: runSediment }, "立即沉淀"),
            h("button", { type: "button", className: "__ds_btn", onClick: load, disabled: view.status === "loading" }, "刷新")
          )
        ),
        view.status === "error" ? h("span", { className: "__ds_error" }, "读取失败：" + view.error) : null,

        /* ---- 观测：四个数字 + 按天柱状图 ---- */
        stats
          ? h(
              "div",
              { style: { display: "flex", flexDirection: "column", gap: "8px" } },
              h(
                "div",
                { className: "__ds_row", style: { gap: "12px" } },
                h(Metric, { label: "观测轮次", value: 0, display: stats.turns }),
                h(Metric, { label: "独立会话", value: 0, display: stats.sessions }),
                h(Metric, { label: "跨天", value: 0, display: stats.days }),
                h(Metric, { label: "输入中位", value: 0, display: stats.textMedian + " 字" })
              ),
              stats.daily && stats.daily.length > 0 ? h(Sparkline, { rows: stats.daily }) : null
            )
          : null,

        /* ---- 反射弧命中：推断条目的依据 ---- */
        stats && stats.reflex
          ? h(
              "div",
              { style: { display: "flex", flexDirection: "column", gap: "4px" } },
              h("span", { className: "__ds_sectionLabel" }, "反射弧命中"),
              h(ReflexBars, { reflex: stats.reflex })
            )
          : null,

        /* ---- 候选表 ---- */
        h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "2px" } },
          h(
            "div",
            { style: { display: "flex", alignItems: "center", justifyContent: "space-between" } },
            h("span", { className: "__ds_sectionLabel" }, "候选模式"),
            h(
              "span",
              { className: "__ds_hint", style: { opacity: 0.7 } },
              d && d.gates
                ? "门槛 会话≥" + d.gates.minSessions + " · 跨天≥" + d.gates.minDays + " · 轮次≥" + d.gates.minTurns
                : ""
            )
          ),
          rows.length === 0
            ? h("span", { className: "__ds_hint" }, "还没有候选——观测还不够触发任何检测器。")
            : h(
                "div",
                { className: "__ds_table" },
                h(
                  "div",
                  { className: "__ds_tr" },
                  h("span", { className: "__ds_th", style: { flex: "0 0 132px" } }, "候选"),
                  h("span", { className: "__ds_th __ds_colNum" }, "会话"),
                  h("span", { className: "__ds_th __ds_colNum2" }, "跨天"),
                  h("span", { className: "__ds_th __ds_colNum" }, "轮次"),
                  h("span", { className: "__ds_th", style: { flex: "1" } }, "证据"),
                  h("span", { className: "__ds_th", style: { flex: "0 0 52px", textAlign: "right" } }, "状态")
                ),
                rows.map(function (r) {
                  var c = r.item;
                  var gate = c.gate;
                  var status = shortStatus(gate);
                  var isReady = r.ready;
                  return h(
                    "div",
                    { className: "__ds_tr", key: c.key, style: isReady ? undefined : { opacity: 0.62 } },
                    h(
                      "span",
                      { style: { flex: "0 0 132px", display: "flex", alignItems: "center", gap: "5px", minWidth: 0 } },
                      h(
                        "span",
                        { className: "__ds_badge " + (c.dimension === "habit" ? "__ds_badgeHabit" : "__ds_badgeChar") },
                        dimLabel[c.dimension] || c.dimension
                      ),
                      h("span", { className: "__ds_colKey", style: { flex: "1" }, title: c.key }, String(c.key).replace(/^(habit|character):/, ""))
                    ),
                    gateCell(gate, "sessions", "会话"),
                    gateCell(gate, "days", "跨天"),
                    gateCell(gate, "turns", "轮次"),
                    h("span", { className: "__ds_colEvent", title: c.event }, c.event),
                    h(
                      "span",
                      {
                        style: {
                          flex: "0 0 52px",
                          textAlign: "right",
                          fontSize: "10px",
                          whiteSpace: "nowrap",
                          color: isReady ? "var(--dsw-alias-state-success-primary,#3c9a5f)" : "var(--dsw-alias-label-tertiary)",
                          fontWeight: isReady ? 600 : 400,
                        },
                      },
                      status
                    )
                  );
                })
              )
        ),

        emitted.length > 0
          ? h(
              "div",
              { style: { display: "flex", flexDirection: "column", gap: "4px" } },
              h("span", { className: "__ds_sectionLabel" }, "已沉淀 " + emitted.length + " 条"),
              h(
                "div",
                { style: { display: "flex", flexWrap: "wrap", gap: "4px" } },
                emitted.map(function (x) {
                  return h(
                    "span",
                    { key: x.key, className: "__ds_badge __ds_badgeGrey", title: x.key },
                    String(x.key).replace(/^(habit|character):/, "")
                  );
                })
              )
            )
          : null,
        view.message ? h("span", { className: "__ds_hint" }, view.message) : null
      );
    }

    function ConfigPanel() {
      return h(
        "div",
        { className: "__ds_root", "data-dsh-soul-evolve": "config" },
        h(StatePanel, null),
        h(PersonaPanel, null),
        h(PatternPanel, null),
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

    /** 条目类别 → 面板上的中文名 */
    var CATEGORY_LABEL = {
      correction: "纠正",
      repeat: "重复犯错",
      preference: "偏好",
      scene: "场景",
      habit: "工作习惯",
      character: "性格表达",
    };

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
