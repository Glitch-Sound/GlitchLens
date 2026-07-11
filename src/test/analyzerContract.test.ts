import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import {
	AnalyzerFactory,
	TypeScriptAnalyzer,
	type AnalyzerError,
	type AnalyzerInput,
	type AnalyzerResult,
	type LanguageAnalyzer,
} from '../analyzers';

suite('Language Analyzer contract', () => {
	test('selects the TypeScript analyzer for TypeScript and JavaScript', () => {
		const factory = new AnalyzerFactory([new TypeScriptAnalyzer()]);

		const typescript = factory.createAnalyzer('typescript');
		const javascript = factory.createAnalyzer('javascript');

		assert.strictEqual(typescript.status, 'found');
		assert.strictEqual(javascript.status, 'found');
		if (typescript.status === 'found' && javascript.status === 'found') {
			assert.deepStrictEqual(typescript.analyzer.languageIds, ['typescript', 'javascript']);
			assert.strictEqual(typescript.analyzer.id, 'typescript');
			assert.strictEqual(javascript.analyzer.id, 'typescript');
		}
	});

	test('returns AnalyzerError for unsupported languages before analysis starts', () => {
		const factory = new AnalyzerFactory([new TypeScriptAnalyzer()]);
		const result = factory.createAnalyzer('python');

		assert.deepStrictEqual(result, {
			status: 'error',
			error: {
				kind: 'unsupported-language',
				message: 'No analyzer is registered for language "python".',
				languageId: 'python',
			},
		});
	});

	test('allows future analyzers without changing the factory', () => {
		const pythonAnalyzer: LanguageAnalyzer = {
			id: 'python',
			version: '0.1.0',
			languageIds: ['python'],
			analyze: async () => failure('analysis-not-implemented', 'Python analyzer is not implemented.'),
		};
		const factory = new AnalyzerFactory([new TypeScriptAnalyzer(), pythonAnalyzer]);
		const result = factory.createAnalyzer('python');

		assert.strictEqual(result.status, 'found');
		if (result.status === 'found') {
			assert.strictEqual(result.analyzer.id, 'python');
		}
	});

	test('defines AnalyzerResult and AnalyzerError contracts for analyzers', async () => {
		const analyzer = new TypeScriptAnalyzer();
		const result = await analyzer.analyze(input('typescript'));

		assert.strictEqual(result.status, 'success');
		if (result.status === 'success') {
			assert.strictEqual(result.completeness, 'complete');
			assert.strictEqual(result.model.metadata.analyzerId, 'typescript');
		}
	});

	test('keeps AnalyzerResult status completeness and payload shape consistent', async () => {
		const analyzer = new TypeScriptAnalyzer();
		const complete = await analyzer.analyze(input('typescript'));
		const partial = await analyzer.analyze(input('javascript', 'function sample(callbacks, index) { callbacks[index](); }'));
		const failed = await analyzer.analyze(input('typescript', 'const outside = 1;', 3));
		const cancelled = await analyzer.analyze({ ...input('typescript'), cancellation: { isCancellationRequested: true } });

		assertResultContract(complete);
		assertResultContract(partial);
		assertResultContract(failed);
		assertResultContract(cancelled);
	});

	test('returns AnalyzerError when TypeScriptAnalyzer is called directly with unsupported language', async () => {
		const result = await new TypeScriptAnalyzer().analyze(input('python'));

		assert.strictEqual(result.status, 'failed');
		if (result.status !== 'failed') {return;}
		assert.strictEqual(result.completeness, 'failed');
		assert.strictEqual(result.error.kind, 'unsupported-language');
		assert.strictEqual(result.error.languageId, 'python');
	});

	test('keeps analyzers independent from VS Code, Mermaid, WebView, and Clipboard APIs', () => {
		const analyzerRoot = path.resolve(__dirname, '../../src/analyzers');
		const offenders = listTypeScriptFiles(analyzerRoot).filter(file => {
			const source = fs.readFileSync(file, 'utf8');

			return /from ['"]vscode['"]/.test(source)
				|| source.includes('vscode.')
				|| source.includes('Mermaid')
				|| source.includes('Webview')
				|| source.includes('Clipboard');
		});

		assert.deepStrictEqual(offenders, []);
	});

	test('keeps TypeScript Compiler API usage inside the TypeScript analyzer boundary only', () => {
		const analyzerRoot = path.resolve(__dirname, '../../src/analyzers');
		const offenders = listTypeScriptFiles(analyzerRoot).filter(file => {
			const source = fs.readFileSync(file, 'utf8');
			const importsTypeScript = /from ['"]typescript['"]/.test(source);
			const isTypeScriptAnalyzerBoundary = file.includes(`${path.sep}typescript${path.sep}`);

			return importsTypeScript && !isTypeScriptAnalyzerBoundary;
		});

		assert.deepStrictEqual(offenders, []);
	});

	test('does not use runtime execution or tracing APIs inside analyzers', () => {
		const analyzerRoot = path.resolve(__dirname, '../../src/analyzers');
		const offenders = listTypeScriptFiles(analyzerRoot).filter(file => {
			const source = fs.readFileSync(file, 'utf8');

			return /\beval\s*\(/.test(source)
				|| /\bnew\s+Function\s*\(/.test(source)
				|| /from ['"](?:node:)?(?:vm|child_process)['"]/.test(source)
				|| source.includes('spawn(')
				|| source.includes('exec(')
				|| source.includes('traceEvents');
		});

		assert.deepStrictEqual(offenders, []);
	});
});

function input(languageId: string, text = 'export function sample() { return 1; }', cursorOffset = 16): AnalyzerInput {
	return {
		source: {
			uri: 'file:///workspace/source.ts',
			languageId,
			version: 1,
			text,
		},
		cursorOffset,
		configuration: {
			configurationDigest: 'sha256:test',
		},
		cancellation: {
			isCancellationRequested: false,
		},
	};
}

function assertResultContract(result: AnalyzerResult): void {
	if (result.status === 'success' || result.status === 'partial') {
		assert.ok('model' in result);
		assert.strictEqual('error' in result, false);
		assert.strictEqual(result.model.completeness, result.completeness);
		assert.strictEqual(result.model.metadata.completeness, result.completeness);
		assert.ok(result.completeness === 'complete' || result.completeness === 'partial');
		return;
	}

	assert.strictEqual(result.status, 'failed');
	assert.strictEqual(result.completeness, 'failed');
	assert.ok('error' in result);
	assert.ok(!('model' in result));
}

function failure(kind: AnalyzerError['kind'], message: string): Promise<AnalyzerResult> {
	return Promise.resolve({
		status: 'failed',
		completeness: 'failed',
		diagnostics: [],
		error: {
			kind,
			message,
			analyzerId: 'python',
			languageId: 'python',
		},
	});
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
