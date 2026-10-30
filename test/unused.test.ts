import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { markUsed, unused } from '../src/commands/unused.ts';
import { parseConfig } from '../src/config.ts';

async function project(files: Record<string, unknown>) {
	const root = await mkdtemp(join(tmpdir(), 'lingo-'));

	for (const [path, content] of Object.entries(files)) {
		await mkdir(join(root, path, '..'), { recursive: true });
		await writeFile(join(root, path), typeof content === 'string' ? content : JSON.stringify(content));
	}

	return root;
}

async function run(root: string, config: unknown = {}) {
	const lines: string[] = [];
	const warnings: string[] = [];
	const code = await unused({ config: parseConfig(config), root, log: (line) => lines.push(line), warn: (line) => warnings.push(line) });
	return { code, output: lines.join('\n'), warnings: warnings.join('\n') };
}

test('a key counts as used however it is written', () => {
	const keys = new Set(['save_button', 'cart.title', 'happy-elephant', 'plain', 'never', 'save']);

	markUsed("m.save_button() t('cart.title') <Text key=\"happy-elephant\" /> const plain = 1", keys);

	// `save` is part of `save_button`, not a mention of its own.
	assert.deepEqual([...keys], ['never', 'save']);
});

test('unused lists keys no source file mentions', async () => {
	const root = await project({
		'messages/en.json': { $schema: 'x', used_key: 'A', old_key: 'B', status_open: 'Open' },
		'messages/fr.json': { used_key: 'A', only_in_french: 'C' },
		'src/app.ts': 'console.log(m.used_key())',
		// Not code, so a mention here doesn't count.
		'src/notes.txt': 'old_key'
	});
	const { code, output, warnings } = await run(root, { ignoreKeys: ['status_*'] });

	assert.equal(code, 1);
	assert.match(output, /Checked 3 keys .* against 1 source file/);
	assert.match(output, /2 keys are not used:\n\s+old_key\n\s+only_in_french$/);
	assert.match(warnings, /ignoreKeys/);
});

test('unused passes when every key is used', async () => {
	const root = await project({ 'messages/en.json': { hello: 'Hi' }, 'app/page.svelte': '<Text key="hello" />' });
	const { code, output } = await run(root, { source: ['app'] });

	assert.equal(code, 0);
	assert.match(output, /Every key is used/);
});

test('a missing source folder is explained', async () => {
	const { code, warnings } = await run(await project({ 'messages/en.json': { hello: 'Hi' } }));

	assert.equal(code, 1);
	assert.match(warnings, /source folder src doesn't exist/);
});
