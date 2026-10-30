import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createLingoApi, LingoApiError, type ProjectFiles } from '../src/api.ts';
import { pull } from '../src/commands/pull.ts';
import { parseConfig } from '../src/config.ts';

const files: ProjectFiles = {
	project: { id: 'p1', name: 'Shop', key: 'shop' },
	branch: 'main',
	format: 'paraglide',
	files: [
		{ locale: 'en', isDefault: true, content: { $schema: 'https://inlang.com/schema/inlang-message-format', hello: 'Hello {name}' } },
		{ locale: 'fr', isDefault: false, content: { $schema: 'https://inlang.com/schema/inlang-message-format', hello: 'Bonjour {name}' } }
	],
	skipped: []
};

/** A Lingo API that answers every request with `body`, and remembers what was asked. */
function fakeApi(body: unknown, status = 200) {
	const requests: { url: URL; authorization: string | null }[] = [];
	const api = createLingoApi({
		apiUrl: 'https://lingo.test/',
		apiKey: 'lingo_test',
		fetch: async (input, init) => {
			requests.push({ url: new URL(String(input)), authorization: new Headers(init?.headers).get('Authorization') });
			return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
		}
	});

	return { api, requests };
}

async function run(root: string, body: unknown = files, options: { check?: boolean; config?: unknown } = {}) {
	const { api, requests } = fakeApi(body);
	const lines: string[] = [];
	const warnings: string[] = [];
	const code = await pull({
		api,
		config: parseConfig(options.config ?? {}),
		root,
		check: options.check,
		log: (line) => lines.push(line),
		warn: (line) => warnings.push(line)
	});

	return { code, lines, warnings, requests };
}

test('pull writes one file per locale and sends the key', async () => {
	const root = await mkdtemp(join(tmpdir(), 'lingo-'));
	const { code, requests } = await run(root, files, { config: { branch: 'development', locales: ['en', 'fr'] } });

	assert.equal(code, 0);
	assert.deepEqual(JSON.parse(await readFile(join(root, 'messages/fr.json'), 'utf8')), files.files[1]!.content);
	assert.equal(requests[0]!.authorization, 'Bearer lingo_test');
	assert.equal(requests[0]!.url.pathname, '/v1/translations/export/files');
	assert.equal(requests[0]!.url.searchParams.get('branch'), 'development');
	assert.equal(requests[0]!.url.searchParams.get('locales'), 'en,fr');
	assert.equal(requests[0]!.url.searchParams.get('format'), 'paraglide');
});

test('a second pull changes nothing, and keeps the indentation already used', async () => {
	const root = await mkdtemp(join(tmpdir(), 'lingo-'));
	await run(root, files, { config: { output: '{locale}.json' } });
	await writeFile(join(root, 'en.json'), `${JSON.stringify(files.files[0]!.content, null, 2)}\n`);

	const { lines } = await run(root, files, { config: { output: '{locale}.json' } });

	assert.ok(lines.some((line) => line.includes('en.json (up to date)')));
	assert.match(await readFile(join(root, 'en.json'), 'utf8'), /^\{\n  "\$schema"/);
});

test('--check reports out-of-date files without writing them', async () => {
	const root = await mkdtemp(join(tmpdir(), 'lingo-'));
	const { code, warnings } = await run(root, files, { check: true });

	assert.equal(code, 1);
	assert.match(warnings.join('\n'), /2 files are out of date/);
	await assert.rejects(readFile(join(root, 'messages/en.json')));
});

test('skipped values are reported', async () => {
	const root = await mkdtemp(join(tmpdir(), 'lingo-'));
	const { code, warnings } = await run(root, { ...files, skipped: [{ key: 'terms', locale: 'en', detail: 'markup {#b}' }] });

	assert.equal(code, 0);
	assert.match(warnings.join('\n'), /Left out "terms" \(en\)/);
});

test('a locale code can not write outside the project', async () => {
	const root = await mkdtemp(join(tmpdir(), 'lingo-'));
	const body = { ...files, files: [{ locale: '../../evil', isDefault: false, content: {} }] };

	await assert.rejects(run(root, body), /Refusing to write/);
});

test('the server\'s error message is passed on', async () => {
	const { api } = fakeApi({ error: 'Invalid API key.' }, 401);

	await assert.rejects(api.files({ format: 'paraglide' }), (reason: unknown) => {
		assert.ok(reason instanceof LingoApiError);
		assert.equal(reason.status, 401);
		assert.equal(reason.message, 'Invalid API key.');
		return true;
	});
});

test('config mistakes are explained', () => {
	assert.throws(() => parseConfig({ output: 'messages.json' }), /must be a path that contains \{locale\}/);
	assert.throws(() => parseConfig({ fromat: 'mf2' }), /doesn't know: fromat/);
	assert.throws(() => parseConfig({ format: 'icu' }), /"format" must be one of/);
	assert.deepEqual(parseConfig({}), { output: 'messages/{locale}.json', format: 'paraglide' });
});
