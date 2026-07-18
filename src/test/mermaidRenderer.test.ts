import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { TypeScriptAnalyzer } from '../analyzers';
import type { AnalyzerInput } from '../analyzers';
import { MermaidRenderer } from '../renderer';
import type { FlowModel, SourceLocation } from '../flow-model';

suite('MermaidRenderer', () => {
	test('renders sequenceDiagram participants calls await and return from FlowModel order', () => {
		const model = createModel();
		const result = new MermaidRenderer().render(model);

		assert.ok(result.mermaidText.startsWith('sequenceDiagram\n'));
		assert.ok(result.mermaidText.includes('participant root as self'));
		assert.ok(result.mermaidText.includes('participant caller as caller'));
		assert.ok(result.mermaidText.includes('participant fetchUser as fetchUser'));
		assert.ok(result.mermaidText.includes('participant saveUser as saveUser'));
		assert.ok(result.mermaidText.includes('root->>fetchUser: fetchUser'));
		assert.ok(result.mermaidText.includes('root->>saveUser: await saveUser'));
		assert.ok(result.mermaidText.includes('root-->>caller: return user'));

		const fetchLine = result.mermaidText.indexOf('root->>fetchUser');
		const saveLine = result.mermaidText.indexOf('root->>saveUser');
		const returnLine = result.mermaidText.indexOf('root-->>caller: return user');
		assert.ok(fetchLine < saveLine);
		assert.ok(saveLine < returnLine);
		assert.deepStrictEqual(result.warnings, []);
	});

	test('renders a single synthetic caller invocation before the function body', () => {
		const result = new MermaidRenderer().render(createModel());
		const lines = result.mermaidText.trimEnd().split('\n');

		assert.strictEqual(lines.filter(line => line === 'caller->>root: invoke').length, 1);
		const entryLine = lines.indexOf('caller->>root: invoke');
		const rootActivationLine = lines.indexOf('activate root');
		const firstBodyLine = lines.findIndex(line => line.startsWith('root->>'));
		assert.ok(entryLine > lines.indexOf('participant root as self'));
		assert.ok(entryLine < rootActivationLine);
		assert.ok(rootActivationLine < firstBodyLine);
		assert.strictEqual(result.sourceMap.some(entry => entry.elementId === `line:${entryLine + 1}`), false);
	});

	test('emits canonical participant activations for calls and terminal returns', () => {
		const result = new MermaidRenderer().render(createModel());
		const lines = result.mermaidText.trimEnd().split('\n');
		const activationStart = lines.indexOf('activate root');
		assert.ok(activationStart >= 0);
		assert.deepStrictEqual(lines.slice(activationStart), [
			'activate root',
			'root->>fetchUser: fetchUser',
			'activate fetchUser',
			'deactivate fetchUser',
			'root->>saveUser: await saveUser',
			'activate saveUser',
			'root-->>caller: return user',
			'deactivate saveUser',
			'deactivate root',
		]);
		assert.strictEqual(lines.filter(line => line === 'activate root').length, 1);
	});

	test('keeps a call activation open for a terminal reached by a next edge', () => {
		const result = new MermaidRenderer().render(createModel({
			edges: [
				edge('edge:fetch', 'node:fetch', 1),
				edge('edge:return', 'node:return', 2, 'next', 'node:fetch'),
			],
		}));
		const text = result.mermaidText;
		assert.ok(text.indexOf('activate fetchUser') < text.indexOf('root-->>caller: return user'));
		assert.ok(text.indexOf('root-->>caller: return user') < text.indexOf('deactivate fetchUser'));
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

		assert.ok(result.mermaidText.includes('participant Unknown as Unknown'));
		assert.ok(result.mermaidText.includes('participant execute as execute'));
		assert.ok(result.mermaidText.includes('root->>Unknown: unknown call'));
		assert.ok(result.mermaidText.includes('Note over root,Unknown: unknown call'));
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

	test('renders the first call without an incoming edge from the self root', () => {
		const model = createModel({
			nodes: [call('node:first', 1, 'firstCall', 'resolved')],
			edges: [],
		});

		const result = new MermaidRenderer().render(model);

		assert.ok(result.mermaidText.includes('root->>firstCall: firstCall'));
		assert.ok(result.sourceMap.some(entry => entry.nodeId === 'node:first' && entry.edgeId === undefined));
		assert.deepStrictEqual(result.warnings, []);
	});

	test('keeps entry-call order and fallback participants when the first call has a successor', () => {
		const model = createModel({
			nodes: [
				call('node:first', 1, 'firstCall', 'unknown'),
				{
					...call('node:second', 2, 'secondCall', 'unresolved'),
					participant: { key: 'unresolved', label: 'Unresolved', kind: 'unresolved' as const },
				},
			],
			edges: [edge('edge:second', 'node:second', 2, 'next', 'node:first')],
			completeness: 'partial',
		});

		const result = new MermaidRenderer().render(model);
		const firstMessage = 'root->>Unknown: unknown call';
		const secondMessage = 'root->>Unresolved: secondCall (unresolved)';

		assert.strictEqual(countOccurrences(result.mermaidText, firstMessage), 1, result.mermaidText);
		assert.strictEqual(countOccurrences(result.mermaidText, secondMessage), 1, result.mermaidText);
		assert.ok(result.mermaidText.indexOf(firstMessage) < result.mermaidText.indexOf(secondMessage));
		assert.strictEqual(countOccurrences(result.mermaidText, 'participant Unknown as Unknown'), 1);
		assert.strictEqual(countOccurrences(result.mermaidText, 'participant Unresolved as Unresolved'), 1);
		assert.deepStrictEqual(result.warnings, []);
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
		assert.ok(result.mermaidText.includes('\nelse\n'));
		assert.ok(result.mermaidText.includes('root->>yes: yes'));
		assert.ok(result.mermaidText.includes('root->>no: no'));
		assert.ok(result.mermaidText.includes('\nend\n'));
		assert.strictEqual(countBranchWarnings(result), 0);
		assert.deepStrictEqual(result.warnings, []);
	});

	test('renders calls inside for loop body before loop end', () => {
		const model = createModel({
			nodes: [
				loopAt('node:loop', 1, 'item of items', 2, 4),
				callAt('node:visit', 2, 'visit', 'resolved', 3),
			],
			edges: [
				edge('edge:body', 'node:visit', 1, 'loop-body', 'node:loop'),
			],
		});
		const result = new MermaidRenderer().render(model);

		assertOrder(result.mermaidText, ['loop item of items', 'root->>visit: visit', 'end']);
		assert.deepStrictEqual(result.warnings, []);
	});

	test('does not warn for loop edges from analyzer generated for-of loop', async () => {
		const result = await renderAnalyzed(`function target(items) {
	for (const item of items) {
		visit(item);
	}
}`);

		assert.deepStrictEqual(result.warnings, []);
		assertOrder(result.mermaidText, ['loop items', 'root->>visit: visit', 'end']);
	});

	test('does not warn for loop edges from analyzer generated while loop', async () => {
		const result = await renderAnalyzed(`function target(ready) {
	while (ready()) {
		poll();
	}
}`);

		assert.deepStrictEqual(result.warnings, []);
		assertOrder(result.mermaidText, ['loop ready()', 'root->>poll: poll', 'end']);
	});

	test('renders call and nested if inside while loop body', () => {
		const model = createModel({
			nodes: [
				loopAt('node:while', 1, 'ready()', 2, 8),
				callAt('node:poll', 2, 'poll', 'resolved', 3),
				branchAt('node:branch', 3, 'stale', 4, 6),
				callAt('node:refresh', 4, 'refresh', 'resolved', 5),
				callAt('node:commit', 5, 'commit', 'resolved', 7),
			],
			edges: [
				edge('edge:loop-body', 'node:poll', 1, 'loop-body', 'node:while'),
				edge('edge:poll-branch', 'node:branch', 2, 'next', 'node:poll'),
				edge('edge:true', 'node:refresh', 3, 'true', 'node:branch'),
				edge('edge:refresh-commit', 'node:commit', 4, 'next', 'node:refresh'),
			],
		});
		const result = new MermaidRenderer().render(model);

		assertOrder(result.mermaidText, ['loop ready()', 'root->>poll: poll', 'opt stale', 'root->>refresh: refresh', 'end', 'root->>commit: commit', 'end']);
		assert.deepStrictEqual(result.warnings, []);
	});

	test('keeps if and else calls in their own blocks', () => {
		const model = createModel({
			nodes: [
				branchAt('node:branch', 1, 'flag', 2, 6),
				callAt('node:yes', 2, 'yes', 'resolved', 3),
				callAt('node:no', 3, 'no', 'resolved', 5),
			],
			edges: [
				edge('edge:true', 'node:yes', 1, 'true', 'node:branch'),
				edge('edge:false', 'node:no', 2, 'false', 'node:branch'),
			],
		});
		const result = new MermaidRenderer().render(model);

		assertOrder(result.mermaidText, ['alt flag', 'root->>yes: yes', 'else', 'root->>no: no', 'end']);
		assert.strictEqual(result.mermaidText.includes('else flag'), false);
		assert.deepStrictEqual(result.warnings, []);
	});

	test('renders try catch inside an outer loop', () => {
		const model = createModel({
			nodes: [
				loopAt('node:loop', 1, 'orders', 2, 10),
				tryCatchAt('node:try', 2, 'error', false, 3, 8),
				callAt('node:save', 3, 'save', 'resolved', 4),
				callAt('node:error', 4, 'error', 'resolved', 7),
			],
			edges: [
				edge('edge:loop-body', 'node:try', 1, 'loop-body', 'node:loop'),
				edge('edge:try', 'node:save', 2, 'try', 'node:try'),
				edge('edge:catch', 'node:error', 3, 'catch', 'node:try'),
			],
		});
		const result = new MermaidRenderer().render(model);

		assertOrder(result.mermaidText, ['loop orders', 'critical try', 'root->>save: save', 'option catch error', 'root->>error: error', 'end', 'end']);
		assert.deepStrictEqual(result.warnings, []);
	});

	test('continues inside parent try after nested loop exits', () => {
		const model = createModel({
			nodes: [
				tryCatchAt('node:try', 1, 'error', false, 2, 10),
				loopAt('node:loop', 2, 'retry < 3', 3, 6),
				callAt('node:risky', 3, 'risky', 'resolved', 4),
				callAt('node:save', 4, 'save', 'resolved', 8),
				callAt('node:recover', 5, 'recover', 'resolved', 9),
			],
			edges: [
				edge('edge:try', 'node:loop', 1, 'try', 'node:try'),
				edge('edge:loop-body', 'node:risky', 2, 'loop-body', 'node:loop'),
				edge('edge:loop-exit', 'node:save', 3, 'loop-exit', 'node:loop'),
				edge('edge:catch', 'node:recover', 4, 'catch', 'node:try'),
			],
		});
		const result = new MermaidRenderer().render(model);

		assertOrder(result.mermaidText, ['critical try', 'loop retry < 3', 'root->>risky: risky', 'end', 'root->>save: save', 'option catch error', 'root->>recover: recover', 'end']);
		assert.deepStrictEqual(result.warnings, []);
	});

	test('continues inside parent try after nested branch exits', () => {
		const model = createModel({
			nodes: [
				tryCatchAt('node:try', 1, 'error', false, 2, 10),
				branchAt('node:branch', 2, 'flag', 3, 6),
				callAt('node:yes', 3, 'yes', 'resolved', 4),
				callAt('node:after', 4, 'after', 'resolved', 8),
				callAt('node:recover', 5, 'recover', 'resolved', 9),
			],
			edges: [
				edge('edge:try', 'node:branch', 1, 'try', 'node:try'),
				edge('edge:true', 'node:yes', 2, 'true', 'node:branch'),
				edge('edge:after', 'node:after', 3, 'next', 'node:yes'),
				edge('edge:catch', 'node:recover', 4, 'catch', 'node:try'),
			],
		});
		const result = new MermaidRenderer().render(model);

		assertOrder(result.mermaidText, ['critical try', 'opt flag', 'root->>yes: yes', 'end', 'root->>after: after', 'option catch error', 'root->>recover: recover', 'end']);
		assert.deepStrictEqual(result.warnings, []);
	});

	test('renders nested loop and branch without top-level duplicates', () => {
		const model = createModel({
			nodes: [
				loopAt('node:outer', 1, 'items', 2, 12),
				branchAt('node:branch', 2, 'item.ok', 3, 10),
				loopAt('node:inner', 3, 'retry < 3', 4, 7),
				callAt('node:retry', 4, 'retry', 'resolved', 5),
				callAt('node:skip', 5, 'skip', 'resolved', 9),
			],
			edges: [
				edge('edge:outer-body', 'node:branch', 1, 'loop-body', 'node:outer'),
				edge('edge:true', 'node:inner', 2, 'true', 'node:branch'),
				edge('edge:inner-body', 'node:retry', 3, 'loop-body', 'node:inner'),
				edge('edge:false', 'node:skip', 4, 'false', 'node:branch'),
			],
		});
		const result = new MermaidRenderer().render(model);

		assertOrder(result.mermaidText, ['loop items', 'alt item.ok', 'loop retry < 3', 'root->>retry: retry', 'end', 'else', 'root->>skip: skip', 'end', 'end']);
		assert.strictEqual(countOccurrences(result.mermaidText, 'root->>retry: retry'), 1);
		assert.strictEqual(countOccurrences(result.mermaidText, 'root->>skip: skip'), 1);
		assert.deepStrictEqual(result.warnings, []);
	});

	test('does not warn for analyzer generated nested loops', async () => {
		const result = await renderAnalyzed(`function target(orders) {
	for (const order of orders) {
		while (order.retry < 3) {
			save(order);
		}
	}
}`);

		assert.deepStrictEqual(result.warnings, []);
		assertOrder(result.mermaidText, ['loop orders', 'loop order.retry < 3', 'root->>save: save', 'end', 'end']);
		assert.strictEqual(countOccurrences(result.mermaidText, ': save'), 1);
	});

	test('does not warn for branch rendered as alt else', async () => {
		const result = await renderAnalyzed(`function target(order) {
	if (order.status === "new") {
		charge(order);
	} else {
		notify(order);
	}
}`);

		assert.strictEqual(countBranchWarnings(result), 0);
		assert.deepStrictEqual(result.warnings, []);
		assertOrder(result.mermaidText, ['alt order.status === "new"', 'root->>charge: charge', 'else', 'root->>notify: notify', 'end']);
	});

	test('does not warn for branch rendered as opt', async () => {
		const result = await renderAnalyzed(`function target(order) {
	if (order.ready) {
		ship(order);
	}
}`);

		assert.strictEqual(countBranchWarnings(result), 0);
		assert.deepStrictEqual(result.warnings, []);
		assertOrder(result.mermaidText, ['opt order.ready', 'root->>ship: ship', 'end']);
	});

	test('does not warn for rendered nested branches', async () => {
		const result = await renderAnalyzed(`function target(order) {
	if (order.ready) {
		if (order.status === "new") {
			charge(order);
		} else {
			notify(order);
		}
	}
}`);

		assert.strictEqual(countBranchWarnings(result), 0);
		assert.deepStrictEqual(result.warnings, []);
		assertOrder(result.mermaidText, ['opt order.ready', 'alt order.status === "new"', 'root->>charge: charge', 'else', 'root->>notify: notify', 'end', 'end']);
	});

	test('warns for connected branch that cannot be rendered as advanced syntax', () => {
		const model = createModel({
			nodes: [
				callAt('node:before', 1, 'before', 'resolved', 2),
				branchAt('node:branch', 2, 'flag', 3, 5),
			],
			edges: [
				edge('edge:before-branch', 'node:branch', 1, 'next', 'node:before'),
			],
		});
		const result = new MermaidRenderer().render(model);

		assert.strictEqual(countBranchWarnings(result), 1);
		assert.ok(result.warnings.some(warning => warning.kind === 'unsupported-node' && warning.nodeId === 'node:branch'));
	});

	test('warns for invalid loop body edge that is not connected to a loop node', () => {
		const model = createModel({
			nodes: [
				callAt('node:first', 1, 'first', 'resolved', 2),
				callAt('node:second', 2, 'second', 'resolved', 3),
			],
			edges: [
				edge('edge:invalid-loop', 'node:second', 1, 'loop-body', 'node:first'),
			],
		});
		const result = new MermaidRenderer().render(model);

		assert.ok(result.warnings.some(warning => warning.kind === 'unsupported-edge' && warning.edgeId === 'edge:invalid-loop'));
		assert.ok(result.mermaidText.includes('root->>second: second'));
	});

	test('warns for reversed loop body edge connected to a loop node', () => {
		const model = createModel({
			nodes: [
				loopAt('node:loop', 1, 'items', 2, 5),
				callAt('node:visit', 2, 'visit', 'resolved', 3),
			],
			edges: [
				edge('edge:reversed-loop', 'node:loop', 1, 'loop-body', 'node:visit'),
			],
		});
		const result = new MermaidRenderer().render(model);

		assert.ok(result.warnings.some(warning => warning.kind === 'unsupported-edge' && warning.edgeId === 'edge:reversed-loop'));
	});

	test('warns for invalid loop exit edge during recursive rendering', () => {
		const model = createModel({
			nodes: [
				loopAt('node:loop', 1, 'items', 2, 6),
				callAt('node:visit', 2, 'visit', 'resolved', 3),
				callAt('node:after', 3, 'after', 'resolved', 5),
			],
			edges: [
				edge('edge:body', 'node:visit', 1, 'loop-body', 'node:loop'),
				edge('edge:invalid-exit', 'node:after', 2, 'loop-exit', 'node:visit'),
			],
		});
		const result = new MermaidRenderer().render(model);

		assert.ok(result.warnings.some(warning => warning.kind === 'unsupported-edge' && warning.edgeId === 'edge:invalid-exit'));
		assert.strictEqual(result.mermaidText.includes('root->>after: after'), false);
	});

	test('warns for loop exit edge targeting a node inside the loop body', () => {
		const model = createModel({
			nodes: [
				loopAt('node:loop', 1, 'items', 2, 6),
				callAt('node:visit', 2, 'visit', 'resolved', 3),
			],
			edges: [
				edge('edge:invalid-exit-target', 'node:visit', 1, 'loop-exit', 'node:loop'),
			],
		});
		const result = new MermaidRenderer().render(model);

		assert.ok(result.warnings.some(warning => warning.kind === 'unsupported-edge' && warning.edgeId === 'edge:invalid-exit-target'));
		assert.strictEqual(result.mermaidText.includes('root->>visit: visit'), false);
	});

	test('renders processOrders-like analyzer output without warnings', async () => {
		const result = await renderAnalyzed(`async function processOrders(orders) {
	const results = [];
	for (const order of orders) {
		try {
			if (order.amount <= 0) {
				results.push(order);
			}
			await validateOrder(order);
			if (order.status === "new") {
				await charge(order);
			} else {
				await notify(order);
			}
			while (order.retry < 3) {
				const saved = await save(order);
				if (saved) {
					break;
				} else {
					retry++;
				}
			}
		} catch (error) {
			error(error);
		}
	}
	results.push("done");
	return results;
}`);

		assert.deepStrictEqual(result.warnings, []);
		assertOrder(result.mermaidText, ['loop orders', 'critical try', 'opt order.amount <= 0', 'root->>push: push', 'end']);
		assertOrder(result.mermaidText, ['alt order.status === "new"', 'root->>charge: await charge', 'else', 'root->>notify: await notify', 'end']);
		assertOrder(result.mermaidText, ['loop order.retry < 3', 'root->>save: await save', 'alt saved', 'Note over root: break', 'else', 'Note over root: retry++', 'end', 'end', 'option catch error', 'root->>error: error', 'end', 'end']);
		assert.strictEqual(countOccurrences(result.mermaidText, 'return results'), 1);
	});

	test('renders return once when return node and return edge are both present', () => {
		const model = createModel({
			nodes: [
				callAt('node:done', 1, 'done', 'resolved', 2),
				{
					id: 'node:return',
					kind: 'return' as const,
					order: 2,
					sourceLocation: location(3, 2, 3, 15),
					expression: 'result',
				},
			],
			edges: [
				edge('edge:done-return', 'node:return', 1, 'return', 'node:done'),
				edge('edge:root-return', 'node:return', 2, 'return'),
			],
		});
		const result = new MermaidRenderer().render(model);

		assert.strictEqual(countOccurrences(result.mermaidText, 'return result'), 1);
		assert.deepStrictEqual(result.warnings, []);
	});

	test('routes returns from self to the fixed caller and never from the last call participant', () => {
		const model = createModel({
			nodes: [
				callAt('node:save', 1, 'save', 'resolved', 2),
				{
					id: 'node:return',
					kind: 'return' as const,
					order: 2,
					sourceLocation: location(3, 2, 3, 50),
					expression: 'results',
				},
			],
			edges: [
				edge('edge:save', 'node:save', 1),
				edge('edge:return', 'node:return', 2, 'next', 'node:save'),
			],
		});
		const result = new MermaidRenderer().render(model);

		assert.strictEqual(countOccurrences(result.mermaidText, 'participant caller as caller'), 1);
		assert.strictEqual(countOccurrences(result.mermaidText, 'root-->>caller: return results'), 1);
		assert.strictEqual(result.mermaidText.includes('save-->>root: return results'), false);
		assert.ok(result.mermaidText.indexOf('deactivate save') < result.mermaidText.indexOf('deactivate root'));
	});

	test('keeps caller identity fixed for long nested return expressions', () => {
		const model = createModel({
			nodes: [{
				id: 'node:return',
				kind: 'return' as const,
				order: 1,
				sourceLocation: location(2, 2, 2, 120),
				expression: 'buildResult({ documentUri: source.documentUri, values: source.values, metadata: source.metadata, nested: compute(source) })',
			}],
			edges: [edge('edge:return', 'node:return', 1)],
		});
		const result = new MermaidRenderer().render(model);

		assert.strictEqual(countOccurrences(result.mermaidText, 'participant caller as caller'), 1);
		assert.strictEqual(countOccurrences(result.mermaidText, 'root-->>caller: return '), 1);
		assert.strictEqual(result.mermaidText.includes('buildResult(...)'), true);
		assert.strictEqual(result.mermaidText.includes('caller-->>root'), false);
	});

	test('maps every return to its exact root-to-caller line across call states', () => {
		const fixtures = [
			{ name: 'await', resolution: 'resolved' as const, awaited: true },
			{ name: 'nested', resolution: 'resolved' as const, awaited: false },
			{ name: 'unknown', resolution: 'unknown' as const, awaited: false },
			{ name: 'unresolved', resolution: 'unresolved' as const, awaited: false },
		];
		for (const fixture of fixtures) {
			const callNode = callAt(`node:${fixture.name}`, 1, fixture.name, fixture.resolution, 2);
			const returnNode = {
				id: `node:${fixture.name}:return`,
				kind: 'return' as const,
				order: 2,
				sourceLocation: location(4, 2, 4, 20),
				expression: `${fixture.name}Result`,
			};
			const model = createModel({
				nodes: [callNode, returnNode],
				edges: [edge(`edge:${fixture.name}`, callNode.id, 1), edge(`edge:${fixture.name}:return`, returnNode.id, 2, 'next', callNode.id)],
				completeness: fixture.name === 'unknown' ? 'partial' : 'complete',
			});
			const result = new MermaidRenderer().render(model);
			const returnEntry = result.sourceMap.find(entry => entry.nodeId === returnNode.id && entry.edgeId === `edge:${fixture.name}:return`);
			assert.ok(returnEntry, fixture.name);
			const lineNumber = Number(returnEntry?.elementId.replace('line:', ''));
			assert.strictEqual(result.mermaidText.split('\n')[lineNumber - 1], `root-->>caller: return ${fixture.name}Result`);
			assert.strictEqual(result.mermaidText.includes(`${fixture.name}-->>root: return`), false);
		}
	});

	test('keeps throw notes separate from caller return and preserves process-note line mapping', () => {
		const model = createModel({
			nodes: [
				{ id: 'node:throw', kind: 'throw' as const, order: 1, sourceLocation: location(2, 2, 2, 12), expression: 'error' },
				{ id: 'node:return', kind: 'return' as const, order: 2, sourceLocation: location(3, 2, 3, 12), expression: 'result' },
		],
		edges: [edge('edge:throw', 'node:throw', 1, 'throw'), edge('edge:return', 'node:return', 2, 'return')],
		});
		const result = new MermaidRenderer().render(model);
		assert.strictEqual(result.mermaidText.includes('Note over root: throw error'), true);
		assert.strictEqual(result.mermaidText.includes('root-->>caller: return result'), true);
		for (const decoration of result.processNoteDecorations) {
			assert.ok(result.mermaidText.split('\n')[decoration.mermaidLine - 1].startsWith('Note over '));
		}
	});

	test('routes a return after genuinely nested calls from root to caller', () => {
		const inner = callAt('node:inner', 1, 'inner', 'resolved', 2);
		const outer = callAt('node:outer', 2, 'outer', 'resolved', 3);
		const terminal = { id: 'node:return', kind: 'return' as const, order: 3, sourceLocation: location(4, 2, 4, 20), expression: 'outerResult' };
		const result = new MermaidRenderer().render(createModel({
			nodes: [inner, outer, terminal],
			edges: [edge('edge:inner', inner.id, 1), edge('edge:outer', outer.id, 2, 'next', inner.id), edge('edge:return', terminal.id, 3, 'next', outer.id)],
		}));

		assert.ok(result.mermaidText.includes('root->>inner: inner'));
		assert.ok(result.mermaidText.includes('root->>outer: outer'));
		assert.ok(result.mermaidText.includes('root-->>caller: return outerResult'));
		assert.strictEqual(result.mermaidText.includes('inner-->>root: return outerResult'), false);
		assert.strictEqual(result.mermaidText.includes('outer-->>root: return outerResult'), false);
	});

	test('preserves caller return and SourceMap in an explicitly partial model with diagnostics', () => {
		const returnNode = { id: 'node:return-partial', kind: 'return' as const, order: 2, sourceLocation: location(5, 2, 5, 20), expression: 'partialResult' };
		const result = new MermaidRenderer().render(createModel({
			nodes: [call('node:known', 1, 'known', 'resolved'), returnNode],
			edges: [edge('edge:known', 'node:known', 1), edge('edge:return-partial', returnNode.id, 2, 'next', 'node:known')],
			completeness: 'partial',
			diagnostics: [{ id: 'diagnostic:partial', kind: 'order-uncertain', severity: 'warning', message: 'Partial analysis.', sourceLocation: location(6, 2, 6, 15) }],
		}));
		const entry = result.sourceMap.find(item => item.nodeId === returnNode.id && item.edgeId === 'edge:return-partial');
		assert.ok(entry);
		const line = Number(entry?.elementId.replace('line:', ''));
		assert.strictEqual(result.mermaidText.split('\n')[line - 1], 'root-->>caller: return partialResult');
		assert.strictEqual(result.mermaidText.includes('known-->>root: return partialResult'), false);
		assert.strictEqual(result.mermaidText.includes('Partial analysis.'), true);
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

	test('keeps the root lifeline named self and separates fallback participants by fixed key', () => {
		const model = createModel({
			nodes: [
				{ ...call('node:unknown', 1, 'lookup', 'unknown'), participant: { key: 'unknown', label: 'Unknown', kind: 'unknown' as const } },
				{ ...call('node:unresolved', 2, 'lookup', 'unresolved'), participant: { key: 'unresolved', label: 'Unresolved', kind: 'unresolved' as const } },
			],
			edges: [edge('edge:unknown', 'node:unknown', 1), edge('edge:unresolved', 'node:unresolved', 2)],
		});
		const result = new MermaidRenderer().render(model);

		assert.ok(result.mermaidText.includes('participant root as self'));
		assert.strictEqual(countOccurrences(result.mermaidText, 'participant Unknown as Unknown'), 1);
		assert.strictEqual(countOccurrences(result.mermaidText, 'participant Unresolved as Unresolved'), 1);
		assert.ok(result.mermaidText.includes('root->>Unknown: unknown call'));
		assert.ok(result.mermaidText.includes('root->>Unresolved:'));
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

	test('does not misclassify same-line loop exits as loop-body edges', async () => {
		const result = await renderAnalyzed('function target(items) { for (const item of items) { break; } after(); }');

		assert.ok(result.mermaidText.includes('Note over root: break'));
		assert.ok(result.mermaidText.includes(': after'));
		assert.strictEqual(result.warnings.some(warning => warning.message.includes('targets a node inside the loop body')), false);
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

	test('records process note decorations by FlowNode kind rather than note text', () => {
		const model = createModel({
			nodes: [
				{ id: 'node:continue', kind: 'continue', order: 1, sourceLocation: location(2, 2, 2, 10), label: 'continue with custom label' },
				{ id: 'node:expression', kind: 'expression', order: 2, sourceLocation: location(3, 2, 3, 20), expression: 'retryCount += step' },
				call('node:unknown', 3, 'unknown', 'unknown'),
			],
			edges: [
				edge('edge:continue', 'node:continue', 1),
				edge('edge:expression', 'node:expression', 2),
				edge('edge:unknown', 'node:unknown', 3),
			],
		});
		const result = new MermaidRenderer().render(model);

		assert.deepStrictEqual(result.processNoteDecorations.map(decoration => decoration.nodeKind), ['continue', 'expression']);
		for (const decoration of result.processNoteDecorations) {
			const lines = result.mermaidText.trimEnd().split('\n');
			assert.strictEqual(lines[decoration.mermaidLine - 1].startsWith('Note over '), true);
		}
		assert.strictEqual(result.processNoteDecorations.length, 2);
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

async function renderAnalyzed(text: string) {
	const functionKeyword = text.indexOf('function ');
	const input: AnalyzerInput = {
		source: { uri: 'file:///workspace/source.ts', languageId: 'typescript', version: 1, text },
		cursorOffset: functionKeyword >= 0 ? functionKeyword + 'function '.length : 0,
		configuration: { configurationDigest: 'sha256:test' },
		cancellation: { isCancellationRequested: false },
	};
	const analysis = await new TypeScriptAnalyzer().analyze(input);
	assert.ok(analysis.status === 'success' || analysis.status === 'partial');
	if (analysis.status !== 'success' && analysis.status !== 'partial') {
		throw new Error('Expected analyzer to return a FlowModel.');
	}
	return new MermaidRenderer().render(analysis.model);
}

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
			analyzerVersion: '0.3.2',
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
	return callAt(id, order, calleeName, resolution, order + 1);
}

function callAt(id: string, order: number, calleeName: string, resolution: 'resolved' | 'unknown' | 'unresolved', line: number) {
	return {
		id,
		kind: 'call' as const,
		order,
		sourceLocation: location(line, 2, line, 20),
		calleeName,
		participant: resolution === 'unknown'
			? { key: 'unknown', label: 'Unknown', kind: 'unknown' as const }
			: { key: `instance:${calleeName}`, label: calleeName, kind: 'instance' as const },
		resolution,
	};
}

function branch(id: string, order: number, condition: string) {
	return branchAt(id, order, condition, order + 1, order + 1);
}

function branchAt(id: string, order: number, condition: string, startLine: number, endLine: number) {
	return {
		id,
		kind: 'branch' as const,
		order,
		sourceLocation: location(startLine, 2, endLine, 20),
		condition,
	};
}

function loop(id: string, order: number, condition: string) {
	return loopAt(id, order, condition, order + 1, order + 1);
}

function loopAt(id: string, order: number, condition: string, startLine: number, endLine: number) {
	return {
		id,
		kind: 'loop' as const,
		order,
		sourceLocation: location(startLine, 2, endLine, 20),
		condition,
	};
}

function tryCatch(id: string, order: number, catchBinding: string, hasFinally: boolean) {
	return tryCatchAt(id, order, catchBinding, hasFinally, order + 1, order + 1);
}

function tryCatchAt(id: string, order: number, catchBinding: string, hasFinally: boolean, startLine: number, endLine: number) {
	return {
		id,
		kind: 'try-catch' as const,
		order,
		sourceLocation: location(startLine, 2, endLine, 20),
		catchBinding,
		hasFinally,
	};
}

function edge(id: string, targetNodeId: string, executionOrder: number, kind: 'next' | 'return' | 'uncertain' | 'true' | 'false' | 'loop-body' | 'loop-exit' | 'try' | 'catch' | 'finally' | 'throw' = 'next', sourceNodeId = 'function:loadUser') {
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

function countBranchWarnings(result: ReturnType<MermaidRenderer['render']>): number {
	return result.warnings.filter(warning => warning.kind === 'unsupported-node' && warning.message.includes('FlowNode kind "branch"')).length;
}

function assertOrder(text: string, expectedFragments: readonly string[]): void {
	let previousIndex = -1;
	for (const fragment of expectedFragments) {
		const normalized = fragment.match(/^(root->>)[^:]+(: .+)$/);
		const pattern = normalized ? new RegExp(`${normalized[1]}[^:]+${escapeRegExp(normalized[2])}`) : undefined;
		const match = pattern ? text.slice(previousIndex + 1).match(pattern) : undefined;
		const index = match?.index === undefined ? text.indexOf(fragment, previousIndex + 1) : previousIndex + 1 + match.index;
		assert.ok(index > previousIndex, `${fragment} should appear after index ${previousIndex} in:\n${text}`);
		previousIndex = index;
	}
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
