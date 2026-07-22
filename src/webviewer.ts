import { Platform, type App } from 'obsidian';
import type { PaneType } from './types';

interface InternalPluginsWithWebViewer {
	plugins?: {
		webviewer?: { enabled?: boolean };
	};
}

function isWebViewerAvailable(app: App): boolean {
	if (Platform.isMobile) return false;
	const internalPlugins = (app as unknown as { internalPlugins?: InternalPluginsWithWebViewer })
		.internalPlugins;
	return internalPlugins?.plugins?.webviewer?.enabled === true;
}

/**
 * Opens a URL in Obsidian's built-in Web Viewer core plugin when it's
 * enabled, falling back to the system browser otherwise (core plugin off,
 * unavailable on this Obsidian version, or on mobile where Web Viewer
 * doesn't exist yet). The Web Viewer leaf type/state shape is undocumented
 * -- there's no public API for this yet -- so this is intentionally
 * defensive and never throws if the shape changes underneath us.
 */
export async function openBookmark(app: App, url: string, paneType: PaneType): Promise<void> {
	if (isWebViewerAvailable(app)) {
		try {
			const leaf = app.workspace.getLeaf(paneType);
			await leaf.setViewState({
				type: 'webviewer',
				state: { url, navigate: true },
				active: true,
			});
			await app.workspace.revealLeaf(leaf);
			return;
		} catch {
			// Fall through to the external-browser fallback below.
		}
	}
	window.open(url, '_blank');
}

/**
 * If the currently active leaf is a Web Viewer tab, returns its url/title so
 * callers can prefill a "bookmark this page" form. Returns null otherwise.
 */
export function getActiveWebViewerPage(app: App): { url: string; title: string } | null {
	const leaf = app.workspace.getMostRecentLeaf();
	if (!leaf) return null;
	const state = leaf.getViewState();
	if (state.type !== 'webviewer') return null;
	const url = (state.state as { url?: string } | undefined)?.url;
	if (!url) return null;
	return { url, title: leaf.getDisplayText() || url };
}
