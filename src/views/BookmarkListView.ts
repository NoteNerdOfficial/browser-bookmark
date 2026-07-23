import { ItemView, Menu, Notice, WorkspaceLeaf, setIcon } from 'obsidian';
import type BrowserBookmarkPlugin from '../main';
import type { BookmarkStore } from '../store';
import type { TreeNode } from '../types';
import { VIEW_TYPE_BROWSER_BOOKMARK, PINNED_PARENT_ID } from '../types';
import { openBookmark } from '../webviewer';
import {
	parseNetscapeHtml,
	parseArcSidebarJson,
	finalizeImport,
	findArcSidebarFile,
	readArcSidebarFile,
	type ImportBatch,
} from '../import';
import { BookmarkEditModal } from '../modals/BookmarkEditModal';
import { FolderEditModal } from '../modals/FolderEditModal';
import { ImportPreviewModal } from '../modals/ImportPreviewModal';

type DropPosition = 'before' | 'after' | 'into';

/** A link dragged in from outside our own tree (e.g. a note), extracted from
 * whichever DataTransfer format is actually present. `getData` only returns
 * real values inside the `drop` event, so this must be called there, not
 * during `dragover`. */
function extractLinkFromDataTransfer(dt: DataTransfer | null): { title: string; url: string } | null {
	if (!dt) return null;
	const uriList = dt.getData('text/uri-list');
	const line = uriList
		.split('\n')
		.map((s) => s.trim())
		.find((s) => s && !s.startsWith('#'));
	if (line) return { title: line, url: line };

	const html = dt.getData('text/html');
	if (html) {
		const anchor = new DOMParser().parseFromString(html, 'text/html').querySelector('a[href]');
		const href = anchor?.getAttribute('href');
		if (href) return { title: anchor?.textContent?.trim() || href, url: href };
	}

	const text = dt.getData('text/plain').trim();
	if (text) {
		const markdownLink = text.match(/^\[([^\]]+)\]\((\S+)\)$/);
		if (markdownLink) return { title: markdownLink[1], url: markdownLink[2] };
		try {
			return { title: text, url: new URL(text).href };
		} catch {
			/* not a bare URL */
		}
	}
	return null;
}

/** Whether dragover data *looks* like it could be a link -- `getData` isn't
 * readable during dragover, only `types` is, so this is just used to decide
 * whether to show drop feedback and call `preventDefault`. */
function hasLinkData(dt: DataTransfer | null): boolean {
	if (!dt) return false;
	return dt.types.includes('text/uri-list') || dt.types.includes('text/html') || dt.types.includes('text/plain');
}

export class BookmarkListView extends ItemView {
	private store: BookmarkStore;
	private treeEl!: HTMLElement;
	private pinnedRowEl!: HTMLElement;
	private searchInputEl!: HTMLInputElement;
	private draggedId: string | null = null;
	private dropMarkedEl: HTMLElement | null = null;
	private unsubscribe: (() => void) | null = null;
	private searchActive = false;
	private searchQuery = '';
	private visibleOrder: string[] = [];
	private focusedId: string | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: BrowserBookmarkPlugin) {
		super(leaf);
		this.store = plugin.store;
	}

	getViewType(): string {
		return VIEW_TYPE_BROWSER_BOOKMARK;
	}

	getDisplayText(): string {
		return 'Browser bookmarks';
	}

	getIcon(): string {
		return 'bookmark';
	}

	async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass('browser-bookmark-view');

		const toolbar = container.createDiv({ cls: 'browser-bookmark-toolbar' });
		this.makeIconButton(toolbar, 'file-plus', 'New bookmark', () => this.createBookmark(null));
		this.makeIconButton(toolbar, 'folder-plus', 'New folder', () => this.createFolder(null));
		this.makeIconButton(toolbar, 'download', 'Import bookmarks', (evt) => this.openImportMenu(evt));
		this.makeIconButton(toolbar, 'search', 'Search', () => this.toggleSearch()).addClass(
			'browser-bookmark-search-toggle'
		);

		this.pinnedRowEl = container.createDiv({ cls: 'browser-bookmark-pinned-row' });
		this.registerPinnedRowDropZone();

		this.searchInputEl = container.createEl('input', {
			cls: 'browser-bookmark-search-input',
			attr: { type: 'text', placeholder: 'Search bookmarks…' },
		});
		this.searchInputEl.addEventListener('input', () => {
			this.searchQuery = this.searchInputEl.value;
			this.render();
		});
		this.searchInputEl.addEventListener('keydown', (evt) => {
			if (evt.key === 'Escape') {
				evt.preventDefault();
				this.toggleSearch(false);
			}
		});

		this.treeEl = container.createDiv({ cls: 'browser-bookmark-tree', attr: { tabindex: '0' } });
		this.registerRootDropZone(this.treeEl);
		this.treeEl.addEventListener('keydown', (evt) => this.handleKeydown(evt));

		this.unsubscribe = this.store.onChange(() => this.render());
		this.render();
	}

	private toggleSearch(forceOpen?: boolean): void {
		this.searchActive = forceOpen ?? !this.searchActive;
		this.searchInputEl.toggleClass('is-visible', this.searchActive);
		if (this.searchActive) {
			this.searchInputEl.focus();
		} else {
			this.searchInputEl.value = '';
			this.searchQuery = '';
			this.render();
		}
	}

	async onClose(): Promise<void> {
		this.unsubscribe?.();
	}

	private makeIconButton(
		parent: HTMLElement,
		icon: string,
		label: string,
		onClick: (evt: MouseEvent) => void
	): HTMLElement {
		const btn = parent.createDiv({ cls: 'browser-bookmark-icon-btn', attr: { 'aria-label': label } });
		setIcon(btn, icon);
		btn.addEventListener('click', onClick);
		return btn;
	}

	private matchesQuery(node: TreeNode, query: string): boolean {
		if (node.type === 'bookmark') {
			return node.title.toLowerCase().includes(query) || (node.url ?? '').toLowerCase().includes(query);
		}
		return this.store.children(node.id).some((child) => this.matchesQuery(child, query));
	}

	private render(): void {
		this.renderPinnedRow();
		this.treeEl.empty();
		this.visibleOrder = [];
		const query = this.searchQuery.trim().toLowerCase();
		const roots = this.store.children(null).filter((n) => !query || this.matchesQuery(n, query));
		if (roots.length === 0) {
			this.treeEl.createDiv({
				cls: 'browser-bookmark-empty',
				text: query ? 'No matches.' : 'No bookmarks yet.',
			});
			return;
		}
		for (const node of roots) this.renderNode(this.treeEl, node, 0, query);
	}

	private renderNode(parentEl: HTMLElement, node: TreeNode, depth: number, query: string): void {
		if (node.type === 'folder') this.renderFolder(parentEl, node, depth, query);
		else this.renderBookmark(parentEl, node, depth);
	}

	private renderRowShell(parentEl: HTMLElement, node: TreeNode, depth: number, extraCls = ''): HTMLElement {
		const row = parentEl.createDiv({
			cls: `browser-bookmark-row ${extraCls}`.trim(),
			attr: { 'data-node-id': node.id, style: `padding-left: ${8 + depth * 16}px` },
		});
		const grip = row.createDiv({ cls: 'browser-bookmark-grip', attr: { draggable: 'true' } });
		setIcon(grip, 'grip-vertical');
		this.wireDrag(row, grip, node);

		this.visibleOrder.push(node.id);
		if (node.id === this.focusedId) row.addClass('is-focused');
		row.addEventListener('mousedown', (evt) => {
			if ((evt.target as HTMLElement).tagName === 'INPUT') return;
			this.setFocus(node.id);
		});
		return row;
	}

	private renderFolder(parentEl: HTMLElement, node: TreeNode, depth: number, query: string): void {
		const wrapper = parentEl.createDiv({ cls: 'browser-bookmark-folder' });
		const row = this.renderRowShell(wrapper, node, depth, 'browser-bookmark-group-header');

		// A folder that matched a search only because a descendant matched is
		// force-expanded to show the path to that match -- collapsed state is
		// still preserved underneath and resumes once the search is cleared.
		const expanded = query ? true : !node.collapsed;
		const chevron = row.createDiv({ cls: 'browser-bookmark-chevron' });
		setIcon(chevron, expanded ? 'chevron-down' : 'chevron-right');

		const title = row.createSpan({ cls: 'browser-bookmark-title browser-bookmark-folder-title' });
		title.setText(node.title);
		this.wireRename(title, node);

		this.wireRowClick(row, () => {
			if (!query) void this.store.toggleCollapsed(node.id);
		});
		row.addEventListener('contextmenu', (evt) => {
			evt.preventDefault();
			this.showFolderMenu(node, evt);
		});

		if (expanded) {
			const childWrap = wrapper.createDiv({ cls: 'browser-bookmark-group-children' });
			const children = this.store
				.children(node.id)
				.filter((child) => !query || this.matchesQuery(child, query));
			for (const child of children) this.renderNode(childWrap, child, depth + 1, query);
		}
	}

	private renderBookmark(parentEl: HTMLElement, node: TreeNode, depth: number): void {
		const row = this.renderRowShell(parentEl, node, depth, 'browser-bookmark-link-row');

		this.renderFavicon(row, node);

		const title = row.createSpan({ cls: 'browser-bookmark-title' });
		title.setText(node.title);
		this.wireRename(title, node);

		this.wireRowClick(row, () => void openBookmark(this.app, node.url ?? '', this.store.settings.openIn));
		row.addEventListener('contextmenu', (evt) => {
			evt.preventDefault();
			this.showBookmarkMenu(node, evt);
		});
	}

	/**
	 * Shows, in order: a custom Lucide icon or custom image (set via the edit
	 * modal), then the site's real favicon, then a generic globe icon as the
	 * final fallback on any failure.
	 */
	private renderFavicon(row: HTMLElement, node: TreeNode): void {
		const box = row.createDiv({ cls: 'browser-bookmark-favicon' });

		if (node.iconType === 'lucide' && node.iconValue) {
			setIcon(box, node.iconValue);
			return;
		}
		if (node.iconType === 'image' && node.iconValue) {
			const img = box.createEl('img', { cls: 'browser-bookmark-favicon-img', attr: { src: node.iconValue } });
			img.addEventListener(
				'error',
				() => {
					img.remove();
					setIcon(box, 'globe');
				},
				{ once: true }
			);
			return;
		}

		const domain = this.store.settings.showFavicons ? this.extractDomain(node.url) : null;
		if (!domain) {
			setIcon(box, 'globe');
			return;
		}
		const img = box.createEl('img', {
			cls: 'browser-bookmark-favicon-img',
			attr: { src: `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}` },
		});
		img.addEventListener(
			'error',
			() => {
				img.remove();
				setIcon(box, 'globe');
			},
			{ once: true }
		);
	}

	private extractDomain(url: string | undefined): string | null {
		if (!url) return null;
		try {
			return new URL(url).hostname;
		} catch {
			return null;
		}
	}

	// ── Pinned row ───────────────────────────────────────────

	/** Hidden entirely when nothing's pinned -- no placeholder/drop-hint box. The first pin always comes from a bookmark's context menu, never a drag onto empty space, since there's nothing visible to drag onto yet. */
	private renderPinnedRow(): void {
		const pinned = this.store.pinned;
		this.pinnedRowEl.empty();
		this.pinnedRowEl.toggleClass('is-visible', pinned.length > 0);
		for (const node of pinned) this.renderPinnedButton(node);
	}

	private renderPinnedButton(node: TreeNode): void {
		const btn = this.pinnedRowEl.createDiv({
			cls: 'browser-bookmark-pinned-btn',
			attr: { draggable: 'true', title: node.title, 'data-node-id': node.id },
		});
		this.renderFavicon(btn, node);
		btn.addEventListener('click', () => void openBookmark(this.app, node.url ?? '', this.store.settings.openIn));
		btn.addEventListener('contextmenu', (evt) => {
			evt.preventDefault();
			this.showBookmarkMenu(node, evt);
		});
		this.wirePinnedDrag(btn, node);
	}

	// ── Keyboard navigation ──────────────────────────────────

	private setFocus(id: string): void {
		const prevId = this.focusedId;
		this.focusedId = id;
		if (prevId) this.treeEl.querySelector<HTMLElement>(`[data-node-id="${prevId}"]`)?.removeClass('is-focused');
		const el = this.treeEl.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
		el?.addClass('is-focused');
		el?.scrollIntoView({ block: 'nearest' });
		this.treeEl.focus();
	}

	private moveFocus(delta: number): void {
		if (this.visibleOrder.length === 0) return;
		const currentIndex = this.focusedId ? this.visibleOrder.indexOf(this.focusedId) : -1;
		const nextIndex = Math.max(0, Math.min(this.visibleOrder.length - 1, currentIndex + delta));
		const nextId = this.visibleOrder[nextIndex];
		if (nextId) this.setFocus(nextId);
	}

	private handleKeydown(evt: KeyboardEvent): void {
		if (!this.focusedId) {
			if (evt.key === 'ArrowDown' || evt.key === 'ArrowUp') {
				evt.preventDefault();
				this.moveFocus(evt.key === 'ArrowDown' ? 1 : -1);
			}
			return;
		}
		const node = this.store.items.find((i) => i.id === this.focusedId);
		if (!node) return;

		switch (evt.key) {
			case 'ArrowDown':
				evt.preventDefault();
				this.moveFocus(1);
				break;
			case 'ArrowUp':
				evt.preventDefault();
				this.moveFocus(-1);
				break;
			case 'ArrowRight':
				evt.preventDefault();
				if (node.type === 'folder') {
					if (node.collapsed) void this.store.toggleCollapsed(node.id);
					else this.moveFocus(1);
				}
				break;
			case 'ArrowLeft':
				evt.preventDefault();
				if (node.type === 'folder' && !node.collapsed) void this.store.toggleCollapsed(node.id);
				else if (node.parentId) this.setFocus(node.parentId);
				break;
			case 'Enter':
				evt.preventDefault();
				if (node.type === 'folder') void this.store.toggleCollapsed(node.id);
				else void openBookmark(this.app, node.url ?? '', this.store.settings.openIn);
				break;
			case 'F2': {
				evt.preventDefault();
				const titleEl = this.treeEl.querySelector<HTMLElement>(
					`[data-node-id="${node.id}"] .browser-bookmark-title`
				);
				if (titleEl) this.startRename(titleEl, node);
				break;
			}
			case 'Delete':
			case 'Backspace':
				evt.preventDefault();
				void this.store.remove(node.id);
				break;
		}
	}

	/**
	 * A plain 'click' listener would also fire (twice) on the way to a
	 * double-click, which both re-triggers `action` and races the rename
	 * input swapped in by `wireRename`'s dblclick handler. Delaying the
	 * action lets a following second click cancel it, so double-clicking
	 * the title renames instead of opening/toggling twice first.
	 */
	private wireRowClick(row: HTMLElement, action: () => void): void {
		let pending: number | null = null;
		row.addEventListener('click', () => {
			if (pending !== null) {
				window.clearTimeout(pending);
				pending = null;
				return;
			}
			pending = window.setTimeout(() => {
				pending = null;
				action();
			}, 250);
		});
	}

	// ── Inline rename ────────────────────────────────────────

	private wireRename(title: HTMLElement, node: TreeNode): void {
		title.addEventListener('dblclick', (evt) => {
			evt.stopPropagation();
			this.startRename(title, node);
		});
	}

	private startRename(title: HTMLElement, node: TreeNode): void {
		const parent = title.parentElement as HTMLElement;
		const input = parent.createEl('input', { cls: 'browser-bookmark-rename-input' });
		input.type = 'text';
		input.value = node.title;
		parent.insertBefore(input, title);
		title.remove();
		input.focus();
		input.select();

		const finish = async (commit: boolean) => {
			input.removeEventListener('blur', onBlur);
			input.removeEventListener('keydown', onKeydown);
			const value = input.value.trim();
			if (commit && value && value !== node.title) {
				await this.store.rename(node.id, value);
			} else {
				input.replaceWith(title);
			}
		};
		const onBlur = () => void finish(true);
		const onKeydown = (evt: KeyboardEvent) => {
			if (evt.key === 'Enter') {
				evt.preventDefault();
				void finish(true);
			} else if (evt.key === 'Escape') {
				evt.preventDefault();
				void finish(false);
			}
		};
		input.addEventListener('blur', onBlur);
		input.addEventListener('keydown', onKeydown);
	}

	// ── Context menus ────────────────────────────────────────

	private showBookmarkMenu(node: TreeNode, evt: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((item) =>
			item.setTitle('Open').setIcon('external-link').onClick(() => {
				void openBookmark(this.app, node.url ?? '', this.store.settings.openIn);
			})
		);
		menu.addItem((item) =>
			item.setTitle('Open in new split').setIcon('separator-vertical').onClick(() => {
				void openBookmark(this.app, node.url ?? '', 'split');
			})
		);
		menu.addItem((item) =>
			item.setTitle('Open in new window').setIcon('picture-in-picture-2').onClick(() => {
				void openBookmark(this.app, node.url ?? '', 'window');
			})
		);
		menu.addSeparator();
		if (node.parentId === PINNED_PARENT_ID) {
			menu.addItem((item) =>
				item.setTitle('Unpin').setIcon('pin-off').onClick(() => void this.store.unpin(node.id))
			);
		} else {
			menu.addItem((item) =>
				item.setTitle('Pin to top').setIcon('pin').onClick(() => void this.store.pin(node.id))
			);
		}
		menu.addSeparator();
		menu.addItem((item) =>
			item.setTitle('Edit').setIcon('pencil').onClick(() => {
				new BookmarkEditModal(
					this.app,
					'Edit bookmark',
					node,
					({ title, url, iconType, iconValue }) => {
						void this.store.updateBookmark(node.id, title, url, iconType, iconValue);
					},
					(url) => this.store.findByUrl(url, node.id)?.title
				).open();
			})
		);
		menu.addItem((item) =>
			item.setTitle('Delete').setIcon('trash').onClick(() => {
				void this.store.remove(node.id);
			})
		);
		menu.showAtMouseEvent(evt);
	}

	private showFolderMenu(node: TreeNode, evt: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((item) =>
			item.setTitle('New bookmark here').setIcon('file-plus').onClick(() => this.createBookmark(node.id))
		);
		menu.addItem((item) =>
			item.setTitle('New subfolder here').setIcon('folder-plus').onClick(() => this.createFolder(node.id))
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item.setTitle('Rename').setIcon('pencil').onClick(() => {
				new FolderEditModal(this.app, 'Rename folder', node.title, (name) => {
					void this.store.rename(node.id, name);
				}).open();
			})
		);
		menu.addItem((item) =>
			item.setTitle('Delete').setIcon('trash').onClick(() => {
				void this.store.remove(node.id);
			})
		);
		menu.showAtMouseEvent(evt);
	}

	// ── Create ───────────────────────────────────────────────

	private createBookmark(parentId: string | null): void {
		const active = this.plugin.getActiveWebViewerPage();
		new BookmarkEditModal(
			this.app,
			'New bookmark',
			active ?? {},
			({ title, url, iconType, iconValue }) => {
				void this.store.addBookmark(title, url, parentId, iconType, iconValue);
			},
			(url) => this.store.findByUrl(url)?.title
		).open();
	}

	private createFolder(parentId: string | null): void {
		new FolderEditModal(this.app, 'New folder', '', (name) => {
			void this.store.addFolder(name, parentId);
		}).open();
	}

	// ── Import ───────────────────────────────────────────────

	private openImportMenu(evt: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle('Import from browser (HTML file)')
				.setIcon('file-up')
				.onClick(() => this.pickImportFile('html'))
		);
		menu.addItem((item) =>
			item.setTitle('Import from Arc').setIcon('file-up').onClick(() => this.pickImportFile('arc'))
		);
		menu.showAtMouseEvent(evt);
	}

	/**
	 * Stays synchronous end-to-end: `findArcSidebarFile` and its fallback to
	 * `pickFileManually` (which opens the native file picker) both need to run
	 * in the exact same tick as the click that invoked this, or the fallback
	 * gets rejected as not coming from a real user gesture.
	 */
	private pickImportFile(kind: 'html' | 'arc'): void {
		if (kind === 'arc') {
			const path = findArcSidebarFile();
			if (path) {
				void this.importArcFromPath(path);
				return;
			}
			new Notice("Couldn't find Arc's data file automatically -- pick it manually.");
		}
		this.pickFileManually(kind);
	}

	private pickFileManually(kind: 'html' | 'arc'): void {
		const input = createEl('input', {
			attr: { type: 'file', accept: kind === 'html' ? '.html,.htm' : '.json' },
		});
		input.hide();
		document.body.appendChild(input);
		input.addEventListener('change', () => {
			const file = input.files?.[0];
			document.body.removeChild(input);
			if (file) void this.handleImportFile(kind, file);
		});
		input.click();
	}

	private async importArcFromPath(path: string): Promise<void> {
		try {
			await this.processImportText('arc', await readArcSidebarFile(path));
		} catch (err) {
			console.error('Browser Bookmark: Arc import failed', err);
			new Notice("Could not read Arc's data file -- see the developer console for details.");
		}
	}

	private async handleImportFile(kind: 'html' | 'arc', file: File): Promise<void> {
		try {
			await this.processImportText(kind, await file.text());
		} catch (err) {
			console.error('Browser Bookmark: import failed', err);
			new Notice('Could not import that file -- see the developer console for details.');
		}
	}

	private async processImportText(kind: 'html' | 'arc', text: string): Promise<void> {
		const batch = kind === 'html' ? parseNetscapeHtml(text) : parseArcSidebarJson(text);
		if (batch.nodes.length === 0) {
			new Notice('No bookmarks found in that file.');
			return;
		}
		const dateLabel = new Date().toLocaleDateString();
		const defaultTitle = kind === 'html' ? `Imported bookmarks (${dateLabel})` : `Imported from Arc (${dateLabel})`;
		new ImportPreviewModal(this.app, batch, defaultTitle, (folderName) => {
			void this.commitImport(batch, folderName);
		}).open();
	}

	private async commitImport(batch: ImportBatch, folderName: string): Promise<void> {
		await this.store.importNodes(finalizeImport(batch, folderName));
		new Notice(
			`Imported ${batch.bookmarkCount} bookmark${batch.bookmarkCount === 1 ? '' : 's'} and ` +
				`${batch.folderCount} folder${batch.folderCount === 1 ? '' : 's'}.`
		);
	}

	// ── Drag and drop ────────────────────────────────────────

	private wireDrag(row: HTMLElement, grip: HTMLElement, node: TreeNode): void {
		grip.addEventListener('dragstart', (evt) => {
			this.draggedId = node.id;
			row.addClass('browser-bookmark-dragging');
			evt.dataTransfer?.setData('text/plain', node.id);
			evt.dataTransfer!.effectAllowed = 'move';
		});
		grip.addEventListener('dragend', () => {
			row.removeClass('browser-bookmark-dragging');
			this.clearDropMarker();
			this.draggedId = null;
		});

		row.addEventListener('dragover', (evt) => {
			if (this.draggedId) {
				if (this.draggedId === node.id) return;
				evt.preventDefault();
				this.markDropTarget(row, this.computeDropPosition(row, node, evt));
				return;
			}
			if (hasLinkData(evt.dataTransfer)) {
				evt.preventDefault();
				this.markDropTarget(row, node.type === 'folder' ? 'into' : 'after');
			}
		});
		row.addEventListener('dragleave', () => this.clearDropMarker());
		row.addEventListener('drop', (evt) => {
			if (this.draggedId) {
				if (this.draggedId === node.id) return;
				evt.preventDefault();
				void this.handleDrop(this.draggedId, node, this.computeDropPosition(row, node, evt));
				this.clearDropMarker();
				return;
			}
			const link = extractLinkFromDataTransfer(evt.dataTransfer);
			if (link) {
				evt.preventDefault();
				const parentId = node.type === 'folder' ? node.id : node.parentId;
				void this.store.addBookmark(link.title, link.url, parentId);
			}
			this.clearDropMarker();
		});
	}

	private computeDropPosition(row: HTMLElement, node: TreeNode, evt: DragEvent): DropPosition {
		const rect = row.getBoundingClientRect();
		const fraction = (evt.clientY - rect.top) / rect.height;
		if (node.type === 'folder' && fraction > 0.25 && fraction < 0.75) return 'into';
		return fraction < 0.5 ? 'before' : 'after';
	}

	private markDropTarget(row: HTMLElement, position: DropPosition): void {
		if (this.dropMarkedEl && this.dropMarkedEl !== row) this.clearDropMarker();
		row.removeClass('browser-bookmark-drop-before', 'browser-bookmark-drop-after', 'browser-bookmark-drop-into');
		row.addClass(`browser-bookmark-drop-${position}`);
		this.dropMarkedEl = row;
	}

	private clearDropMarker(): void {
		this.dropMarkedEl?.removeClass(
			'browser-bookmark-drop-before',
			'browser-bookmark-drop-after',
			'browser-bookmark-drop-into'
		);
		this.dropMarkedEl = null;
	}

	private registerRootDropZone(treeEl: HTMLElement): void {
		treeEl.addEventListener('dragover', (evt) => {
			if (evt.target !== treeEl) return;
			if (this.draggedId || hasLinkData(evt.dataTransfer)) evt.preventDefault();
		});
		treeEl.addEventListener('drop', (evt) => {
			if (evt.target !== treeEl) return;
			if (this.draggedId) {
				evt.preventDefault();
				const index = this.store.children(null).filter((n) => n.id !== this.draggedId).length;
				void this.store.moveInto(this.draggedId, null, index);
				return;
			}
			const link = extractLinkFromDataTransfer(evt.dataTransfer);
			if (link) {
				evt.preventDefault();
				void this.store.addBookmark(link.title, link.url, null);
			}
		});
	}

	/**
	 * Pinned buttons sit in a horizontal, wrapping row, so reordering compares
	 * cursor X against the button's left/right halves instead of the tree
	 * rows' top/bottom split. No grip handle here -- the whole button is the
	 * drag source, which is fine for a small icon-only target since a native
	 * click and a native drag-start are already mutually exclusive gestures
	 * (the tree rows need the separate grip specifically because their click
	 * target is mostly title text, where that ambiguity actually bites).
	 */
	private wirePinnedDrag(btn: HTMLElement, node: TreeNode): void {
		btn.addEventListener('dragstart', (evt) => {
			this.draggedId = node.id;
			btn.addClass('browser-bookmark-dragging');
			evt.dataTransfer?.setData('text/plain', node.id);
			evt.dataTransfer!.effectAllowed = 'move';
		});
		btn.addEventListener('dragend', () => {
			btn.removeClass('browser-bookmark-dragging');
			this.clearDropMarker();
			this.draggedId = null;
		});
		btn.addEventListener('dragover', (evt) => {
			if (!this.draggedId || this.draggedId === node.id) return;
			if (this.store.items.find((i) => i.id === this.draggedId)?.type !== 'bookmark') return;
			evt.preventDefault();
			this.markDropTarget(btn, this.computeHorizontalDropPosition(btn, evt));
		});
		btn.addEventListener('dragleave', () => this.clearDropMarker());
		btn.addEventListener('drop', (evt) => {
			if (!this.draggedId || this.draggedId === node.id) return;
			evt.preventDefault();
			void this.handlePinnedDrop(this.draggedId, node, this.computeHorizontalDropPosition(btn, evt));
			this.clearDropMarker();
		});
	}

	private computeHorizontalDropPosition(el: HTMLElement, evt: DragEvent): 'before' | 'after' {
		const rect = el.getBoundingClientRect();
		return evt.clientX - rect.left < rect.width / 2 ? 'before' : 'after';
	}

	private async handlePinnedDrop(draggedId: string, target: TreeNode, position: 'before' | 'after'): Promise<void> {
		const draggedNode = this.store.items.find((i) => i.id === draggedId);
		if (draggedNode?.type !== 'bookmark') return;
		const siblings = this.store.pinned.filter((n) => n.id !== draggedId);
		let index = siblings.findIndex((n) => n.id === target.id);
		if (index === -1) index = siblings.length;
		if (position === 'after') index += 1;
		await this.store.moveInto(draggedId, PINNED_PARENT_ID, index);
	}

	private registerPinnedRowDropZone(): void {
		this.pinnedRowEl.addEventListener('dragover', (evt) => {
			if (evt.target !== this.pinnedRowEl || !this.draggedId) return;
			if (this.store.items.find((i) => i.id === this.draggedId)?.type !== 'bookmark') return;
			evt.preventDefault();
		});
		this.pinnedRowEl.addEventListener('drop', (evt) => {
			if (evt.target !== this.pinnedRowEl || !this.draggedId) return;
			const node = this.store.items.find((i) => i.id === this.draggedId);
			if (node?.type !== 'bookmark') return;
			evt.preventDefault();
			void this.store.moveInto(this.draggedId, PINNED_PARENT_ID, this.store.pinned.length);
		});
	}

	private async handleDrop(draggedId: string, target: TreeNode, position: DropPosition): Promise<void> {
		if (position === 'into') {
			const index = this.store.children(target.id).filter((n) => n.id !== draggedId).length;
			await this.store.moveInto(draggedId, target.id, index);
			return;
		}
		const siblings = this.store.children(target.parentId).filter((n) => n.id !== draggedId);
		let index = siblings.findIndex((n) => n.id === target.id);
		if (index === -1) index = siblings.length;
		if (position === 'after') index += 1;
		await this.store.moveInto(draggedId, target.parentId, index);
	}
}
