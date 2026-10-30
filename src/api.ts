// Everything the CLI asks of the Lingo API. Kept apart from the commands so it can become a library.

export type FileFormat = 'paraglide' | 'mf2';

export const fileFormats: FileFormat[] = ['paraglide', 'mf2'];

/** One locale's translations, as the JSON to save. */
export type LocaleFile = {
	locale: string;
	isDefault: boolean;
	content: Record<string, unknown>;
};

/** A value that couldn't be converted, and was left out: of the files on a pull, of Lingo on a push. */
export type SkippedValue = {
	key: string;
	locale: string;
	detail: string;
};

export type ProjectFiles = {
	project: { id: string; name: string; key: string };
	branch: string;
	format: FileFormat;
	files: LocaleFile[];
	skipped: SkippedValue[];
};

export type FilesRequest = {
	format: FileFormat;
	/** The project's default branch when left out. The branch must allow exporting. */
	branch?: string;
	/** Locale codes; every locale when left out. */
	locales?: string[];
};

/** `fill-empty` adds new keys and missing values; `overwrite` also replaces values that differ. */
export type PushMode = 'fill-empty' | 'overwrite';

export type PushRequest = {
	format: FileFormat;
	files: { locale: string; content: Record<string, unknown> }[];
	/** The project's default branch when left out. The branch must allow importing. */
	branch?: string;
	mode: PushMode;
	/** Report what would change without saving anything. */
	dryRun?: boolean;
};

export type PushResult = {
	branch: string;
	mode: PushMode;
	dryRun: boolean;
	/** What the files hold compared with the branch, whatever the mode. */
	preview: { newKeys: number; existingKeys: number; newValues: number; unchangedValues: number; conflictingValues: number };
	/** What was saved; absent on a dry run. */
	summary?: { createdKeys: number; createdValues: number; updatedValues: number; skippedValues: number };
	skipped: SkippedValue[];
};

/**
 * Where a key must be unused. `branch`: on that branch, which is all saving a key needs. `project`:
 * anywhere in the project, as a generated key should be, since branches match keys by name.
 */
export type KeyScope = 'branch' | 'project';

export type AvailabilityRequest = {
	/** At most 100. */
	keys: string[];
	scope: KeyScope;
	/** For the branch scope; the project's default branch when left out. */
	branch?: string;
};

export type KeyAvailability = {
	key: string;
	available: boolean;
	/** The branches that have the key, whatever the scope. */
	branches: string[];
};

export type AvailabilityResult = {
	scope: KeyScope;
	/** The branch checked; `null` for the project scope. */
	branch: string | null;
	/** The project's default locale, which a new key's text is written in. */
	defaultLocale: string | null;
	keys: KeyAvailability[];
};

/** A request Lingo refused or that never reached it. `status` is the HTTP status, when there was one. */
export class LingoApiError extends Error {
	readonly status: number | undefined;

	constructor(message: string, status?: number) {
		super(message);
		this.name = 'LingoApiError';
		this.status = status;
	}
}

export type LingoApiOptions = {
	apiUrl: string;
	/** A project API key, `lingo_…`. It decides which project is used. */
	apiKey: string;
	fetch?: typeof fetch;
};

export type LingoApi = {
	files(request: FilesRequest): Promise<ProjectFiles>;
	/** Needs a key with write access. */
	push(request: PushRequest): Promise<PushResult>;
	/** Whether keys are free to use, on a branch or in the whole project. */
	availability(request: AvailabilityRequest): Promise<AvailabilityResult>;
};

async function errorText(response: Response) {
	try {
		const body = (await response.json()) as { error?: unknown };

		if (typeof body.error === 'string') {
			return body.error;
		}
	} catch {
		// Not JSON, such as a proxy's error page.
	}

	return `Lingo responded with status ${response.status}.`;
}

export function createLingoApi(options: LingoApiOptions): LingoApi {
	const request = options.fetch ?? fetch;
	const base = options.apiUrl.replace(/\/+$/, '');

	async function send<Result>(method: 'GET' | 'POST', path: string, query: Record<string, string | undefined>, body?: unknown) {
		const url = new URL(`${base}${path}`);

		for (const [name, value] of Object.entries(query)) {
			if (value) {
				url.searchParams.set(name, value);
			}
		}

		let response: Response;

		try {
			response = await request(url, {
				method,
				headers: {
					Authorization: `Bearer ${options.apiKey}`,
					Accept: 'application/json',
					...(body === undefined ? {} : { 'Content-Type': 'application/json' })
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) })
			});
		} catch (reason) {
			throw new LingoApiError(`Could not reach Lingo at ${base}: ${reason instanceof Error ? reason.message : String(reason)}`);
		}

		if (!response.ok) {
			throw new LingoApiError(await errorText(response), response.status);
		}

		return (await response.json()) as Result;
	}

	return {
		files: ({ format, branch, locales }) =>
			send<ProjectFiles>('GET', '/v1/translations/export/files', { format, branch, locales: locales?.join(',') }),
		push: (body) => send<PushResult>('POST', '/v1/translations/import/files', {}, body),
		availability: ({ keys, scope, branch }) =>
			send<AvailabilityResult>('GET', '/v1/translations/availability', { keys: keys.join(','), scope, branch: scope === 'branch' ? branch : undefined })
	};
}
