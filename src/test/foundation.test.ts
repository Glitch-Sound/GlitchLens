import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { findFunctionCandidates } from '../integration/functionRanges';

interface PackageJson {
	scripts?: Record<string, string>;
	activationEvents?: string[];
	contributes?: {
		commands?: Array<{
			command: string;
			title: string;
		}>;
		configuration?: {
			properties?: Record<string, unknown>;
		};
	};
	capabilities?: {
		untrustedWorkspaces?: {
			supported?: boolean | 'limited';
			description?: string;
		};
	};
}

const packageJsonPath = path.resolve(__dirname, '../../package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as PackageJson;

suite('GlitchLens foundation', () => {
	test('contributes the function flow visualization command without template commands', () => {
		const commands = packageJson.contributes?.commands ?? [];
		const commandIds = commands.map(command => command.command);

		assert.ok(commandIds.includes('glitchlens.visualizeFunctionFlow'));
		assert.ok(!commandIds.includes('glitchlens.helloWorld'));
		assert.ok(!JSON.stringify(packageJson).toLowerCase().includes('llm'));
	});

	test('activates only for the visualization command and initial TypeScript JavaScript targets', () => {
		const activationEvents = packageJson.activationEvents ?? [];

		assert.ok(activationEvents.includes('onCommand:glitchlens.visualizeFunctionFlow'));
		assert.ok(activationEvents.includes('onLanguage:typescript'));
		assert.ok(activationEvents.includes('onLanguage:javascript'));
		assert.ok(!activationEvents.includes('onLanguage:python'));
		assert.ok(!activationEvents.includes('onLanguage:java'));
		assert.ok(!activationEvents.includes('onLanguage:go'));
		assert.ok(!activationEvents.includes('onLanguage:csharp'));
	});

	test('declares workspace trust and CodeLens configuration boundaries', () => {
		const properties = packageJson.contributes?.configuration?.properties ?? {};

		assert.strictEqual(packageJson.capabilities?.untrustedWorkspaces?.supported, 'limited');
		assert.ok(Object.hasOwn(properties, 'glitchlens.codeLens.enabled'));
		assert.ok(Object.hasOwn(properties, 'glitchlens.supportedLanguages'));
	});

	test('separates unit and VS Code integration validation scripts', () => {
		const scripts = packageJson.scripts ?? {};

		assert.ok(Object.hasOwn(scripts, 'test:unit'));
		assert.ok(Object.hasOwn(scripts, 'test:integration'));
		assert.ok(scripts['test:unit'].includes('mocha'));
		assert.ok(scripts['test:integration'].includes('vscode-test'));
	});

	test('provides a CodeLens registration boundary using the visualization command', () => {
		const providerPath = path.resolve(__dirname, '../../src/integration/codeLensProvider.ts');

		assert.ok(fs.existsSync(providerPath));

		const source = fs.readFileSync(providerPath, 'utf8');
		assert.ok(source.includes('registerGlitchLensCodeLensProvider'));
		assert.ok(source.includes('registerCodeLensProvider'));
		assert.ok(source.includes('visualizeFunctionFlowCommandId'));
		assert.ok(source.includes('functionRange'));
		assert.ok(source.includes('findFunctionCandidates'));
	});

	test('detects lightweight function candidates for CodeLens ranges', () => {
		const source = [
			'const ignored = 1;',
			'export async function loadUser(id: string) {',
			'  return fetchUser(id);',
			'}',
			'const saveUser = async (user) => {',
			'  return persist(user);',
			'};',
		].join('\n');

		const candidates = findFunctionCandidates(source);

		assert.deepStrictEqual(candidates.map(candidate => candidate.name), ['loadUser', 'saveUser']);
		assert.deepStrictEqual(candidates[0].range, {
			startLine: 1,
			startCharacter: 22,
			endLine: 1,
			endCharacter: 30,
		});
		assert.deepStrictEqual(candidates[1].range, {
			startLine: 4,
			startCharacter: 6,
			endLine: 4,
			endCharacter: 14,
		});
	});

	test('keeps vscode imports inside extension and integration boundaries', () => {
		const sourceRoot = path.resolve(__dirname, '..');
		const files = listTypeScriptFiles(sourceRoot);
		const offenders = files.filter(file => {
			const relative = path.relative(sourceRoot, file);
			const isAllowed = relative === 'extension.ts' || relative.startsWith(`integration${path.sep}`) || relative.startsWith(`test${path.sep}`);
			const source = fs.readFileSync(file, 'utf8');

			return !isAllowed && source.includes('from \'vscode\'');
		});

		assert.deepStrictEqual(offenders, []);
	});
});

function listTypeScriptFiles(directory: string): string[] {
	const entries = fs.readdirSync(directory, { withFileTypes: true });
	const files: string[] = [];

	for (const entry of entries) {
		const fullPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...listTypeScriptFiles(fullPath));
		} else if (entry.isFile() && entry.name.endsWith('.ts')) {
			files.push(fullPath);
		}
	}

	return files;
}
