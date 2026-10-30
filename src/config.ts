import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileFormats, type FileFormat } from './api.ts';

export const configFileName = 'lingo.config.json';

/** Lingo's hosted API, used when neither `apiUrl` nor `LINGO_API_URL` names another. */
export const defaultApiUrl = 'https://api.lingo.io';

/** Stands for each file's locale code in `output`. */
export const localePlaceholder = '{locale}';

/** `lingo.config.json`. The project isn't named here: the API key decides it. */
export type Config = {
	/** Where Lingo's API is, when it isn't {@link defaultApiUrl}. `LINGO_API_URL` overrides it. */
	apiUrl?: string;
	/** Where each locale's file goes, relative to the config file, e.g. `messages/{locale}.json`. */
	output: string;
	format: FileFormat;
	/**
	 * The Lingo branch to pull from and push to. Left out, both use the project's default branch.
	 * `--branch` overrides it.
	 */
	branch?: string;
	/** Locale codes to pull; every locale when left out. */
	locales?: string[];
	/** Folders `lingo unused` searches for keys, relative to the config file. `src` when left out. */
	source?: string[];
	/** Keys `lingo unused` never reports, such as ones built at runtime. `*` stands for any text: `status_*`. */
	ignoreKeys?: string[];
};

export const defaultConfig: Config = { output: `messages/${localePlaceholder}.json`, format: 'paraglide' };

/** A config file that is missing or wrong, with a message for the person who wrote it. */
export class ConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ConfigError';
	}
}

function isStringList(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim() !== '');
}

/** Checks what a config file holds. Unknown fields are refused, since they're usually typos. */
export function parseConfig(value: unknown): Config {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new ConfigError(`${configFileName} must hold a JSON object.`);
	}

	const { $schema: _schema, apiUrl, output = defaultConfig.output, format = defaultConfig.format, branch, locales, source, ignoreKeys, ...unknown } = value as Record<string, unknown>;

	if (Object.keys(unknown).length) {
		throw new ConfigError(`${configFileName} has fields the CLI doesn't know: ${Object.keys(unknown).join(', ')}.`);
	}

	if (apiUrl !== undefined && (typeof apiUrl !== 'string' || !/^https?:\/\//.test(apiUrl))) {
		throw new ConfigError('"apiUrl" must be an http(s) address.');
	}

	if (typeof output !== 'string' || !output.includes(localePlaceholder)) {
		throw new ConfigError(`"output" must be a path that contains ${localePlaceholder}, such as "${defaultConfig.output}".`);
	}

	if (!fileFormats.some((item) => item === format)) {
		throw new ConfigError(`"format" must be one of: ${fileFormats.join(', ')}.`);
	}

	if (branch !== undefined && (typeof branch !== 'string' || branch.trim() === '')) {
		throw new ConfigError('"branch" must be a branch name.');
	}

	if (locales !== undefined && !isStringList(locales)) {
		throw new ConfigError('"locales" must be a list of locale codes, such as ["en", "fr"].');
	}

	if (source !== undefined && !isStringList(source)) {
		throw new ConfigError('"source" must be a list of folders, such as ["src"].');
	}

	if (ignoreKeys !== undefined && !isStringList(ignoreKeys)) {
		throw new ConfigError('"ignoreKeys" must be a list of keys or patterns, such as ["status_*"].');
	}

	return {
		...(apiUrl ? { apiUrl } : {}),
		output,
		format: format as FileFormat,
		...(branch ? { branch: branch.trim() } : {}),
		...(locales?.length ? { locales } : {}),
		...(source?.length ? { source } : {}),
		...(ignoreKeys?.length ? { ignoreKeys } : {})
	};
}

/** Reads the config file at `path`, or `lingo.config.json` in `cwd`. Returns where it was found too. */
export async function loadConfig(cwd: string, path?: string) {
	const file = resolve(cwd, path ?? configFileName);
	let text: string;

	try {
		text = await readFile(file, 'utf8');
	} catch {
		throw new ConfigError(`No ${path ?? configFileName} found. Run "lingo init" to create one.`);
	}

	try {
		return { file, config: parseConfig(JSON.parse(text)) };
	} catch (reason) {
		if (reason instanceof SyntaxError) {
			throw new ConfigError(`${file} isn't valid JSON: ${reason.message}`);
		}

		throw reason;
	}
}
