import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Config } from '../config.ts';
import { findLocaleFiles } from '../locale-files.ts';

export type UnusedOptions = {
	config: Config;
	/** The folder `config.output` and `config.source` are relative to: the config file's. */
	root: string;
	log: (line: string) => void;
	warn: (line: string) => void;
};

/** Files that can mention a key. Anything else (images, lockfiles, data) is skipped. */
const sourceExtensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.svelte', '.vue', '.astro', '.html', '.md', '.mdx']);
const skippedFolders = new Set(['node_modules', 'dist', 'build', 'out', 'coverage']);
const largestSourceFile = 2_000_000;

/**
 * The files to search under `folder`. In a git repository these are the files git doesn't ignore,
 * which leaves out generated code such as Paraglide's compiled messages, where every key appears.
 */
async function sourceFiles(folder: string) {
	try {
		const { stdout } = await promisify(execFile)('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
			cwd: folder,
			maxBuffer: 64 * 1024 * 1024
		});
		return stdout.split('\0').filter(Boolean).map((file) => join(folder, file));
	} catch {
		// Not a git repository, or no git: walk the folder, leaving out the usual build output.
	}

	const files: string[] = [];
	const walk = async (current: string) => {
		for (const entry of await readdir(current, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				if (!entry.name.startsWith('.') && !skippedFolders.has(entry.name)) {
					await walk(join(current, entry.name));
				}
			} else if (entry.isFile()) {
				files.push(join(current, entry.name));
			}
		}
	};

	await walk(folder);
	return files;
}

/** `status_*` → a test for keys that start with `status_`. */
function ignoreTest(patterns: string[]) {
	const tests = patterns.map((pattern) => new RegExp(`^${pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`));
	return (key: string) => tests.some((test) => test.test(key));
}

/**
 * Removes from `keys` every key that `text` mentions. A key counts as used when its name appears
 * as a whole word, however it's written: `m.save_button()`, `t('save_button')`, `key="save_button"`.
 */
export function markUsed(text: string, keys: Set<string>) {
	for (const [word] of text.matchAll(/[\p{L}\p{N}_$.-]+/gu)) {
		keys.delete(word);

		if (word.includes('.')) {
			const segments = word.split('.');

			for (const [index, segment] of segments.entries()) {
				// `m.save_button` names `save_button`; `i18n.t.cart.title` names the nested key `cart.title`.
				keys.delete(segment);
				keys.delete(segments.slice(index).join('.'));
			}
		}
	}
}

/**
 * Lists keys in the locale files that no source file mentions. It reads only local files, and
 * changes nothing. Returns the process exit code: 1 when there are unused keys.
 */
export async function unused({ config, root, log, warn }: UnusedOptions) {
	const localeFiles = await findLocaleFiles(root, config.output, config.locales);

	if (localeFiles.length === 0) {
		warn(`No files match ${config.output}, so there are no keys to check.`);
		return 1;
	}

	const ignored = ignoreTest(config.ignoreKeys ?? []);
	// `$schema` and the like are settings of the file, not messages.
	const allKeys = new Set(localeFiles.flatMap((file) => Object.keys(file.content)).filter((key) => !key.startsWith('$') && !ignored(key)));
	const remaining = new Set(allKeys);
	const localePaths = new Set(localeFiles.map((file) => resolve(file.path)));
	let searched = 0;

	for (const folder of config.source ?? ['src']) {
		const path = resolve(root, folder);

		if (!(await stat(path).catch(() => undefined))?.isDirectory()) {
			warn(`The source folder ${folder} doesn't exist. Set "source" in the config to where your code is.`);
			return 1;
		}

		for (const file of await sourceFiles(path)) {
			if (!sourceExtensions.has(extname(file)) || localePaths.has(resolve(file))) {
				continue;
			}

			const info = await stat(file).catch(() => undefined);

			if (!info?.isFile() || info.size > largestSourceFile) {
				continue;
			}

			markUsed(await readFile(file, 'utf8'), remaining);
			searched++;
		}
	}

	const shown = localeFiles.map((file) => relative(process.cwd(), file.path) || file.path).join(', ');
	log(`Checked ${allKeys.size} key${allKeys.size === 1 ? '' : 's'} from ${shown} against ${searched} source file${searched === 1 ? '' : 's'}.`);

	if (remaining.size === 0) {
		log('  ✓ Every key is used.');
		return 0;
	}

	log(`  ${remaining.size} key${remaining.size === 1 ? ' is' : 's are'} not used:`);

	for (const key of [...remaining].sort()) {
		log(`    ${key}`);
	}

	warn('Keys put together at runtime, such as m[`status_${name}`], can\'t be seen. List them under "ignoreKeys" in the config (e.g. "status_*").');
	return 1;
}
