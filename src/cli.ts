#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createLingoApi, LingoApiError } from './api.ts';
import { add } from './commands/add.ts';
import { init } from './commands/init.ts';
import { pull } from './commands/pull.ts';
import { push } from './commands/push.ts';
import { unused } from './commands/unused.ts';
import { ConfigError, configFileName, defaultApiUrl, loadConfig } from './config.ts';

const help = `lingo — keep a codebase's locale files in step with a Lingo project

Usage
  lingo init            Create ${configFileName}
  lingo pull            Download translations and write the locale files
  lingo push            Send keys and values from the locale files to a Lingo branch
  lingo add "<text>"    Add a key for new text, to Lingo and the default locale's file.
                        Its name is random and unused in the project, like brave_otter_jump
  lingo unused          List keys in the locale files that your code doesn't use

Options
  --config <path>       Config file to use (default: ${configFileName})
  --branch <name>       The Lingo branch to use, instead of "branch" in the config.
                        Default: the project's default branch
  --check               pull: change nothing; exit 1 if a file is out of date
  --overwrite           push: also replace values in Lingo that differ from your files
  --dry-run             push: show what would change without saving anything
  -k, --key <name>      add: name the key yourself; it only has to be new on the branch
  --api-url <url>       init: save another API address in the config (default: ${defaultApiUrl})
  -h, --help            Show this help
  -v, --version         Show the version

Environment
  LINGO_API_KEY         A project API key (Lingo → project → Settings → API keys).
                        Read from a .env file in the current folder when not set.
  LINGO_API_URL         Overrides "apiUrl" in the config.
`;

/** A mistake in how the command was run, shown without a stack trace. */
class UsageError extends Error {}

function version() {
	const packageFile = new URL('../package.json', import.meta.url);
	return (JSON.parse(readFileSync(packageFile, 'utf8')) as { version: string }).version;
}

/** Variables already set win, so CI secrets aren't replaced by a stray `.env`. */
function loadDotEnv(cwd: string) {
	for (const name of ['.env.local', '.env']) {
		const file = resolve(cwd, name);

		if (existsSync(file)) {
			try {
				process.loadEnvFile(file);
			} catch {
				// A .env this parser can't read isn't the CLI's to complain about.
			}
		}
	}
}

async function run(argv: string[]) {
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			config: { type: 'string' },
			branch: { type: 'string' },
			check: { type: 'boolean', default: false },
			overwrite: { type: 'boolean', default: false },
			'dry-run': { type: 'boolean', default: false },
			key: { type: 'string', short: 'k' },
			'api-url': { type: 'string' },
			help: { type: 'boolean', short: 'h', default: false },
			version: { type: 'boolean', short: 'v', default: false }
		}
	});
	const [command, ...rest] = positionals;
	const log = (line: string) => console.log(line);
	const warn = (line: string) => console.error(line);
	const cwd = process.cwd();

	if (values.version) {
		log(version());
		return 0;
	}

	if (values.help || !command) {
		log(help);
		return command || values.help ? 0 : 1;
	}

	// Only `add` takes an argument: the text.
	const extra = command === 'add' ? rest.slice(1) : rest;

	if (extra.length) {
		throw new UsageError(`Unexpected argument "${extra[0]}".${command === 'add' ? ' Put the text in quotes.' : ''}`);
	}

	if (command === 'init') {
		return init({ cwd, apiUrl: values['api-url'], log, warn });
	}

	if (command === 'unused') {
		// Works on local files only, so it needs no API key.
		const { file, config } = await loadConfig(cwd, values.config);
		return unused({ config, root: dirname(file), log, warn });
	}

	if (command === 'pull' || command === 'push' || command === 'add') {
		loadDotEnv(cwd);
		const loaded = await loadConfig(cwd, values.config);
		const config = { ...loaded.config, ...(values.branch?.trim() ? { branch: values.branch.trim() } : {}) };
		const apiKey = process.env.LINGO_API_KEY?.trim();
		const apiUrl = process.env.LINGO_API_URL?.trim() || config.apiUrl || defaultApiUrl;

		if (!apiKey) {
			throw new UsageError('LINGO_API_KEY is not set. Create a key in Lingo (project → Settings → API keys) and put it in the environment or a .env file.');
		}

		const shared = { api: createLingoApi({ apiUrl, apiKey }), config, root: dirname(loaded.file), log, warn };

		if (command === 'add') {
			const text = rest[0] ?? '';

			if (!text.trim()) {
				throw new UsageError('Give the text the key is for, in quotes: lingo add "Pay now".');
			}

			return add({ ...shared, text, key: values.key?.trim() || undefined });
		}

		return command === 'pull'
			? pull({ ...shared, check: values.check })
			: push({ ...shared, overwrite: values.overwrite, dryRun: values['dry-run'] });
	}

	throw new UsageError(`Unknown command "${command}". Run "lingo --help".`);
}

try {
	process.exitCode = await run(process.argv.slice(2));
} catch (reason) {
	// Expected failures get one readable line; anything else is a bug and keeps its stack.
	if (reason instanceof UsageError || reason instanceof ConfigError || reason instanceof LingoApiError || (reason as NodeJS.ErrnoException).code?.startsWith('ERR_PARSE_ARGS')) {
		console.error(`lingo: ${(reason as Error).message}`);

		if (reason instanceof LingoApiError && reason.status === 401) {
			console.error('Check LINGO_API_KEY: the key may have been deleted, or belong to another Lingo server.');
		}

		process.exitCode = 1;
	} else {
		throw reason;
	}
}
