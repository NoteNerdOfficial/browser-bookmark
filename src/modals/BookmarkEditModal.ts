import { App, Modal, Notice, Setting } from 'obsidian';

interface BookmarkEditResult {
	title: string;
	url: string;
}

export class BookmarkEditModal extends Modal {
	private title_: string;
	private url: string;

	constructor(
		app: App,
		private heading: string,
		initial: Partial<BookmarkEditResult>,
		private onSubmit: (result: BookmarkEditResult) => void,
		/** Returns the title of an existing bookmark with this URL, if any. */
		private findDuplicateTitle?: (url: string) => string | undefined
	) {
		super(app);
		this.title_ = initial.title ?? '';
		this.url = initial.url ?? '';
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: this.heading });

		new Setting(contentEl)
			.setName('Title')
			.addText((text) =>
				text
					.setPlaceholder('My bookmark')
					.setValue(this.title_)
					.onChange((value) => (this.title_ = value))
			);

		let updateWarning = () => {};
		new Setting(contentEl)
			.setName('URL')
			.addText((text) =>
				text
					.setPlaceholder('https://example.com')
					.setValue(this.url)
					.onChange((value) => {
						this.url = value;
						updateWarning();
					})
			);

		const warningEl = contentEl.createDiv({ cls: 'browser-bookmark-modal-warning' });
		updateWarning = () => {
			const existing = this.findDuplicateTitle?.(this.url.trim());
			warningEl.setText(existing ? `Already bookmarked as "${existing}".` : '');
			warningEl.toggleClass('is-visible', Boolean(existing));
		};
		updateWarning();

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText('Save')
				.setCta()
				.onClick(() => {
					const trimmedUrl = this.url.trim();
					if (!trimmedUrl) {
						new Notice('A URL is required.');
						return;
					}
					const trimmedTitle = this.title_.trim() || trimmedUrl;
					this.onSubmit({ title: trimmedTitle, url: trimmedUrl });
					this.close();
				})
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
