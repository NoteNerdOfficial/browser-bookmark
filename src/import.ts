import { Platform } from 'obsidian';
import { generateId, type TreeNode } from './types';

/**
 * Node's fs/os/path don't exist on mobile, so this is gated on
 * `Platform.isDesktop` by every caller before it ever runs. Kept synchronous
 * specifically because `findArcSidebarFile` needs it to be: its caller's
 * manual file-picker fallback (`input.click()`) is only allowed to open
 * without an explicit user gesture in the same synchronous tick as the
 * originating click, and an `await` (which a dynamic `import()` introduces)
 * loses that, so the fallback fails with "File chooser dialog can only be
 * shown with a user activation." `require` is the only way to get these
 * synchronously; the project's `obsidianmd/no-nodejs-modules` rule still
 * (correctly) flags that as a warning since it's real Node-only code, which
 * is why `Platform.isDesktop` is checked before this is ever called.
 * `readArcSidebarFile` below has no such constraint (nothing after it needs
 * a preserved gesture), so it uses a plain async dynamic `import()` instead.
 */
function loadNodeFsModulesSync(): {
	fs: typeof import('fs');
	os: typeof import('os');
	path: typeof import('path');
} {
	/* eslint-disable no-undef, @typescript-eslint/no-require-imports --
	   require() (not a static import) is the only way to keep this synchronous so the file-picker fallback
	   keeps the user gesture that triggered it; see the doc comment above. Each is cast to its real type
	   right here so nothing downstream (including the return below) is left typed as `any`. */
	const fs = require('fs') as typeof import('fs');
	const os = require('os') as typeof import('os');
	const path = require('path') as typeof import('path');
	/* eslint-enable no-undef, @typescript-eslint/no-require-imports -- end of the require() block above */
	return { fs, os, path };
}

/**
 * Looks for Arc's `StorableSidebar.json` at its standard per-OS location and
 * reads it directly, so importing doesn't require the user to hunt for it
 * through a native file picker -- it lives under `~/Library/Application
 * Support/Arc/` on macOS, which Finder-style Open dialogs hide by default
 * (that folder isn't a dotfile, it's flagged hidden at the OS level), which
 * is exactly the friction this sidesteps. Returns null if Arc isn't
 * installed in the usual place (or we're on mobile); callers should fall
 * back to a manual file picker rather than error out, since this is an
 * observed convention, not a documented guarantee.
 */
export function findArcSidebarFile(): string | null {
	if (!Platform.isDesktop) return null;
	try {
		const { fs, os, path } = loadNodeFsModulesSync();
		if (Platform.isMacOS) {
			const filePath = path.join(os.homedir(), 'Library', 'Application Support', 'Arc', 'StorableSidebar.json');
			return fs.existsSync(filePath) ? filePath : null;
		}
		if (Platform.isWin) {
			const packagesDir = path.join(os.homedir(), 'AppData', 'Local', 'Packages');
			if (!fs.existsSync(packagesDir)) return null;
			const arcDir = fs.readdirSync(packagesDir).find((name) => name.startsWith('TheBrowserCompany.Arc'));
			if (!arcDir) return null;
			const filePath = path.join(packagesDir, arcDir, 'LocalCache', 'Local', 'Arc', 'StorableSidebar.json');
			return fs.existsSync(filePath) ? filePath : null;
		}
	} catch {
		/* fall through to manual file picker */
	}
	return null;
}

/** No gesture-preservation constraint here (unlike `findArcSidebarFile`), so a plain async dynamic `import()` is enough -- no `require()` needed. */
export async function readArcSidebarFile(path: string): Promise<string> {
	const fs = await import('fs');
	return fs.readFileSync(path, 'utf8');
}

/** All returned nodes' true top-level entries have `parentId === null`; the
 * caller re-parents those under a single new "Imported from X" folder so a
 * big import doesn't dump a flat mess into the user's existing root. */
export interface ImportBatch {
	nodes: TreeNode[];
	bookmarkCount: number;
	folderCount: number;
}

function emptyBatch(): ImportBatch {
	return { nodes: [], bookmarkCount: 0, folderCount: 0 };
}

/**
 * Wraps a parsed batch's true top-level entries (`parentId === null`) under
 * one new folder, then assigns sequential `order` values per sibling group
 * (the parsers themselves leave every `order` at the placeholder 0). Keeps a
 * big import from dumping a flat mess into the vault's existing root and
 * from colliding with an unrelated bookmark that happens to already be at
 * root order 0.
 */
export function finalizeImport(batch: ImportBatch, wrapperTitle: string): TreeNode[] {
	const wrapperId = generateId();
	const wrapper: TreeNode = {
		id: wrapperId,
		type: 'folder',
		title: wrapperTitle,
		parentId: null,
		order: 0,
		collapsed: false,
	};
	const nodes = batch.nodes.map((node) =>
		node.parentId === null ? { ...node, parentId: wrapperId } : node
	);

	const orderCounters = new Map<string | null, number>();
	for (const node of nodes) {
		const count = orderCounters.get(node.parentId) ?? 0;
		node.order = count;
		orderCounters.set(node.parentId, count + 1);
	}

	return [wrapper, ...nodes];
}

/**
 * Parses the standard "Netscape Bookmark File Format" HTML that Chrome,
 * Firefox, Safari, and Edge all export (and can all re-import). Browsers
 * write this format as tag-soup (unclosed <DT>/<p>), relying on HTML parsers'
 * error recovery to normalize it, so this walks the DOM defensively rather
 * than assuming a single nesting shape -- the matching <DL> for a folder's
 * <DT><H3> can end up nested inside that <DT> or as its next sibling
 * depending on how the parser recovers.
 */
export function parseNetscapeHtml(html: string): ImportBatch {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	const rootDl = doc.querySelector('dl');
	const batch = emptyBatch();
	if (!rootDl) return batch;
	walkNetscapeDl(rootDl, null, batch);
	return batch;
}

function walkNetscapeDl(dl: Element, parentId: string | null, batch: ImportBatch): void {
	const children = Array.from(dl.children);
	for (let i = 0; i < children.length; i++) {
		const el = children[i];
		if (el.tagName === 'DL') {
			// A <DL> not immediately consumed as a folder's children below --
			// treat as more entries at this same level.
			walkNetscapeDl(el, parentId, batch);
			continue;
		}
		if (el.tagName !== 'DT') continue;

		const h3 = el.querySelector(':scope > h3');
		const a = el.querySelector(':scope > a');
		if (h3) {
			const folderId = generateId();
			batch.nodes.push({
				id: folderId,
				type: 'folder',
				title: h3.textContent?.trim() || 'Imported folder',
				parentId,
				order: 0,
				collapsed: false,
			});
			batch.folderCount++;

			let childDl = el.querySelector(':scope > dl');
			if (!childDl && children[i + 1]?.tagName === 'DL') {
				childDl = children[i + 1];
				i++;
			}
			if (childDl) walkNetscapeDl(childDl, folderId, batch);
		} else if (a) {
			const url = a.getAttribute('href');
			if (!url) continue;
			batch.nodes.push({
				id: generateId(),
				type: 'bookmark',
				title: a.textContent?.trim() || url,
				url,
				parentId,
				order: 0,
			});
			batch.bookmarkCount++;
		}
	}
}

// ── Arc ──────────────────────────────────────────────────────

interface ArcItem {
	id: string;
	title?: string;
	childrenIds?: unknown[];
	data?: {
		tab?: { savedURL?: string; savedTitle?: string };
		list?: unknown;
	};
}

interface ArcSpace {
	id: string;
	title?: string;
	containerIDs?: unknown[];
	newContainerIDs?: unknown[];
}

/** Arc stores URLs with JSON-escaped slashes (e.g. `https:\/\/x.com`); undo that. */
function cleanArcUrl(url: string): string {
	return url.replace(/\\\//g, '/').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/**
 * Parses Arc's internal `StorableSidebar.json`. Arc has no standard export
 * like Chromium's chrome://bookmarks, so this reads its own undocumented
 * Spaces/Containers/Items graph directly. That format isn't versioned or
 * publicly documented and could change in a future Arc release without
 * notice -- if imports silently stop working, this is the first place to
 * check against a fresh sample file.
 */
export function parseArcSidebarJson(json: string): ImportBatch {
	const batch = emptyBatch();
	const data: unknown = JSON.parse(json);
	if (!isRecord(data)) return batch;

	const containers = (data.sidebar as Record<string, unknown> | undefined)?.containers;
	if (!Array.isArray(containers)) return batch;

	// Don't hardcode which index holds the real data (the reference
	// implementations use index 1, but that's an observed convention, not a
	// documented guarantee) -- use whichever entry actually has both arrays.
	const container = containers.find(
		(c): c is { items: unknown[]; spaces: unknown[] } =>
			isRecord(c) && Array.isArray(c.items) && Array.isArray(c.spaces)
	);
	if (!container) return batch;

	// The items array holds each real item twice: once as a full object, once
	// as a bare id string alongside it (an Arc quirk, not a documented index) --
	// only the object entries carry an `id` field, so the string duplicates are
	// naturally excluded here rather than needing separate filtering.
	const itemsById = new Map<string, ArcItem>();
	for (const raw of container.items) {
		if (isRecord(raw) && typeof raw.id === 'string') itemsById.set(raw.id, raw as unknown as ArcItem);
	}

	/**
	 * `containerIDs` and `newContainerIDs` both describe the *same* pinned and
	 * unpinned containers for a space -- one as flat alternating label/id
	 * strings (`["unpinned", "<id>", "pinned", "<id>"]`), the other as
	 * alternating marker-object/id pairs (`[{pinned:{}}, "<id>", ...]`).
	 * Using both would walk every container twice; this reads only
	 * `newContainerIDs` (falling back to `containerIDs` for older data) and
	 * keeps just the "pinned" ids -- Arc's "unpinned" bucket is closer to that
	 * space's open/recent tabs than to deliberately-saved bookmarks, which is
	 * also what the reference exporters default to.
	 */
	const extractPinnedContainerIds = (space: ArcSpace): string[] => {
		const source = space.newContainerIDs ?? space.containerIDs;
		if (!Array.isArray(source)) return [];
		const ids: string[] = [];
		for (let i = 0; i < source.length; i++) {
			const marker = source[i];
			const label = typeof marker === 'string' ? marker : isRecord(marker) ? Object.keys(marker)[0] : undefined;
			if (label !== 'pinned') continue;
			const idEntry = source[i + 1];
			if (typeof idEntry === 'string') ids.push(idEntry);
		}
		return ids;
	};

	const walkChildren = (childrenIds: unknown[] | undefined, parentId: string | null): void => {
		for (const rawId of childrenIds ?? []) {
			if (typeof rawId !== 'string') continue;
			const item = itemsById.get(rawId);
			if (!item) continue;

			if (item.data?.tab) {
				const rawUrl = item.data.tab.savedURL;
				if (!rawUrl) continue;
				const url = cleanArcUrl(rawUrl);
				batch.nodes.push({
					id: generateId(),
					type: 'bookmark',
					title: item.data.tab.savedTitle?.trim() || url,
					url,
					parentId,
					order: 0,
				});
				batch.bookmarkCount++;
			} else if (item.data?.list) {
				const folderId = generateId();
				batch.nodes.push({
					id: folderId,
					type: 'folder',
					title: item.title?.trim() || 'Imported folder',
					parentId,
					order: 0,
					collapsed: false,
				});
				batch.folderCount++;
				walkChildren(item.childrenIds, folderId);
			} else {
				// A plain grouping container (e.g. the pinned-tabs bar itself) --
				// transparent, so its children land directly under `parentId`
				// instead of gaining an extra wrapper folder.
				walkChildren(item.childrenIds, parentId);
			}
		}
	};

	for (const rawSpace of container.spaces) {
		if (!isRecord(rawSpace)) continue;
		const space = rawSpace as unknown as ArcSpace;
		const spaceFolderId = generateId();
		const beforeCount = batch.nodes.length;
		const spaceNode: TreeNode = {
			id: spaceFolderId,
			type: 'folder',
			title: space.title?.trim() || 'Arc space',
			parentId: null,
			order: 0,
			collapsed: false,
		};

		for (const containerId of extractPinnedContainerIds(space)) {
			const containerItem = itemsById.get(containerId);
			if (containerItem) walkChildren(containerItem.childrenIds, spaceFolderId);
		}

		// Skip spaces that turned out empty rather than importing clutter.
		if (batch.nodes.length > beforeCount) {
			batch.nodes.splice(beforeCount, 0, spaceNode);
			batch.folderCount++;
		}
	}

	return batch;
}
