import { relative } from 'node:path';
import type { LingoApi } from '../api.ts';
import type { Config } from '../config.ts';
import { findLocaleFiles } from '../locale-files.ts';

export type PushOptions = {
	api: LingoApi;
	config: Config;
	/** The folder `config.output` is relative to: the config file's. */
	root: string;
	/** Also replace values in Lingo that differ from the files. */
	overwrite?: boolean;
	/** Report what would change without saving anything. */
	dryRun?: boolean;
	log: (line: string) => void;
	warn: (line: string) => void;
};

function count(number: number, one: string, many = `${one}s`) {
	return `${number} ${number === 1 ? one : many}`;
}

/**
 * Sends the local locale files to a Lingo branch. By default it only adds: new keys, and values
 * Lingo doesn't have yet. Values that differ are left as Lingo has them unless `overwrite`.
 * Returns the process exit code.
 */
export async function push({ api, config, root, overwrite = false, dryRun = false, log, warn }: PushOptions) {
	const files = await findLocaleFiles(root, config.output, config.locales);

	if (files.length === 0) {
		warn(`No files match ${config.output}, so there is nothing to push.`);
		return 1;
	}

	const result = await api.push({
		format: config.format,
		branch: config.branch,
		mode: overwrite ? 'overwrite' : 'fill-empty',
		dryRun,
		files: files.map(({ locale, content }) => ({ locale, content }))
	});
	const { preview, summary } = result;

	log(`${dryRun ? 'Would push' : 'Pushed'} ${files.map((file) => relative(process.cwd(), file.path) || file.path).join(', ')} → branch ${result.branch}`);

	if (summary) {
		log(`  ✓ ${count(summary.createdKeys, 'new key')}, ${count(summary.createdValues, 'new value')}, ${count(summary.updatedValues, 'value')} updated`);
	} else {
		const updated = overwrite ? preview.conflictingValues : 0;
		log(`  ${count(preview.newKeys, 'new key')}, ${count(preview.newValues, 'new value')}, ${count(updated, 'value')} to update`);
	}

	if (preview.conflictingValues && !overwrite) {
		warn(`  ! ${count(preview.conflictingValues, 'value differs', 'values differ')} from Lingo and ${preview.conflictingValues === 1 ? 'was' : 'were'} left as Lingo has ${preview.conflictingValues === 1 ? 'it' : 'them'}. Use --overwrite to send yours, or "lingo pull" to take Lingo's.`);
	}

	for (const value of result.skipped) {
		warn(`  ! Left out "${value.key}" (${value.locale}): ${value.detail}`);
	}

	return 0;
}
