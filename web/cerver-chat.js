// <cerver-chat> — a drop-in AI chat widget powered by cerver.
//
// One script tag, one element:
//   <script src="https://cerver.ai/embed/cerver-chat.js"></script>
//   <cerver-chat model="claude-haiku-4-5-20251001"
//                system-prompt="You answer questions about Acme's docs."></cerver-chat>
//
// It creates an anonymous, per-visitor session against the cerver gateway and
// streams replies live. No backend, no message store, no streaming layer to
// build — cerver does all of it. Runs on your compute / subscription.
//
// PROTOTYPE auth: falls back to /v2/auth/temp-signup (anonymous). In production
// you pass a publishable, spend-capped key:  <cerver-chat pk="pk_live_…">.
(function () {
  const DEFAULT_BASE = "https://gateway.cerver.ai";
  const LS_KEY = "cerver_chat_key";
  const LS_UID = "cerver_chat_uid";
  const LS_SID = "cerver_chat_sid";
  const LS_LOG = "cerver_chat_log";
  const DEFAULT_MODELS = [
    ["Claude Haiku", "claude-haiku-4-5-20251001"],
    ["Claude Sonnet", "claude-sonnet-4-6"],
    ["Claude Opus", "claude-opus-4-8"],
    ["GPT-5", "gpt-5"],
    ["Gemini Flash", "gemini-3.1-flash"],
    ["Grok", "grok-4"],
  ];
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16);
      }));

  const CSS = `
    :host { all: initial; display: block; height: 100%; min-height: 420px; font-family: 'IBM Plex Mono', ui-monospace, monospace; }
    .wrap { display: flex; flex-direction: column; height: 100%;
            background: #f4f1e8; color: #1b1a16; border: 1px solid #d9d3c2; }
    .head { padding: 11px 14px; border-bottom: 1px solid #d9d3c2; font-size: 12px; font-weight: 600;
            display: flex; align-items: center; gap: 8px; }
    .head select { font: inherit; font-size: 11.5px; font-weight: 600; background: #fff; border: 1px solid #d9d3c2; color: #1b1a16; padding: 3px 6px; cursor: pointer; }
    .head .dot { color: #4f9d74; }
    .head .cost { color: #6c685c; font-weight: 400; font-size: 11px; }
    .head button { font: inherit; font-size: 10.5px; color: #6c685c; background: none; border: 0; cursor: pointer; text-decoration: underline; padding: 0 0 0 9px; }
    .msgs { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
    .turn { font-size: 13.5px; line-height: 1.55; }
    .turn .who { font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: #6c685c; margin-bottom: 3px; }
    .turn.user .who { color: var(--accent, #d2588f); }
    .turn .body { white-space: pre-wrap; }
    .turn .body.cur::after { content: "▋"; color: #df7536; animation: blink 1.1s steps(1) infinite; }
    @keyframes blink { 50% { opacity: 0; } }
    .row { display: flex; gap: 8px; padding: 11px; border-top: 1px solid #d9d3c2; }
    .row input { flex: 1; font: inherit; font-size: 13.5px; padding: 9px 11px; border: 1.5px solid #d9d3c2;
                 background: #fff; color: #1b1a16; outline: none; }
    .row input:focus { border-color: #1b1a16; }
    .row button { font: inherit; font-size: 13px; padding: 9px 16px; border: 0; background: #1b1a16; color: #f4f1e8; cursor: pointer; }
    .row button:hover { background: var(--accent, #d2588f); }
    .row button:disabled { opacity: .4; cursor: default; }
    .foot { padding: 7px 14px; border-top: 1px solid #d9d3c2; font-size: 10.5px; color: #6c685c; text-align: center; }
    .foot a { color: #6c685c; }
  `;

  class CerverChat extends HTMLElement {
    connectedCallback() {
      this.base = this.getAttribute("api-base") || DEFAULT_BASE;
      const raw = this.getAttribute("models");
      this.modelList = raw
        ? raw.split(",").map((s) => { const p = s.split(":"); return p[1] ? [p[0].trim(), p[1].trim()] : [p[0].trim(), p[0].trim()]; })
        : DEFAULT_MODELS;
      this.model = this.getAttribute("model") || this.modelList[0][1];
      this.modelLabel = (this.modelList.find((m) => m[1] === this.model) || [this.model])[0];
      this.systemPrompt = this.getAttribute("system-prompt") || "";
      this.pk = this.getAttribute("pk") || "";
      this.session = null;
      this.busy = false;
      this.history = [];
      this._render();
      this._restore();
      if (this.pk) this._loadPublicConfig();
    }

    _loadLog() { try { return JSON.parse(localStorage.getItem(LS_LOG) || "[]"); } catch { return []; } }
    _saveLog() { try { localStorage.setItem(LS_LOG, JSON.stringify(this.history.slice(-40))); } catch (e) { /* full */ } }
    _restore() { this.history = this._loadLog(); for (const m of this.history) this._addTurn(m.role, m.text, m.who); }

    // When a publishable key is set, pull the app's configured model list +
    // branding from the gateway (prompt/context/tools stay server-side). Falls
    // back silently to the attribute/default models if it can't.
    async _loadPublicConfig() {
      try {
        const r = await fetch(this.base + "/v2/chat/public-config", { headers: { Authorization: "Bearer " + this.pk } });
        if (!r.ok) return;
        const d = await r.json();
        if (Array.isArray(d.models) && d.models.length) {
          this.modelList = d.models.map((m) => [m.label || m.id, m.id]);
          this.model = this.modelList[0][1];
          this.modelLabel = this.modelList[0][0];
          const sel = this.$("model");
          if (sel) {
            sel.innerHTML = "";
            this.modelList.forEach(([label, id]) => { const o = document.createElement("option"); o.value = id; o.textContent = label; sel.appendChild(o); });
          }
        }
        if (d.branding && d.branding.accent) this.style.setProperty("--accent", d.branding.accent);
      } catch (e) { /* keep defaults */ }
    }

    _render() {
      const root = this.attachShadow({ mode: "open" });
      root.innerHTML = `<style>${CSS}</style>
        <div class="wrap">
          <div class="head"><span class="dot">●</span><select id="model" title="switch model live"></select><span class="cost" id="cost" style="margin-left:auto"></span><button id="clr" title="clear history">clear</button></div>
          <div class="msgs" id="msgs"></div>
          <div class="row">
            <input id="in" type="text" placeholder="Ask anything…" autocomplete="off" />
            <button id="send">Send</button>
          </div>
          <div class="foot">powered by <a href="https://cerver.ai" target="_blank">cerver</a> · run local or remote agents</div>
        </div>`;
      this.$ = (s) => root.getElementById(s);
      const submit = () => { const v = this.$("in").value; this.$("in").value = ""; this.send(v); };
      this.$("send").addEventListener("click", submit);
      this.$("in").addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
      this.$("clr").addEventListener("click", () => {
        this.history = []; this._saveLog();
        this.$("msgs").innerHTML = ""; this.$("cost").textContent = "";
        this._resetSession();
      });
      const sel = this.$("model");
      this.modelList.forEach(([label, id]) => {
        const o = document.createElement("option"); o.value = id; o.textContent = label;
        if (id === this.model) o.selected = true; sel.appendChild(o);
      });
      sel.addEventListener("change", () => { this.model = sel.value; this.modelLabel = sel.options[sel.selectedIndex].textContent; });
    }

    _addTurn(role, text, who) {
      const el = document.createElement("div");
      el.className = "turn " + role;
      const label = role === "user" ? "you" : (who || "cerver");
      el.innerHTML = `<div class="who">${label}</div><div class="body"></div>`;
      const body = el.querySelector(".body");
      body.textContent = text;
      this.$("msgs").appendChild(el);
      this._scroll();
      return body;
    }
    _scroll() { const m = this.$("msgs"); m.scrollTop = m.scrollHeight; }

    async _ensureSession() {
      if (this.session) return this.session;
      let key = this.pk || localStorage.getItem(LS_KEY);
      if (!key) {
        const r = await fetch(this.base + "/v2/auth/temp-signup", { method: "POST" });
        if (!r.ok) throw new Error("could not start a session (temp-signup " + r.status + ")");
        key = (await r.json()).api_key;
        localStorage.setItem(LS_KEY, key);
      }
      this.key = key;
      const cached = localStorage.getItem(LS_SID);
      // Only reuse a cached session if THIS key created it. A session is owned
      // by the account of the key that made it, so reusing one across keys (e.g.
      // an old anonymous session under a new pk) makes run-llm 403 with
      // "session belongs to another account".
      if (cached && localStorage.getItem(LS_SID + "_k") === key) { this.session = cached; return this.session; }
      let uid = localStorage.getItem(LS_UID);
      if (!uid) { uid = uuid(); localStorage.setItem(LS_UID, uid); }
      const s = await fetch(this.base + "/v2/sessions", {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ session_type: "chat", workload: "general", session_name: "embed-chat", metadata: { external_user_id: uid } }),
      });
      if (!s.ok) throw new Error("session create failed (" + s.status + ")");
      const sd = await s.json();
      this.session = sd.session_id || (sd.session && sd.session.sessionId);
      if (!this.session) throw new Error("no session id returned");
      localStorage.setItem(LS_SID, this.session);
      localStorage.setItem(LS_SID + "_k", key);
      return this.session;
    }

    _resetSession() { this.session = null; localStorage.removeItem(LS_SID); localStorage.removeItem(LS_SID + "_k"); }

    async send(text) {
      if (this.busy || !text || !text.trim()) return;
      text = text.trim();
      this.busy = true; this.$("send").disabled = true;
      this.history.push({ role: "user", text });
      this._addTurn("user", text);
      const who = "cerver · " + (this.modelLabel || this.model);
      const bubble = this._addTurn("assistant", "", who);
      bubble.classList.add("cur");
      try {
        // run-llm is stateless, so we thread the recent turns into the prompt
        // ourselves — that's the conversation memory.
        const prior = this.history.slice(0, -1).slice(-12)
          .map((m) => (m.role === "user" ? "User: " : "Assistant: ") + m.text).join("\n");
        const input = prior ? prior + "\n\nUser: " + text : text;
        const run = async () => {
          const sid = await this._ensureSession();
          return fetch(`${this.base}/v2/sessions/${sid}/run-llm`, {
            method: "POST",
            headers: { Authorization: "Bearer " + this.key, "Content-Type": "application/json" },
            body: JSON.stringify({ input, model: this.model, systemPrompt: this.systemPrompt || undefined }),
          });
        };
        let res = await run();
        // Stale or foreign session (403/404) → drop it and try once with a fresh one.
        if (res.status === 403 || res.status === 404) { this._resetSession(); res = await run(); }
        if (!res.ok || !res.body) throw new Error("run failed (" + res.status + ")");
        const acc = await this._consume(res, bubble);
        this.history.push({ role: "assistant", text: acc, who });
        this._saveLog();
      } catch (e) {
        bubble.textContent = "⚠ " + e.message;
      } finally {
        bubble.classList.remove("cur");
        this.busy = false; this.$("send").disabled = false; this.$("in").focus();
      }
    }

    // Parse the run-llm SSE stream: text_delta → append, usage → show cost.
    async _consume(res, bubble) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "", acc = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop();
        for (const f of frames) {
          const ev = (/event:\s*(.*)/.exec(f) || [])[1];
          const dm = (/data:\s*([\s\S]*)/.exec(f) || [])[1];
          if (!dm) continue;
          let data; try { data = JSON.parse(dm); } catch { continue; }
          if (ev === "text_delta" && data.content) { acc += data.content; bubble.textContent = acc; this._scroll(); }
          else if (ev === "usage" && data.cost_estimate_usd != null) {
            this.$("cost").textContent = "this turn: $" + Number(data.cost_estimate_usd).toFixed(4);
          }
        }
      }
      return acc;
    }
  }

  if (!customElements.get("cerver-chat")) customElements.define("cerver-chat", CerverChat);
})();
