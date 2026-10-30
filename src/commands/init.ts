import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { configFileName, defaultConfig, localePlaceholder, type Config } from '../config.ts';

export type InitOptions = {
	cwd: string;
	apiUrl?: string;
	log: (line: string) => void;
	warn: (line: string) => void;
};

/** A Paraglide project says where its message files are; use that instead of guessing. */
async function paraglideOutput(cwd: string) {
	try {
		const settings = JSON.parse(await readFile(resolve(cwd, 'project.inlang/settings.json'), 'utf8')) as Record<string, unknown>;
		const plugin = settings['plugin.inlang.messageFormat'] as { pathPattern?: unknown } | undefined;
		const pattern = typeof plugin?.pathPattern === 'string' ? plugin.pathPattern : undefined;
		return pattern?.includes(localePlaceholder) ? pattern.replace(/^\.\//, '') : undefined;
	} catch {
		return undefined;
	}
}

/** Writes `lingo.config.json`, leaving one that exists alone. Returns the process exit code. */
export async function init({ cwd, apiUrl, log, warn }: InitOptions) {
	const file = resolve(cwd, configFileName);
	const config: Config = { ...(apiUrl ? { apiUrl } : {}), ...defaultConfig, output: (await paraglideOutput(cwd)) ?? defaultConfig.output };

	try {
		// `wx` fails when the file exists, so a second `init` can't wipe a config.
		await writeFile(file, `${JSON.stringify(config, null, '\t')}\n`, { flag: 'wx' });
	} catch (reason) {
		if ((reason as NodeJS.ErrnoException).code === 'EEXIST') {
			warn(`${configFileName} already exists; left as it is.`);
			return 1;
		}

		throw reason;
	}

	log(`Created ${configFileName}. Translations will be written to ${config.output}.`);
	log('');
	log('Next:');
	log('  1. In Lingo, open your project → Settings → API keys and create a key.');
	log('  2. Put it in LINGO_API_KEY (a .env file here works; keep it out of git).');
	log('  3. Run "lingo pull".');
	return 0;
}
