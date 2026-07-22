import { App, Modal, Notice, Setting } from 'obsidian';
import type { ImportBatch } from '../import';

const PREVIEW_LIMIT = 12;

export class ImportPreviewModal extends Modal {
	private folderName: string;

	constructor(
		app: App,
		private batch: ImportBatch,
		defaultFolderName: string,
		private onConfirm: (folderName: string) => void
	) {
		super(app);
		this.folderName = defaultFolderName;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Import bookmarks' });

		const bookmarkLabel = `${this.batch.bookmarkCount} bookmark${this.batch.bookmarkCount === 1 ? '' : 's'}`;
		const folderLabel = `${this.batch.folderCount} folder${this.batch.folderCount === 1 ? '' : 's'}`;
		contentEl.createEl('p', { text: `Found ${bookmarkLabel} in ${folderLabel}.` });

		new Setting(contentEl)
			.setName('Import into new folder')
			.addText((text) =>
				text
					.setValue(this.folderName)
					.onChange((value) => (this.folderName = value))
			);

		const topLevel = this.batch.nodes.filter((n) => n.parentId === null);
		if (topLevel.length > 0) {
			contentEl.createEl('p', {
				text: 'Top-level items:',
				cls: 'browser-bookmark-import-preview-label',
			});
			const list = contentEl.createEl('ul', { cls: 'browser-bookmark-import-preview-list' });
			for (const node of topLevel.slice(0, PREVIEW_LIMIT)) {
				list.createEl('li', { text: node.title });
			}
			if (topLevel.length > PREVIEW_LIMIT) {
				list.createEl('li', {
					text: `…and ${topLevel.length - PREVIEW_LIMIT} more`,
					cls: 'browser-bookmark-import-preview-more',
				});
			}
		}

		new Setting(contentEl)
			.addButton((btn) => btn.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((btn) =>
				btn
					.setButtonText('Import')
					.setCta()
					.onClick(() => {
						const name = this.folderName.trim();
						if (!name) {
							new Notice('A folder name is required.');
							return;
						}
						this.onConfirm(name);
						this.close();
					})
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
