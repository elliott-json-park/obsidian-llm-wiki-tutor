// 쓰기 미리보기 · 승인 모달. 볼트에 뭔가 만들기 전에 무엇을 만드는지 보여 주고 허락을 받는다
const { Modal } = require('obsidian');

class PreviewModal extends Modal {
  constructor(app, T, items, resolve) {
    super(app);
    this.T = T;
    this.items = items;
    this.resolve = resolve;
    this.answered = false;
  }

  onOpen() {
    const { contentEl, T } = this;
    contentEl.addClass('lwt-preview');
    // 전부 wiki 안에 쓰는 거면(요리 · 청소 · 규칙 반영) 재료로 위키 노트를 만든다고 말한다
    const wikiOnly = this.items.length > 0 && this.items.every((it) => /(^|\/)wiki(\/|$)/.test(it.path) && it.op !== 'folder');
    contentEl.createEl('h3', { text: T.t(wikiOnly ? 'preview.titleWiki' : 'preview.title') });
    const list = contentEl.createDiv({ cls: 'lwt-preview-list' });
    for (const it of this.items) {
      const row = list.createDiv({ cls: 'lwt-preview-item' });
      row.createDiv({ cls: 'lwt-preview-path', text: (it.op === 'folder' ? '📁 ' : it.op === 'append' ? '＋ ' : '📄 ') + (it.label || it.path) });
      if (it.content) {
        const lines = it.content.split('\n');
        row.createEl('pre', { cls: 'lwt-preview-body', text: lines.slice(0, 8).join('\n') + (lines.length > 8 ? '\n…' : '') });
      }
    }
    const btns = contentEl.createDiv({ cls: 'lwt-preview-buttons' });
    const ok = btns.createEl('button', { cls: 'mod-cta', text: T.t('preview.apply') });
    const no = btns.createEl('button', { text: T.t('preview.cancel') });
    ok.addEventListener('click', () => this.answer(true));
    no.addEventListener('click', () => this.answer(false));
    setTimeout(() => ok.focus(), 0);
  }

  answer(v) {
    if (this.answered) return;
    this.answered = true;
    this.resolve(v);
    this.close();
  }

  onClose() {
    this.contentEl.empty();
    if (!this.answered) this.answer(false);
  }
}

function confirmWrites(app, T, items) {
  return new Promise((resolve) => new PreviewModal(app, T, items, resolve).open());
}

module.exports = { confirmWrites };
