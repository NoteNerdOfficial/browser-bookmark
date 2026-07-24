/**
 * Electron is provided by the Obsidian host at runtime, same as Node's
 * fs/os/path elsewhere in this plugin -- it isn't an installed dependency,
 * so TypeScript has no declarations for it. This is just enough of a shape
 * for `shell.openExternal`, the one thing used from it (in webviewer.ts),
 * rather than pulling in the whole `electron` package as a devDependency
 * purely for typing.
 */
declare module 'electron' {
	export const shell: {
		openExternal(url: string): Promise<void>;
	};
}
