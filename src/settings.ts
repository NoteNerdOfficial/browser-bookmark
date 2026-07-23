import { App, PluginSettingTab, Setting } from 'obsidian';
import type BrowserBookmarkPlugin from './main';
import type { PaneType } from './types';

export class BrowserBookmarkSettingTab extends PluginSettingTab {
	plugin: BrowserBookmarkPlugin;

	constructor(app: App, plugin: BrowserBookmarkPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

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
