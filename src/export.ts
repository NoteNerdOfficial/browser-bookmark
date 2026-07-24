import { PINNED_PARENT_ID, type TreeNode } from './types';

function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function childrenOf(items: TreeNode[], parentId: string | null): TreeNode[] {
	return items.filter((item) => item.parentId === parentId).sort((a, b) => a.order - b.order);
}

function renderNode(items: TreeNode[], node: TreeNode, depth: number): string {
	const indent = '  '.repeat(depth);
	if (node.type === 'folder') {
		const kids = childrenOf(items, node.id);
		return (
			`${indent}<DT><H3>${escapeHtml(node.title)}</H3>\n` +
			`${indent}<DL><p>\n` +
			kids.map((kid) => renderNode(items, kid, depth + 1)).join('') +
			`${indent}</DL><p>\n`
		);
	}
	return `${indent}<DT><A HREF="${escapeHtml(node.url ?? '')}">${escapeHtml(node.title)}</A>\n`;
}

/**
 * Builds a standard Netscape Bookmark File Format HTML document from the
 * full tree -- the same format `parseNetscapeHtml` reads, and what Chrome,
 * Firefox, Safari, and Edge all import. Pinned bookmarks (parentId ===
 * PINNED_PARENT_ID) aren't part of the regular root-down tree walk, so
 * they're included separately under a "Pinned" folder rather than silently
 * dropped; there's no "pinned" concept in this format, so that status is
 * lost on export the same way any other app-specific metadata would be.
 */
export function exportToNetscapeHtml(items: TreeNode[]): string {
	const rootItems = childrenOf(items, null);
	const pinnedItems = childrenOf(items, PINNED_PARENT_ID);

	let body = rootItems.map((node) => renderNode(items, node, 1)).join('');
	if (pinnedItems.length > 0) {
		body +=
			'  <DT><H3>Pinned</H3>\n' +
			'  <DL><p>\n' +
			pinnedItems.map((node) => renderNode(items, node, 2)).join('') +
			'  </DL><p>\n';
	}

	return (
		'<!DOCTYPE NETSCAPE-Bookmark-file-1>\n' +
		'<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n' +
		'<TITLE>Bookmarks</TITLE>\n' +
		'<H1>Bookmarks</H1>\n' +
		'<DL><p>\n' +
		body +
		'</DL><p>\n'
	);
}
