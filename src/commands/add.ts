import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import type { AvailabilityResult, LingoApi } from '../api.ts';
import type { Config } from '../config.ts';
import { isValidKey, keyRules, randomKey } from '../key-names.ts';
import { findLocaleFiles, indentOf, outputPath, readText } from '../locale-files.ts';

export type AddOptions = {
	api: LingoApi;
	config: Config;
	/** The folder `config.output` is relative to: the config file's. */
	root: string;
	/** The new key's text, in the project's default locale. */
	text: string;
	/** The name to give the key. Left out, a random name nothing in the project uses. */
	key?: string;
	/** Makes random names; replaced in tests. */
	generate?: () => string;
	log: (line: string) => void;
	warn: (line: string) => void;
};

// Random names are checked with Lingo a batch at a time. A batch where every name is taken is very
// unlikely, so a few batches are plenty.
const namesPerCheck = 10;
const maxChecks = 3;

/**
 * A random name that is in no local locale file and unused anywhere in the project, so it can't
 * clash with another branch's key when branches are compared or synced.
 */
async function unusedRandomKey(api: LingoApi, local: Set<string>, generate: () => string) {
	for (let check = 0; check < maxChecks; check++) {
		const names = new Set<string>();

		// Bounded, so a generator that keeps repeating itself can't loop forever.
		for (let attempt = 0; names.size < namesPerCheck && attempt < namesPerCheck * 10; attempt++) {
			const name = generate();

			if (!local.has(name)) {
				names.add(name);
			}
		}

		if (names.size === 0) {
			continue;
		}

		const availability = await api.availability({ keys: [...names], scope: 'project' });
		const unused = availability.keys.find((item) => item.available);

		if (unused) {
			return { key: unused.key, availability };
		}
	}

	return undefined;
}

/**
 * Adds a key for new text: to a Lingo branch, and to the default locale's file. Without `key`, the
 * name is random and unused in the whole project; a name given is only checked against the branch,
 * as Lingo does when a key is added by hand. Returns the process exit code.
 */
export async function add({ api, config, root, text, key, generate = randomKey, log, warn }: AddOptions) {
	const local = new Set((await findLocaleFiles(root, config.output)).flatMap((file) => Object.keys(file.content)));
	let name: string;
	let availability: AvailabilityResult;

	if (key) {
		if (!isValidKey(key)) {
			warn(`"${key}" can't be a key: use ${keyRules}.`);
			return 1;
		}

		if (local.has(key)) {
			warn(`${key} is already in your locale files. Use "lingo push" to send it to Lingo.`);
			return 1;
		}

		availability = await api.availability({ keys: [key], scope: 'branch', branch: config.branch });
		const [result] = availability.keys;

		if (!result?.available) {
			warn(`${key} already exists on branch ${availability.branch}. Choose another name, or leave out --key for a random one.`);
			return 1;
		}

		if (result.branches.length) {
			const others = result.branches.length === 1 ? 'that branch' : 'those branches';
			warn(`! ${key} is also a key on ${result.branches.join(', ')}. Lingo matches keys by name, so comparing or syncing ${others} with this one treats them as the same key.`);
		}

		name = key;
	} else {
		const found = await unusedRandomKey(api, local, generate);

		if (!found) {
			warn('Could not find an unused key name. Try again, or choose one with --key.');
			return 1;
		}

		({ key: name, availability } = found);
	}

	const locale = availability.defaultLocale;

	if (!locale) {
		warn('This project has no default locale yet. Add a locale in Lingo first.');
		return 1;
	}

	// Lingo first: a key that is saved there can't be taken by anyone else on the branch.
	const result = await api.push({ format: config.format, branch: config.branch, mode: 'fill-empty', files: [{ locale, content: { [name]: text } }] });
	const skipped = result.skipped.find((value) => value.key === name);

	if (skipped) {
		warn(`Lingo couldn't read the text: ${skipped.detail}`);
		return 1;
	}

	if (!result.summary?.createdKeys) {
		warn(`${name} was added to branch ${result.branch} by someone else a moment ago. Run the command again${key ? ' with another --key' : ''}.`);
		return 1;
	}

	const path = outputPath(root, config.output, locale);
	const current = await readText(path);
	const content = current === undefined ? {} : (JSON.parse(current) as Record<string, unknown>);

	content[name] = text;
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(content, null, indentOf(current))}\n`);
	log(`Added ${name} to branch ${result.branch} and ${relative(process.cwd(), path) || path}`);
	return 0;
}
