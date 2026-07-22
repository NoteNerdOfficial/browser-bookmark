import type BrowserBookmarkPlugin from './main';
import {
	type TreeNode,
	type BrowserBookmarkData,
	type BrowserBookmarkSettings,
	DEFAULT_DATA,
	DEFAULT_SETTINGS,
	generateId,
} from './types';

export class BookmarkStore {
	private plugin: BrowserBookmarkPlugin;
	private data: BrowserBookmarkData;
	private listeners: Array<() => void> = [];

	constructor(plugin: BrowserBookmarkPlugin) {
		this.plugin = plugin;
		this.data = { items: [], settings: { ...DEFAULT_SETTINGS } };
	}

	async load(): Promise<void> {
		const saved = (await this.plugin.loadData()) as Partial<BrowserBookmarkData> | null;
		this.data = {
			items: saved?.items ?? DEFAULT_DATA.items,
			settings: { ...DEFAULT_SETTINGS, ...(saved?.settings ?? {}) },
		};
	}

	async save(): Promise<void> {
		await this.plugin.saveData(this.data);
	}

	onChange(listener: () => void): () => void {
		this.listeners.push(listener);
		return () => {
			this.listeners = this.listeners.filter((l) => l !== listener);
		};
	}

	private notify(): void {
		for (const listener of this.listeners) listener();
	}

	get settings(): BrowserBookmarkSettings {
		return this.data.settings;
	}

	async updateSettings(patch: Partial<BrowserBookmarkSettings>): Promise<void> {
		this.data.settings = { ...this.data.settings, ...patch };
		await this.save();
		this.notify();
	}

	get items(): TreeNode[] {
		return this.data.items;
	}

	children(parentId: string | null): TreeNode[] {
		return this.data.items
			.filter((item) => item.parentId === parentId)
			.sort((a, b) => a.order - b.order);
	}

	private nextOrder(parentId: string | null): number {
		const siblings = this.children(parentId);
		return siblings.length > 0 ? Math.max(...siblings.map((s) => s.order)) + 1 : 0;
	}

	async addBookmark(title: string, url: string, parentId: string | null = null): Promise<TreeNode> {
		const node: TreeNode = {
			id: generateId(),
			type: 'bookmark',
			title,
			url,
			parentId,
			order: this.nextOrder(parentId),
		};
		this.data.items.push(node);
		await this.save();
		this.notify();
		return node;
	}

	async addFolder(title: string, parentId: string | null = null): Promise<TreeNode> {
		const node: TreeNode = {
			id: generateId(),
			type: 'folder',
			title,
			parentId,
			order: this.nextOrder(parentId),
			collapsed: false,
		};
		this.data.items.push(node);
		await this.save();
		this.notify();
		return node;
	}

	/** Normalizes a URL for comparison: trims whitespace and a single trailing slash. */
	private static normalizeUrl(url: string): string {
		const trimmed = url.trim();
		return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
	}

	/** Finds an existing bookmark with the same URL, excluding `excludeId` (the one being edited). */
	findByUrl(url: string, excludeId?: string): TreeNode | undefined {
		const target = BookmarkStore.normalizeUrl(url);
		if (!target) return undefined;
		return this.data.items.find(
			(item) =>
				item.type === 'bookmark' &&
				item.id !== excludeId &&
				item.url !== undefined &&
				BookmarkStore.normalizeUrl(item.url) === target
		);
	}

	/**
	 * Appends a batch of already-fully-formed nodes (e.g. from a bookmark
	 * import) in one save+notify, instead of one per node -- an import can be
	 * hundreds of nodes, and addBookmark/addFolder each write the whole
	 * data.json to disk, which would otherwise thrash on a big import.
	 */
	async importNodes(nodes: TreeNode[]): Promise<void> {
		if (nodes.length === 0) return;
		this.data.items.push(...nodes);
		await this.save();
		this.notify();
	}

	async rename(id: string, title: string): Promise<void> {
		const node = this.data.items.find((i) => i.id === id);
		if (!node) return;
		node.title = title;
		await this.save();
		this.notify();
	}

	async updateBookmark(id: string, title: string, url: string): Promise<void> {
		const node = this.data.items.find((i) => i.id === id);
		if (!node) return;
		node.title = title;
		node.url = url;
		await this.save();
		this.notify();
	}

	async toggleCollapsed(id: string): Promise<void> {
		const node = this.data.items.find((i) => i.id === id);
		if (!node || node.type !== 'folder') return;
		node.collapsed = !node.collapsed;
		await this.save();
		this.notify();
	}

	/** Removes a node. If it's a folder, its descendants are removed too. */
	async remove(id: string): Promise<void> {
		const idsToRemove = new Set<string>([id]);
		let grew = true;
		while (grew) {
			grew = false;
			for (const item of this.data.items) {
				if (item.parentId && idsToRemove.has(item.parentId) && !idsToRemove.has(item.id)) {
					idsToRemove.add(item.id);
					grew = true;
				}
			}
		}
		this.data.items = this.data.items.filter((i) => !idsToRemove.has(i.id));
		await this.save();
		this.notify();
	}

	/** Returns true if `ancestorId` is `id` itself or one of its ancestors. */
	private isDescendantOf(id: string, ancestorId: string): boolean {
		let current = this.data.items.find((i) => i.id === id);
		while (current) {
			if (current.id === ancestorId) return true;
			current = current.parentId ? this.data.items.find((i) => i.id === current!.parentId) : undefined;
		}
		return false;
	}

	/**
	 * Moves `id` to be a child of `newParentId`, inserted at `index` among its
	 * new siblings. Reordering within the same parent is just a move to a new
	 * index there, so this single method covers both drag gestures.
	 */
	async moveInto(id: string, newParentId: string | null, index: number): Promise<void> {
		const node = this.data.items.find((i) => i.id === id);
		if (!node) return;
		// A folder can't be dropped into itself or one of its own descendants.
		if (newParentId && (newParentId === id || this.isDescendantOf(newParentId, id))) return;

		node.parentId = newParentId;
		const siblings = this.children(newParentId).filter((s) => s.id !== id);
		siblings.splice(Math.max(0, Math.min(index, siblings.length)), 0, node);
		siblings.forEach((s, i) => {
			s.order = i;
		});
		await this.save();
		this.notify();
	}
}
