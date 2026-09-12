import { marked } from "marked";
import DOMPurify from "dompurify";

var SDK = window.__HERMES_PLUGIN_SDK__ || {};
var React = SDK.React || window.React;
var hooks = SDK.hooks || React;
var useState = hooks.useState, useEffect = hooks.useEffect, useRef = hooks.useRef, useCallback = hooks.useCallback, useMemo = hooks.useMemo || React.useMemo;
var PLUGIN_VERSION = "1.0.0";

function afetch(url, init) {
  init = init || {};
  var headers = new Headers(init.headers || {});
  var tok = window.__HERMES_SESSION_TOKEN__ || "";
  if (tok && !headers.has("X-Hermes-Session-Token")) headers.set("X-Hermes-Session-Token", tok);
  return fetch(url, Object.assign({}, init, { headers: headers }));
}
function escAttr(v) { return String(v || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
marked.setOptions({ gfm: true, breaks: false, renderer: (() => {
  const r = new marked.Renderer();
  r.html = (html) => String(html.raw || html).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  r.link = (token) => {
    const href = escAttr(token.href || "");
    const title = token.title ? ` title="${escAttr(token.title)}"` : "";
    const text = r.parser.parseInline(token.tokens || []);
    return `<a href="${href}"${title} target="_blank" rel="noopener noreferrer">${text}</a>`;
  };
  return r;
})() });
function sanitizeMarkdownHtml(html) { return DOMPurify.sanitize(html, { ADD_ATTR: ["target", "rel"] }); }
var _mdCache = new Map();
function renderMarkdownCached(text) {
  if (_mdCache.has(text)) return _mdCache.get(text);
  var html = sanitizeMarkdownHtml(marked.parse(text || ""));
  if (_mdCache.size > 400) _mdCache.delete(_mdCache.keys().next().value);
  _mdCache.set(text, html);
  return html;
}

const CSS = `
*{-webkit-tap-highlight-color:transparent;box-sizing:border-box}
button{touch-action:manipulation;font-family:inherit}
.wc-app{display:flex;flex-direction:column;min-height:0;color:#e6ede9;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;--wc-bg:#0b0f0e;--wc-card:#121816;--wc-card2:#1a211e;--wc-border:#2a3530;--wc-fg:#e6ede9;--wc-muted:#8a9790;--wc-accent:#34d399;--wc-accent-strong:#10b981;--wc-accent-ink:#04241a;--wc-user-bg:#14352a;--wc-user-border:#1f5c46;--wc-assistant-bg:#1a211e;--wc-assistant-border:#2a3530;--wc-danger:#f87171}
.wc-header{display:flex;align-items:center;gap:8px;padding:6px 10px;padding-top:calc(6px + env(safe-area-inset-top,0px));border-bottom:1px solid var(--wc-border);background:var(--wc-card);flex-shrink:0}
.wc-hbtn{display:inline-flex;align-items:center;justify-content:center;min-width:40px;height:40px;border:1px solid var(--wc-border);background:var(--wc-card2);color:var(--wc-fg);border-radius:6px;font-size:17px;cursor:pointer;flex-shrink:0}
.wc-hbtn:active{background:var(--wc-border)}
.wc-title{flex:1;min-width:0;font-weight:600;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wc-sub{display:block;font-size:11px;color:var(--wc-muted);font-weight:400}
.wc-settings{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border-bottom:1px solid var(--wc-border);flex-shrink:0}
.wc-settings-label{font-size:11px;color:var(--wc-muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-top:2px}
.wc-sel{width:100%;height:32px;border:1px solid var(--wc-border);background:var(--wc-card2);color:var(--wc-fg);border-radius:4px;padding:0 8px;font-size:13px;font-family:inherit}
.wc-sel:focus{outline:none;border-color:var(--wc-accent)}
.wc-messages{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:10px 8px;display:flex;flex-direction:column;gap:8px;contain:layout style}
.wc-jump{position:sticky;bottom:8px;align-self:flex-end;width:36px;height:36px;border-radius:50%;background:var(--wc-accent-strong);color:var(--wc-accent-ink);border:none;font-size:18px;cursor:pointer;box-shadow:0 2px 8px rgb(0 0 0/.4);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:-44px}
.wc-row{display:flex;gap:6px;max-width:100%}
.wc-row.user{justify-content:flex-end}
.wc-row.assistant{justify-content:flex-start}
.wc-avatar{width:24px;height:24px;border-radius:4px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;background:var(--wc-accent-strong);color:var(--wc-accent-ink)}
.wc-bubble{max-width:85%;padding:8px 10px;border-radius:6px;font-size:15px;line-height:1.45;word-break:break-word;overflow-wrap:anywhere;color:var(--wc-fg)}
.wc-row.user .wc-bubble{background:var(--wc-user-bg);border:1px solid var(--wc-user-border);border-bottom-right-radius:2px;white-space:pre-wrap}
.wc-row.assistant .wc-bubble{background:var(--wc-assistant-bg);border:1px solid var(--wc-assistant-border);border-bottom-left-radius:2px}
.wc-bubble p{margin:0 0 6px}.wc-bubble p:last-child{margin-bottom:0}
.wc-bubble code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:rgba(255,255,255,.08);padding:1px 4px;border-radius:3px;color:#d7e6df}
.wc-bubble pre{background:#0a0d0c;border:1px solid var(--wc-border);border-radius:4px;padding:8px 10px;overflow-x:auto;margin:6px 0;color:#d7e6df}
.wc-bubble pre code{background:none;padding:0;color:#d7e6df}
.wc-bubble ul,.wc-bubble ol{padding-left:1.3em;margin:4px 0}
.wc-bubble a{color:var(--wc-accent)}
.wc-bubble table{border-collapse:collapse;width:100%;margin:6px 0;font-size:13px}
.wc-bubble th,.wc-bubble td{border:1px solid var(--wc-border);padding:3px 6px;text-align:left;color:var(--wc-fg)}
.wc-bubble th{background:rgba(255,255,255,.04)}
.wc-bubble blockquote{border-left:3px solid var(--wc-accent);padding-left:8px;color:var(--wc-muted);margin:6px 0}
.wc-bubble h1,.wc-bubble h2,.wc-bubble h3,.wc-bubble h4,.wc-bubble h5,.wc-bubble h6{color:var(--wc-fg);margin:10px 0 6px;line-height:1.3}
.wc-bubble h1{font-size:18px}.wc-bubble h2{font-size:17px}.wc-bubble h3{font-size:16px}.wc-bubble h4,.wc-bubble h5,.wc-bubble h6{font-size:15px}
.wc-bubble strong{color:var(--wc-fg);font-weight:700}
.wc-bubble em{color:var(--wc-fg)}
.wc-bubble hr{border:none;border-top:1px solid var(--wc-border);margin:8px 0}
.wc-img{max-width:100%;border-radius:4px;margin:3px 0}
.wc-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;margin:2px 4px 2px 0;border:1px solid var(--wc-border);border-radius:4px;background:var(--wc-card2);color:var(--wc-fg);font-size:12px;font-family:ui-monospace,monospace;text-decoration:none;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wc-bulk{display:inline-block;margin:4px 0;padding:3px 8px;border:1px solid var(--wc-accent);border-radius:4px;font-size:12px;color:var(--wc-accent);text-decoration:none;background:transparent}
.wc-dots{display:inline-flex;gap:3px;align-items:center;padding:3px 0}
.wc-dots span{width:5px;height:5px;border-radius:50%;background:var(--wc-accent);animation:wc-blink 1.2s infinite}
.wc-dots span:nth-child(2){animation-delay:.2s}.wc-dots span:nth-child(3){animation-delay:.4s}
@keyframes wc-blink{0%,80%,100%{opacity:.25}40%{opacity:1}}
.wc-status{display:flex;align-items:center;gap:6px;padding:4px 10px;color:var(--wc-muted);font-size:12px;flex-shrink:0}
.wc-error{margin:0 10px 6px;padding:8px 10px;background:rgba(248,113,113,.1);color:var(--wc-danger);border-radius:4px;font-size:13px;border:1px solid rgba(248,113,113,.3)}
.wc-inputbar{display:flex;align-items:flex-end;gap:6px;padding:8px 10px;padding-bottom:calc(8px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--wc-border);background:var(--wc-card);flex-shrink:0;contain:layout}
.wc-inputbar textarea{flex:1;min-height:40px;max-height:132px;resize:none;border:1px solid var(--wc-border);background:var(--wc-bg);color:var(--wc-fg);border-radius:6px;padding:9px 10px;font-size:15px;font-family:inherit;line-height:1.4;outline:none}
.wc-inputbar textarea:focus{border-color:var(--wc-accent)}
.wc-attach{display:flex;flex-wrap:wrap;gap:4px;padding:4px 0 0}
.wc-send{width:40px;height:40px;flex-shrink:0;border:none;border-radius:6px;background:var(--wc-accent-strong);color:var(--wc-accent-ink);font-size:17px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.wc-send:disabled{opacity:.4}
.wc-send.stop{background:var(--wc-danger);color:#fff}
.wc-edit-trigger{margin-left:6px;background:transparent;border:none;color:var(--wc-muted);cursor:pointer;font-size:12px;padding:2px 4px;vertical-align:middle;opacity:.7}
.wc-edit-trigger:hover{color:var(--wc-accent);opacity:1}
.wc-row.user .wc-bubble.wc-bubble-edit{max-width:100%;width:100%;background:var(--wc-user-bg);border:1px solid var(--wc-accent)}
.wc-edit-ta{width:100%;min-height:60px;resize:vertical;background:var(--wc-bg);color:var(--wc-fg);border:1px solid var(--wc-border);border-radius:6px;padding:8px;font-size:15px;font-family:inherit;line-height:1.4;outline:none;box-sizing:border-box}
.wc-edit-ta:focus{border-color:var(--wc-accent)}
.wc-edit-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:6px}
.wc-edit-btn{border:1px solid var(--wc-border);background:var(--wc-card2);color:var(--wc-fg);border-radius:6px;padding:6px 12px;font-size:13px;cursor:pointer}
.wc-edit-btn.primary{background:var(--wc-accent-strong);color:var(--wc-accent-ink);border-color:var(--wc-accent-strong);font-weight:600}
.wc-sheet{position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;justify-content:flex-end;visibility:hidden;transition:visibility .2s}
.wc-sheet.open{visibility:visible}
.wc-sheet-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.55);opacity:0;transition:opacity .2s}
.wc-sheet.open .wc-sheet-backdrop{opacity:1}
.wc-sheet-panel{position:relative;background:var(--wc-card);border-top:1px solid var(--wc-border);border-radius:8px 8px 0 0;max-height:80dvh;display:flex;flex-direction:column;transform:translateY(100%);transition:transform .25s ease;padding-bottom:env(safe-area-inset-bottom,0px)}
.wc-sheet.open .wc-sheet-panel{transform:translateY(0)}
.wc-sheet-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px 8px;border-bottom:1px solid var(--wc-border)}
.wc-sheet-head h2{margin:0;font-size:15px;font-weight:600}
.wc-sheet-close{border:1px solid var(--wc-border);background:var(--wc-card2);color:var(--wc-fg);border-radius:6px;padding:6px 12px;font-size:14px;cursor:pointer}
.wc-sheet-list{overflow-y:auto;-webkit-overflow-scrolling:touch;padding:6px}
.wc-session{display:flex;align-items:center;gap:8px;padding:10px;border-radius:6px;cursor:pointer;border:1px solid transparent;position:relative}
.wc-session:active{background:var(--wc-card2)}
.wc-session.active{background:rgba(52,211,153,.08);border-color:rgba(52,211,153,.3)}
.wc-session-body{flex:1;min-width:0}
.wc-session-title{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wc-session-prev{font-size:12px;color:var(--wc-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.wc-badge{flex-shrink:0;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--wc-muted);border:1px solid var(--wc-border);border-radius:4px;padding:1px 5px}
.wc-del{position:absolute;top:6px;right:6px;border:0;background:transparent;color:var(--wc-muted);cursor:pointer;font-size:15px;opacity:.6;padding:3px 6px}
.wc-del:hover{color:var(--wc-danger)}
.wc-needs-answer{border-color:var(--wc-accent-strong,#e0a52c)!important;box-shadow:inset 3px 0 0 var(--wc-accent-strong,#e0a52c)}
.wc-badge-clarify{color:#1a1200;background:var(--wc-accent-strong,#e0a52c);border-color:var(--wc-accent-strong,#e0a52c);animation:wc-pulse 2s ease-in-out infinite}
.wc-badge-busy{color:var(--wc-accent-ink);background:var(--wc-accent);border-color:var(--wc-accent);animation:wc-pulse 2s ease-in-out infinite}
@keyframes wc-pulse{0%,100%{opacity:1}50%{opacity:.55}}
.wc-sheet-new{border-top:1px solid var(--wc-border);padding:8px 12px}
.wc-sheet-new button{width:100%;padding:11px;border-radius:6px;font-size:15px;font-weight:600;border:1px solid var(--wc-accent);background:transparent;color:var(--wc-accent);cursor:pointer}
.wc-confirm{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);padding:16px}
.wc-confirm-card{background:var(--wc-card);border:1px solid var(--wc-border);border-radius:8px;padding:16px;max-width:320px;width:100%;box-shadow:0 8px 24px rgb(0 0 0 / .4)}
.wc-confirm-title{font-size:15px;font-weight:600;margin:0 0 6px}
.wc-confirm-text{font-size:13px;color:var(--wc-muted);margin:0 0 14px;line-height:1.5}
.wc-confirm-actions{display:flex;gap:8px;justify-content:flex-end}
.wc-confirm-btn{border:1px solid var(--wc-border);background:var(--wc-card2);color:var(--wc-fg);border-radius:6px;padding:8px 14px;font-size:14px;cursor:pointer}
.wc-confirm-btn.danger{background:var(--wc-danger);border-color:var(--wc-danger);color:#fff}
.wc-no-sessions{padding:12px 10px;color:var(--wc-muted);font-size:13px;text-align:center;line-height:1.5}
.wc-empty{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--wc-muted);padding:16px;text-align:center}
.wc-empty-mark{width:40px;height:40px;display:flex;align-items:center;justify-content:center;background:var(--wc-accent-strong);color:var(--wc-accent-ink);font-size:18px;font-weight:800;border-radius:6px}
.wc-empty-title{font-size:16px;font-weight:700;color:var(--wc-fg)}
.wc-empty-sub{font-size:13px;max-width:420px;line-height:1.5}
.wc-suggest{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;max-width:520px}
.wc-suggest-chip{font-size:13px;padding:7px 12px;border-radius:6px;background:var(--wc-card2);border:1px solid var(--wc-border);color:var(--wc-fg);cursor:pointer}
.wc-suggest-chip:active{border-color:var(--wc-accent)}
.wc-clarify{align-self:stretch;max-width:min(560px,100%);background:var(--wc-card);border:1.5px solid var(--wc-accent);border-radius:6px;padding:12px 14px;box-shadow:0 2px 8px rgb(0 0 0 / .2)}
.wc-clarify .q-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--wc-accent);margin-bottom:4px}
.wc-clarify .q-text{font-size:14px;line-height:1.5;margin-bottom:10px;white-space:pre-wrap;color:var(--wc-fg)}
.wc-clarify .q-choices{display:flex;flex-direction:column;gap:6px}
.wc-clarify button.q-choice{text-align:left;background:var(--wc-card2);color:var(--wc-fg);border:1px solid var(--wc-border);border-radius:6px;padding:9px 10px;font-size:14px;cursor:pointer;font-family:inherit}
.wc-clarify button.q-choice:active{border-color:var(--wc-accent)}
.wc-clarify .q-rec{display:inline-block;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--wc-accent);border:1px solid var(--wc-accent);border-radius:4px;padding:1px 6px;margin-left:6px;vertical-align:middle}
.wc-clarify .q-other-row{display:flex;gap:6px;margin-top:4px}
.wc-clarify .q-other-row input{flex:1;min-width:0;background:var(--wc-bg);color:var(--wc-fg);border:1px solid var(--wc-border);border-radius:6px;padding:8px 10px;font-size:15px;font-family:inherit}
.wc-clarify .q-other-row input:focus{outline:none;border-color:var(--wc-accent)}
.wc-clarify .q-other-row button{background:var(--wc-accent-strong);color:var(--wc-accent-ink);border:none;border-radius:6px;padding:8px 12px;font-size:13px;font-weight:600;cursor:pointer;flex-shrink:0}
.wc-clarify.answered{opacity:.6;filter:saturate(.6)}
.wc-clarify.answered button,.wc-clarify.answered input{pointer-events:none;opacity:.6}
.wc-clarify .q-answer{margin-top:8px;font-size:12px;color:var(--wc-muted);border-top:1px dashed var(--wc-border);padding-top:6px}
.wc-clarify .q-answer strong{color:var(--wc-accent)}
.wc-clarify .q-multi{display:flex;flex-direction:column;gap:6px}
.wc-clarify .q-multi label{display:flex;align-items:center;gap:6px;font-size:14px;cursor:pointer;padding:7px 8px;border:1px solid var(--wc-border);border-radius:6px;background:var(--wc-card2)}
.wc-clarify .q-multi input{accent-color:var(--wc-accent-strong)}
.wc-sidebar{display:none}
.wc-main-col{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0}
@media (min-width:860px){
  .wc-app{flex-direction:row}
  .wc-sidebar{display:flex;flex-direction:column;width:240px;flex-shrink:0;border-right:1px solid var(--wc-border);background:var(--wc-card)}
  .wc-sidebar .wc-sheet-list{flex:1}
  .wc-hbtn.menu{display:none}
  .wc-sheet{display:none}
  .wc-bubble{max-width:70%}
}
`;
function injectStyles() { if (document.getElementById("wc-v2-style")) return; var s = document.createElement("style"); s.id = "wc-v2-style"; s.textContent = CSS; document.head.appendChild(s); }
function api(path) { return (window.__HERMES_BASE_PATH__ || "") + "/api/plugins/web-chat" + path; }
// The dashboard's ProfileSwitcher keeps the currently-selected management
// profile in the URL as ?profile=<name> (see web/src/contexts/ProfileProvider.tsx);
// "" means the dashboard's own profile. This plugin is a same-window bundle
// (not an iframe), so it can read that param directly -- without this, every
// state.db-touching endpoint stayed pinned to whatever /api/profiles/active
// returned once at mount, ignoring the switcher entirely.
function getSelectedProfile() { try { return new URLSearchParams(window.location.search).get("profile") || ""; } catch (e) { return ""; } }
function withProfile(url, profile) { var p = profile || getSelectedProfile(); if (!p) return url; var sep = url.indexOf("?") === -1 ? "?" : "&"; return url + sep + "profile=" + encodeURIComponent(p); }
function wsUrl(path) { var proto = location.protocol === "https:" ? "wss:" : "ws:"; var token = window.__HERMES_SESSION_TOKEN__ || ""; return proto + "//" + location.host + api(path) + "?token=" + encodeURIComponent(token); }
function fmtTime(ts) { if (!ts) return ""; try { return new Date(ts * 1000).toLocaleString(); } catch (e) { return ""; } }
function sourceLabel(src) {
  if (!src || src === "dashboard-plugin:web-chat") return "";
  var s = String(src).replace(/^dashboard-plugin:/, "");
  var known = { api_server: "API", acp: "ACP", cli: "CLI", tui: "TUI",
    telegram: "Telegram", discord: "Discord", slack: "Slack", whatsapp: "WhatsApp",
    whatsapp_cloud: "WhatsApp", sms: "SMS", desktop: "Desktop", kanban: "Kanban",
    recovered: "Recovered", unknown: "Unknown" };
  if (known[s]) return known[s];
  return s.split("_").filter(Boolean).map(function (p) { return p.charAt(0).toUpperCase() + p.slice(1); }).join(" ").slice(0, 14);
}
function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/[^A-Za-z0-9_.-]/g, "-"); }

// --- Perf tracker -----------------------------------------------------
// Frontend is the actual complaint surface ("typing is laggy") -- backend
// turn time is left alone as informational-only (varies wildly with what
// the agent is doing, not a UI regression signal). Three independent
// client-side measurements, each batched and flushed on its own timer
// (NEVER one network call per keystroke/frame -- that would itself be the
// perf bug):
//
// 1. keystroke   -- keydown -> next-paint latency (2x rAF). Concrete "typing
//    feels laggy" number: render+reflow cost of THIS keystroke, including
//    markdown re-parse of unrelated messages if memoization regresses.
// 2. longtask    -- PerformanceObserver('longtask'): browser-native signal
//    for "main thread blocked >=50ms", the actual definition of jank. Catches
//    background jank (re-renders during streaming, etc.) that keystroke
//    timing alone would miss if the user isn't typing at that moment.
// 3. session_switch -- time from clicking a session in the sidebar to its
//    messages actually painting. The other big "feels slow" moment besides
//    typing.
var PerfTracker = (function () {
  var buffers = { keystroke: [], longtask: [], session_switch: [] };
  var flushTimers = {};
  var FLUSH_MS = 20000, MAX_BUFFERED = 200;
  function percentile(arr, p) {
    if (!arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var idx = Math.min(s.length - 1, Math.floor((s.length - 1) * p));
    return s[idx];
  }
  function scheduleFlush(event, extra) {
    if (flushTimers[event]) return;
    flushTimers[event] = setTimeout(function () {
      flushTimers[event] = null;
      flush(event, extra);
    }, FLUSH_MS);
  }
  function flush(event, extra) {
    var batch = buffers[event]; buffers[event] = [];
    if (!batch.length) return;
    var payload = Object.assign({
      event: event,
      p50_ms: Math.round(percentile(batch, 0.5) * 10) / 10,
      p95_ms: Math.round(percentile(batch, 0.95) * 10) / 10,
      max_ms: Math.round(Math.max.apply(null, batch) * 10) / 10,
      count: batch.length,
    }, extra || {});
    try {
      afetch(api("/perf/client"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).catch(function () { });
    } catch (e) { /* perf reporting must never break the UI */ }
  }
  function push(event, ms, messageCount) {
    var buf = buffers[event];
    buf.push(ms);
    if (buf.length > MAX_BUFFERED) buf.shift();
    scheduleFlush(event, { message_count: messageCount || 0 });
  }
  // Long-task observer: fires for every main-thread task >=50ms, independent
  // of any user action -- the closest thing a browser exposes to "the UI just
  // froze". Not supported in every engine; no-op (not a crash) when absent.
  try {
    if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes && PerformanceObserver.supportedEntryTypes.indexOf("longtask") !== -1) {
      new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (entry) { push("longtask", entry.duration); });
      }).observe({ type: "longtask", buffered: true });
    }
  } catch (e) { /* longtask unsupported (Safari/Firefox) -- keystroke + session_switch still cover it */ }
  return {
    markKeydown: function (messageCount) {
      var t0 = performance.now();
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { push("keystroke", performance.now() - t0, messageCount); });
      });
    },
    // Call at the moment a session switch is requested; returns a function to
    // call once the new session's messages are in the DOM (next paint).
    startSessionSwitch: function () {
      var t0 = performance.now();
      return function () {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () { push("session_switch", performance.now() - t0); });
        });
      };
    },
  };
})();
function stripRec(s) { return String(s || "").replace(/\s*\(Recommended\)\s*$/i, ""); }
function isRec(s) { return /\(Recommended\)\s*$/i.test(String(s || "")); }

const MEDIA_RE = /MEDIA:([^\s]+)/g, IMG_RE = /!\[([^\]]*)\]\(([^)]+)\)/g, PATH_RE = /(?:^|\s)(\/[^\s]{2,})/g;
function parseSegments(text) {
  var matches = [];
  function add(re, fn) { var r = new RegExp(re.source, "g"), m; while ((m = r.exec(text))) { matches.push({ start: m.index, end: m.index + m[0].length, seg: fn(m) }); } }
  add(MEDIA_RE, m => ({ type: "file", path: m[1] }));
  add(IMG_RE, m => ({ type: "image", alt: m[1], url: m[2] }));
  var r = new RegExp(PATH_RE.source, "g"), m;
  while ((m = r.exec(text))) { var s = m.index + (m[0].length - m[1].length), e = s + m[1].length; if (!matches.some(x => s < x.end && e > x.start)) matches.push({ start: s, end: e, seg: { type: "file", path: m[1] } }); }
  matches.sort((a, b) => a.start - b.start);
  var segs = [], cur = 0;
  matches.forEach(x => { if (cur < x.start) segs.push({ type: "text", content: text.slice(cur, x.start) }); segs.push(x.seg); cur = x.end; });
  if (cur < text.length) segs.push({ type: "text", content: text.slice(cur) });
  return segs.length ? segs : [{ type: "text", content: text || "" }];
}
function fileHref(path, inline) { return api("/file?path=" + encodeURIComponent(path) + (inline ? "&inline=true" : "")); }
function FileChip({ path, onRemove }) {
  var name = String(path).split("/").pop() || path;
  return React.createElement("a", { className: "wc-chip", href: fileHref(path, false), title: path, onClick: onRemove ? function (e) { e.preventDefault(); onRemove(); } : undefined }, "📎 ", name, onRemove ? " ×" : "");
}
var AgentContent = React.memo(function AgentContent({ text }) {
  var segs = useMemo(function () { return parseSegments(text || ""); }, [text]);
  var files = useMemo(function () { return segs.filter(s => s.type === "file").map(s => s.path); }, [segs]);
  return React.createElement(React.Fragment, null,
    files.length >= 3 ? React.createElement("a", { className: "wc-bulk", href: api("/bulk-download"), onClick: function (e) { e.preventDefault(); afetch(api("/bulk-download"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paths: files }) }).then(r => r.blob()).then(b => { var u = URL.createObjectURL(b), a = document.createElement("a"); a.href = u; a.download = "web-chat-files.zip"; a.click(); URL.revokeObjectURL(u); }); } }, "Download all (ZIP)") : null,
    segs.map((s, i) => {
      if (s.type === "file") return React.createElement(FileChip, { key: i, path: s.path });
      if (s.type === "image") return React.createElement("img", { key: i, className: "wc-img", src: s.url, alt: s.alt });
      var html = renderMarkdownCached(s.content || "");
      return React.createElement("div", { key: i, className: "wc-md", dangerouslySetInnerHTML: { __html: html } });
    }));
});
function StatusLine({ label }) {
  if (!label) return null;
  return React.createElement("div", { className: "wc-status" },
    React.createElement("span", { className: "wc-dots" }, React.createElement("span"), React.createElement("span"), React.createElement("span")),
    React.createElement("span", null, label + "…"));
}
var Bubble = React.memo(function Bubble({ msg, idx, canEdit, editing, editValue, onEditChange, onStartEdit, onSaveEdit, onCancelEdit }) {
  var role = msg.role || "assistant";
  var text = msg.text || msg.content || "";
  if (role === "assistant") {
    return React.createElement("div", { className: "wc-row assistant" },
      React.createElement("div", { className: "wc-avatar" }, "H"),
      React.createElement("div", { className: "wc-bubble" }, React.createElement(AgentContent, { text: text })));
  }
  if (editing) {
    return React.createElement("div", { className: "wc-row user" },
      React.createElement("div", { className: "wc-bubble wc-bubble-edit" },
        React.createElement("textarea", {
          className: "wc-edit-ta", value: editValue, autoFocus: true,
          onChange: e => onEditChange(e.target.value),
          onKeyDown: e => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSaveEdit(idx, msg, editValue); }
            else if (e.key === "Escape") { e.preventDefault(); onCancelEdit(); }
          }
        }),
        React.createElement("div", { className: "wc-edit-actions" },
          React.createElement("button", { className: "wc-edit-btn", onClick: () => onCancelEdit() }, "Cancel"),
          React.createElement("button", { className: "wc-edit-btn primary", onClick: () => onSaveEdit(idx, msg, editValue), disabled: !editValue.trim() }, "Save & resend"))));
  }
  return React.createElement("div", { className: "wc-row user" },
    React.createElement("div", { className: "wc-bubble" }, text,
      canEdit ? React.createElement("button", { className: "wc-edit-trigger", title: "Edit & resend", onClick: () => onStartEdit(idx) }, "\u270E") : null));
});
function ClarifyCard({ frame, onAnswer }) {
  var [answers, setAnswers] = useState({});
  var [others, setOthers] = useState({});
  var [done, setDone] = useState(false);
  var questions = frame.questions || [{ qid: "q0", question: frame.question, choices: frame.choices, choices_offered: frame.choices, multi_select: frame.multi_select }];
  function answer(qid, raw) {
    var next = Object.assign({}, answers, { [qid]: raw });
    setAnswers(next);
    onAnswer(frame.request_id, qid, raw);
    if (questions.length === 1) setDone(true);
    else if (Object.keys(next).length >= questions.length) setDone(true);
  }
  function submitOther(qid) {
    var v = (others[qid] || "").trim();
    if (!v) return;
    answer(qid, v);
  }
  return React.createElement("div", { className: "wc-clarify" + (done ? " answered" : "") },
    React.createElement("div", { className: "q-title" }, "Question"),
    questions.map(q => {
      var qid = q.qid || "q0";
      var answered = answers[qid] !== undefined;
      var choices = (q.choices || q.choices_offered || []).map(c => ({ label: stripRec(c), rec: isRec(c) }));
      return React.createElement("div", { key: qid, style: { marginBottom: questions.length > 1 ? 14 : 0 } },
        React.createElement("div", { className: "q-text" }, q.question),
        q.multi_select && choices.length ? React.createElement("div", { className: "q-multi" },
          choices.map((c, i) => React.createElement("label", { key: i },
            React.createElement("input", { type: "checkbox", disabled: done, onChange: function (e) {
              var cur = (answers[qid] || "").split(",").map(s => s.trim()).filter(Boolean);
              var next = e.target.checked ? cur.concat([c.label]) : cur.filter(x => x !== c.label);
              answer(qid, next.join(","));
            } }), c.label, c.rec ? React.createElement("span", { className: "q-rec" }, "Recommended") : null)))
          : React.createElement("div", { className: "q-choices" },
            choices.map((c, i) => React.createElement("button", { key: i, className: "q-choice", disabled: done, onClick: () => answer(qid, c.label) },
              c.label, c.rec ? React.createElement("span", { className: "q-rec" }, "Recommended") : null))),
        React.createElement("div", { className: "q-other-row" },
          React.createElement("input", { placeholder: "Other (type your answer)", disabled: done, value: others[qid] || "", onChange: e => setOthers(Object.assign({}, others, { [qid]: e.target.value })), onKeyDown: e => { if (e.key === "Enter") { e.preventDefault(); submitOther(qid); } } }),
          React.createElement("button", { disabled: done, onClick: () => submitOther(qid) }, "Send")),
        answered ? React.createElement("div", { className: "q-answer" }, "Answered: ", React.createElement("strong", null, answers[qid])) : null);
    }));
}
function EmptyState({ onSuggestion }) {
  var suggestions = [
    { label: "Analyze a workspace", prompt: "Analyze this workspace structure and give me 3 engineering risks. Use tools and keep it concise." },
    { label: "Save a preference", prompt: "Save this to memory exactly: \"For demos, respond in 3 bullets max and put risk first.\" Then confirm saved." },
    { label: "Create a file", prompt: "Create demo-checklist.md with 5 launch checks for this app." },
  ];
  return React.createElement("div", { className: "wc-empty" },
    React.createElement("div", { className: "wc-empty-mark" }, "H"),
    React.createElement("div", { className: "wc-empty-title" }, "Hermes Web Chat"),
    React.createElement("div", { className: "wc-empty-sub" }, "Streaming responses, tool status, file uploads, persistent sessions, and clarify cards — no terminal. Send a message, paste an image, or drop a file."),
    React.createElement("div", { className: "wc-suggest" },
      suggestions.map((s, i) => React.createElement("button", { key: i, className: "wc-suggest-chip", onClick: () => onSuggestion(s.prompt) }, s.label))));
}

function ChatPage() {
  useEffect(injectStyles, []);
  useEffect(() => {
    function fit() {
      var root = document.querySelector(".wc-app");
      if (!root) return;
      var top = root.getBoundingClientRect().top;
      var vh = (window.visualViewport ? window.visualViewport.height : window.innerHeight) - top;
      root.style.height = Math.max(240, Math.round(vh)) + "px";
    }
    fit();
    window.addEventListener("resize", fit);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      if (window.visualViewport) window.visualViewport.removeEventListener("resize", fit);
    };
  }, []);
  var saved = localStorage.getItem("web-chat.session_id") || uuid();
  if (!localStorage.getItem("web-chat.session_id")) localStorage.setItem("web-chat.session_id", saved);
  var [sessionId, setSessionId] = useState(saved);
  var [sessions, setSessions] = useState([]);
  var [messages, setMessages] = useState([]);
  var [input, setInput] = useState("");
  // busy/status/clarify are PER-SESSION, not global -- a chat streaming in
  // session A must never block sending in session B or a brand-new chat.
  // Each is a {session_id: value} map; the scalars below are just the
  // CURRENTLY VIEWED session's slice, derived every render.
  var [busyMap, setBusyMap] = useState({});
  var [statusMap, setStatusMap] = useState({});
  var [clarifyMap, setClarifyMap] = useState({});
  // Session ids (any chat, not just the one currently open) with an
  // unanswered clarify card -- powers the sidebar badge. Polled
  // unconditionally (even while document.hidden) so a question raised in
  // a background chat, or while the tab/phone is backgrounded, is still
  // visible the next time the user glances at the sidebar.
  var [pendingClarifySessions, setPendingClarifySessions] = useState([]);
  var busy = !!busyMap[sessionId];
  var status = statusMap[sessionId] || null;
  var clarify = clarifyMap[sessionId] || null;
  function setBusyFor(sid, val) { setBusyMap(m => { var n = Object.assign({}, m); if (val) n[sid] = true; else delete n[sid]; return n; }); }
  function setStatusFor(sid, val) { setStatusMap(m => { var n = Object.assign({}, m); if (val) n[sid] = val; else delete n[sid]; return n; }); }
  function setClarifyFor(sid, val) { setClarifyMap(m => { var n = Object.assign({}, m); if (val) n[sid] = val; else delete n[sid]; return n; }); }
  // Migrate a per-session map entry from oldKey to newKey, used when the
  // backend renames a brand-new client-minted session id to its canonical
  // server id (see the "session" frame handler in send()) -- without this,
  // the busy/status flag set under the pre-rename id becomes invisible the
  // instant React's sessionId state flips to the canonical id.
  function renameKey(setter, oldKey, newKey, fallback) {
    if (oldKey === newKey) return;
    setter(m => { var n = Object.assign({}, m); var v = n[oldKey]; delete n[oldKey]; n[newKey] = v !== undefined ? v : fallback; return n; });
  }
  var [error, setError] = useState(null);
  var [attachments, setAttachments] = useState([]);
  var [drag, setDrag] = useState(false);
  var [profile, setProfile] = useState(null);
  var [models, setModels] = useState([]);
  var [defaultModel, setDefaultModel] = useState("");
  var [sessionModel, setSessionModel] = useState({});
  var [sessionEffort, setSessionEffort] = useState({});
  var [sessionsOpen, setSessionsOpen] = useState(false);
  var [confirmDel, setConfirmDel] = useState(null);
  var [atBottom, setAtBottom] = useState(true);
  var [editingIdx, setEditingIdx] = useState(null);
  var [editText, setEditText] = useState("");
  var scrollRef = useRef(null), fileRef = useRef(null), inputRef = useRef(null);
  // One WebSocket per session id, so a background session's stream keeps
  // running (and can be individually stopped) while another is viewed.
  var wsMapRef = useRef({});
  // Polling handle per session id for a turn that's busy on the SERVER but
  // not owned by this tab's own WebSocket (started from another tab/device,
  // or survives this tab's own page reload -- busyMap always starts empty
  // client-side, so without this a refreshed page has no way to know the
  // agent is still working and would let you fire a second message that
  // silently queues behind the per-session lock instead of interrupting
  // anything, looking hung with zero feedback).
  var remoteBusyPollRef = useRef({});
  var pendingScrollRef = useRef(false);
  // Tracks "was the user at the bottom" from the LAST real scroll event, not
  // recomputed after new content already grew the DOM -- see the fix note
  // on the auto-scroll effect below for why the naive post-hoc check breaks.
  var atBottomRef = useRef(true);
  // Read-after-write (style.height="auto" then reading scrollHeight) forces a
  // synchronous layout flush on every keystroke. `.wc-messages` now carries
  // `contain:layout style` so that flush stays scoped to the input bar
  // instead of re-laying-out the whole message list -- this was the real
  // regression: live perf beacons showed keystroke p95 climbing with
  // message_count even after the markdown-render memoization fix, which only
  // helps React's own re-render, not this direct DOM layout thrash. See
  // PERF_PROFILER.md. Height-unchanged guard below just skips a redundant
  // write on top (most keystrokes don't change line count).
  var lastAutosizeHeight = null;
  function autosize(el) {
    if (!el) return;
    el.style.height = "auto";
    var next = Math.min(132, Math.max(44, el.scrollHeight));
    if (next === lastAutosizeHeight) return;
    lastAutosizeHeight = next;
    el.style.height = next + "px";
  }
  // Per-session accumulated streaming text -- a single shared ref would
  // interleave/corrupt text if two sessions stream concurrently.
  var streamingMapRef = useRef({});
  var messagesRef = useRef([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  var sessionIdRef = useRef(sessionId);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  // input/attachments/busyMap change on every keystroke/upload -- `send` must
  // NOT depend on them directly, or its identity churns every keystroke,
  // which busts React.memo on every Bubble row via the onSaveEdit prop (same
  // bug class as the editValue-prop regression fixed earlier, just
  // reintroduced by the rewind/edit feature's `send` dependency array this
  // time). Refs let send() read current values without being recreated.
  var inputRef2 = useRef(input);
  useEffect(() => { inputRef2.current = input; }, [input]);
  var attachmentsRef = useRef(attachments);
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  var busyMapRef = useRef(busyMap);
  useEffect(() => { busyMapRef.current = busyMap; }, [busyMap]);

  function loadSessions() { afetch(withProfile(api("/sessions"))).then(r => r.json()).then(d => setSessions(d.sessions || [])).catch(() => { }); }
  // Recovery: a page reload or a WS that died mid-turn loses the browser-side
  // clarify card even though the agent thread is still blocked waiting for an
  // answer server-side. Poll the stashed payload so the card reappears -- same
  // fix class as virgil's whisperClarify stash/replay (see hermes-chat-frontend skill).
  function checkPendingClarify(id) {
    afetch(withProfile(api("/pending_clarify?session_id=" + encodeURIComponent(id)))).then(r => r.ok ? r.json() : null).then(d => {
      if (d && d.pending && d.frame) setClarifyFor(id, d.frame);
    }).catch(() => { });
  }
  function loadSession(id) {
    setError(null); setEditingIdx(null); setEditText("");
    var perfDone = PerfTracker.startSessionSwitch();
    afetch(withProfile(api("/sessions/" + encodeURIComponent(id)))).then(r => r.ok ? r.json() : Promise.reject()).then(d => {
      sessionIdRef.current = id;
      setSessionId(id); localStorage.setItem("web-chat.session_id", id);
      pendingScrollRef.current = true;
      setMessages(d.messages || d.history || []); setAttachments([]);
      perfDone();
      checkPendingClarify(id);
      // Server-side truth for "is this session's turn actually in flight" --
      // this tab's own busyMap always starts empty on load/refresh, so
      // without this a still-running turn (started here before a reload, or
      // from another tab/device) would look idle: sending into it wouldn't
      // interrupt anything, it would silently queue behind the per-session
      // lock until the real turn finishes. wsMapRef check avoids double-
      // tracking a turn this very tab's live WS already owns.
      if (d.is_busy && !wsMapRef.current[id]) watchRemoteBusy(id);
      // Model is now a server-side per-session property (state.db `model`
      // column). Prefer the persisted value; fall back to the dashboard's
      // current main model via the `|| defaultModel` in the picker/send.
      if (d.model) setSessionModel(Object.assign({}, sessionModel, { [id]: d.model }));
      var prefs = sessionPrefs(id);
      setSessionEffort(Object.assign({}, sessionEffort, { [id]: prefs.effort || "" }));
    }).catch(() => { setMessages([]); });
  }
  // Lightweight re-sync: refresh only messages + persisted model, without
  // touching staged attachments, clarify cards, or the error banner (those are
  // transient UI state that a background poll must not clobber).
  function refreshMessages(id) {
    afetch(withProfile(api("/sessions/" + encodeURIComponent(id)))).then(r => r.ok ? r.json() : Promise.reject()).then(d => {
      var next = d.messages || d.history || [];
      var cur = messagesRef.current || [];
      var changed = next.length !== cur.length;
      if (!changed && next.length) {
        var a = next[next.length - 1], b = cur[cur.length - 1];
        changed = (a && a.text || "") !== (b && b.text || "");
      }
      if (changed) setMessages(next);
      if (d.model) setSessionModel(Object.assign({}, sessionModel, { [id]: d.model }));
    }).catch(() => { });
  }
  function sessionPrefs(id) {
    var key = "web-chat.prefs." + id;
    try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) { return {}; }
  }
  // Watch a session the SERVER says is busy but this tab's own WebSocket
  // doesn't own (see remoteBusyPollRef comment) -- poll until it finishes,
  // then refresh the final messages once so the completed turn appears
  // without a manual reload.
  function watchRemoteBusy(id) {
    if (remoteBusyPollRef.current[id]) return;
    setBusyFor(id, true);
    setStatusFor(id, "thinking");
    var tick = function () {
      afetch(withProfile(api("/sessions/" + encodeURIComponent(id)))).then(r => r.ok ? r.json() : Promise.reject()).then(d => {
        if (d.is_busy) return;
        clearInterval(remoteBusyPollRef.current[id]);
        delete remoteBusyPollRef.current[id];
        setBusyFor(id, false); setStatusFor(id, null);
        if (id === sessionIdRef.current) setMessages(d.messages || d.history || []);
      }).catch(() => { });
    };
    remoteBusyPollRef.current[id] = setInterval(tick, 2500);
  }
  function setSessionPref(id, patch) {
    var key = "web-chat.prefs." + id;
    var cur = sessionPrefs(id);
    var next = Object.assign({}, cur, patch);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch (e) { }
    return next;
  }
  useEffect(() => {
    loadSessions(); loadSession(saved);
    afetch(api("/sessions")).then(r => r.json()).then(d => {
      var ids = (d.sessions || []).map(s => s.session_id);
      if (ids.indexOf(saved) === -1) {
        var fresh = uuid();
        setSessionId(fresh); localStorage.setItem("web-chat.session_id", fresh);
        setMessages([]); setAttachments([]);
      }
    }).catch(() => { });
    // Seed from the dashboard's own management-profile selection (the
    // ProfileSwitcher's ?profile= URL param), not the sticky "active"
    // profile -- those can differ, and the switcher is what the user sees
    // and expects Chat to follow. "" (dashboard's own profile) resolves via
    // /api/profiles/active as before, since there's no explicit selection yet.
    var urlProfile = getSelectedProfile();
    if (urlProfile) { setProfile(urlProfile); }
    else {
      afetch("/api/profiles/active").then(r => r.json()).then(d => {
        setProfile(d.current || d.active || "default");
      }).catch(() => { setProfile("default"); });
    }
    afetch("/api/model/options?explicit_only=1").then(r => r.json()).then(d => {
      var list = [];
      (d.providers || []).forEach(p => {
        (p.models || []).forEach(m => {
          var id = typeof m === "string" ? m : (m.id || m.model || m.name);
          if (id) list.push(id);
        });
      });
      setModels(list);
      var def = d.model || (list[0] || "");
      setDefaultModel(def);
      var prefs = sessionPrefs(saved);
      if (!prefs.effort) { prefs.effort = ""; setSessionPref(saved, { effort: "" }); }
      setSessionEffort(Object.assign({}, sessionEffort, { [saved]: prefs.effort || "" }));
    }).catch(() => { });
  }, []);
  // Re-sync when the tab regains focus/visibility, and poll lightly so a
  // session that progresses elsewhere (TUI/desktop/gateway) shows up here
  // without a manual refresh. Never clobber an in-flight stream (busy) or
  // staged attachments (refreshMessages only touches messages + model).
  useEffect(() => {
    // The dashboard's ProfileSwitcher writes ?profile= via react-router's
    // setSearchParams (history.replaceState), which does NOT fire a
    // popstate event -- so this is the only way a same-window, non-iframe
    // plugin like this one notices the user flipped profiles without a
    // full page reload. Cheap (string compare) at the existing 5s cadence.
    function syncProfile() {
      var urlProfile = getSelectedProfile();
      if (!urlProfile || urlProfile === profile) return;
      setProfile(urlProfile);
      // A session id from the previous profile almost certainly doesn't
      // exist in the new profile's state.db (each profile has its own) --
      // mirrors the mount-time stale-id guard so switching profiles lands
      // on a real session instead of a 404'd load that blanks the chat.
      afetch(withProfile(api("/sessions"), urlProfile)).then(r => r.json()).then(d => {
        var list = d.sessions || [];
        setSessions(list);
        var ids = list.map(x => x.session_id);
        if (ids.indexOf(sessionIdRef.current) === -1) {
          var fresh = uuid();
          sessionIdRef.current = fresh;
          setSessionId(fresh); localStorage.setItem("web-chat.session_id", fresh);
          setMessages([]); setAttachments([]); setClarifyFor(fresh, null); setError(null);
        } else {
          loadSession(sessionIdRef.current);
        }
      }).catch(() => { });
    }
    function sync() {
      syncProfile();
      loadSessions();
      if (!busy) refreshMessages(sessionId);
      if (!busy && !clarify) checkPendingClarify(sessionId);
    }
    function onVis() { if (!document.hidden) sync(); }
    function onFocus() { sync(); }
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    var t = setInterval(function () {
      if (document.hidden) return;
      syncProfile();
      loadSessions();
      if (!busy) refreshMessages(sessionId);
      if (!busy && !clarify) checkPendingClarify(sessionId);
    }, 5000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      clearInterval(t);
    };
  }, [busy, sessionId, profile]);
  // Unmount-only cleanup for remote-busy polls (see watchRemoteBusy) -- these
  // are keyed per session id and must survive session switches (that's the
  // whole point, e.g. a sidebar "busy" badge for a chat you're not viewing),
  // so they can't live in the effect above whose deps change on every switch.
  useEffect(() => {
    return () => { Object.keys(remoteBusyPollRef.current).forEach(id => clearInterval(remoteBusyPollRef.current[id])); };
  }, []);
  // Poll for pending clarify cards across ALL sessions, unconditionally --
  // deliberately NOT gated by document.hidden like the main sync poll, so a
  // question raised while this tab is backgrounded still gets badged the
  // moment the user looks at the sidebar (see hermes-chat-frontend skill:
  // clarify cards were expiring/going unseen with zero visible signal).
  useEffect(() => {
    function pollPendingClarify() {
      afetch(withProfile(api("/pending_clarify_sessions"))).then(r => r.ok ? r.json() : null).then(d => {
        if (d && d.session_ids) setPendingClarifySessions(d.session_ids);
      }).catch(() => { });
    }
    pollPendingClarify();
    var t = setInterval(pollPendingClarify, 10000);
    return () => clearInterval(t);
  }, [profile]);
  function onScroll() {
    var el = scrollRef.current;
    if (!el) return;
    var nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottomRef.current = nearBottom;
    setAtBottom(nearBottom);
  }
  function jumpToBottom() {
    var el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    atBottomRef.current = true;
    setAtBottom(true);
  }
  useEffect(() => {
    var el = scrollRef.current;
    if (!el) return;
    var shouldFollow = pendingScrollRef.current || atBottomRef.current;
    if (shouldFollow) {
      el.scrollTop = el.scrollHeight;
      pendingScrollRef.current = false;
      atBottomRef.current = true;
      setAtBottom(true);
    }
    // else: user is genuinely scrolled up reading history -- leave them be;
    // atBottom is already false (set by onScroll when they scrolled away),
    // so the jump-to-latest button is showing and stays showing.
  }, [messages, status, clarify, sessionId]);
  useEffect(() => { autosize(inputRef.current); }, [input]);
  function saveLocal(id, msgs) { afetch(withProfile(api("/sessions/" + encodeURIComponent(id))), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: msgs }) }).then(loadSessions).catch(() => { }); }
  function newChat() { var id = uuid(); sessionIdRef.current = id; setSessionId(id); localStorage.setItem("web-chat.session_id", id); setMessages([]); setAttachments([]); setInput(""); setClarifyFor(id, null); setError(null); setSessionsOpen(false); setEditingIdx(null); setEditText(""); }
  function deleteSession(id, e) { e.stopPropagation(); afetch(withProfile(api("/sessions/" + encodeURIComponent(id))), { method: "DELETE" }).then(() => { loadSessions(); if (id === sessionId) newChat(); }); }
  function uploadFiles(files) {
    Array.from(files || []).forEach(file => {
      var fd = new FormData(); fd.append("session_id", sessionId); fd.append("file", file);
      afetch(api("/upload"), { method: "POST", body: fd }).then(r => r.ok ? r.json() : r.text().then(t => Promise.reject(t))).then(d => { setAttachments(a => a.concat([d])); }).catch(e => setError(String(e)));
    });
  }
  function paste(e) {
    var items = e.clipboardData && e.clipboardData.items; if (!items) return;
    var files = [];
    for (var i = 0; i < items.length; i++) { if (items[i].kind === "file") files.push(items[i].getAsFile()); }
    if (files.length) { e.preventDefault(); uploadFiles(files); }
  }
  function answerClarify(requestId, qid, answer) {
    afetch(api("/clarify"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request_id: requestId, answer: answer, question_id: qid }) }).catch(() => { });
  }
  var startEdit = useCallback(function (idx) {
    if (busy) return;
    var m = messagesRef.current[idx];
    if (!m) return;
    setEditingIdx(idx);
    setEditText(m.text || m.content || "");
  }, [busy]);
  var cancelEdit = useCallback(function () { setEditingIdx(null); setEditText(""); }, []);
  var saveEdit = useCallback(function (idx, msg, text) {
    text = String(text || "").trim();
    if (!text) { cancelEdit(); return; }
    var truncated = messagesRef.current.slice(0, idx);
    setEditingIdx(null); setEditText(""); setError(null);
    function proceed() { send(text, truncated); }
    if (msg.id != null) {
      // Soft-delete the edited turn + everything after it in state.db (the
      // desktop's rewind semantics) before resending, so the agent's next
      // turn — and the persisted transcript — never see the old branch.
      afetch(withProfile(api("/sessions/" + encodeURIComponent(sessionId) + "/rewind")), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: msg.id })
      }).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error(t || ("HTTP " + r.status)); });
        proceed();
      }).catch(function (e) { setError("Rewind failed: " + e); loadSession(sessionId); });
    } else {
      // Optimistic/unpersisted bubble (shouldn't normally happen for a
      // loaded message) -- nothing to rewind server-side, just resend.
      proceed();
    }
  }, [messagesRef, sessionId, send]);
  function stop() {
    afetch(api("/stop"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: sessionId }) }).catch(() => { });
    var ws = wsMapRef.current[sessionId];
    if (ws) { try { ws.close(); } catch (e) { } }
    setBusyFor(sessionId, false); setStatusFor(sessionId, null);
  }
  // Sends in whatever session is CURRENTLY VIEWED when send() is called
  // (captured into `sid` immediately), but every callback below keys off
  // `sid`/`streamSid` -- never the live `sessionId` state -- so switching
  // away to another chat, or opening a brand-new one, never blocks or
  // corrupts this stream: each session has its own busy flag, status,
  // clarify card, streaming buffer, and WebSocket entry.
  var send = useCallback(function (textOverride, baseMessagesOverride, sidOverride) {
    var sid = sidOverride || sessionIdRef.current;
    var text = (textOverride !== undefined ? textOverride : inputRef2.current).trim();
    var currentAttachments = attachmentsRef.current;
    if ((!text && !currentAttachments.length) || busyMapRef.current[sid]) return;
    var base = baseMessagesOverride !== undefined ? baseMessagesOverride : (sid === sessionIdRef.current ? messagesRef.current : []);
    var streamSid = sid;
    var mediaText = currentAttachments.map(a => "MEDIA:" + a.path).join("\n");
    var full = [text, mediaText].filter(Boolean).join("\n");
    var userMsg = { role: "user", text: full, timestamp: Date.now() / 1000, attachments: currentAttachments };
    var next = base.concat([userMsg]);
    if (sid === sessionIdRef.current) { pendingScrollRef.current = true; setMessages(next); }
    saveLocal(sid, next);
    if (sid === sessionIdRef.current) { setInput(""); setAttachments([]); }
    setBusyFor(sid, true); setStatusFor(sid, "thinking"); setError(null); setClarifyFor(sid, null);
    streamingMapRef.current[sid] = "";
    var chunks = [];
    var ws = new WebSocket(wsUrl("/stream"));
    wsMapRef.current[sid] = ws;
    ws.onopen = function () { ws.send(JSON.stringify({ type: "message", text: full, session_id: sid, profile: profile, model: sessionModel[sid] || defaultModel, effort: sessionEffort[sid] || "", attachments: currentAttachments })); };
    ws.onmessage = function (evt) {
      var f; try { f = JSON.parse(evt.data); } catch (e) { return; }
      if (f.type === "session" && f.session_id) {
        var oldSid = streamSid;
        streamSid = f.session_id;
        // The backend may rename a brand-new client-minted id to its
        // canonical server id -- migrate this stream's map entries so the
        // busy/status/clarify/ws bookkeeping stays reachable under the new
        // key (an unmigrated entry would look like the stream vanished,
        // even though it's still running).
        if (oldSid !== streamSid) {
          renameKey(setBusyMap, oldSid, streamSid, true);
          renameKey(setStatusMap, oldSid, streamSid, "thinking");
          renameKey(setClarifyMap, oldSid, streamSid, null);
          wsMapRef.current[streamSid] = wsMapRef.current[oldSid]; delete wsMapRef.current[oldSid];
          streamingMapRef.current[streamSid] = streamingMapRef.current[oldSid] || ""; delete streamingMapRef.current[oldSid];
        }
        if (sessionIdRef.current === sid) { setSessionId(f.session_id); localStorage.setItem("web-chat.session_id", f.session_id); }
        return;
      }
      if (f.type === "status") setStatusFor(streamSid, f.label || null);
      else if (f.type === "delta") {
        chunks.push(f.text || "");
        streamingMapRef.current[streamSid] = (streamingMapRef.current[streamSid] || "") + (f.text || "");
        if (sessionIdRef.current === streamSid) {
          setMessages(next.concat([{ role: "assistant", text: streamingMapRef.current[streamSid], timestamp: Date.now() / 1000, streaming: true }]));
        }
      }
      else if (f.type === "clarify") { setClarifyFor(streamSid, f); setStatusFor(streamSid, null); }
      else if (f.type === "clarify.expire") { setClarifyFor(streamSid, null); setStatusFor(streamSid, "thinking"); }
      else if (f.type === "done") {
        var final = f.text || chunks.join("");
        var doneMsgs = next.concat([{ role: "assistant", text: final, timestamp: Date.now() / 1000, attachments: [] }]);
        if (sessionIdRef.current === streamSid) setMessages(doneMsgs);
        saveLocal(f.session_id || streamSid, doneMsgs); setStatusFor(streamSid, null); setClarifyFor(streamSid, null); loadSessions();
      }
      else if (f.type === "clear") setStatusFor(streamSid, null);
      else if (f.type === "error") { if (sessionIdRef.current === streamSid) setError(f.text || "Agent error"); setStatusFor(streamSid, null); }
    };
    ws.onerror = function () { if (sessionIdRef.current === streamSid) setError("Connection error. Restart dashboard and retry if the plugin was just updated."); setBusyFor(streamSid, false); setStatusFor(streamSid, null); };
    ws.onclose = function () { if (wsMapRef.current[streamSid] === ws) delete wsMapRef.current[streamSid]; setBusyFor(streamSid, false); setStatusFor(streamSid, null); };
  }, [profile, sessionModel, sessionEffort]);
  function key(e) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); return; }
    // Skip pure navigation/modifier keys -- they don't trigger the
    // input-state re-render this tracker is measuring.
    if (e.key && e.key.length === 1 || e.key === "Backspace" || e.key === "Delete" || e.key === "Enter") {
      PerfTracker.markKeydown(messages.length);
    }
  }
  var current = sessions.find(s => s.session_id === sessionId) || {};
  // Memoized: this only depends on sessions/sessionId/pendingClarifySessions,
  // NOT on `input` -- without this it was rebuilt (with an O(sessions) indexOf
  // scan x2 per row) on every keystroke re-render of ChatPage, which is what
  // regressed client_keystroke_p95_ms after the clarify-badge feature landed
  // (pendingClarifySessions was new and never wired into a useMemo, unlike
  // AgentContent/Bubble in this same change). Use a Set for O(1) lookup too.
  var sessionList = useMemo(function () {
    if (!sessions.length) return React.createElement("div", { className: "wc-no-sessions" }, "No sessions yet — send a message to start.");
    var pendingSet = new Set(pendingClarifySessions);
    return sessions.map(s => {
      var needsAnswer = pendingSet.has(s.session_id);
      return React.createElement("div", { key: s.session_id, className: "wc-session" + (s.session_id === sessionId ? " active" : "") + (needsAnswer ? " wc-needs-answer" : "") + (s.is_busy ? " wc-busy" : ""), onClick: () => { loadSession(s.session_id); setSessionsOpen(false); } },
        React.createElement("button", { className: "wc-del", onClick: (e) => { e.stopPropagation(); setConfirmDel(s.session_id); }, title: "Delete" }, "×"),
        React.createElement("div", { className: "wc-session-body" },
          React.createElement("div", { className: "wc-session-title" }, s.title || "New chat"),
          React.createElement("div", { className: "wc-session-prev" }, s.preview || "No messages")),
        needsAnswer ? React.createElement("span", { className: "wc-badge wc-badge-clarify", title: "Waiting on your answer" }, "❓ needs answer")
          : s.is_busy ? React.createElement("span", { className: "wc-badge wc-badge-busy", title: "Agent is working" }, "\u23f3 busy")
          : (sourceLabel(s.source) ? React.createElement("span", { className: "wc-badge" }, sourceLabel(s.source)) : null));
    });
  }, [sessions, sessionId, pendingClarifySessions]);
  var settingsPanel = React.createElement("div", { className: "wc-settings" },
    models.length ? React.createElement(React.Fragment, null,
      React.createElement("label", { className: "wc-settings-label" }, "Model"),
      React.createElement("select", { className: "wc-sel", value: sessionModel[sessionId] || defaultModel, onChange: e => { var v = e.target.value; setSessionModel(Object.assign({}, sessionModel, { [sessionId]: v })); afetch(withProfile(api("/sessions/" + encodeURIComponent(sessionId) + "/model")), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: v }) }).catch(() => { }); }, title: "Model (per chat)" },
        models.map(m => React.createElement("option", { key: m, value: m }, m)))) : null,
    React.createElement("label", { className: "wc-settings-label" }, "Effort"),
    React.createElement("select", { className: "wc-sel", value: sessionEffort[sessionId] || "", onChange: e => { var v = e.target.value; setSessionPref(sessionId, { effort: v }); setSessionEffort(Object.assign({}, sessionEffort, { [sessionId]: v })); }, title: "Reasoning effort (per chat)" },
      React.createElement("option", { value: "" }, "default"),
      React.createElement("option", { value: "low" }, "low"),
      React.createElement("option", { value: "medium" }, "medium"),
      React.createElement("option", { value: "high" }, "high")));
  var confirmModal = confirmDel ? React.createElement("div", { className: "wc-confirm", onClick: () => setConfirmDel(null) },
    React.createElement("div", { className: "wc-confirm-card", onClick: e => e.stopPropagation() },
      React.createElement("h3", { className: "wc-confirm-title" }, "Delete chat?"),
      React.createElement("p", { className: "wc-confirm-text" }, "This will permanently delete this chat and its messages. This can't be undone."),
      React.createElement("div", { className: "wc-confirm-actions" },
        React.createElement("button", { className: "wc-confirm-btn", onClick: () => setConfirmDel(null) }, "Cancel"),
        React.createElement("button", { className: "wc-confirm-btn danger", onClick: () => { var id = confirmDel; setConfirmDel(null); deleteSession(id, { stopPropagation: function () { } }); } }, "Delete")))) : null;

  return React.createElement("div", { className: "wc-app", onPaste: paste, onDragOver: e => { e.preventDefault(); setDrag(true); }, onDragLeave: () => setDrag(false), onDrop: e => { e.preventDefault(); setDrag(false); uploadFiles(e.dataTransfer.files); } },
    React.createElement("aside", { className: "wc-sidebar" },
      React.createElement("div", { className: "wc-sheet-head" },
        React.createElement("h2", null, "Sessions"),
        React.createElement("button", { className: "wc-sheet-close", onClick: newChat }, "+ New")),
      settingsPanel,
      React.createElement("div", { className: "wc-sheet-list" }, sessionList)),
    React.createElement("div", { className: "wc-main-col" },
      React.createElement("div", { className: "wc-header" },
        React.createElement("button", { className: "wc-hbtn menu", onClick: () => setSessionsOpen(true) }, "☰"),
        React.createElement("div", { className: "wc-title" },
          current.title || "Chat",
          React.createElement("span", { className: "wc-sub" }, sourceLabel(current.source) || "web-chat"))),
      React.createElement("div", { className: "wc-messages", ref: scrollRef, onScroll: onScroll },
        messages.length ? messages.map((m, i) => React.createElement(Bubble, {
          key: m.id != null ? "m" + m.id : i, msg: m, idx: i,
          canEdit: m.role === "user" && !busy && !m.streaming,
          editing: editingIdx === i, editValue: editingIdx === i ? editText : "", onEditChange: setEditText,
          onStartEdit: startEdit, onSaveEdit: saveEdit, onCancelEdit: cancelEdit,
        }))
          : React.createElement(EmptyState, { onSuggestion: (p) => send(p) }),
        clarify ? React.createElement(ClarifyCard, { frame: clarify, onAnswer: answerClarify }) : null,
        !atBottom ? React.createElement("button", { className: "wc-jump", onClick: jumpToBottom, title: "Jump to latest" }, "↓") : null),
      error ? React.createElement("div", { className: "wc-error" }, error) : null,
      React.createElement(StatusLine, { label: status }),
      React.createElement("div", { className: "wc-inputbar" },
        React.createElement("input", { ref: fileRef, type: "file", multiple: true, style: { display: "none" }, onChange: e => uploadFiles(e.target.files) }),
        React.createElement("button", { className: "wc-hbtn", onClick: () => fileRef.current && fileRef.current.click(), disabled: busy, title: "Attach file", style: { minWidth: 44, height: 44 } }, "📎"),
        React.createElement("div", { style: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0 } },
          React.createElement("textarea", { ref: inputRef, value: input, onChange: e => setInput(e.target.value), onKeyDown: key, placeholder: busy ? "Agent is working…" : "Type a message…", disabled: busy, rows: 1, style: { width: "100%", overflowY: "auto" } }),
          attachments.length ? React.createElement("div", { className: "wc-attach" }, attachments.map((a, i) => React.createElement(FileChip, { key: i, path: a.path, onRemove: () => setAttachments(x => x.filter((_, j) => j !== i)) }))) : null),
        busy ? React.createElement("button", { className: "wc-send stop", onClick: stop, title: "Stop" }, "■")
             : React.createElement("button", { className: "wc-send", onClick: () => send(), disabled: !input.trim() && !attachments.length, title: "Send" }, "➤"))),
    React.createElement("div", { className: "wc-sheet" + (sessionsOpen ? " open" : "") },
      React.createElement("div", { className: "wc-sheet-backdrop", onClick: () => setSessionsOpen(false) }),
      React.createElement("div", { className: "wc-sheet-panel" },
        React.createElement("div", { className: "wc-sheet-head" },
          React.createElement("h2", null, "Sessions"),
          React.createElement("button", { className: "wc-sheet-close", onClick: () => setSessionsOpen(false) }, "Done")),
        settingsPanel,
        React.createElement("div", { className: "wc-sheet-list" }, sessionList),
        React.createElement("div", { className: "wc-sheet-new" },
          React.createElement("button", { onClick: newChat }, "+ New chat")))), confirmModal);
}

window.__HERMES_PLUGINS__.register("web-chat", ChatPage);
