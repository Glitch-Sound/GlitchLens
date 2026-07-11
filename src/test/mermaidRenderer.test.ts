import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { MermaidRenderer } from '../renderer';
import type { FlowModel, SourceLocation } from '../flow-model';

suite('MermaidRenderer', () => {
	test('renders sequenceDiagram participants calls await and return from FlowModel order', () => {
		const model = createModel();
		const result = new MermaidRenderer().render(model);

		assert.ok(result.mermaidText.startsWith('sequenceDiagram\n'));
		assert.ok(result.mermaidText.includes('participant root as loadUser'));
		assert.ok(result.mermaidText.includes('participant fetchUser as fetchUser'));
		assert.ok(result.mermaidText.includes('participant saveUser as saveUser'));
		assert.ok(result.mermaidText.includes('root->>fetchUser: fetchUser'));
		assert.ok(result.mermaidText.includes('root->>saveUser: await saveUser'));
		assert.ok(result.mermaidText.includes('saveUser-->>root: return user'));

		const fetchLine = result.mermaidText.indexOf('root->>fetchUser');
		const saveLine = result.mermaidText.indexOf('root->>saveUser');
		const returnLine = result.mermaidText.indexOf('saveUser-->>root');
		assert.ok(fetchLine < saveLine);
		assert.ok(saveLine < returnLine);
		assert.deepStrictEqual(result.warnings, []);
	});

	test('represents unknown and unresolved calls without forcing resolution', () => {
		const model = createModel({
			nodes: [
				call('node:unknown', 1, '<unknown>', 'unknown'),
				call('node:unresolved', 2, 'execute', 'unresolved'),
			],
			edges: [
				edge('edge:unknown', 'node:unknown', 1),
				edge('edge:unresolved', 'node:unresolved', 2),
			],
			completeness: 'partial',
		});
		const result = new MermaidRenderer().render(model);

		assert.ok(result.mermaidText.includes('participant unknown_1 as Unknown'));
		assert.ok(result.mermaidText.includes('participant execute as execute'));
		assert.ok(result.mermaidText.includes('root->>unknown_1: unknown call'));
		assert.ok(result.mermaidText.includes('Note over root,unknown_1: unknown call'));
		assert.ok(result.mermaidText.includes('root->>execute: execute (unresolved)'));
		assert.ok(result.mermaidText.includes('Note over root,execute: unresolved call'));
	});

	test('returns source map entries for rendered Mermaid elements', () => {
		const model = createModel();
		const result = new MermaidRenderer().render(model);

		const fetchEntry = result.sourceMap.find(entry => entry.nodeId === 'node:fetch');
		const edgeEntry = result.sourceMap.find(entry => entry.edgeId === 'edge:fetch');

		assert.ok(fetchEntry);
		assert.strictEqual(fetchEntry.sourceLocation.uri, 'file:///workspace/source.ts');
		assert.ok(fetchEntry.elementId.startsWith('line:'));
		assert.ok(edgeEntry);
		assert.strictEqual(edgeEntry.sourceLocation.uri, 'file:///workspace/source.ts');
	});

	test('marks uncertain ordering from edges and diagnostics in Mermaid output', () => {
		const model = createModel({
			nodes: [call('node:later', 1, 'later', 'resolved')],
			edges: [edge('edge:uncertain', 'node:later', 1, 'uncertain')],
			diagnostics: [
				{
					id: 'diagnostic:order',
					kind: 'order-uncertain',
					severity: 'warning',
					message: 'Order could not be determined statically.',
					edgeId: 'edge:uncertain',
					sourceLocation: location(2, 2, 2, 12),
				},
			],
			completeness: 'partial',
		});
		const result = new MermaidRenderer().render(model);

		assert.ok(result.mermaidText.includes('Note over root,later: order uncertain'));
		assert.ok(result.mermaidText.includes('Note over root: Order could not be determined statically.'));
		assert.ok(result.sourceMap.some(entry => entry.edgeId === 'edge:uncertain'));
		assert.ok(result.sourceMap.some(entry => entry.elementId === 'diagnostic:diagnostic:order'));
	});

	test('returns UI independent warnings for unsupported nodes and stays dependency clean', () => {
		const model = createModel({
			nodes: [
				{
					id: 'node:branch',
					kind: 'branch',
					order: 1,
					sourceLocation: location(3, 2, 5, 3),
					condition: 'flag',
				},
			],
			edges: [],
		});
		const result = new MermaidRenderer().render(model);

		assert.ok(result.warnings.some(warning => warning.kind === 'unsupported-node' && warning.nodeId === 'node:branch'));
		assert.ok(!result.mermaidText.includes('Webview'));

		const rendererRoot = path.resolve(__dirname, '../../src/renderer');
		const offenders = listTypeScriptFiles(rendererRoot).filter(file => {
			const source = fs.readFileSync(file, 'utf8');
			return /from ['"](?:vscode|typescript)['"]/.test(source)
				|| source.includes('vscode.')
				|| source.includes('Webview')
				|| source.includes('Clipboard');
		});
		assert.deepStrictEqual(offenders, []);
	});

	test('renders branch true and false edges with alt else blocks', () => {
		const model = createModel({
			nodes: [
				branch('node:branch', 1, 'flag'),
				call('node:yes', 2, 'yes', 'resolved'),
				call('node:no', 3, 'no', 'resolved'),
			],
			edges: [
				edge('edge:true', 'node:yes', 1, 'true', 'node:branch'),
				edge('edge:false', 'node:no', 2, 'false', 'node:branch'),
			],
		});
		const result = new MermaidRenderer().render(model);

		assert.ok(result.mermaidText.includes('alt flag'));
		assert.ok(result.mermaidText.includes('else flag'));
		assert.ok(result.mermaidText.includes('root->>yes: yes'));
		assert.ok(result.mermaidText.includes('root->>no: no'));
		assert.ok(result.mermaidText.includes('\nend\n'));
		assert.deepStrictEqual(result.warnings, []);
	});

	test('deduplicates participants for repeated calls to the same target', () => {
		const model = createModel({
			nodes: [
				call('node:first', 1, 'load', 'resolved'),
				call('node:second', 2, 'load', 'resolved'),
			],
			edges: [
				edge('edge:first', 'node:first', 1),
				edge('edge:second', 'node:second', 2),
			],
		});
		const result = new MermaidRenderer().render(model);

		assert.strictEqual(countOccurrences(result.mermaidText, 'participant load as load'), 1);
		assert.strictEqual(countOccurrences(result.mermaidText, 'root->>load: load'), 2);
	});

	test('renders loop edges with loop block and preserves nested call order', () => {
		const model = createModel({
			nodes: [
				loop('node:loop', 1, 'item of items'),
				call('node:visit', 2, 'visit', 'resolved'),
			],
			edges: [
				edge('edge:body', 'node:visit', 1, 'loop-body', 'node:loop'),
			],
		});
		const result = new MermaidRenderer().render(model);

		assert.ok(result.mermaidText.includes('loop item of items'));
		assert.ok(result.mermaidText.includes('root->>visit: visit'));
		assert.ok(result.mermaidText.includes('\nend\n'));
		assert.deepStrictEqual(result.warnings, []);
	});

	test('renders try catch finally and throw with critical option and note blocks', () => {
		const model = createModel({
			nodes: [
				tryCatch('node:try', 1, 'error', true),
				call('node:risky', 2, 'risky', 'resolved'),
				call('node:recover', 3, 'recover', 'resolved'),
				call('node:cleanup', 4, 'cleanup', 'resolved'),
				{
					id: 'node:throw',
					kind: 'throw',
					order: 5,
					sourceLocation: location(6, 2, 6, 14),
					expression: 'error',
				},
			],
			edges: [
				edge('edge:try', 'node:risky', 1, 'try', 'node:try'),
				edge('edge:catch', 'node:recover', 2, 'catch', 'node:try'),
				edge('edge:finally', 'node:cleanup', 3, 'finally', 'node:try'),
				edge('edge:throw', 'node:throw', 4, 'throw', 'node:recover'),
			],
		});
		const result = new MermaidRenderer().render(model);

		assert.ok(result.mermaidText.includes('critical try'));
		assert.ok(result.mermaidText.includes('option catch error'));
		assert.ok(result.mermaidText.includes('option finally'));
		assert.ok(result.mermaidText.includes('Note over root: throw error'));
		assert.deepStrictEqual(result.warnings, []);
	});

	test('returns Mermaid for partial models and warns about unrenderable edges without dropping renderable calls', () => {
		const model = createModel({
			nodes: [call('node:known', 1, 'known', 'resolved')],
			edges: [
				edge('edge:known', 'node:known', 1),
				edge('edge:missing', 'node:missing', 2),
			],
			completeness: 'partial',
		});
		const result = new MermaidRenderer().render(model);

		assert.ok(result.mermaidText.includes('root->>known: known'));
		assert.ok(result.warnings.some(warning => warning.kind === 'unsupported-edge' && warning.edgeId === 'edge:missing'));
	});

	test('is deterministic and does not mutate the FlowModel input', () => {
		const model = createModel({
			nodes: [
				call('node:b', 2, 'b', 'resolved'),
				call('node:a', 1, 'a', 'resolved'),
			],
			edges: [
				edge('edge:b', 'node:b', 2),
				edge('edge:a', 'node:a', 1),
			],
		});
		const before = JSON.stringify(model);
		const renderer = new MermaidRenderer();
		const first = renderer.render(model);
		const second = renderer.render(model);

		assert.deepStrictEqual(second, first);
		assert.strictEqual(JSON.stringify(model), before);
		assert.ok(first.mermaidText.indexOf('root->>a: a') < first.mermaidText.indexOf('root->>b: b'));
	});
});

function createModel(overrides: Partial<FlowModel> = {}): FlowModel {
	const nodes = overrides.nodes ?? [
		call('node:fetch', 1, 'fetchUser', 'resolved'),
		{
			id: 'node:await',
			kind: 'await',
			order: 2,
			sourceLocation: location(3, 2, 3, 22),
			expression: 'saveUser(user)',
		},
		call('node:save', 3, 'saveUser', 'resolved'),
		{
			id: 'node:return',
			kind: 'return',
			order: 4,
			sourceLocation: location(4, 2, 4, 14),
			expression: 'user',
		},
	];
	const edges = overrides.edges ?? [
		edge('edge:fetch', 'node:fetch', 1),
		edge('edge:await-save', 'node:save', 2, 'next', 'node:await'),
		edge('edge:return', 'node:return', 3, 'return', 'node:save'),
	];

	return {
		metadata: {
			schemaVersion: '1.0.0',
			analyzerId: 'typescript',
			analyzerVersion: '0.3.0',
			languageId: 'typescript',
			generatedAt: '2026-07-11T00:00:00.000Z',
			sourceDocumentVersion: 1,
			completeness: overrides.completeness ?? 'complete',
			configurationDigest: 'sha256:test',
			rootFunctionIdentifier: 'function:loadUser',
		},
		rootFunction: {
			id: 'function:loadUser',
			name: 'loadUser',
			sourceLocation: location(1, 0, 5, 1),
		},
		nodes,
		edges,
		diagnostics: overrides.diagnostics ?? [],
		source: {
			uri: 'file:///workspace/source.ts',
			languageId: 'typescript',
			documentVersion: 1,
		},
		completeness: overrides.completeness ?? 'complete',
	};
}

function call(id: string, order: number, calleeName: string, resolution: 'resolved' | 'unknown' | 'unresolved') {
	return {
		id,
		kind: 'call' as const,
		order,
		sourceLocation: location(order + 1, 2, order + 1, 20),
		calleeName,
		resolution,
	};
}

function branch(id: string, order: number, condition: string) {
	return {
		id,
		kind: 'branch' as const,
		order,
		sourceLocation: location(order + 1, 2, order + 1, 20),
		condition,
	};
}

function loop(id: string, order: number, condition: string) {
	return {
		id,
		kind: 'loop' as const,
		order,
		sourceLocation: location(order + 1, 2, order + 1, 20),
		condition,
	};
}

function tryCatch(id: string, order: number, catchBinding: string, hasFinally: boolean) {
	return {
		id,
		kind: 'try-catch' as const,
		order,
		sourceLocation: location(order + 1, 2, order + 1, 20),
		catchBinding,
		hasFinally,
	};
}

function edge(id: string, targetNodeId: string, executionOrder: number, kind: 'next' | 'return' | 'uncertain' | 'true' | 'false' | 'loop-body' | 'try' | 'catch' | 'finally' | 'throw' = 'next', sourceNodeId = 'function:loadUser') {
	return {
		id,
		sourceNodeId,
		targetNodeId,
		kind,
		executionOrder,
		sourceLocation: location(executionOrder + 1, 2, executionOrder + 1, 20),
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

function countOccurrences(text: string, pattern: string): number {
	return text.split(pattern).length - 1;
}
