import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import type { LingoApi, LocaleFile } from '../api.ts';
import type { Config } from '../config.ts';
import { indentOf, outputPath, readText } from '../locale-files.ts';

export type PullOptions = {
	api: LingoApi;
	config: Config;
	/** The folder `config.output` is relative to: the config file's. */
	root: string;
	/** Change nothing; fail when a file is out of date. For CI. */
	check?: boolean;
	log: (line: string) => void;
	warn: (line: string) => void;
};

function countKeys(file: LocaleFile) {
	return Object.keys(file.content).length;
}

/** Downloads the project's files and writes the ones that changed. Returns the process exit code. */
export async function pull({ api, config, root, check = false, log, warn }: PullOptions) {
	const result = await api.files({ format: config.format, branch: config.branch, locales: config.locales });
	let changed = 0;

	log(`${result.project.name} · ${result.branch}`);

	if (result.files.length === 0) {
		warn('This project has no locales yet, so there is nothing to write.');
	}

	for (const file of result.files) {
		const path = outputPath(root, config.output, file.locale);
		const shown = relative(process.cwd(), path) || path;
		const current = await readText(path);
		const next = `${JSON.stringify(file.content, null, indentOf(current))}\n`;

		if (next === current) {
			log(`  = ${shown} (up to date)`);
			continue;
		}

		changed++;

		if (check) {
			log(`  ! ${shown} (${current === undefined ? 'missing' : 'out of date'})`);
			continue;
		}

		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, next);
		log(`  ✓ ${shown} (${countKeys(file)} entries)`);
	}

	for (const value of result.skipped) {
		warn(`Left out "${value.key}" (${value.locale}): the ${result.format} format can't express it (${value.detail}).`);
	}

	if (check && changed) {
		warn(`${changed} file${changed === 1 ? ' is' : 's are'} out of date. Run "lingo pull".`);
		return 1;
	}

	return 0;
}
