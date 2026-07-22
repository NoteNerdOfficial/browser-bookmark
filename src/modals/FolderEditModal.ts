import { App, Modal, Notice, Setting } from 'obsidian';

export class FolderEditModal extends Modal {
	private name: string;

	constructor(
		app: App,
		private heading: string,
		initialName: string,
		private onSubmit: (name: string) => void
	) {
		super(app);
		this.name = initialName;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: this.heading });

		new Setting(contentEl)
			.setName('Folder name')
			.addText((text) => {
				text
					.setPlaceholder('New folder')
					.setValue(this.name)
					.onChange((value) => (this.name = value));
				text.inputEl.focus();
			});

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText('Save')
				.setCta()
				.onClick(() => {
					const trimmed = this.name.trim();
					if (!trimmed) {
						new Notice('A folder name is required.');
						return;
					}
					this.onSubmit(trimmed);
					this.close();
				})
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
