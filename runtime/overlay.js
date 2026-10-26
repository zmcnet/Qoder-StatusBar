/* Qoder 桌面端 · 输入框底栏用量条
 * 注入到渲染进程，默认挂在内置「上下文占用」控件的左侧。
 * 由注入器通过 CDP 调 window.__qoderStatusUpdate(payload) 推送数据。
 * 自包含 IIFE，无外部依赖。
 *
 * 显示规则：
 *   - 永远三项：速度 / 缓存 / 首字，不多不少
 *   - 新会话里内置上下文控件本来就不显示，我们也不显示
 *   - 老会话生成中控件会临时卸载，但那时有数据，照样显示
 */
(function () {
  "use strict";
  if (window.__qoderStatusOverlay) return;

  var VERSION = "2026-10-26-14";
  var ID = "qoder-statusbar-module";
  var state = { payload: window.__qoderStatusPayload || null };

  /* 热重载：旧观察器先摘掉，否则新旧两个 render 会互相覆盖排版类 */
  if (window.__qoderStatusObserver) {
    try {
      window.__qoderStatusObserver.disconnect();
    } catch (e) {}
    window.__qoderStatusObserver = null;
  }

  function ctxButton() {
    return document.querySelector('[data-chat-context-usage-progress="true"]');
  }
  function ctxStrip() {
    return document.querySelector('[data-conversation-context-strip="true"]');
  }
  function composer() {
    return document.querySelector('[data-conversation-composer="true"]');
  }
  function visible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  }

  /* 挂载点：内置控件优先（紧贴它左边），控件不在时逐级回退，保证常驻 */
  function anchor() {
    var btn = ctxButton();
    if (btn && visible(btn) && btn.parentElement) {
      return { parent: btn.parentElement, before: btn, inGroup: true };
    }
    var strip = ctxStrip();
    if (strip && visible(strip)) {
      var group = null;
      for (var i = 0; i < strip.children.length; i++) {
        if (strip.children[i].classList.contains("ml-auto")) {
          group = strip.children[i];
          break;
        }
      }
      return { parent: strip, before: group, inGroup: false };
    }
    var box = composer();
    if (box && visible(box)) return { parent: box, before: null, inGroup: false };
    return null;
  }

  function fmt(n, digits) {
    if (n === null || n === undefined || !isFinite(n)) return null;
    return n.toFixed(digits === undefined ? 1 : digits);
  }

  function agoText(sec) {
    if (sec === null || sec === undefined || !isFinite(sec) || sec < 0) return "";
    if (sec < 60) return Math.round(sec) + "秒前";
    if (sec < 3600) return Math.round(sec / 60) + "分钟前";
    return Math.floor(sec / 3600) + "小时" + Math.floor((sec % 3600) / 60) + "分前";
  }

  function hasValue(v) {
    return v !== null && v !== undefined;
  }

  function render() {
    var el = document.getElementById(ID);
    var d = state.payload || {};
    /* 切会话时渲染页还是同一个，payload 里可能还挂着上一个会话的数字。
     * 带上 sid 比对：对不上就当没数据，显示占位符，绝不把 A 会话的读数挂在 B 上。 */
    var curSid = (location.hash.match(/\/chat\/([0-9a-fA-F-]{8,64})/) || [])[1] || null;
    /* curSid 为空（新会话/非聊天页）也要清空，否则旧会话的 payload 会被当成本页数据 */
    if (d.sid && d.sid !== curSid) d = {};

    /* 可见性跟着内置上下文控件走：新会话里上下文控件本来就不显示，我们也不显示；
     * 老会话生成中控件会临时卸载，但那时有数据，照样显示。 */
    var hasData =
      hasValue(d.speed) || hasValue(d.cache) || hasValue(d.ttft);
    if (!visible(ctxButton()) && !hasData) {
      if (el) el.style.display = "none";
      return;
    }
    var a = anchor();
    if (!a) {
      if (el) el.style.display = "none";
      return;
    }

    /* 挂载点变了（控件出现/消失、换会话）就搬家 */
    if (!el) {
      el = document.createElement("span");
      el.id = ID;
      el.setAttribute("data-qoder-statusbar", "true");
    }
    if (el.parentElement !== a.parent || el.nextElementSibling !== a.before) {
      a.parent.insertBefore(el, a.before);
    }
    /* 排版完全照抄内置上下文控件（text-[10px] / leading-none / tertiary / tabular-nums），
     * 只是它是 button，我们是 span。
     * 间距用内联样式而不是 mr-2 这类工具类：Tailwind 只编译它扫到的类，
     * 客户端源码里没出现过的类在注入的 DOM 上不会生效。 */
    el.className =
      "inline-flex shrink-0 items-center justify-center gap-1 p-0 text-[10px] font-normal leading-none text-text-tertiary tabular-nums";
    el.style.marginRight = "8px";
    /* 回退到上下文条上时靠 margin-left:auto 贴右，保持视觉位置不跳 */
    el.style.marginLeft = a.inGroup ? "0px" : "auto";

    /* 固定三项，永远不多不少：速度 / 缓存 / 首字。
     * 取不到值的那一项显示 –，绝不因为缺一项就少一项、也不加额外项。 */
    var text =
      "速度 " +
      (hasValue(d.speed) ? fmt(d.speed, 0) : "–") +
      " tok/s · 缓存 " +
      (hasValue(d.cache) ? fmt(d.cache, 2) : "–") +
      "% · 首字 " +
      (hasValue(d.ttft) ? fmt(d.ttft, 2) : "–") +
      "s";
    if (el.textContent !== text) el.textContent = text;
    el.style.display = "";

    var tip = [];
    if (d.model) tip.push("模型 " + d.model);
    if (hasValue(d.speed)) tip.push("纯生成速度 " + fmt(d.speed, 0) + " tok/s");
    if (hasValue(d.e2e)) tip.push("端到端 " + fmt(d.e2e, 0) + " tok/s");
    if (hasValue(d.ttft)) tip.push("首字 " + fmt(d.ttft, 2) + "s");
    if (hasValue(d.cache)) tip.push("缓存命中 " + fmt(d.cache, 2) + "%");
    if (hasValue(d.ctxPct)) tip.push("上下文 " + d.ctxPct + "%");
    if (d.requests) tip.push("本轮请求 " + d.requests + " 次");
    if (d.outTokens) tip.push("输出 " + d.outTokens + " tok");
    if (hasValue(d.age)) tip.push(agoText(d.age));
    el.title = tip.join(" · ");
  }

  /* React 重渲染可能把注入节点冲掉，用 MutationObserver 兜住 */
  var obs = new MutationObserver(function () {
    var el = document.getElementById(ID);
    var a = anchor();
    if (!el || !a || el.parentElement !== a.parent || el.nextElementSibling !== a.before) {
      render();
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });

  window.__qoderStatusUpdate = function (payload) {
    state.payload = payload || {};
    window.__qoderStatusPayload = state.payload; /* 热重载后接着用，不用等下一轮推送 */
    render();
  };

  /* 注入器用来问渲染端：当前会话 id / 内置上下文百分比 / 面板是否就位 */
  window.__qoderStatusProbe = function () {
    var m = location.hash.match(/\/chat\/([0-9a-fA-F-]{8,64})/);
    var btn = ctxButton();
    var pct = null;
    if (btn) {
      var t = (btn.textContent || "").match(/(\d+(?:\.\d+)?)\s*%/);
      if (t) pct = parseFloat(t[1]);
    }
    var a = anchor();
    var el = document.getElementById(ID);
    return {
      sid: m ? m[1] : null,
      ctxPct: pct,
      hasCtx: !!(btn && visible(btn)),
      hasHost: !!a,
      moduleInDom: !!el,
      moduleVisible: !!(el && el.style.display !== "none"),
      url: location.href,
    };
  };

  window.__qoderStatusObserver = obs;
  window.__qoderStatusOverlay = VERSION;
  render();
})();
