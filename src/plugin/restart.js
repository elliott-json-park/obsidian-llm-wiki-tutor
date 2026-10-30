// "수업 처음부터": 수업만 처음부터 / 노트까지 초기화 / 취소
const { Modal } = require('obsidian');

class RestartModal extends Modal {
  constructor(app, T, root, resolve) {
    super(app);
    this.T = T;
    this.root = root;
    this.resolve = resolve;
    this.answered = false;
  }

  onOpen() {
    const { contentEl, T } = this;
    contentEl.addClass('lwt-restart');
    contentEl.createEl('h3', { text: T.t('restart.title') });
    contentEl.createEl('p', { text: T.t('restart.body', { root: this.root }) });
    const btns = contentEl.createDiv({ cls: 'lwt-preview-buttons' });
    const only = btns.createEl('button', { cls: 'mod-cta', text: T.t('restart.lessonsOnly') });
    const wipe = btns.createEl('button', { cls: 'mod-warning', text: T.t('restart.wipeNotes') });
    const no = btns.createEl('button', { text: T.t('preview.cancel') });
    only.addEventListener('click', () => this.answer('lessons'));
    wipe.addEventListener('click', () => this.answer('wipe'));
    no.addEventListener('click', () => this.answer(null));
    setTimeout(() => only.focus(), 0);
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

function askRestart(app, T, root) {
  return new Promise((resolve) => new RestartModal(app, T, root, resolve).open());
}

module.exports = { askRestart };
