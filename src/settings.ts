import { App, PluginSettingTab, Setting, type SettingDefinitionItem } from 'obsidian';
import type BrowserBookmarkPlugin from './main';
import type { BrowserBookmarkSettings, PaneType } from './types';

export class BrowserBookmarkSettingTab extends PluginSettingTab {
	plugin: BrowserBookmarkPlugin;

	constructor(app: App, plugin: BrowserBookmarkPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/** Declarative settings (1.13.0+): gets these into Obsidian's settings search. */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'Open bookmarks in',
				desc: "Where clicking a bookmark opens Obsidian's web viewer.",
				control: {
					type: 'dropdown',
					key: 'openIn',
					options: { tab: 'New tab', split: 'Split pane', window: 'New window' },
				},
			},
			{
				name: 'Intercept external links in notes',
				desc: 'Open external links clicked in your notes with the web viewer instead of your system browser.',
				control: { type: 'toggle', key: 'interceptLinks' },
			},
			{
				name: 'Show favicons',
				desc:
					"Fetch each bookmark's real site icon from Google's favicon service. Turn off to always show a plain globe icon instead (no requests sent for your bookmarked domains).",
				control: { type: 'toggle', key: 'showFavicons' },
			},
			{
				name: 'Show ribbon icon',
				desc: 'Show a bookmark icon in the left ribbon to open the sidebar.',
				control: { type: 'toggle', key: 'showRibbonIcon' },
			},
		];
	}

	getControlValue(key: string): unknown {
		return this.plugin.store.settings[key as keyof BrowserBookmarkSettings];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await this.plugin.store.updateSettings({ [key]: value });
		if (key === 'showRibbonIcon') this.plugin.updateRibbonIcon();
	}

	/**
	 * Fallback for Obsidian versions older than 1.13.0 (this plugin supports
	 * back to 1.8.3, when the Web Viewer core plugin shipped). Not called at
	 * all once getSettingDefinitions() above is available.
	 */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Open bookmarks in')
			.setDesc('Where clicking a bookmark opens Obsidian\'s web viewer.')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('tab', 'New tab')
					.addOption('split', 'Split pane')
					.addOption('window', 'New window')
					.setValue(this.plugin.store.settings.openIn)
					.onChange(async (value) => {
						await this.plugin.store.updateSettings({ openIn: value as PaneType });
					})
			);

		new Setting(containerEl)
			.setName('Intercept external links in notes')
			.setDesc('Open external links clicked in your notes with the web viewer instead of your system browser.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.store.settings.interceptLinks).onChange(async (value) => {
					await this.plugin.store.updateSettings({ interceptLinks: value });
				})
			);

		new Setting(containerEl)
			.setName('Show favicons')
			.setDesc(
				"Fetch each bookmark's real site icon from Google's favicon service. Turn off to always show a plain globe icon instead (no requests sent for your bookmarked domains)."
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.store.settings.showFavicons).onChange(async (value) => {
					await this.plugin.store.updateSettings({ showFavicons: value });
				})
			);

		new Setting(containerEl)
			.setName('Show ribbon icon')
			.setDesc('Show a bookmark icon in the left ribbon to open the sidebar.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.store.settings.showRibbonIcon).onChange(async (value) => {
					await this.plugin.store.updateSettings({ showRibbonIcon: value });
					this.plugin.updateRibbonIcon();
				})
			);
	}
}
