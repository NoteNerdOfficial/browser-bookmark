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
}

export interface BrowserBookmarkData {
	items: TreeNode[];
	settings: BrowserBookmarkSettings;
}

export const DEFAULT_SETTINGS: BrowserBookmarkSettings = {
	openIn: 'tab',
	interceptLinks: false,
};

export const DEFAULT_DATA: BrowserBookmarkData = {
	items: [],
	settings: DEFAULT_SETTINGS,
};

export const VIEW_TYPE_BROWSER_BOOKMARK = 'browser-bookmark-view';

export function generateId(): string {
	return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}
