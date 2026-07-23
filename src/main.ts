import { Plugin, WorkspaceLeaf } from 'obsidian';
import { BookmarkStore } from './store';
import { BookmarkListView } from './views/BookmarkListView';
import { BrowserBookmarkSettingTab } from './settings';
import { BookmarkEditModal } from './modals/BookmarkEditModal';
import { VIEW_TYPE_BROWSER_BOOKMARK } from './types';
import { openBookmark, getActiveWebViewerPage } from './webviewer';

export default class BrowserBookmarkPlugin extends Plugin {
	store!: BookmarkStore;
	private ribbonIconEl: HTMLElement | null = null;

	async onload(): Promise<void> {
		this.store = new BookmarkStore(this);
		await this.store.load();

		this.registerView(VIEW_TYPE_BROWSER_BOOKMARK, (leaf) => new BookmarkListView(leaf, this));

		this.updateRibbonIcon();

		this.addCommand({
			id: 'open-sidebar',
			name: 'Open sidebar',
			callback: () => this.activateView(),
		});

		this.addCommand({
			id: 'bookmark-current-page',
			name: 'Bookmark current web viewer page',
			callback: () => this.bookmarkCurrentPage(),
		});

		this.addSettingTab(new BrowserBookmarkSettingTab(this.app, this));

		this.registerDomEvent(
			document,
			'click',
			(evt) => this.maybeInterceptLink(evt),
			{ capture: true }
		);
	}

	getActiveWebViewerPage() {
		return getActiveWebViewerPage(this.app);
	}

	/** Adds or removes the ribbon icon to match the current setting, live -- called on load and whenever the setting toggles. */
	updateRibbonIcon(): void {
		const shouldShow = this.store.settings.showRibbonIcon;
		if (shouldShow && !this.ribbonIconEl) {
			this.ribbonIconEl = this.addRibbonIcon('bookmark', 'Open browser bookmarks', () => this.activateView());
		} else if (!shouldShow && this.ribbonIconEl) {
			this.ribbonIconEl.remove();
			this.ribbonIconEl = null;
		}
	}

	/**
	 * Fires when a user explicitly toggles the plugin on -- not on every app
	 * startup, so this opens the sidebar exactly once as a "here's your new
	 * panel" default without fighting the user's own choice to close it on
	 * later restarts (Obsidian's normal workspace layout persistence handles
	 * that afterwards, same as any other panel).
	 */
	onUserEnable(): void {
		void this.activateView();
	}

	private bookmarkCurrentPage(): void {
		const active = getActiveWebViewerPage(this.app) ?? {};
		new BookmarkEditModal(
			this.app,
			'Bookmark current page',
			active,
			({ title, url, iconType, iconValue }) => {
				void this.store.addBookmark(title, url, null, iconType, iconValue);
			},
			(url) => this.store.findByUrl(url)?.title
		).open();
	}

	private maybeInterceptLink(evt: MouseEvent): void {
		if (!this.store.settings.interceptLinks) return;
		const target = evt.target as HTMLElement | null;
		const anchor = target?.closest('a.external-link') as HTMLAnchorElement | null;
		if (!anchor?.href) return;
		evt.preventDefault();
		evt.stopPropagation();
		void openBookmark(this.app, anchor.href, this.store.settings.openIn);
	}

	private async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_BROWSER_BOOKMARK)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: VIEW_TYPE_BROWSER_BOOKMARK, active: true });
		}
		if (leaf) await workspace.revealLeaf(leaf);
	}

	onunload(): void {
		// View instances clean up their own store subscription in onClose().
	}
}
