// 복붙 길의 붙여넣기 창. AI 의 답을 여기에 붙여넣으면 엔진이 쪽으로 쪼갠다. 클립보드를 몰래 읽지 않는다
const { Modal } = require('obsidian');

class PasteModal extends Modal {
  constructor(app, T, resolve, opts = {}) {
    super(app);
    this.T = T;
    this.resolve = resolve;
    this.opts = opts;
    this.answered = false;
  }

  onOpen() {
    const { contentEl, T } = this;
    contentEl.addClass('lwt-paste');
    contentEl.createEl('h3', { text: this.opts.title || T.t('paste.title') });
    contentEl.createEl('p', { cls: 'lwt-paste-help', text: this.opts.help || T.t('paste.help') });
    const ta = contentEl.createEl('textarea', { cls: 'lwt-paste-area', attr: { rows: '14', placeholder: T.t('paste.placeholder') } });
    const btns = contentEl.createDiv({ cls: 'lwt-preview-buttons' });
    const ok = btns.createEl('button', { cls: 'mod-cta', text: T.t('paste.apply') });
    const no = btns.createEl('button', { text: T.t('paste.later') });
    ok.addEventListener('click', () => this.answer(ta.value));
    no.addEventListener('click', () => this.answer(null));
    setTimeout(() => ta.focus(), 0);
  }

  answer(v) {
    if (this.answered) return;
    this.answered = true;
    this.resolve(v);
    this.close();
  }

  onClose() {
    this.contentEl.empty();
    if (!this.answered) this.answer(null);
  }
}

function askPaste(app, T, opts) {
  return new Promise((resolve) => new PasteModal(app, T, resolve, opts).open());
}

module.exports = { askPaste };
