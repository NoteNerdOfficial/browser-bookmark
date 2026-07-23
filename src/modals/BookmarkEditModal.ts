import { App, Modal, Notice, Setting, setIcon } from 'obsidian';
import type { BookmarkIconType } from '../types';

interface BookmarkEditResult {
	title: string;
	url: string;
	iconType?: BookmarkIconType;
	iconValue?: string;
}

export class BookmarkEditModal extends Modal {
	private title_: string;
	private url: string;
	private iconType: BookmarkIconType | 'auto';
	private iconValue: string;

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
		this.iconType = initial.iconType ?? 'auto';
		this.iconValue = initial.iconValue ?? '';
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

		let updateIconUi = () => {};
		new Setting(contentEl)
			.setName('Icon')
			.setDesc("Auto uses the site's favicon.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption('auto', 'Auto (favicon)')
					.addOption('lucide', 'Icon name')
					.addOption('image', 'Image URL')
					.setValue(this.iconType)
					.onChange((value) => {
						this.iconType = value as BookmarkIconType | 'auto';
						updateIconUi();
					})
			);

		let iconValueInputEl!: HTMLInputElement;
		const iconValueSetting = new Setting(contentEl).addText((text) => {
			text.setValue(this.iconValue).onChange((value) => {
				this.iconValue = value;
				updateIconUi();
			});
			iconValueInputEl = text.inputEl;
		});

		const previewEl = contentEl.createDiv({ cls: 'browser-bookmark-icon-preview' });

		updateIconUi = () => {
			const isAuto = this.iconType === 'auto';
			iconValueSetting.settingEl.toggleClass('browser-bookmark-hidden', isAuto);
			if (this.iconType === 'lucide') {
				iconValueSetting.setName('Icon name');
				iconValueInputEl.placeholder = 'e.g. star, bookmark, book-marked';
			} else if (this.iconType === 'image') {
				iconValueSetting.setName('Image URL');
				iconValueInputEl.placeholder = 'https://example.com/icon.png';
			}

			previewEl.empty();
			const value = this.iconValue.trim();
			if (isAuto || !value) return;
			if (this.iconType === 'lucide') {
				setIcon(previewEl, value);
			} else {
				const img = previewEl.createEl('img', { attr: { src: value } });
				img.addEventListener(
					'error',
					() => {
						img.remove();
						previewEl.setText('Could not load that image.');
					},
					{ once: true }
				);
			}
		};
		updateIconUi();

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
					const trimmedIconValue = this.iconValue.trim();
					const useCustomIcon = this.iconType !== 'auto' && Boolean(trimmedIconValue);
					this.onSubmit({
						title: trimmedTitle,
						url: trimmedUrl,
						iconType: useCustomIcon ? (this.iconType as BookmarkIconType) : undefined,
						iconValue: useCustomIcon ? trimmedIconValue : undefined,
					});
					this.close();
				})
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
