import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { visualizeFunctionFlowCommandId } from '../integration/commandIds';
import { supportedLanguageIds } from '../integration/documentSelector';
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
			properties?: Record<string, {
				default?: unknown;
				items?: unknown;
			}>;
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

		assert.ok(commandIds.includes(visualizeFunctionFlowCommandId));
		assert.ok(!commandIds.includes('glitchlens.helloWorld'));
		assert.ok(!JSON.stringify(packageJson).toLowerCase().includes('llm'));
	});

	test('activates for the visualization command and registered language targets', () => {
		const activationEvents = packageJson.activationEvents ?? [];

		assert.ok(activationEvents.includes(`onCommand:${visualizeFunctionFlowCommandId}`));
		for (const languageId of supportedLanguageIds) {
			assert.ok(activationEvents.includes(`onLanguage:${languageId}`));
		}
		assert.ok(activationEvents.includes('onLanguage:python'));
		assert.ok(!activationEvents.includes('onLanguage:java'));
		assert.ok(!activationEvents.includes('onLanguage:go'));
		assert.ok(!activationEvents.includes('onLanguage:csharp'));
	});

	test('keeps package command and language selectors aligned with implementation sources of truth', () => {
		const commandIds = packageJson.contributes?.commands?.map(command => command.command) ?? [];
		const activationEvents = packageJson.activationEvents ?? [];
		const supportedLanguages = packageJson.contributes?.configuration?.properties?.['glitchlens.supportedLanguages']?.default;

		assert.deepStrictEqual(commandIds, [visualizeFunctionFlowCommandId]);
		assert.ok(activationEvents.includes(`onCommand:${visualizeFunctionFlowCommandId}`));
		assert.deepStrictEqual(supportedLanguages, [...supportedLanguageIds]);
	});

	test('declares workspace trust and CodeLens configuration boundaries', () => {
		const properties = packageJson.contributes?.configuration?.properties ?? {};
		const trustDescription = packageJson.capabilities?.untrustedWorkspaces?.description ?? '';

		assert.strictEqual(packageJson.capabilities?.untrustedWorkspaces?.supported, 'limited');
		assert.ok(trustDescription.includes('Restricted Mode'));
		assert.ok(trustDescription.includes('disabled'));
		assert.ok(Object.hasOwn(properties, 'glitchlens.codeLens.enabled'));
		assert.ok(Object.hasOwn(properties, 'glitchlens.supportedLanguages'));
	});

	test('keeps manifest and runtime trust guard policy aligned', () => {
		const packageText = fs.readFileSync(packageJsonPath, 'utf8');
		const trustSource = [
			fs.readFileSync(path.resolve(__dirname, '../../src/integration/workspaceTrust.ts'), 'utf8'),
			fs.readFileSync(path.resolve(__dirname, '../../src/integration/workspaceTrustPolicy.ts'), 'utf8'),
		].join('\n');

		assert.ok(packageText.includes('"supported": "limited"'));
		assert.ok(trustSource.includes('canExecuteCommand'));
		assert.ok(trustSource.includes('canProvideCodeLens'));
		assert.ok(trustSource.includes('canShowVisualization'));
		assert.ok(trustSource.includes('canWriteClipboard'));
		assert.ok(trustSource.includes('Restricted Mode'));
	});

	test('does not register external egress LLM runtime trace or process execution paths', () => {
		const projectSource = [
			fs.readFileSync(packageJsonPath, 'utf8'),
			...[
				path.resolve(__dirname, '../../src/extension.ts'),
				path.resolve(__dirname, '../../src/application'),
				path.resolve(__dirname, '../../src/analyzers'),
				path.resolve(__dirname, '../../src/flow-model'),
				path.resolve(__dirname, '../../src/integration'),
				path.resolve(__dirname, '../../src/renderer'),
			].flatMap(readTree),
		].join('\n');
		const commandIds = packageJson.contributes?.commands?.map(command => command.command) ?? [];
		const lower = projectSource.toLowerCase();

		assert.deepStrictEqual(commandIds, ['glitchlens.visualizeFunctionFlow']);
		assert.ok(!/\bfetch\s*\(/.test(projectSource));
		assert.ok(!/\bxmlhttprequest\b/i.test(projectSource));
		assert.ok(!/\bwebsocket\b/i.test(projectSource));
		assert.ok(!/\btelemetry\b/i.test(projectSource));
		assert.ok(!/\bupload\b/i.test(projectSource));
		assert.ok(!/\bhttps?\s*\./.test(projectSource));
		assert.ok(!/from ['"](?:node:)?(?:child_process|vm|inspector|trace_events|worker_threads)['"]/.test(projectSource));
		assert.ok(!/\b(?:spawn|exec|fork|trace)\s*\(/.test(projectSource));
		assert.ok(!lower.includes('openai'));
		assert.ok(!lower.includes('anthropic'));
		assert.ok(!lower.includes('llm'));
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
		const commandPath = path.resolve(__dirname, '../../src/integration/codeLensCommands.ts');

		assert.ok(fs.existsSync(providerPath));
		assert.ok(fs.existsSync(commandPath));

		const source = `${fs.readFileSync(providerPath, 'utf8')}\n${fs.readFileSync(commandPath, 'utf8')}`;
		assert.ok(source.includes('registerGlitchLensCodeLensProvider'));
		assert.ok(source.includes('registerCodeLensProvider'));
		assert.ok(source.includes('visualizeFunctionFlowCommandId'));
		assert.ok(source.includes('functionRange'));
		assert.ok(source.includes('findFunctionCandidates'));
	});

	test('keeps extension entry thin and delegates lifecycle registration to integration composition', () => {
		const extensionSource = fs.readFileSync(path.resolve(__dirname, '../../src/extension.ts'), 'utf8');
		const entrySource = fs.readFileSync(path.resolve(__dirname, '../../src/integration/extensionEntry.ts'), 'utf8');
		const adapterSource = fs.readFileSync(path.resolve(__dirname, '../../src/integration/vscodeAdapters.ts'), 'utf8');

		assert.ok(extensionSource.includes('registerGlitchLensExtension(context)'));
		assert.ok(!extensionSource.includes('MermaidRenderer'));
		assert.ok(!extensionSource.includes('TypeScriptAnalyzer'));
		assert.ok(!extensionSource.includes('VisualizeFunctionFlowUseCase'));
		assert.ok(!extensionSource.includes('registerCommand'));
		assert.ok(!extensionSource.includes('registerCodeLensProvider'));

		assert.ok(entrySource.includes('context.subscriptions.push(view)'));
		assert.ok(entrySource.includes('registerGlitchLensCommands(context, controller)'));
		assert.ok(entrySource.includes('registerGlitchLensCodeLensProvider(context, locatorRegistry)'));
		assert.ok(entrySource.includes('onDidGrantWorkspaceTrust'));
		assert.ok(adapterSource.includes('VsCodeClipboardAdapter'));
		assert.ok(adapterSource.includes('getWorkspaceTrustGuard'));
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

		const candidates = findFunctionCandidates({
			uri: 'file:///workspace/source.ts',
			languageId: 'typescript',
			version: 1,
			text: source,
		});

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

function readTree(root: string): string[] {
	if (!fs.existsSync(root)) {
		return [];
	}
	const stat = fs.statSync(root);
	if (stat.isFile() && root.endsWith('.ts')) {
		return [fs.readFileSync(root, 'utf8')];
	}
	if (!stat.isDirectory()) {
		return [];
	}
	return fs.readdirSync(root).flatMap(entry => readTree(path.join(root, entry)));
}
