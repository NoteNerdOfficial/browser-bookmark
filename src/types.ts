export type NodeType = 'bookmark' | 'folder';

export interface TreeNode {
	id: string;
	type: NodeType;
	title: string;
	/** Bookmarks only. */
	url?: string;
	/** null means root level. */
	parentId: string | null;
	order: number;
	/** Folders only. */
	collapsed?: boolean;
}

export type PaneType = 'tab' | 'split' | 'window';

export interface BrowserBookmarkSettings {
	openIn: PaneType;
	interceptLinks: boolean;
	showFavicons: boolean;
	showRibbonIcon: boolean;
}

export interface BrowserBookmarkData {
	items: TreeNode[];
	settings: BrowserBookmarkSettings;
}

export const DEFAULT_SETTINGS: BrowserBookmarkSettings = {
	openIn: 'tab',
	interceptLinks: false,
	showFavicons: true,
	showRibbonIcon: true,
};

export const DEFAULT_DATA: BrowserBookmarkData = {
	items: [],
	settings: DEFAULT_SETTINGS,
};

export const VIEW_TYPE_BROWSER_BOOKMARK = 'browser-bookmark-view';

/**
 * A reserved `parentId` value meaning "pinned row" rather than a real
 * folder. Reusing the existing parentId/order machinery for this (instead
 * of a separate pinned-ids list) means pinning is just a move -- rename,
 * delete, drag-to-reorder, and drag-between-locations all already work on
 * pinned bookmarks with no special-casing, since they're still just regular
 * TreeNodes. Never collides with a real folder id since `generateId()` only
 * ever produces base36 timestamp+random strings, never this exact literal.
 */
export const PINNED_PARENT_ID = '__pinned__';

export function generateId(): string {
	return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}
