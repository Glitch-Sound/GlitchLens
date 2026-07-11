import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import type { FlowModel, SourceLocation } from '../flow-model';

suite('FlowModel invariants', () => {
	test('represents monotonically increasing FlowNode order', () => {
		const model = createModel();
		const orders = model.nodes.map(node => node.order);

		assert.deepStrictEqual(orders, [1, 2, 3, 4, 5, 6, 7]);
		assert.ok(orders.every((order, index) => index === 0 || order > orders[index - 1]));
	});

	test('preserves execution order on FlowEdge', () => {
		const model = createModel();
		const edgeTraversal = model.edges
			.slice()
			.sort((left, right) => left.executionOrder - right.executionOrder)
			.map(edge => `${edge.executionOrder}:${edge.kind}:${edge.sourceNodeId}->${edge.targetNodeId}`);

		assert.deepStrictEqual(edgeTraversal, [
			'1:next:node:call-known->node:branch-active',
			'2:true:node:branch-active->node:loop-items',
			'3:loop-body:node:loop-items->node:try-save',
			'4:try:node:try-save->node:call-unknown',
			'5:catch:node:try-save->node:call-unresolved',
			'6:return:node:call-unresolved->node:return-user',
		]);
	});

	test('represents Branch Loop and TryCatch connections with FlowEdge', () => {
		const model = createModel();
		const branchEdge = model.edges.find(edge => edge.kind === 'true');
		const loopBodyEdge = model.edges.find(edge => edge.kind === 'loop-body');
		const tryEdge = model.edges.find(edge => edge.kind === 'try');
		const catchEdge = model.edges.find(edge => edge.kind === 'catch');

		assert.deepStrictEqual(branchEdge, {
			id: 'edge:branch-true',
			sourceNodeId: 'node:branch-active',
			targetNodeId: 'node:loop-items',
			kind: 'true',
			executionOrder: 2,
			condition: 'user.active',
		});
		assert.strictEqual(loopBodyEdge?.sourceNodeId, 'node:loop-items');
		assert.strictEqual(loopBodyEdge?.targetNodeId, 'node:try-save');
		assert.strictEqual(tryEdge?.sourceNodeId, 'node:try-save');
		assert.strictEqual(tryEdge?.targetNodeId, 'node:call-unknown');
		assert.strictEqual(catchEdge?.sourceNodeId, 'node:try-save');
		assert.strictEqual(catchEdge?.targetNodeId, 'node:call-unresolved');
	});

	test('keeps unknown and unresolved resolution with FlowDiagnostic entries', () => {
		const model = createModel();
		const unknown = model.nodes.find(node => node.id === 'node:call-unknown');
		const unresolved = model.nodes.find(node => node.id === 'node:call-unresolved');
		const diagnosticNodeIds = model.diagnostics.map(diagnostic => diagnostic.nodeId);

		assert.strictEqual(unknown?.kind, 'call');
		if (unknown?.kind === 'call') {
			assert.strictEqual(unknown.resolution, 'unknown');
		}

		assert.strictEqual(unresolved?.kind, 'call');
		if (unresolved?.kind === 'call') {
			assert.strictEqual(unresolved.resolution, 'unresolved');
		}

		assert.ok(diagnosticNodeIds.includes('node:call-unknown'));
		assert.ok(diagnosticNodeIds.includes('node:call-unresolved'));
		assert.deepStrictEqual(model.diagnostics.map(diagnostic => diagnostic.kind), ['unknown-call', 'unresolved-call']);
	});

	test('represents partial completeness and stable metadata fields', () => {
		const model = createModel();

		assert.strictEqual(model.completeness, 'partial');
		assert.strictEqual(model.metadata.completeness, 'partial');
		assert.strictEqual(model.metadata.schemaVersion, '1.0.0');
		assert.strictEqual(model.metadata.analyzerId, 'typescript');
		assert.strictEqual(model.metadata.analyzerVersion, '0.1.0');
		assert.strictEqual(model.metadata.sourceDocumentVersion, 12);
		assert.strictEqual(model.metadata.configurationDigest, 'sha256:flow-config');
	});

	test('keeps FlowModel types independent from editor and language specific objects', () => {
		const flowModelRoot = path.resolve(__dirname, '../../src/flow-model');
		const offenders = listTypeScriptFiles(flowModelRoot).filter(file => {
			const source = fs.readFileSync(file, 'utf8');

			return /from ['"](?:vscode|typescript)['"]/.test(source)
				|| source.includes('vscode.')
				|| source.includes('ts.Node')
				|| source.includes('ts.Symbol')
				|| source.includes('typescript.Node')
				|| source.includes('typescript.Symbol');
		});

		assert.deepStrictEqual(offenders, []);
	});

	test('uses readonly arrays and readonly contracts for downstream safety', () => {
		const model = createModel();

		assertReadonlyContracts(model);
		assert.ok(Array.isArray(model.nodes));
		assert.ok(Array.isArray(model.edges));
		assert.ok(Array.isArray(model.diagnostics));
	});
});

function assertReadonlyContracts(model: FlowModel): void {
	if (false) {
		// @ts-expect-error FlowModel nodes collection is readonly.
		model.nodes = [];
		// @ts-expect-error FlowModel nodes cannot be pushed by downstream code.
		model.nodes.push(model.nodes[0]);
		// @ts-expect-error FlowNode order is readonly.
		model.nodes[0].order = 99;
		// @ts-expect-error FlowEdge execution order is readonly.
		model.edges[0].executionOrder = 99;
		// @ts-expect-error FlowModel metadata is readonly.
		model.metadata.analyzerVersion = 'mutable';
	}
}

function createModel(): FlowModel {
	return {
		metadata: {
			schemaVersion: '1.0.0',
			analyzerId: 'typescript',
			analyzerVersion: '0.1.0',
			languageId: 'typescript',
			generatedAt: '2026-07-11T00:00:00.000Z',
			sourceDocumentVersion: 12,
			completeness: 'partial',
			configurationDigest: 'sha256:flow-config',
			rootFunctionIdentifier: 'loadUser',
		},
		rootFunction: {
			id: 'function:loadUser',
			name: 'loadUser',
			sourceLocation: location(1, 0, 18, 1, 'loadUser'),
		},
		nodes: [
			{
				id: 'node:call-known',
				kind: 'call',
				order: 1,
				sourceLocation: location(2, 2, 2, 22, 'fetchUser'),
				calleeName: 'fetchUser',
				resolution: 'resolved',
				targetFunctionIdentifier: 'fetchUser',
			},
			{
				id: 'node:branch-active',
				kind: 'branch',
				order: 2,
				sourceLocation: location(3, 2, 8, 3),
				condition: 'user.active',
			},
			{
				id: 'node:loop-items',
				kind: 'loop',
				order: 3,
				sourceLocation: location(4, 4, 7, 5),
				condition: 'const item of user.items',
			},
			{
				id: 'node:try-save',
				kind: 'try-catch',
				order: 4,
				sourceLocation: location(5, 6, 10, 7),
				catchBinding: 'error',
			},
			{
				id: 'node:call-unknown',
				kind: 'call',
				order: 5,
				sourceLocation: location(6, 8, 6, 26, 'dynamicSave'),
				calleeName: 'dynamicSave',
				resolution: 'unknown',
			},
			{
				id: 'node:call-unresolved',
				kind: 'call',
				order: 6,
				sourceLocation: location(9, 8, 9, 28, 'handleError'),
				calleeName: 'handleError',
				resolution: 'unresolved',
			},
			{
				id: 'node:return-user',
				kind: 'return',
				order: 7,
				sourceLocation: location(12, 2, 12, 13),
				expression: 'user',
			},
		],
		edges: [
			{
				id: 'edge:next-call-branch',
				sourceNodeId: 'node:call-known',
				targetNodeId: 'node:branch-active',
				kind: 'next',
				executionOrder: 1,
			},
			{
				id: 'edge:branch-true',
				sourceNodeId: 'node:branch-active',
				targetNodeId: 'node:loop-items',
				kind: 'true',
				executionOrder: 2,
				condition: 'user.active',
			},
			{
				id: 'edge:loop-body',
				sourceNodeId: 'node:loop-items',
				targetNodeId: 'node:try-save',
				kind: 'loop-body',
				executionOrder: 3,
				label: 'each item',
				sourceLocation: location(4, 4, 7, 5),
			},
			{
				id: 'edge:try',
				sourceNodeId: 'node:try-save',
				targetNodeId: 'node:call-unknown',
				kind: 'try',
				executionOrder: 4,
			},
			{
				id: 'edge:catch',
				sourceNodeId: 'node:try-save',
				targetNodeId: 'node:call-unresolved',
				kind: 'catch',
				executionOrder: 5,
			},
			{
				id: 'edge:return',
				sourceNodeId: 'node:call-unresolved',
				targetNodeId: 'node:return-user',
				kind: 'return',
				executionOrder: 6,
			},
		],
		diagnostics: [
			{
				id: 'diagnostic:unknown-call',
				kind: 'unknown-call',
				severity: 'warning',
				message: 'Call target could not be resolved statically.',
				nodeId: 'node:call-unknown',
				sourceLocation: location(6, 8, 6, 26),
			},
			{
				id: 'diagnostic:unresolved-call',
				kind: 'unresolved-call',
				severity: 'warning',
				message: 'Imported call target could not be resolved.',
				nodeId: 'node:call-unresolved',
				sourceLocation: location(9, 8, 9, 28),
			},
		],
		source: {
			uri: 'file:///workspace/loadUser.ts',
			languageId: 'typescript',
			documentVersion: 12,
		},
		completeness: 'partial',
	};
}

function location(
	startLine: number,
	startCharacter: number,
	endLine: number,
	endCharacter: number,
	symbolName?: string,
): SourceLocation {
	return {
		uri: 'file:///workspace/loadUser.ts',
		range: {
			start: { line: startLine, character: startCharacter },
			end: { line: endLine, character: endCharacter },
		},
		symbolName,
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
