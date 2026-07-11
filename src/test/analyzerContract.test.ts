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

	test('defines AnalyzerResult and AnalyzerError contracts for skeleton analyzers', async () => {
		const analyzer = new TypeScriptAnalyzer();
		const result = await analyzer.analyze(input('typescript'));

		assert.deepStrictEqual(result, {
			status: 'failed',
			completeness: 'failed',
			diagnostics: [],
			error: {
				kind: 'analysis-not-implemented',
				message: 'TypeScriptAnalyzer skeleton does not perform AST analysis yet.',
				analyzerId: 'typescript',
				languageId: 'typescript',
			},
		});
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
});

function input(languageId: string): AnalyzerInput {
	return {
		source: {
			uri: 'file:///workspace/source.ts',
			languageId,
			version: 1,
			text: 'export function sample() { return 1; }',
		},
		cursorOffset: 16,
		configuration: {
			configurationDigest: 'sha256:test',
		},
		cancellation: {
			isCancellationRequested: false,
		},
	};
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
