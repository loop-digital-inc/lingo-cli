import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createLingoApi, type PushResult } from '../src/api.ts';
import { add } from '../src/commands/add.ts';
import { parseConfig } from '../src/config.ts';
import { isValidKey, randomKey } from '../src/key-names.ts';

const pushed: PushResult = {
	branch: 'main',
	mode: 'fill-empty',
	dryRun: false,
	preview: { newKeys: 1, existingKeys: 0, newValues: 1, unchangedValues: 0, conflictingValues: 0 },
	summary: { createdKeys: 1, createdValues: 1, updatedValues: 0, skippedValues: 0 },
	skipped: []
};

async function project(files: Record<string, unknown>) {
	const root = await mkdtemp(join(tmpdir(), 'lingo-'));

	for (const [path, content] of Object.entries(files)) {
		await mkdir(join(root, path, '..'), { recursive: true });
		await writeFile(join(root, path), typeof content === 'string' ? content : JSON.stringify(content));
	}

	return root;
}

type Options = {
	key?: string;
	config?: unknown;
	/** Random names to hand out, in order. */
	names?: string[];
	/** Keys Lingo has: on the branch checked, and on other branches. */
	onBranch?: string[];
	elsewhere?: Record<string, string[]>;
	push?: PushResult;
};

/** Runs `add` against a fake Lingo, and remembers what was asked of it. */
async function run(root: string, text: string, options: Options = {}) {
	const checks: URLSearchParams[] = [];
	const pushes: Record<string, unknown>[] = [];
	const lines: string[] = [];
	const warnings: string[] = [];
	const names = [...(options.names ?? [])];
	const api = createLingoApi({
		apiUrl: 'https://lingo.test',
		apiKey: 'lingo_test',
		fetch: async (input, init) => {
			const url = new URL(String(input));
			let body: unknown;

			if (url.pathname === '/v1/translations/availability') {
				const query = url.searchParams;
				const scope = query.get('scope');
				checks.push(query);
				body = {
					scope,
					branch: scope === 'branch' ? (query.get('branch') ?? 'main') : null,
					defaultLocale: 'en',
					keys: query.get('keys')!.split(',').map((key) => {
						const branches = Object.entries(options.elsewhere ?? {}).flatMap(([branch, keys]) => (keys.includes(key) ? [branch] : []));
						const onBranch = options.onBranch?.includes(key) ?? false;
						return { key, available: !onBranch && (scope === 'branch' || branches.length === 0), branches: onBranch ? ['main', ...branches] : branches };
					})
				};
			} else {
				pushes.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
				body = options.push ?? pushed;
			}

			return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
		}
	});
	const code = await add({
		api,
		config: parseConfig(options.config ?? {}),
		root,
		text,
		key: options.key,
		generate: () => names.shift() ?? 'out_of_names',
		log: (line) => lines.push(line),
		warn: (line) => warnings.push(line)
	});

	return { code, checks, pushes, lines, warnings };
}

async function readJson(path: string) {
	return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

test('random names are made of words and are valid keys', () => {
	for (let index = 0; index < 50; index++) {
		const key = randomKey();

		assert.match(key, /^[a-z]+_[a-z]+_[a-z]+$/);
		assert.ok(isValidKey(key));
	}
});

test('add picks a random name unused in the project and in the local files', async () => {
	const root = await project({ 'messages/en.json': { $schema: 'https://inlang.com/schema/inlang-message-format', local_only_key: 'Hi' } });
	const { code, checks, pushes, lines, warnings } = await run(root, 'Pay now', {
		names: ['local_only_key', 'taken_on_main', 'taken_elsewhere', 'brave_otter_jump'],
		onBranch: ['taken_on_main'],
		elsewhere: { 'feature/a': ['taken_elsewhere'] }
	});

	assert.equal(code, 0);
	assert.equal(warnings.length, 0);
	assert.equal(checks[0]!.get('scope'), 'project');
	assert.equal(checks[0]!.get('branch'), null);
	assert.ok(!checks[0]!.get('keys')!.split(',').includes('local_only_key'));
	assert.deepEqual(pushes[0], { format: 'paraglide', mode: 'fill-empty', files: [{ locale: 'en', content: { brave_otter_jump: 'Pay now' } }] });
	assert.deepEqual(await readJson(join(root, 'messages/en.json')), {
		$schema: 'https://inlang.com/schema/inlang-message-format',
		local_only_key: 'Hi',
		brave_otter_jump: 'Pay now'
	});
	assert.match(lines.join('\n'), /Added brave_otter_jump to branch main and .*messages\/en\.json/);
});

test('add keeps checking until a batch has an unused name, and gives up after a few', async () => {
	const taken = Array.from({ length: 30 }, (_, index) => `taken_${index}`);
	const later = await run(await project({}), 'Pay now', { names: [...taken.slice(0, 10), 'free_name_now'], elsewhere: { main: taken } });

	assert.equal(later.code, 0);
	assert.equal(later.checks.length, 2);
	assert.deepEqual(later.pushes[0]!.files, [{ locale: 'en', content: { free_name_now: 'Pay now' } }]);

	const never = await run(await project({}), 'Pay now', { names: taken, elsewhere: { main: [...taken, 'out_of_names'] } });

	assert.equal(never.code, 1);
	assert.equal(never.checks.length, 3);
	assert.equal(never.pushes.length, 0);
	assert.match(never.warnings.join('\n'), /Could not find an unused key name/);
});

test('--key only has to be new on the branch, and warns about other branches', async () => {
	const root = await project({ 'messages/en.json': '{\n  "a": "A"\n}\n' });
	const { code, checks, pushes, warnings } = await run(root, 'Pay now', {
		key: 'checkout.pay',
		config: { branch: 'feature/checkout' },
		elsewhere: { main: ['checkout.pay'] }
	});

	assert.equal(code, 0);
	assert.equal(checks[0]!.get('scope'), 'branch');
	assert.equal(checks[0]!.get('branch'), 'feature/checkout');
	assert.equal(pushes[0]!.branch, 'feature/checkout');
	assert.match(warnings.join('\n'), /also a key on main/);
	// The file's own indentation is kept.
	assert.equal(await readFile(join(root, 'messages/en.json'), 'utf8'), '{\n  "a": "A",\n  "checkout.pay": "Pay now"\n}\n');
});

test('--key refuses a name the branch or the local files already have, or that Lingo would refuse', async () => {
	const root = await project({ 'messages/fr.json': { local_key: 'Salut' } });
	const onBranch = await run(root, 'Pay now', { key: 'pay_now', onBranch: ['pay_now'] });
	const local = await run(root, 'Pay now', { key: 'local_key' });
	const invalid = await run(root, 'Pay now', { key: 'pay now' });

	assert.equal(onBranch.code, 1);
	assert.match(onBranch.warnings.join('\n'), /pay_now already exists on branch main/);
	assert.equal(onBranch.pushes.length, 0);
	assert.equal(local.code, 1);
	assert.match(local.warnings.join('\n'), /already in your locale files/);
	assert.equal(local.checks.length, 0);
	assert.equal(invalid.code, 1);
	assert.match(invalid.warnings.join('\n'), /can't be a key/);
	assert.equal(invalid.checks.length, 0);
});

test('add writes nothing locally when Lingo didn\'t create the key', async () => {
	const root = await project({ 'messages/en.json': { a: 'A' } });
	const raced = await run(root, 'Pay now', { names: ['brave_otter_jump'], push: { ...pushed, summary: { ...pushed.summary!, createdKeys: 0 } } });
	const unreadable = await run(root, 'Pay {', {
		names: ['brave_otter_jump'],
		push: { ...pushed, summary: { ...pushed.summary!, createdKeys: 0 }, skipped: [{ key: 'brave_otter_jump', locale: 'en', detail: 'not valid' }] }
	});

	assert.equal(raced.code, 1);
	assert.match(raced.warnings.join('\n'), /added to branch main by someone else/);
	assert.equal(unreadable.code, 1);
	assert.match(unreadable.warnings.join('\n'), /couldn't read the text: not valid/);
	assert.deepEqual(await readJson(join(root, 'messages/en.json')), { a: 'A' });
});
