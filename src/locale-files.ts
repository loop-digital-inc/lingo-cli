import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { ConfigError, localePlaceholder } from './config.ts';

export type LocalFile = {
	locale: string;
	path: string;
	content: Record<string, unknown>;
};

/** Tabs unless the file already there uses spaces, so writing a file doesn't re-indent it. */
export function indentOf(text: string | undefined) {
	const indent = text?.match(/^([ \t]+)\S/m)?.[1];
	return indent && !indent.includes('\t') ? indent : '\t';
}

export async function readText(path: string) {
	try {
		return await readFile(path, 'utf8');
	} catch {
		return undefined;
	}
}

/** Where a locale's file goes. Locale codes come from the server, so one may not climb out of `root`. */
export function outputPath(root: string, output: string, locale: string) {
	const path = resolve(root, output.replaceAll(localePlaceholder, locale));
	const fromRoot = relative(root, path);

	if (/[\\/]/.test(locale) || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
		throw new Error(`Refusing to write locale "${locale}" outside ${root}.`);
	}

	return path;
}

function escapeRegExp(text: string) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The locale files on disk that match `output`, such as `messages/{locale}.json`: whatever stands
 * where `{locale}` is, in the one path segment that holds it, is taken as a locale code.
 */
export async function findLocaleFiles(root: string, output: string, only?: string[]): Promise<LocalFile[]> {
	const segments = output.split('/').filter((segment) => segment !== '.' && segment !== '');
	const index = segments.findIndex((segment) => segment.includes(localePlaceholder));
	const folder = resolve(root, ...segments.slice(0, index));
	const [before = '', after = ''] = (segments[index] ?? '').split(localePlaceholder);
	const pattern = new RegExp(`^${escapeRegExp(before)}(.+)${escapeRegExp(after)}$`);
	let names: string[];

	try {
		names = await readdir(folder);
	} catch {
		return [];
	}

	const files: LocalFile[] = [];

	for (const name of names.sort()) {
		const locale = pattern.exec(name)?.[1];

		if (!locale || (only && !only.includes(locale))) {
			continue;
		}

		const path = join(folder, name, ...segments.slice(index + 1));
		let text: string;

		try {
			text = await readFile(path, 'utf8');
		} catch {
			// A folder or file that only looks like a locale.
			continue;
		}

		let content: unknown;

		try {
			content = JSON.parse(text);
		} catch (reason) {
			throw new ConfigError(`${path} isn't valid JSON: ${reason instanceof Error ? reason.message : String(reason)}`);
		}

		if (!content || typeof content !== 'object' || Array.isArray(content)) {
			throw new ConfigError(`${path} must hold a JSON object of keys and messages.`);
		}

		files.push({ locale, path, content: content as Record<string, unknown> });
	}

	return files;
}
