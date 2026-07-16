import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

import { TypeScriptAnalyzer } from '../analyzers';

interface PackageJson {
	readonly contributes?: {
		readonly commands?: ReadonlyArray<{ readonly command: string; readonly title?: string }>;
		readonly configuration?: {
			readonly properties?: Record<string, unknown>;
		};
	};
	readonly dependencies?: Record<string, string>;
	readonly devDependencies?: Record<string, string>;
}

interface ProductionSourceFile {
	readonly path: string;
	readonly sourceFile: ts.SourceFile;
}

suite('Local static analysis safety boundary', () => {
	const projectRoot = path.resolve(__dirname, '../..');
	const packageJsonPath = path.join(projectRoot, 'package.json');
	const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as PackageJson;
	const productionFiles = productionTypeScriptFiles(projectRoot);

	test('does not execute target code callee bodies callbacks eval or Function constructors during analysis', async () => {
		let getterInvoked = false;
		let callbackInvoked = false;
		let evalInvoked = false;
		let constructorInvoked = false;
		const source = [
			'function target(callback) {',
			'  callback(() => { callbackInvoked = true; });',
			'  dangerousGetter.value;',
			'  eval("evalInvoked = true");',
			'  Function("constructorInvoked = true")();',
			'  callee();',
			'}',
			'const dangerousGetter = { get value() { getterInvoked = true; return 1; } };',
			'function callee() { throw new Error("callee body must not run"); }',
		].join('\n');

		const result = await new TypeScriptAnalyzer().analyze({
			source: {
				uri: 'file:///workspace/safety.js',
				languageId: 'javascript',
				version: 1,
				text: source,
			},
			cursorOffset: source.indexOf('target'),
			configuration: { configurationDigest: 'sha256:safety' },
			cancellation: { isCancellationRequested: false },
		});

		assert.ok(result.status === 'success' || result.status === 'partial');
		assert.strictEqual(getterInvoked, false);
		assert.strictEqual(callbackInvoked, false);
		assert.strictEqual(evalInvoked, false);
		assert.strictEqual(constructorInvoked, false);
		if (result.status === 'success' || result.status === 'partial') {
			const calls = result.model.nodes.flatMap(node => node.kind === 'call' ? [node.calleeName] : []);
			assert.ok(calls.includes('callback'));
			assert.ok(calls.includes('eval'));
			assert.ok(calls.includes('Function'));
			assert.ok(calls.includes('callee'));
		}
	});

	test('production source has no execution tracing process worker vm eval or Function-constructor APIs', () => {
		const offenders = productionFiles.flatMap(file => forbiddenRuntimeFindings(file));

		assert.deepStrictEqual(offenders, []);
	});

	test('production source has no external network telemetry analytics upload or LLM API paths', () => {
		const offenders = productionFiles.flatMap(file => forbiddenEgressFindings(file));
		const packageText = JSON.stringify(packageJson).toLowerCase();

		assert.deepStrictEqual(offenders, []);
		assert.ok(!packageText.includes('openai'));
		assert.ok(!packageText.includes('anthropic'));
		assert.ok(!packageText.includes('telemetry'));
		assert.ok(!packageText.includes('analytics'));
		assert.ok(!packageText.includes('upload'));
		assert.ok(!packageText.includes('llm'));
	});

	test('package commands configuration and dependencies expose no LLM upload telemetry or external analyzer capability', () => {
		const productionDependencies = Object.keys(packageJson.dependencies ?? {});
		const devDependencies = Object.keys(packageJson.devDependencies ?? {});
		const commandAndConfiguration = JSON.stringify({
			commands: packageJson.contributes?.commands ?? [],
			configuration: packageJson.contributes?.configuration ?? {},
		}).toLowerCase();

		assert.deepStrictEqual(productionDependencies.sort(), ['@lezer/python', 'mermaid']);
		assert.deepStrictEqual(productionDependencies.filter(isExternalAnalyzerOrLlmDependency), []);
		assert.deepStrictEqual(devDependencies.filter(isExternalAnalyzerOrLlmDependency), []);
		for (const term of ['llm', 'openai', 'anthropic', 'telemetry', 'analytics', 'upload']) {
			assert.ok(!commandAndConfiguration.includes(term), term);
		}
	});

	test('cache and integration state remain in process memory without file database or VS Code storage persistence', () => {
		const persistenceFindings = productionFiles.flatMap(file => forbiddenPersistenceFindings(file));
		const cacheSource = fs.readFileSync(path.join(projectRoot, 'src/application/cache.ts'), 'utf8');
		const adapterSource = fs.readFileSync(path.join(projectRoot, 'src/integration/vscodeAdapters.ts'), 'utf8');

		assert.deepStrictEqual(persistenceFindings, []);
		assert.ok(cacheSource.includes('new Map<string, AnalysisCacheEntry>()'));
		assert.ok(!cacheSource.includes('fs.'));
		assert.ok(!cacheSource.includes('globalStorage'));
		assert.ok(adapterSource.includes('new AnalysisCache()'));
	});

	test('Webview CSP allows no external connections and clipboard writes are only user-message initiated', () => {
		const viewSource = fs.readFileSync(path.join(projectRoot, 'src/integration/visualizationView.ts'), 'utf8');
		const adapterSource = fs.readFileSync(path.join(projectRoot, 'src/integration/vscodeAdapters.ts'), 'utf8');

		assert.ok(viewSource.includes("default-src 'none'"));
		assert.ok(viewSource.includes("img-src data:"));
		assert.ok(!viewSource.includes('https://'));
		assert.ok(!viewSource.includes('http://'));
		assert.ok(!viewSource.includes('connect-src'));
		assert.ok(viewSource.includes("allowed.type === 'copyMermaid'"));
		assert.ok(viewSource.includes('viewId !== this.currentViewId'));
		assert.strictEqual(countOccurrences(adapterSource, 'clipboard.writeText'), 1);
		assert.ok(adapterSource.includes('class VsCodeClipboardAdapter'));
	});

	test('production source does not log source text FlowModel Mermaid text or diagnostics bodies', () => {
		const logFindings = productionFiles.flatMap(file => forbiddenLogFindings(file));

		assert.deepStrictEqual(logFindings, []);
	});
});

function productionTypeScriptFiles(projectRoot: string): readonly ProductionSourceFile[] {
	const sourceRoot = path.join(projectRoot, 'src');
	return listTypeScriptFiles(sourceRoot)
		.filter(file => !path.relative(sourceRoot, file).startsWith(`test${path.sep}`))
		.map(file => ({
			path: file,
			sourceFile: ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
		}));
}

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

function forbiddenRuntimeFindings(file: ProductionSourceFile): readonly string[] {
	const forbiddenModules = new Set(['child_process', 'node:child_process', 'worker_threads', 'node:worker_threads', 'vm', 'node:vm', 'inspector', 'node:inspector', 'trace_events', 'node:trace_events']);
	const forbiddenCalls = new Set(['eval', 'spawn', 'exec', 'execFile', 'fork']);
	return inspectSource(file, node => {
		if (isImportFrom(node, forbiddenModules) || isRequireOf(node, forbiddenModules) || isDynamicImportOf(node, forbiddenModules)) {
			return describe(file, node, 'forbidden runtime module');
		}
		if (ts.isCallExpression(node) && isIdentifierCalled(node, forbiddenCalls)) {
			return describe(file, node, `forbidden runtime call ${node.expression.getText(file.sourceFile)}`);
		}
		if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Function') {
			return describe(file, node, 'forbidden Function constructor');
		}
		if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Function') {
			return describe(file, node, 'forbidden Function constructor call');
		}
		return undefined;
	});
}

function forbiddenEgressFindings(file: ProductionSourceFile): readonly string[] {
	const forbiddenModules = new Set(['http', 'node:http', 'https', 'node:https', 'net', 'node:net', 'tls', 'node:tls', 'ws', 'undici', 'openai', '@anthropic-ai/sdk', '@azure/openai']);
	const forbiddenCalls = new Set(['fetch', 'XMLHttpRequest', 'WebSocket', 'sendBeacon']);
	return inspectSource(file, node => {
		if (isImportFrom(node, forbiddenModules) || isRequireOf(node, forbiddenModules) || isDynamicImportOf(node, forbiddenModules)) {
			return describe(file, node, 'forbidden external egress module');
		}
		if (ts.isCallExpression(node) && isIdentifierCalled(node, forbiddenCalls)) {
			return describe(file, node, `forbidden external egress call ${node.expression.getText(file.sourceFile)}`);
		}
		if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && forbiddenCalls.has(node.expression.text)) {
			return describe(file, node, `forbidden external egress constructor ${node.expression.text}`);
		}
		return undefined;
	});
}

function forbiddenPersistenceFindings(file: ProductionSourceFile): readonly string[] {
	const forbiddenModules = new Set(['fs', 'node:fs', 'fs/promises', 'node:fs/promises', 'sqlite3', 'better-sqlite3']);
	const forbiddenCalls = new Set(['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'createWriteStream']);
	return inspectSource(file, node => {
		if (isImportFrom(node, forbiddenModules) || isRequireOf(node, forbiddenModules) || isDynamicImportOf(node, forbiddenModules)) {
			if (path.basename(file.path) === 'visualizationView.ts') {
				return undefined;
			}
			return describe(file, node, 'forbidden persistence module');
		}
		if (ts.isCallExpression(node) && isIdentifierCalled(node, forbiddenCalls)) {
			return describe(file, node, `forbidden persistence call ${node.expression.getText(file.sourceFile)}`);
		}
		if (ts.isPropertyAccessExpression(node) && ['globalStorageUri', 'storageUri', 'workspaceState', 'globalState'].includes(node.name.text)) {
			return describe(file, node, `forbidden VS Code storage ${node.name.text}`);
		}
		return undefined;
	});
}

function forbiddenLogFindings(file: ProductionSourceFile): readonly string[] {
	return inspectSource(file, node => {
		if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
			const owner = node.expression.expression.getText(file.sourceFile);
			const method = node.expression.name.text;
			if (owner === 'console' || method === 'appendLine') {
				return describe(file, node, `forbidden production log call ${owner}.${method}`);
			}
		}
		if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'createOutputChannel') {
			return describe(file, node, 'forbidden output channel');
		}
		return undefined;
	});
}

function inspectSource(file: ProductionSourceFile, inspect: (node: ts.Node) => string | undefined): readonly string[] {
	const findings: string[] = [];
	const visit = (node: ts.Node): void => {
		const finding = inspect(node);
		if (finding) {
			findings.push(finding);
		}
		node.forEachChild(visit);
	};
	visit(file.sourceFile);
	return findings;
}

function isImportFrom(node: ts.Node, forbiddenModules: ReadonlySet<string>): boolean {
	if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
		return Boolean(node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && forbiddenModules.has(node.moduleSpecifier.text));
	}
	return false;
}

function isRequireOf(node: ts.Node, forbiddenModules: ReadonlySet<string>): boolean {
	return ts.isCallExpression(node)
		&& ts.isIdentifier(node.expression)
		&& node.expression.text === 'require'
		&& node.arguments.length === 1
		&& ts.isStringLiteral(node.arguments[0])
		&& forbiddenModules.has(node.arguments[0].text);
}

function isDynamicImportOf(node: ts.Node, forbiddenModules: ReadonlySet<string>): boolean {
	return ts.isCallExpression(node)
		&& node.expression.kind === ts.SyntaxKind.ImportKeyword
		&& node.arguments.length === 1
		&& ts.isStringLiteral(node.arguments[0])
		&& forbiddenModules.has(node.arguments[0].text);
}

function isIdentifierCalled(node: ts.CallExpression, forbiddenCalls: ReadonlySet<string>): boolean {
	if (ts.isIdentifier(node.expression)) {
		return forbiddenCalls.has(node.expression.text);
	}
	if (ts.isPropertyAccessExpression(node.expression)) {
		return forbiddenCalls.has(node.expression.name.text);
	}
	return false;
}

function describe(file: ProductionSourceFile, node: ts.Node, message: string): string {
	const position = file.sourceFile.getLineAndCharacterOfPosition(node.getStart(file.sourceFile));
	return `${path.relative(path.resolve(__dirname, '../..'), file.path)}:${position.line + 1}:${position.character + 1}: ${message}`;
}

function isExternalAnalyzerOrLlmDependency(name: string): boolean {
	const lower = name.toLowerCase();
	return lower.includes('openai')
		|| lower.includes('anthropic')
		|| lower.includes('telemetry')
		|| lower.includes('analytics')
		|| lower.includes('sentry')
		|| lower === 'ws'
		|| lower === 'undici'
		|| lower === 'axios'
		|| lower === 'node-fetch';
}

function countOccurrences(source: string, fragment: string): number {
	return source.split(fragment).length - 1;
}
