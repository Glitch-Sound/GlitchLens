import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import {
	flowEdgeKinds,
	flowNodeKinds,
	isFlowEdgeKind,
	type FlowModel,
} from '../flow-model';

suite('Common Flow Model contract', () => {
	test('exposes the stable node and edge kinds required by the design', () => {
		assert.deepStrictEqual(flowNodeKinds, [
			'call',
			'branch',
			'loop',
			'await',
			'return',
			'throw',
			'try-catch',
		]);
		assert.deepStrictEqual(flowEdgeKinds, [
			'next',
			'true',
			'false',
			'loop-body',
			'loop-exit',
			'try',
			'catch',
			'finally',
			'return',
			'throw',
			'uncertain',
		]);
		assert.strictEqual(isFlowEdgeKind('catch'), true);
		assert.strictEqual(isFlowEdgeKind('dynamic'), false);
	});

	test('represents calls, control flow, diagnostics, and metadata as plain data', () => {
		const sample: FlowModel = {
			metadata: {
				schemaVersion: '1.0.0',
				analyzerId: 'typescript',
				analyzerVersion: '0.1.0',
				languageId: 'typescript',
				generatedAt: '2026-07-11T00:00:00.000Z',
				sourceDocumentVersion: 4,
				completeness: 'partial',
				configurationDigest: 'digest',
				rootFunctionIdentifier: 'loadUser',
			},
			rootFunction: {
				id: 'function:loadUser',
				name: 'loadUser',
				sourceLocation: sourceLocation(1, 0, 9, 1, 'loadUser'),
			},
			nodes: [
				{
					id: 'node:call',
					kind: 'call',
					order: 1,
					sourceLocation: sourceLocation(2, 2, 2, 16, 'fetchUser'),
					calleeName: 'fetchUser',
					resolution: 'resolved',
				},
				{
					id: 'node:branch',
					kind: 'branch',
					order: 2,
					sourceLocation: sourceLocation(3, 2, 7, 3),
					condition: 'user.active',
				},
				{
					id: 'node:loop',
					kind: 'loop',
					order: 3,
					sourceLocation: sourceLocation(4, 4, 6, 5),
					condition: 'const item of user.items',
				},
				{
					id: 'node:await',
					kind: 'await',
					order: 4,
					sourceLocation: sourceLocation(5, 6, 5, 28),
					expression: 'saveItem(item)',
				},
				{
					id: 'node:return',
					kind: 'return',
					order: 5,
					sourceLocation: sourceLocation(8, 2, 8, 13),
					expression: 'user',
				},
				{
					id: 'node:throw',
					kind: 'throw',
					order: 6,
					sourceLocation: sourceLocation(10, 2, 10, 24),
					expression: 'error',
				},
				{
					id: 'node:try',
					kind: 'try-catch',
					order: 7,
					sourceLocation: sourceLocation(1, 0, 11, 1),
				},
				{
					id: 'node:unknown',
					kind: 'call',
					order: 8,
					sourceLocation: sourceLocation(12, 2, 12, 18),
					calleeName: 'dynamicCall',
					resolution: 'unknown',
				},
			],
			edges: [
				{
					id: 'edge:next',
					sourceNodeId: 'node:call',
					targetNodeId: 'node:branch',
					kind: 'next',
					executionOrder: 1,
				},
				{
					id: 'edge:true',
					sourceNodeId: 'node:branch',
					targetNodeId: 'node:loop',
					kind: 'true',
					executionOrder: 2,
					condition: 'user.active',
				},
				{
					id: 'edge:loop',
					sourceNodeId: 'node:loop',
					targetNodeId: 'node:await',
					kind: 'loop-body',
					executionOrder: 3,
					label: 'each item',
					sourceLocation: sourceLocation(4, 4, 6, 5),
				},
			],
			diagnostics: [
				{
					id: 'diagnostic:unknown-call',
					kind: 'unknown-call',
					severity: 'warning',
					message: 'Call target could not be resolved statically.',
					nodeId: 'node:unknown',
					sourceLocation: sourceLocation(12, 2, 12, 18),
				},
			],
			source: {
				uri: 'file:///workspace/user.ts',
				languageId: 'typescript',
				documentVersion: 4,
			},
			completeness: 'partial',
		};

		assert.strictEqual(sample.nodes.length, 8);
		assert.strictEqual(sample.edges[2].kind, 'loop-body');
		assert.strictEqual(sample.metadata.analyzerVersion, '0.1.0');
		assert.strictEqual(sample.diagnostics[0].kind, 'unknown-call');
		assert.doesNotThrow(() => JSON.stringify(sample));
	});

	test('keeps flow-model modules independent from VS Code APIs', () => {
		const flowModelRoot = path.resolve(__dirname, '../../src/flow-model');
		const offenders = listTypeScriptFiles(flowModelRoot).filter(file => {
			const source = fs.readFileSync(file, 'utf8');

			return source.includes('from \'vscode\'') || source.includes('from "vscode"');
		});

		assert.deepStrictEqual(offenders, []);
	});
});

function sourceLocation(
	startLine: number,
	startCharacter: number,
	endLine: number,
	endCharacter: number,
	symbolName?: string,
) {
	return {
		uri: 'file:///workspace/user.ts',
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
