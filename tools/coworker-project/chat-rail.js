/* eslint-disable no-underscore-dangle */
// The persistent "Ask anything" chat rail (ticket #30). Our own component over
// the multi-turn direct-AO seam (coworker.js openChat / ChatSession), mounted
// shell-wide in the runner so it is present on every stage. It is stage-aware:
// the shell passes the current stage + project view model, and the rail feeds a
// composed context preamble (chat-context.js) to its AO session, so answers are
// grounded in where the producer is. Supersedes #19 (the hosted <nx-chat-ao>,
// which does not connect from our foreign-origin iframe - see #20).

import { LitElement, html } from 'da-lit';
import { openChat } from './coworker.js';
import { composeContext } from './chat-context.js';

class DaChatRail extends LitElement {
  static properties = {
    context: { attribute: false },
    stage: { attribute: false },
    project: { attribute: false },
    _messages: { state: true },
    _input: { state: true },
    _sending: { state: true },
    _error: { state: true },
  };

  constructor() {
    super();
    this.context = null;
    this.stage = null;
    this.project = null;
    this._messages = [];
    this._input = '';
    this._sending = false;
    this._error = null;
    this._chat = null;
  }

  createRenderRoot() {
    return this;
  }

  firstUpdated() {
    this._chat = openChat(this.context);
    this.syncContext();
  }

  // Keep the AO session's context preamble in step with the current stage +
  // project state; ChatSession only resends it when it actually changed.
  updated() {
    this.syncContext();
  }

  syncContext() {
    this._chat?.setContext(composeContext(this.stage, this.project));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._chat?.close();
  }

  async sendMessage() {
    const text = this._input.trim();
    if (!text || this._sending) return;
    this._messages = [...this._messages, { role: 'user', text }];
    this._input = '';
    this._sending = true;
    this._error = null;
    try {
      const reply = await this._chat.send(text);
      this._messages = [...this._messages, { role: 'assistant', text: reply }];
    } catch (e) {
      this._error = e.message || 'The assistant could not respond.';
    } finally {
      this._sending = false;
    }
  }

  onKeydown(e) {
    // Enter sends; Shift+Enter is a newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.sendMessage();
    }
  }

  renderMessages() {
    if (!this._messages.length) {
      return html`<p class="cw-chat-empty">Ask anything about your project - keywords, creative
        direction, the brief, or next steps.</p>`;
    }
    return html`<div class="cw-chat-msgs">
      ${this._messages.map((m) => html`
        <div class="cw-chat-msg is-${m.role}">
          <span class="cw-chat-role">${m.role === 'user' ? 'You' : 'Coworker'}</span>
          <div class="cw-chat-text">${m.text}</div>
        </div>`)}
      ${this._sending ? html`<div class="cw-chat-msg is-assistant">
        <span class="cw-chat-role">Coworker</span>
        <div class="cw-chat-text cw-muted">Thinking...</div>
      </div>` : ''}
    </div>`;
  }

  render() {
    return html`
      <div class="cw-chat-head">
        <h3 class="cw-kw-title">Ask anything</h3>
      </div>
      ${this.renderMessages()}
      ${this._error ? html`<p class="cw-error">${this._error}</p>` : ''}
      <div class="cw-chat-entry">
        <textarea class="cw-chat-input" rows="2" placeholder="Ask anything" .value=${this._input}
          ?disabled=${this._sending}
          @input=${(e) => { this._input = e.target.value; }}
          @keydown=${(e) => this.onKeydown(e)}></textarea>
        <button class="nx-btn-accent" ?disabled=${!this._input.trim() || this._sending}
          @click=${() => this.sendMessage()}>Send</button>
      </div>`;
  }
}

customElements.define('da-chat-rail', DaChatRail);
