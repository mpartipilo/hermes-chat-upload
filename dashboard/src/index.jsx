import { marked } from "marked";
import DOMPurify from "dompurify";

var SDK = window.__HERMES_PLUGIN_SDK__ || {};
var React = SDK.React || window.React;
var hooks = SDK.hooks || React;
var useState = hooks.useState, useEffect = hooks.useEffect, useRef = hooks.useRef, useCallback = hooks.useCallback;
var C = SDK.components || {};
var Button = C.Button || ((p) => React.createElement("button", p));
var Input = C.Input || ((p) => React.createElement("input", p));
var Badge = C.Badge || ((p) => React.createElement("span", p));
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

const CSS = `
*{-webkit-tap-highlight-color:transparent}
button{touch-action:manipulation}
.wc-root{height:calc(100vh - 110px);min-height:0;display:grid;grid-template-columns:280px 1fr;gap:12px;color:hsl(var(--foreground));font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;--wc-accent:#34d399;--wc-accent-strong:#10b981;--wc-user-bg:color-mix(in srgb,var(--wc-accent) 24%,hsl(var(--card)));--wc-user-border:color-mix(in srgb,var(--wc-accent) 50%,transparent);--wc-assistant-bg:hsl(var(--card));--wc-assistant-border:color-mix(in srgb,var(--wc-accent) 22%,transparent)}
.wc-sidebar,.wc-main{background:hsl(var(--card));border:1px solid hsl(var(--border));border-radius:0;overflow:hidden;display:flex;flex-direction:column;min-height:0}
.wc-sidebar{box-shadow:0 1px 2px rgb(0 0 0 / .2)}
.wc-side-head{padding:12px 14px 10px;border-bottom:1px solid hsl(var(--border));display:flex;justify-content:space-between;align-items:center}
.wc-side-title{font-weight:700;font-size:.9rem;letter-spacing:.02em;display:flex;align-items:center;gap:6px}
.wc-side-title::before{content:"";width:8px;height:8px;background:var(--wc-accent);display:inline-block}
.wc-new{font-size:.78rem;padding:5px 12px;border-radius:0;background:hsl(var(--card));color:var(--wc-accent-strong);border:1px solid color-mix(in srgb,var(--wc-accent) 50%,transparent);cursor:pointer;font-weight:600}
.wc-new:hover{background:var(--wc-accent-strong);color:#04241a}
.wc-sessions{flex:1;overflow-y:auto;padding:6px}
.wc-session{padding:9px 12px;margin:2px 0;border:1px solid transparent;border-left:2px solid transparent;border-radius:0;cursor:pointer;position:relative}
.wc-session:hover{background:hsl(var(--muted))}
.wc-session.active{background:color-mix(in srgb,var(--wc-accent) 10%,transparent);border-left-color:var(--wc-accent);border-color:color-mix(in srgb,var(--wc-accent) 30%,transparent)}
.wc-session-title{font-weight:600;font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:18px}
.wc-session-prev{font-size:.74rem;color:hsl(var(--muted-foreground));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
.wc-session-time{font-size:.68rem;color:hsl(var(--muted-foreground) / .8);margin-top:3px}
.wc-no-sessions{padding:16px 12px;color:hsl(var(--muted-foreground));font-size:.8rem;text-align:center;line-height:1.5}
.wc-del{position:absolute;top:8px;right:8px;border:0;background:transparent;color:hsl(var(--muted-foreground));cursor:pointer;font-size:.9rem;opacity:0}
.wc-session:hover .wc-del{opacity:1}
.wc-del:hover{color:hsl(var(--destructive))}
.wc-main{position:relative}
.wc-main.wc-glowing{animation:wc-glow-pulse 2.4s ease-in-out infinite}
@keyframes wc-glow-pulse{0%,100%{box-shadow:0 0 0 1.5px color-mix(in srgb,var(--wc-accent) 30%,transparent),0 0 18px 2px color-mix(in srgb,var(--wc-accent) 12%,transparent)}50%{box-shadow:0 0 0 1.5px color-mix(in srgb,var(--wc-accent) 55%,transparent),0 0 28px 4px color-mix(in srgb,var(--wc-accent) 20%,transparent)}}
.wc-top{position:relative;padding:12px 16px;border-bottom:1px solid hsl(var(--border));display:flex;justify-content:space-between;align-items:center;gap:10px}
.wc-top-left{display:flex;align-items:center;gap:10px;min-width:0}
.wc-top-title{font-weight:700;font-size:.95rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.wc-top-right{display:flex;align-items:center;gap:8px}
.wc-profile{font-size:.76rem;padding:4px 8px;border-radius:0;background:hsl(var(--card));color:var(--wc-accent-strong);border:1px solid color-mix(in srgb,var(--wc-accent) 40%,transparent);cursor:pointer;max-width:170px;height:26px}
.wc-mobile-toggle{display:inline-flex;align-items:center;font-size:.8rem;padding:4px 10px;border-radius:0;background:hsl(var(--muted));border:1px solid hsl(var(--border));cursor:pointer;color:hsl(var(--foreground))}
.wc-root.sidebar-closed{grid-template-columns:1fr}
.wc-root.sidebar-closed .wc-sidebar{display:none}
.wc-info-pop{position:absolute;top:calc(100% + 6px);right:16px;z-index:40;background:hsl(var(--card));border:1px solid hsl(var(--border));border-radius:0;padding:8px 12px;font-size:.76rem;color:hsl(var(--foreground));box-shadow:0 4px 16px rgb(0 0 0 / .35);white-space:nowrap}
.wc-messages{flex:1;overflow-y:auto;padding:22px 24px;scroll-behavior:smooth}
.wc-row{display:flex;margin-bottom:14px;animation:wc-fade-in .25s ease;min-width:0}
.wc-row.user{justify-content:flex-end}
.wc-row.assistant{justify-content:flex-start}
.wc-avatar{width:28px;height:28px;border-radius:0;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.75rem;font-weight:700;margin-right:10px;background:hsl(var(--muted));border:1px solid hsl(var(--border));color:hsl(var(--muted-foreground))}
.wc-avatar.assistant{background:var(--wc-accent-strong);border-color:var(--wc-accent-strong);color:#04241a}
.wc-avatar.user{display:none}
.wc-bubble{max-width:80%;padding:10px 14px;border-radius:0;font-size:.875rem;line-height:1.55;word-break:break-word}
.wc-row.user .wc-bubble{background:var(--wc-user-bg);border:1px solid var(--wc-user-border);color:hsl(var(--foreground));white-space:pre-wrap}
.wc-row.assistant .wc-bubble{background:var(--wc-assistant-bg);border:1px solid var(--wc-assistant-border);color:hsl(var(--foreground))}
.wc-status{padding:8px 20px;color:hsl(var(--muted-foreground));font-size:.8rem;display:flex;gap:8px;align-items:center;border-top:1px solid hsl(var(--border))}
.wc-status-label{font-style:italic;color:color-mix(in srgb,var(--wc-accent) 70%,hsl(var(--foreground)))}
.wc-error{margin:10px 20px;padding:10px 14px;background:hsl(var(--destructive) / .12);color:hsl(var(--destructive));border-radius:0;font-size:.8rem;border:1px solid hsl(var(--destructive) / .3)}
.wc-input{padding:12px 16px;border-top:1px solid hsl(var(--border));display:flex;gap:8px;align-items:flex-end;background:hsl(var(--card))}
.wc-input>div{display:flex;flex-direction:column;justify-content:flex-end;min-width:0}
.wc-text{flex:1;height:38px;min-height:38px;box-sizing:border-box;border:1px solid hsl(var(--border));border-radius:0;background:hsl(var(--background));color:hsl(var(--foreground));padding:9px 12px;font-size:.875rem;font-family:inherit;resize:none}
.wc-text:focus{outline:2px solid color-mix(in srgb,var(--wc-accent) 55%,transparent);border-color:transparent}
.wc-text:disabled{opacity:.6}
.wc-iconbtn{width:38px;height:38px;box-sizing:border-box;border-radius:0;display:flex;align-items:center;justify-content:center;background:hsl(var(--card));border:1px solid hsl(var(--border));color:hsl(var(--muted-foreground));cursor:pointer;font-size:1rem;line-height:1;flex-shrink:0}
.wc-iconbtn:hover:not(:disabled){border-color:var(--wc-accent);color:var(--wc-accent-strong)}
.wc-iconbtn.primary{background:var(--wc-accent-strong);border-color:var(--wc-accent-strong);color:#04241a}
.wc-iconbtn.primary:hover:not(:disabled){filter:brightness(1.15)}
.wc-about{width:28px;height:28px;font-size:.8rem}
.wc-iconbtn:disabled{opacity:.45;cursor:not-allowed}
.wc-attach{display:flex;flex-wrap:wrap;gap:6px;padding:6px 0 0}
.wc-drop{outline:2px solid var(--wc-accent);outline-offset:-4px}
.wc-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 10px;margin:2px 4px 2px 0;border:1px solid hsl(var(--border));border-radius:0;background:hsl(var(--background));color:hsl(var(--foreground));font-size:.76rem;font-family:ui-monospace,monospace;text-decoration:none;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wc-img{max-width:100%;border-radius:0;margin:4px 0}
.wc-bulk{display:inline-block;margin:6px 0;padding:4px 10px;border:1px solid color-mix(in srgb,var(--wc-accent) 45%,transparent);border-radius:0;font-size:.76rem;color:var(--wc-accent-strong);text-decoration:none;background:hsl(var(--background))}
.wc-dots{display:inline-flex;gap:3px;align-items:center}
.wc-dot{width:5px;height:5px;border-radius:50%;background:var(--wc-accent-strong);animation:wc-blink 1.2s infinite}
.wc-dot:nth-child(2){animation-delay:.2s}.wc-dot:nth-child(3){animation-delay:.4s}
@keyframes wc-blink{0%,80%,100%{opacity:.25}40%{opacity:1}}
@keyframes wc-fade-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
.wc-md{font-size:.875rem;line-height:1.6;color:hsl(var(--foreground));overflow-wrap:anywhere}
.wc-md>*:first-child{margin-top:0!important}.wc-md>*:last-child{margin-bottom:0!important}
.wc-md h1,.wc-md h2,.wc-md h3,.wc-md h4{font-weight:600;margin:.75em 0 .25em;line-height:1.3}
.wc-md h1{font-size:1.25rem}.wc-md h2{font-size:1.1rem}.wc-md h3{font-size:1rem}
.wc-md p{margin:.4em 0}.wc-md strong{font-weight:700}.wc-md em{font-style:italic}
.wc-md a{color:var(--wc-accent-strong);text-decoration:underline}
.wc-md code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.82em;background:hsl(var(--background));padding:.1em .35em;border-radius:0}
.wc-md pre{background:hsl(var(--background));border:1px solid hsl(var(--border));border-radius:0;padding:.75em 1em;overflow-x:auto;margin:.5em 0}
.wc-md pre code{background:none;padding:0}
.wc-md ul,.wc-md ol{padding-left:1.5em;margin:.4em 0}
.wc-md blockquote{border-left:3px solid color-mix(in srgb,var(--wc-accent) 55%,transparent);padding-left:.75em;color:hsl(var(--muted-foreground))}
.wc-md table{border-collapse:collapse;width:100%;margin:.5em 0;font-size:.82rem}
.wc-md th,.wc-md td{border:1px solid hsl(var(--border));padding:.35em .65em;text-align:left}
.wc-md th{background:hsl(var(--background));font-weight:600}
.wc-md tbody tr:nth-child(even){background:hsl(var(--background) / .55)}
.wc-empty{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;color:hsl(var(--muted-foreground));padding:20px;text-align:center}
.wc-empty-mark{width:44px;height:44px;display:flex;align-items:center;justify-content:center;background:var(--wc-accent-strong);color:#04241a;font-size:1.25rem;font-weight:800}
.wc-empty-title{font-size:1.05rem;font-weight:700;color:hsl(var(--foreground))}
.wc-empty-sub{font-size:.82rem;max-width:420px;line-height:1.5}
.wc-suggest{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;max-width:520px}
.wc-suggest-chip{font-size:.78rem;padding:7px 14px;border-radius:0;background:hsl(var(--card));border:1px solid color-mix(in srgb,var(--wc-accent) 35%,transparent);color:hsl(var(--foreground));cursor:pointer}
.wc-suggest-chip:hover{border-color:var(--wc-accent);color:var(--wc-accent-strong)}
.wc-clarify{align-self:stretch;max-width:min(560px,100%);background:hsl(var(--card));border:1.5px solid var(--wc-accent);border-radius:0;padding:14px 16px;box-shadow:0 2px 8px rgb(0 0 0 / .2)}
.wc-clarify .q-title{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--wc-accent-strong);margin-bottom:6px}
.wc-clarify .q-text{font-size:14px;line-height:1.5;margin-bottom:12px;white-space:pre-wrap;color:hsl(var(--foreground))}
.wc-clarify .q-choices{display:flex;flex-direction:column;gap:8px}
.wc-clarify button.q-choice{text-align:left;background:hsl(var(--card));color:hsl(var(--foreground));border:1px solid hsl(var(--border));border-radius:0;padding:10px 12px;font-size:13.5px;cursor:pointer;font-family:inherit}
.wc-clarify button.q-choice:hover:not(:disabled){border-color:var(--wc-accent);color:var(--wc-accent-strong)}
.wc-clarify .q-rec{display:inline-block;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--wc-accent-strong);border:1px solid color-mix(in srgb,var(--wc-accent) 50%,transparent);border-radius:0;padding:1px 7px;margin-left:8px;vertical-align:middle}
.wc-clarify .q-other-row{display:flex;gap:8px;margin-top:6px}
.wc-clarify .q-other-row input{flex:1;min-width:0;background:hsl(var(--background));color:hsl(var(--foreground));border:1px solid hsl(var(--border));border-radius:0;padding:9px 12px;font-size:13.5px;font-family:inherit}
.wc-clarify .q-other-row input:focus{outline:2px solid color-mix(in srgb,var(--wc-accent) 55%,transparent);border-color:transparent}
.wc-clarify .q-other-row button{background:var(--wc-accent-strong);color:#04241a;border:none;border-radius:0;padding:9px 14px;font-size:13px;font-weight:600;cursor:pointer;flex-shrink:0}
.wc-clarify.answered{opacity:.6;filter:saturate(.6)}
.wc-clarify.answered button,.wc-clarify.answered input{pointer-events:none;opacity:.6}
.wc-clarify .q-answer{margin-top:10px;font-size:12.5px;color:hsl(var(--muted-foreground));border-top:1px dashed hsl(var(--border));padding-top:8px}
.wc-clarify .q-answer strong{color:var(--wc-accent-strong)}
.wc-clarify .q-multi{display:flex;flex-direction:column;gap:8px}
.wc-clarify .q-multi label{display:flex;align-items:center;gap:8px;font-size:13.5px;cursor:pointer;padding:8px 10px;border:1px solid hsl(var(--border));border-radius:0;background:hsl(var(--card))}
.wc-clarify .q-multi label:hover{border-color:var(--wc-accent)}
.wc-clarify .q-multi input{accent-color:var(--wc-accent-strong)}
.wc-clarify .q-done-row{display:flex;justify-content:flex-end;margin-top:10px}
@media (max-width: 860px){
  .wc-root{grid-template-columns:1fr}
  .wc-sidebar{position:absolute;z-index:20;top:0;bottom:0;left:0;width:280px;box-shadow:0 4px 24px rgb(0 0 0 / .5)}
  .wc-sidebar.hidden{display:none}
  .wc-mobile-toggle{display:inline-block}
  .wc-bubble{max-width:92%}
  .wc-messages{padding:12px 12px 18px}
  .wc-text{font-size:16px}
  .wc-top{flex-wrap:wrap;padding:10px 12px;gap:8px}
  .wc-top-left{flex:1 1 100%;min-width:0}
  .wc-top-right{flex:1 1 100%;flex-wrap:wrap;gap:6px;justify-content:flex-start;padding-top:2px}
  .wc-profile{font-size:16px;height:38px;max-width:none;flex:1 1 calc(50% - 6px)}
  span.wc-profile{flex:0 1 auto;max-width:150px;height:38px}
  .wc-about{width:38px!important;height:38px!important;font-size:.85rem!important}
  .wc-iconbtn{width:44px;height:44px}
  .wc-input{padding:10px 12px;padding-bottom:calc(10px + env(safe-area-inset-bottom,0px))}
  .wc-session{padding:12px 14px}
  .wc-new{padding:8px 14px}
  .wc-suggest-chip{padding:10px 16px}
  .wc-clarify .q-other-row input{font-size:16px}
  .wc-clarify button.q-choice{padding:12px 14px;font-size:14px}
}
`;
function injectStyles() { if (document.getElementById("wc-v2-style")) return; var s = document.createElement("style"); s.id = "wc-v2-style"; s.textContent = CSS; document.head.appendChild(s); }
function api(path) { return (window.__HERMES_BASE_PATH__ || "") + "/api/plugins/web-chat" + path; }
function wsUrl(path) { var proto = location.protocol === "https:" ? "wss:" : "ws:"; var token = window.__HERMES_SESSION_TOKEN__ || ""; return proto + "//" + location.host + api(path) + "?token=" + encodeURIComponent(token); }
function fmtTime(ts) { if (!ts) return ""; try { return new Date(ts * 1000).toLocaleString(); } catch (e) { return ""; } }
function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/[^A-Za-z0-9_.-]/g, "-"); }
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
function AgentContent({ text }) {
  var segs = parseSegments(text || "");
  var files = segs.filter(s => s.type === "file").map(s => s.path);
  return React.createElement(React.Fragment, null,
    files.length >= 3 ? React.createElement("a", { className: "wc-bulk", href: api("/bulk-download"), onClick: function (e) { e.preventDefault(); afetch(api("/bulk-download"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paths: files }) }).then(r => r.blob()).then(b => { var u = URL.createObjectURL(b), a = document.createElement("a"); a.href = u; a.download = "web-chat-files.zip"; a.click(); URL.revokeObjectURL(u); }); } }, "Download all (ZIP)") : null,
    segs.map((s, i) => {
      if (s.type === "file") return React.createElement(FileChip, { key: i, path: s.path });
      if (s.type === "image") return React.createElement("img", { key: i, className: "wc-img", src: s.url, alt: s.alt });
      var html = sanitizeMarkdownHtml(marked.parse(s.content || ""));
      return React.createElement("div", { key: i, className: "wc-md", dangerouslySetInnerHTML: { __html: html } });
    }));
}
function StatusLine({ label }) {
  if (!label) return null;
  return React.createElement("div", { className: "wc-status" },
    React.createElement("span", { className: "wc-dots" }, React.createElement("span", { className: "wc-dot" }), React.createElement("span", { className: "wc-dot" }), React.createElement("span", { className: "wc-dot" })),
    React.createElement("span", { className: "wc-status-label" }, label + "…"));
}
function Bubble({ msg }) {
  var role = msg.role || "assistant";
  var text = msg.text || msg.content || "";
  if (role === "assistant") {
    return React.createElement("div", { className: "wc-row assistant" },
      React.createElement("div", { className: "wc-avatar assistant" }, "H"),
      React.createElement("div", { className: "wc-bubble" }, React.createElement(AgentContent, { text: text })));
  }
  return React.createElement("div", { className: "wc-row user" },
    React.createElement("div", { className: "wc-bubble" }, text));
}
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
  // Fit the chat to the ACTUAL space below the dashboard header. The old
  // calc(100vh - 110px) guess overflows the dashboard's own flex layout on
  // mobile (input bar ends up below the fold). visualViewport tracks the
  // on-screen keyboard, so the input stays visible while typing.
  useEffect(() => {
    function fit() {
      var root = document.querySelector(".wc-root");
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
  var [busy, setBusy] = useState(false);
  var [status, setStatus] = useState(null);
  var [error, setError] = useState(null);
  var [attachments, setAttachments] = useState([]);
  var [drag, setDrag] = useState(false);
  var [profile, setProfile] = useState(null);
  var [models, setModels] = useState([]);
  // Per-session model/effort: each chat remembers its own selection.
  var [sessionModel, setSessionModel] = useState({});
  var [sessionEffort, setSessionEffort] = useState({});
  var [sidebarOpen, setSidebarOpen] = useState(function () { return window.innerWidth > 860; });
  var [showInfo, setShowInfo] = useState(false);
  var [clarify, setClarify] = useState(null);
  var scrollRef = useRef(null), fileRef = useRef(null), wsRef = useRef(null);
  var streamingRef = useRef("");

  function loadSessions() { afetch(api("/sessions")).then(r => r.json()).then(d => setSessions(d.sessions || [])).catch(() => { }); }
  function loadSession(id) {
    setError(null); setClarify(null);
    afetch(api("/sessions/" + encodeURIComponent(id))).then(r => r.ok ? r.json() : Promise.reject()).then(d => {
      setSessionId(id); localStorage.setItem("web-chat.session_id", id);
      setMessages(d.messages || d.history || []); setAttachments([]);
      // Apply this session's saved model/effort prefs (defaults to dashboard model).
      var prefs = sessionPrefs(id);
      setSessionModel(Object.assign({}, sessionModel, { [id]: prefs.model || "" }));
      setSessionEffort(Object.assign({}, sessionEffort, { [id]: prefs.effort || "" }));
    }).catch(() => { setMessages([]); });
  }
  function sessionPrefs(id) {
    var key = "web-chat.prefs." + id;
    try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) { return {}; }
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
    // Cross-talk guard: the saved id may be a stale desktop/gateway session
    // (from before the source filter existed). If it isn't in the web-chat
    // list, mint a fresh session so we never write into another surface's row.
    afetch(api("/sessions")).then(r => r.json()).then(d => {
      var ids = (d.sessions || []).map(s => s.session_id);
      if (ids.length && ids.indexOf(saved) === -1) {
        var fresh = uuid();
        setSessionId(fresh); localStorage.setItem("web-chat.session_id", fresh);
        setMessages([]); setAttachments([]);
      }
    }).catch(() => { });
    // The dashboard owns profile state — pick up its current profile instead of
    // reimplementing a switcher. `current` is the profile this dashboard is scoped to.
    afetch("/api/profiles/active").then(r => r.json()).then(d => {
      setProfile(d.current || d.active || "default");
    }).catch(() => { setProfile("default"); });
    // Model + effort: read the dashboard's own picker payload (same source the
    // Models page uses) so we don't reimplement model discovery.
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
      // Seed the current session's prefs with the dashboard default if unset.
      var prefs = sessionPrefs(saved);
      if (!prefs.model) { prefs.model = def; setSessionPref(saved, { model: def }); }
      if (!prefs.effort) { prefs.effort = ""; setSessionPref(saved, { effort: "" }); }
      setSessionModel(Object.assign({}, sessionModel, { [saved]: prefs.model || def }));
      setSessionEffort(Object.assign({}, sessionEffort, { [saved]: prefs.effort || "" }));
    }).catch(() => { });
  }, []);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages, status, clarify]);
  function saveLocal(id, msgs) { afetch(api("/sessions/" + encodeURIComponent(id)), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: msgs }) }).then(loadSessions).catch(() => { }); }
  function newChat() { var id = uuid(); setSessionId(id); localStorage.setItem("web-chat.session_id", id); setMessages([]); setAttachments([]); setInput(""); setClarify(null); setError(null); }
  function deleteSession(id, e) { e.stopPropagation(); afetch(api("/sessions/" + encodeURIComponent(id)), { method: "DELETE" }).then(() => { loadSessions(); if (id === sessionId) newChat(); }); }
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
  var send = useCallback(function (textOverride) {
    var text = (textOverride !== undefined ? textOverride : input).trim();
    if ((!text && !attachments.length) || busy) return;
    var mediaText = attachments.map(a => "MEDIA:" + a.path).join("\n");
    var full = [text, mediaText].filter(Boolean).join("\n");
    var userMsg = { role: "user", text: full, timestamp: Date.now() / 1000, attachments: attachments };
    var next = messages.concat([userMsg]);
    setMessages(next); saveLocal(sessionId, next);
    setInput(""); setAttachments([]); setBusy(true); setStatus("thinking"); setError(null); setClarify(null);
    streamingRef.current = "";
    var chunks = [];
    var ws = new WebSocket(wsUrl("/stream"));
    wsRef.current = ws;
    ws.onopen = function () { ws.send(JSON.stringify({ type: "message", text: full, session_id: sessionId, profile: profile, model: sessionModel[sessionId] || "", effort: sessionEffort[sessionId] || "", attachments: attachments })); };
    ws.onmessage = function (evt) {
      var f; try { f = JSON.parse(evt.data); } catch (e) { return; }
      if (f.type === "session" && f.session_id) { setSessionId(f.session_id); localStorage.setItem("web-chat.session_id", f.session_id); }
      else if (f.type === "status") setStatus(f.label || null);
      else if (f.type === "delta") {
        chunks.push(f.text || "");
        streamingRef.current += (f.text || "");
        setMessages(next.concat([{ role: "assistant", text: streamingRef.current, timestamp: Date.now() / 1000, streaming: true }]));
      }
      else if (f.type === "clarify") { setClarify(f); setStatus(null); }
      else if (f.type === "clarify.expire") { setClarify(null); setStatus("thinking"); }
      else if (f.type === "done") {
        var final = f.text || chunks.join("");
        var doneMsgs = next.concat([{ role: "assistant", text: final, timestamp: Date.now() / 1000, attachments: [] }]);
        setMessages(doneMsgs); saveLocal(sessionId, doneMsgs); setStatus(null); setClarify(null); loadSessions();
      }
      else if (f.type === "clear") setStatus(null);
      else if (f.type === "error") { setError(f.text || "Agent error"); setStatus(null); }
    };
    ws.onerror = function () { setError("Connection error. Restart dashboard and retry if the plugin was just updated."); setBusy(false); setStatus(null); };
    ws.onclose = function () { setBusy(false); setStatus(null); wsRef.current = null; };
  }, [input, attachments, busy, messages, sessionId, profile, sessionModel, sessionEffort]);
  function key(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }
  var sessionList = sessions.length ? sessions.map(s => React.createElement("div", { key: s.session_id, className: "wc-session" + (s.session_id === sessionId ? " active" : ""), onClick: () => { loadSession(s.session_id); if (window.innerWidth <= 860) setSidebarOpen(false); } },
      React.createElement("button", { className: "wc-del", onClick: (e) => deleteSession(s.session_id, e), title: "Delete" }, "×"),
      React.createElement("div", { className: "wc-session-title" }, s.title || "New chat"),
      React.createElement("div", { className: "wc-session-prev" }, s.preview || "No messages"),
      React.createElement("div", { className: "wc-session-time" }, fmtTime(s.updated_at))))
      : React.createElement("div", { className: "wc-no-sessions" }, "No sessions yet - send a message to start.");
  return React.createElement("div", { className: "wc-root" + (sidebarOpen ? "" : " sidebar-closed"), onPaste: paste, onDragOver: e => { e.preventDefault(); setDrag(true); }, onDragLeave: () => setDrag(false), onDrop: e => { e.preventDefault(); setDrag(false); uploadFiles(e.dataTransfer.files); } },
    React.createElement("div", { className: "wc-sidebar" },
      React.createElement("div", { className: "wc-side-head" },
        React.createElement("span", { className: "wc-side-title" }, "Sessions"),
        React.createElement("button", { className: "wc-new", onClick: newChat }, "+ New")),
      React.createElement("div", { className: "wc-sessions" }, sessionList),
      React.createElement("div", { className: "wc-main" + (drag ? " wc-drop" : "") + (busy || status ? " wc-glowing" : "") },
      React.createElement("div", { className: "wc-top" },
        React.createElement("div", { className: "wc-top-left" },
          React.createElement("button", { className: "wc-mobile-toggle", onClick: () => setSidebarOpen(o => !o), title: "Toggle sidebar" }, "☰"),
          React.createElement("span", { className: "wc-top-title" }, (sessions.find(s => s.session_id === sessionId) || {}).title || "Chat")),
        React.createElement("div", { className: "wc-top-right" },
          models.length ? React.createElement("select", { className: "wc-profile", value: sessionModel[sessionId] || "", onChange: e => { var v = e.target.value; setSessionPref(sessionId, { model: v }); setSessionModel(Object.assign({}, sessionModel, { [sessionId]: v })); }, title: "Model (per chat)" },
            models.map(m => React.createElement("option", { key: m, value: m }, m))) : null,
          React.createElement("select", { className: "wc-profile", value: sessionEffort[sessionId] || "", onChange: e => { var v = e.target.value; setSessionPref(sessionId, { effort: v }); setSessionEffort(Object.assign({}, sessionEffort, { [sessionId]: v })); }, title: "Reasoning effort (per chat)" },
            React.createElement("option", { value: "" }, "effort: default"),
            React.createElement("option", { value: "low" }, "effort: low"),
            React.createElement("option", { value: "medium" }, "effort: medium"),
            React.createElement("option", { value: "high" }, "effort: high")),
          profile ? React.createElement("span", { className: "wc-profile", title: "Dashboard profile" }, profile) : null,
          React.createElement("button", { className: "wc-iconbtn wc-about", onClick: () => setShowInfo(o => !o), title: "About" }, "ⓘ"),
          showInfo ? React.createElement("div", { className: "wc-info-pop" }, "Web Chat v" + PLUGIN_VERSION, " — streaming, files, clarify. No terminal.") : null)),
      React.createElement("div", { className: "wc-messages", ref: scrollRef },
        messages.length ? messages.map((m, i) => React.createElement(Bubble, { key: i, msg: m }))
          : React.createElement(EmptyState, { onSuggestion: (p) => send(p) }),
        clarify ? React.createElement(ClarifyCard, { frame: clarify, onAnswer: answerClarify }) : null),
      error ? React.createElement("div", { className: "wc-error" }, error) : null,
      React.createElement(StatusLine, { label: status }),
      React.createElement("div", { className: "wc-input" },
        React.createElement("input", { ref: fileRef, type: "file", multiple: true, style: { display: "none" }, onChange: e => uploadFiles(e.target.files) }),
        React.createElement("div", { style: { flex: 1 } },
          React.createElement("textarea", { className: "wc-text", value: input, onChange: e => setInput(e.target.value), onKeyDown: key, placeholder: busy ? "Agent is working…" : "Type a message.", disabled: busy, rows: 1, style: { width: "100%" } }),
          attachments.length ? React.createElement("div", { className: "wc-attach" }, attachments.map((a, i) => React.createElement(FileChip, { key: i, path: a.path, onRemove: () => setAttachments(x => x.filter((_, j) => j !== i)) }))) : null),
        React.createElement("button", { className: "wc-iconbtn", onClick: () => fileRef.current && fileRef.current.click(), disabled: busy, title: "Attach file" }, "📎"),
        React.createElement("button", { className: "wc-iconbtn primary", onClick: () => send(), disabled: busy || (!input.trim() && !attachments.length), title: "Send" }, "➤")))));
}

window.__HERMES_PLUGINS__.register("web-chat", ChatPage);
