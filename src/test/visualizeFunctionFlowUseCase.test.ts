import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import {
	AnalysisCache,
	AnalyzerRegistry,
	VisualizeFunctionFlowUseCase,
	type CacheKey,
	type VisualizationRequest,
	type VisualizationResult,
} from '../application';
import type {
	AnalyzerInput,
	AnalyzerResult,
	LanguageAnalyzer,
} from '../analyzers';
import type { FlowModel, SourceLocation } from '../flow-model';
import type { RenderResult } from '../renderer';

suite('VisualizeFunctionFlowUseCase', () => {
	test('selects TypeScript and JavaScript analyzers and renders complete success', async () => {
		const analyzer = new StubAnalyzer('typescript', ['typescript', 'javascript'], successResult(createModel()));
		const renderer = new StubRenderer(renderResult('sequenceDiagram\nroot->>load: load\n'));
		const useCase = new VisualizeFunctionFlowUseCase(new AnalyzerRegistry([analyzer]), renderer);

		const typescript = await useCase.execute(request('typescript'));
		const javascript = await useCase.execute(request('javascript'));

		assert.strictEqual(typescript.status, 'success');
		assert.strictEqual(javascript.status, 'success');
		assert.strictEqual(analyzer.calls.length, 2);
		assert.strictEqual(renderer.calls.length, 2);
		assert.strictEqual(typescript.mermaidText, 'sequenceDiagram\nroot->>load: load\n');
		assert.strictEqual(typescript.canCopyMermaid, true);
		assert.deepStrictEqual(typescript.notices, []);
	});

	test('AnalyzerRegistry selects by public LanguageAnalyzer contract without concrete analyzer coupling', async () => {
		const javascriptAnalyzer = new StubAnalyzer('javascript-custom', ['javascript'], successResult(createModel()));
		const typescriptAnalyzer = new StubAnalyzer('typescript-custom', ['typescript'], successResult(createModel()));
		const renderer = new StubRenderer(renderResult('sequenceDiagram\n'));
		const useCase = new VisualizeFunctionFlowUseCase(new AnalyzerRegistry([javascriptAnalyzer, typescriptAnalyzer]), renderer);

		await useCase.execute(request('javascript'));
		await useCase.execute(request('typescript'));

		assert.strictEqual(javascriptAnalyzer.calls.length, 1);
		assert.strictEqual(typescriptAnalyzer.calls.length, 1);
		assert.strictEqual(javascriptAnalyzer.id, 'javascript-custom');
		assert.strictEqual(typescriptAnalyzer.id, 'typescript-custom');
	});

	test('returns unsupported language without invoking analyzer or renderer', async () => {
		const analyzer = new StubAnalyzer('typescript', ['typescript'], successResult(createModel()));
		const renderer = new StubRenderer(renderResult('sequenceDiagram\n'));
		const useCase = new VisualizeFunctionFlowUseCase(new AnalyzerRegistry([analyzer]), renderer);

		const result = await useCase.execute(request('python'));

		assert.strictEqual(result.status, 'unsupported-language');
		assert.strictEqual(analyzer.calls.length, 0);
		assert.strictEqual(renderer.calls.length, 0);
		assertFailureContract(result, 'unsupported-language');
		assert.ok(result.notices.some(notice => notice.kind === 'unsupported-language' && notice.severity === 'error'));
	});

	test('returns target not found without rendering', async () => {
		const analyzer = new StubAnalyzer('typescript', ['typescript'], failureResult('invalid-input', 'Target function was not found.'));
		const renderer = new StubRenderer(renderResult('sequenceDiagram\n'));
		const useCase = new VisualizeFunctionFlowUseCase(new AnalyzerRegistry([analyzer]), renderer);

		const result = await useCase.execute(request('typescript'));

		assert.strictEqual(result.status, 'target-not-found');
		assert.strictEqual(renderer.calls.length, 0);
		assertFailureContract(result, 'target-not-found');
		assert.ok(result.notices.some(notice => notice.kind === 'target-not-found'));
	});

	test('returns partial success with diagnostic and renderer warning notices', async () => {
		const model = createModel({
			completeness: 'partial',
			diagnostics: [
				{
					id: 'diagnostic:unresolved',
					kind: 'unresolved-call',
					severity: 'warning',
					message: 'Could not resolve dynamic call.',
					nodeId: 'node:load',
					sourceLocation: location(2, 2, 2, 14),
				},
			],
		});
		const analyzer = new StubAnalyzer('typescript', ['typescript'], successResult(model, 'partial'));
		const renderer = new StubRenderer(renderResult('sequenceDiagram\n', [
			{
				id: 'warning:edge',
				kind: 'unsupported-edge',
				message: 'Edge could not be rendered.',
				edgeId: 'edge:missing',
				sourceLocation: location(3, 2, 3, 12),
			},
		]));
		const useCase = new VisualizeFunctionFlowUseCase(new AnalyzerRegistry([analyzer]), renderer);

		const result = await useCase.execute(request('typescript'));

		assert.strictEqual(result.status, 'partial');
		assert.strictEqual(result.completeness, 'partial');
		assert.strictEqual(result.canCopyMermaid, true);
		assert.ok(result.notices.some(notice => notice.kind === 'unresolved-call' && notice.sourceLocation));
		assert.ok(result.notices.some(notice => notice.kind === 'renderer-warning' && notice.sourceLocation));
	});

	test('distinguishes cancelled and fatal analyzer failures', async () => {
		const cancelled = new VisualizeFunctionFlowUseCase(
			new AnalyzerRegistry([new StubAnalyzer('typescript', ['typescript'], failureResult('analysis-cancelled', 'Cancelled.'))]),
			new StubRenderer(renderResult('sequenceDiagram\n')),
		);
		const fatal = new VisualizeFunctionFlowUseCase(
			new AnalyzerRegistry([new StubAnalyzer('typescript', ['typescript'], failureResult('analysis-failed', 'Analyzer crashed.'))]),
			new StubRenderer(renderResult('sequenceDiagram\n')),
		);

		const cancelledResult = await cancelled.execute(request('typescript'));
		const fatalResult = await fatal.execute(request('typescript'));

		assert.strictEqual(cancelledResult.status, 'cancelled');
		assert.strictEqual(fatalResult.status, 'failed');
		assertFailureContract(cancelledResult, 'cancelled');
		assertFailureContract(fatalResult, 'failed');
	});

	test('returns render failure when renderer throws', async () => {
		const analyzer = new StubAnalyzer('typescript', ['typescript'], successResult(createModel()));
		const renderer = new StubRenderer(new Error('render failed'));
		const useCase = new VisualizeFunctionFlowUseCase(new AnalyzerRegistry([analyzer]), renderer);

		const result = await useCase.execute(request('typescript'));

		assert.strictEqual(result.status, 'render-failed');
		assertFailureContract(result, 'render-failed');
		assert.ok(result.notices.some(notice => notice.kind === 'render-failed'));
	});

	test('calls analyzer before renderer and does not mutate FlowModel', async () => {
		const events: string[] = [];
		const model = createModel();
		const before = JSON.stringify(model);
		const analyzer = new StubAnalyzer('typescript', ['typescript'], successResult(model), events);
		const renderer = new StubRenderer(renderResult('sequenceDiagram\n'), events);
		const useCase = new VisualizeFunctionFlowUseCase(new AnalyzerRegistry([analyzer]), renderer);

		const result = await useCase.execute(request('typescript'));

		assert.strictEqual(result.status, 'success');
		assert.strictEqual(result.canCopyMermaid, true);
		assert.deepStrictEqual(events, ['analyze', 'render']);
		assert.strictEqual(JSON.stringify(model), before);
		assert.strictEqual(renderer.calls[0], model);
	});

	test('does not invoke renderer for target not found cancelled or fatal analyzer failure', async () => {
		for (const failure of [
			failureResult('invalid-input', 'Target function was not found.'),
			failureResult('analysis-cancelled', 'Cancelled.'),
			failureResult('analysis-failed', 'Analyzer crashed.'),
		]) {
			const renderer = new StubRenderer(renderResult('sequenceDiagram\n'));
			const useCase = new VisualizeFunctionFlowUseCase(
				new AnalyzerRegistry([new StubAnalyzer('typescript', ['typescript'], failure)]),
				renderer,
			);

			await useCase.execute(request('typescript'));

			assert.strictEqual(renderer.calls.length, 0);
		}
	});

	test('keeps visualization results as plain data without UI VS Code or AST objects', async () => {
		const model = createModel();
		const useCase = new VisualizeFunctionFlowUseCase(
			new AnalyzerRegistry([new StubAnalyzer('typescript', ['typescript'], successResult(model))]),
			new StubRenderer(renderResult('sequenceDiagram\n')),
		);

		const result = await useCase.execute(request('typescript'));

		assert.doesNotThrow(() => JSON.stringify(result));
		assertNoForbiddenRuntimeObjects(result);
	});

	test('application layer stays independent from VS Code WebView and Clipboard APIs', () => {
		const applicationRoot = path.resolve(__dirname, '../../src/application');
		const offenders = listTypeScriptFiles(applicationRoot).filter(file => {
			const source = fs.readFileSync(file, 'utf8');
			return /from ['"]vscode['"]/.test(source)
				|| source.includes('vscode.')
				|| source.includes('Webview')
				|| source.includes('Clipboard');
		});

		assert.deepStrictEqual(offenders, []);
	});

	test('application layer does not generate Mermaid syntax or depend on TypeScript AST or Symbol APIs', () => {
		const applicationRoot = path.resolve(__dirname, '../../src/application');
		const offenders = listTypeScriptFiles(applicationRoot).filter(file => {
			const source = fs.readFileSync(file, 'utf8');
			return source.includes('sequenceDiagram')
				|| source.includes('->>')
				|| /from ['"]typescript['"]/.test(source)
				|| /\bts\./.test(source)
				|| /\bSymbol\b/.test(source);
		});

		assert.deepStrictEqual(offenders, []);
	});

	test('deduplicates equivalent diagnostics and renderer warnings as notices', async () => {
		const duplicateLocation = location(2, 2, 2, 14);
		const diagnostic = {
			id: 'diagnostic:dup',
			kind: 'unresolved-call' as const,
			severity: 'warning' as const,
			message: 'Could not resolve dynamic call.',
			nodeId: 'node:load',
			sourceLocation: duplicateLocation,
		};
		const model = createModel({ diagnostics: [diagnostic, { ...diagnostic, id: 'diagnostic:dup-again' }] });
		const rendererWarning = {
			id: 'warning:dup',
			kind: 'unsupported-edge' as const,
			message: 'Could not render edge.',
			edgeId: 'edge:load',
			sourceLocation: duplicateLocation,
		};
		const useCase = new VisualizeFunctionFlowUseCase(
			new AnalyzerRegistry([new StubAnalyzer('typescript', ['typescript'], successResult(model))]),
			new StubRenderer(renderResult('sequenceDiagram\n', [rendererWarning, { ...rendererWarning, id: 'warning:dup-again' }])),
		);

		const result = await useCase.execute(request('typescript'));

		assert.strictEqual(result.status, 'success');
		assert.strictEqual(result.notices.filter(notice => notice.kind === 'unresolved-call').length, 1);
		assert.strictEqual(result.notices.filter(notice => notice.kind === 'renderer-warning').length, 1);
	});

	test('reuses exact cache match without rerunning analyzer or renderer', async () => {
		const analyzer = new StubAnalyzer('typescript', ['typescript'], successResult(createModel()));
		const renderer = new StubRenderer(renderResult('sequenceDiagram\nroot->>load: load\n'));
		const cache = new AnalysisCache();
		const useCase = new VisualizeFunctionFlowUseCase(new AnalyzerRegistry([analyzer]), renderer, cache);
		const input = request('typescript');

		const first = await useCase.execute(input);
		const second = await useCase.execute(input);

		assert.strictEqual(first.status, 'success');
		assert.strictEqual(second.status, 'success');
		assert.strictEqual(second.canCopyMermaid, true);
		assert.strictEqual(analyzer.calls.length, 1);
		assert.strictEqual(renderer.calls.length, 1);
		assert.deepStrictEqual(second, first);
	});

	test('misses cache when document version function range configuration analyzer id or analyzer version differs', async () => {
		const cache = new AnalysisCache();
		const entry = cacheEntry();
		const key = cacheKey();
		cache.set(key, entry);

		assert.ok(cache.get(key));
		assert.strictEqual(cache.get({ ...key, documentVersion: 2 }), undefined);
		assert.strictEqual(cache.get({ ...key, functionRange: location(10, 0, 12, 1).range }), undefined);
		assert.strictEqual(cache.get({ ...key, configurationDigest: 'sha256:other' }), undefined);
		assert.strictEqual(cache.get({ ...key, analyzerId: 'other' }), undefined);
		assert.strictEqual(cache.get({ ...key, analyzerVersion: '9.9.9' }), undefined);
	});

	test('invalidates entries by document URI', () => {
		const cache = new AnalysisCache();
		cache.set(cacheKey({ documentUri: 'file:///workspace/a.ts' }), cacheEntry());
		cache.set(cacheKey({ documentUri: 'file:///workspace/b.ts' }), cacheEntry());

		cache.invalidateDocument('file:///workspace/a.ts');

		assert.strictEqual(cache.get(cacheKey({ documentUri: 'file:///workspace/a.ts' })), undefined);
		assert.ok(cache.get(cacheKey({ documentUri: 'file:///workspace/b.ts' })));
	});

	test('does not cache cancelled fatal or render failure results through the use case', async () => {
		const cache = new AnalysisCache();
		const renderer = new StubRenderer(renderResult('sequenceDiagram\n'));
		const cancelledAnalyzer = new StubAnalyzer('typescript', ['typescript'], failureResult('analysis-cancelled', 'Cancelled.'));
		const failedAnalyzer = new StubAnalyzer('typescript', ['typescript'], failureResult('analysis-failed', 'Failed.'));
		const renderFailureAnalyzer = new StubAnalyzer('typescript', ['typescript'], successResult(createModel()));

		const cancelled = new VisualizeFunctionFlowUseCase(new AnalyzerRegistry([cancelledAnalyzer]), renderer, cache);
		await cancelled.execute(request('typescript'));
		await cancelled.execute(request('typescript'));
		assert.strictEqual(cancelledAnalyzer.calls.length, 2);

		const failed = new VisualizeFunctionFlowUseCase(new AnalyzerRegistry([failedAnalyzer]), renderer, cache);
		await failed.execute(request('typescript'));
		await failed.execute(request('typescript'));
		assert.strictEqual(failedAnalyzer.calls.length, 2);

		const renderFailure = new VisualizeFunctionFlowUseCase(
			new AnalyzerRegistry([renderFailureAnalyzer]),
			new StubRenderer(new Error('render failed')),
			cache,
		);
		await renderFailure.execute(request('typescript'));
		await renderFailure.execute(request('typescript'));
		assert.strictEqual(renderFailureAnalyzer.calls.length, 2);
	});

	test('stores and reuses partial result only for matching source version and function range', async () => {
		const cache = new AnalysisCache();
		const model = createModel({ completeness: 'partial' });
		const analyzer = new StubAnalyzer('typescript', ['typescript'], successResult(model, 'partial'));
		const renderer = new StubRenderer(renderResult('sequenceDiagram\n'));
		const useCase = new VisualizeFunctionFlowUseCase(new AnalyzerRegistry([analyzer]), renderer, cache);

		const first = await useCase.execute(request('typescript'));
		const second = await useCase.execute(request('typescript'));
		const differentRange = await useCase.execute(request('typescript', {
			functionRange: location(4, 0, 6, 1).range,
		}));

		assert.strictEqual(first.status, 'partial');
		assert.strictEqual(second.status, 'partial');
		assert.strictEqual(differentRange.status, 'partial');
		assert.deepStrictEqual(second, first);
		assert.strictEqual(analyzer.calls.length, 2);
		assert.strictEqual(renderer.calls.length, 2);
	});

	test('source text changes alone do not affect cache key when document version and range are unchanged', async () => {
		const analyzer = new StubAnalyzer('typescript', ['typescript'], successResult(createModel()));
		const renderer = new StubRenderer(renderResult('sequenceDiagram\n'));
		const useCase = new VisualizeFunctionFlowUseCase(new AnalyzerRegistry([analyzer]), renderer, new AnalysisCache());

		await useCase.execute(request('typescript', { text: 'export function sample() { first(); }' }));
		const second = await useCase.execute(request('typescript', { text: 'export function sample() { second(); }' }));

		assert.strictEqual(second.status, 'success');
		assert.strictEqual(analyzer.calls.length, 1);
		assert.strictEqual(renderer.calls.length, 1);
	});

	test('fresh execution and cache hit return equivalent visualization contracts', async () => {
		const analyzer = new StubAnalyzer('typescript', ['typescript'], successResult(createModel()));
		const renderer = new StubRenderer(renderResult('sequenceDiagram\nroot->>load: load\n'));
		const useCase = new VisualizeFunctionFlowUseCase(new AnalyzerRegistry([analyzer]), renderer, new AnalysisCache());

		const fresh = await useCase.execute(request('typescript'));
		const cached = await useCase.execute(request('typescript'));

		assert.deepStrictEqual(cached, fresh);
		assertSuccessContract(fresh, 'success');
		assertSuccessContract(cached, 'success');
	});

	test('use case misses cache when analyzer version changes', async () => {
		const cache = new AnalysisCache();
		const firstAnalyzer = new StubAnalyzer('typescript', ['typescript'], successResult(createModel()), [], '0.1.0');
		const secondAnalyzer = new StubAnalyzer('typescript', ['typescript'], successResult(createModel()), [], '0.2.0');
		const firstRenderer = new StubRenderer(renderResult('sequenceDiagram\nroot->>first: first\n'));
		const secondRenderer = new StubRenderer(renderResult('sequenceDiagram\nroot->>second: second\n'));

		const firstUseCase = new VisualizeFunctionFlowUseCase(new AnalyzerRegistry([firstAnalyzer]), firstRenderer, cache);
		const secondUseCase = new VisualizeFunctionFlowUseCase(new AnalyzerRegistry([secondAnalyzer]), secondRenderer, cache);

		const first = await firstUseCase.execute(request('typescript'));
		const second = await secondUseCase.execute(request('typescript'));

		assert.strictEqual(first.status, 'success');
		assert.strictEqual(second.status, 'success');
		assert.strictEqual(firstAnalyzer.calls.length, 1);
		assert.strictEqual(secondAnalyzer.calls.length, 1);
		assert.strictEqual(firstRenderer.calls.length, 1);
		assert.strictEqual(secondRenderer.calls.length, 1);
		assert.strictEqual(first.mermaidText, 'sequenceDiagram\nroot->>first: first\n');
		assert.strictEqual(second.mermaidText, 'sequenceDiagram\nroot->>second: second\n');
	});
});

class StubAnalyzer implements LanguageAnalyzer {
	public readonly calls: AnalyzerInput[] = [];

	public constructor(
		public readonly id: string,
		public readonly languageIds: readonly string[],
		private readonly result: AnalyzerResult,
		private readonly events: string[] = [],
		public readonly version = '0.1.0',
	) {}

	public analyze(input: AnalyzerInput): Promise<AnalyzerResult> {
		this.calls.push(input);
		this.events.push('analyze');
		return Promise.resolve(this.result);
	}
}

interface RendererLike {
	render(model: FlowModel): RenderResult;
}

class StubRenderer implements RendererLike {
	public readonly calls: FlowModel[] = [];

	public constructor(
		private readonly result: RenderResult | Error,
		private readonly events: string[] = [],
	) {}

	public render(model: FlowModel): RenderResult {
		this.calls.push(model);
		this.events.push('render');
		if (this.result instanceof Error) {
			throw this.result;
		}
		return this.result;
	}
}

function request(languageId: string, overrides: {
	readonly version?: number;
	readonly text?: string;
	readonly configurationDigest?: string;
	readonly functionRange?: SourceLocation['range'];
} = {}): VisualizationRequest {
	return {
		source: {
			uri: 'file:///workspace/source.ts',
			languageId,
			version: overrides.version ?? 1,
			text: overrides.text ?? 'export function sample() { load(); }',
		},
		cursorOffset: 16,
		functionRange: overrides.functionRange ?? location(1, 0, 3, 1).range,
		configuration: {
			configurationDigest: overrides.configurationDigest ?? 'sha256:test',
		},
		cancellation: {
			isCancellationRequested: false,
		},
	};
}

function cacheKey(overrides: Partial<CacheKey> = {}): CacheKey {
	return {
		documentUri: 'file:///workspace/source.ts',
		documentVersion: 1,
		functionRange: location(1, 0, 3, 1).range,
		configurationDigest: 'sha256:test',
		analyzerId: 'typescript',
		analyzerVersion: '0.1.0',
		...overrides,
	};
}

function cacheEntry(): ReturnType<AnalysisCache['get']> extends infer Entry | undefined ? Entry : never {
	const model = createModel();
	return {
		key: cacheKey(),
		result: {
			status: 'success',
			mermaidText: 'sequenceDiagram\n',
			canCopyMermaid: true,
			sourceMap: [],
			notices: [],
			processNoteDecorations: [],
			completeness: 'complete',
			model,
		},
		model,
		renderResult: renderResult('sequenceDiagram\n'),
		createdAt: '2026-07-12T00:00:00.000Z',
	};
}

function successResult(model: FlowModel, status: 'success' | 'partial' = 'success'): AnalyzerResult {
	return {
		status,
		model,
		diagnostics: model.diagnostics,
		completeness: status === 'partial' ? 'partial' : 'complete',
	};
}

function failureResult(kind: AnalyzerResultFailureKind, message: string): AnalyzerResult {
	return {
		status: 'failed',
		completeness: 'failed',
		diagnostics: [],
		error: {
			kind,
			message,
			analyzerId: 'typescript',
			languageId: 'typescript',
		},
	};
}

type AnalyzerResultFailureKind = Extract<AnalyzerResult, { status: 'failed' }>['error']['kind'];

function renderResult(mermaidText: string, warnings: RenderResult['warnings'] = []): RenderResult {
	return {
		mermaidText,
		warnings,
		sourceMap: [],
		processNoteDecorations: [],
	};
}

function assertSuccessContract(result: VisualizationResult, status: 'success' | 'partial'): void {
	assert.strictEqual(result.status, status);
	assert.ok('mermaidText' in result);
	assert.ok(result.mermaidText.length > 0);
	assert.strictEqual(result.canCopyMermaid, true);
	assert.ok(!('error' in result));
	assertNoForbiddenRuntimeObjects(result);
}

function assertFailureContract(result: VisualizationResult, status: Exclude<VisualizationResult['status'], 'success' | 'partial'>): void {
	assert.strictEqual(result.status, status);
	assert.ok('error' in result);
	assert.ok(!('mermaidText' in result));
	assert.strictEqual(result.canCopyMermaid, false);
	assertNoForbiddenRuntimeObjects(result);
}

function assertNoForbiddenRuntimeObjects(value: unknown): void {
	const seen = new Set<unknown>();
	const visit = (candidate: unknown): void => {
		if (!candidate || typeof candidate !== 'object') {
			return;
		}
		if (seen.has(candidate)) {
			return;
		}
		seen.add(candidate);
		assert.strictEqual(candidate instanceof Map, false);
		assert.strictEqual(candidate instanceof Set, false);
		assert.strictEqual(candidate instanceof Error, false);
		assert.strictEqual(typeof (candidate as { getText?: unknown }).getText, 'undefined');
		assert.strictEqual(typeof (candidate as { kind?: unknown }).kind === 'number', false);
		for (const nested of Object.values(candidate as Record<string, unknown>)) {
			visit(nested);
		}
	};

	visit(value);
}

function createModel(overrides: Partial<FlowModel> = {}): FlowModel {
	const sourceLocation = location(1, 0, 3, 1);
	const completeness = overrides.completeness ?? 'complete';
	return {
		metadata: {
			schemaVersion: '1.0.0',
			analyzerId: 'typescript',
			analyzerVersion: '0.3.2',
			languageId: 'typescript',
			generatedAt: '2026-07-12T00:00:00.000Z',
			sourceDocumentVersion: 1,
			completeness,
			configurationDigest: 'sha256:test',
			rootFunctionIdentifier: 'function:sample',
		},
		rootFunction: {
			id: 'function:sample',
			name: 'sample',
			sourceLocation,
		},
		nodes: [
			{
				id: 'node:load',
				kind: 'call',
				order: 1,
				sourceLocation: location(2, 2, 2, 8),
				calleeName: 'load',
				resolution: 'resolved',
			},
		],
		edges: [
			{
				id: 'edge:load',
				kind: 'next',
				sourceNodeId: 'function:sample',
				targetNodeId: 'node:load',
				executionOrder: 1,
				sourceLocation: location(2, 2, 2, 8),
			},
		],
		diagnostics: [],
		source: {
			uri: 'file:///workspace/source.ts',
			languageId: 'typescript',
			documentVersion: 1,
		},
		completeness,
		...overrides,
	};
}

function location(startLine: number, startCharacter: number, endLine: number, endCharacter: number): SourceLocation {
	return {
		uri: 'file:///workspace/source.ts',
		range: {
			start: { line: startLine, character: startCharacter },
			end: { line: endLine, character: endCharacter },
		},
	};
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
