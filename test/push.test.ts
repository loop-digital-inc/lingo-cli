import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createLingoApi, type PushResult } from '../src/api.ts';
import { push } from '../src/commands/push.ts';
import { parseConfig } from '../src/config.ts';
import { findLocaleFiles } from '../src/locale-files.ts';

const answer: PushResult = {
	branch: 'development',
	mode: 'fill-empty',
	dryRun: false,
	preview: { newKeys: 1, existingKeys: 1, newValues: 2, unchangedValues: 1, conflictingValues: 1 },
	summary: { createdKeys: 1, createdValues: 2, updatedValues: 0, skippedValues: 2 },
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

async function run(root: string, options: { config?: unknown; overwrite?: boolean; dryRun?: boolean; answer?: PushResult } = {}) {
	const bodies: Record<string, unknown>[] = [];
	const lines: string[] = [];
	const warnings: string[] = [];
	const api = createLingoApi({
		apiUrl: 'https://lingo.test',
		apiKey: 'lingo_test',
		fetch: async (_input, init) => {
			bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
			return new Response(JSON.stringify(options.answer ?? answer), { headers: { 'Content-Type': 'application/json' } });
		}
	});
	const code = await push({
		api,
		config: parseConfig(options.config ?? {}),
		root,
		overwrite: options.overwrite,
		dryRun: options.dryRun,
		log: (line) => lines.push(line),
		warn: (line) => warnings.push(line)
	});

	return { code, bodies, lines, warnings };
}

test('push sends every locale file to the chosen branch, adding only by default', async () => {
	const root = await project({ 'messages/en.json': { happy_elephant_jump: 'Hello' }, 'messages/fr-ca.json': { happy_elephant_jump: 'Bonjour' }, 'messages/notes.txt': 'x' });
	const { code, bodies, lines, warnings } = await run(root, { config: { branch: 'feature-login' } });

	assert.equal(code, 0);
	assert.equal(bodies[0]!.branch, 'feature-login');
	assert.equal(bodies[0]!.mode, 'fill-empty');
	assert.deepEqual(bodies[0]!.files, [
		{ locale: 'en', content: { happy_elephant_jump: 'Hello' } },
		{ locale: 'fr-ca', content: { happy_elephant_jump: 'Bonjour' } }
	]);
	assert.match(lines.join('\n'), /branch development[\s\S]*1 new key, 2 new values, 0 values updated/);
	assert.match(warnings.join('\n'), /1 value differs from Lingo and was left as Lingo has it/);
});

test('--overwrite and --dry-run are passed on', async () => {
	const root = await project({ 'messages/en.json': { a: 'A' } });
	const { bodies, lines, warnings } = await run(root, { overwrite: true, dryRun: true, answer: { ...answer, mode: 'overwrite', dryRun: true, summary: undefined } });

	assert.equal(bodies[0]!.mode, 'overwrite');
	assert.equal(bodies[0]!.dryRun, true);
	assert.match(lines.join('\n'), /Would push[\s\S]*1 new key, 2 new values, 1 value to update/);
	assert.equal(warnings.length, 0);
});

test('push with no files says so', async () => {
	const { code, bodies, warnings } = await run(await project({}));

	assert.equal(code, 1);
	assert.equal(bodies.length, 0);
	assert.match(warnings.join('\n'), /nothing to push/);
});

test('locale files are found by the output pattern', async () => {
	const root = await project({ 'locales/en/app.json': { a: 'A' }, 'locales/zh-Hans/app.json': { a: '甲' }, 'locales/README.md': '' });

	assert.deepEqual((await findLocaleFiles(root, './locales/{locale}/app.json')).map((file) => file.locale), ['en', 'zh-Hans']);
	assert.deepEqual((await findLocaleFiles(root, 'locales/{locale}/app.json', ['en'])).map((file) => file.locale), ['en']);
	await assert.rejects(findLocaleFiles(await project({ 'messages/en.json': '{' }), 'messages/{locale}.json'), /isn't valid JSON/);
});
