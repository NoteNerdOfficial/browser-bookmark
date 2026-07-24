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
 * Once Web Viewer is enabled, Obsidian appears to intercept `window.open()`
 * itself and redirect it into a Web Viewer tab rather than letting it reach
 * the OS -- confirmed by testing, not just theory: a plain `window.open`
 * kept landing in Web Viewer even when the intent was explicitly to escape
 * it. `shell.openExternal()` asks the OS directly to open the URL, bypassing
 * that interception entirely, since it isn't a window-open event at all.
 * Not available on mobile (no Electron there), where `window.open` is the
 * only option and isn't subject to this interception anyway.
 *
 * Loads `electron` via `require`, not a dynamic `import()`: confirmed by
 * testing in the real app that a dynamic import of a bare specifier like
 * `'electron'` fails outright in Obsidian's renderer with "TypeError: Failed
 * to resolve module specifier" -- `require` is the only thing that actually
 * works here, same lesson as the Node fs/os/path loading in `import.ts`.
 */
async function openExternally(url: string): Promise<void> {
	if (Platform.isDesktop) {
		try {
			/* eslint-disable no-undef, @typescript-eslint/no-require-imports --
			   require() is the only thing that actually loads 'electron' at runtime here; see the doc comment above. */
			const electron = require('electron') as typeof import('electron');
			/* eslint-enable no-undef, @typescript-eslint/no-require-imports -- end of the require() line above */
			await electron.shell.openExternal(url);
			return;
		} catch (err) {
			console.error('Browser Bookmark: shell.openExternal threw, falling back to window.open', err);
		}
	}
	window.open(url, '_blank');
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
	await openExternally(url);
}

/**
 * Forces a URL open in the system browser, bypassing Web Viewer even when
 * it's available. Some sites (e.g. corporate SSO/VPN-gated intranet pages)
 * don't work well in an embedded webview regardless of settings, so this
 * gives an explicit escape hatch alongside the automatic fallback above.
 */
export async function openInSystemBrowser(url: string): Promise<void> {
	await openExternally(url);
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
