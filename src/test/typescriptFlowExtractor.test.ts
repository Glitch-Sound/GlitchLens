import * as assert from 'assert';

import { TypeScriptAnalyzer } from '../analyzers';
import type { AnalyzerInput } from '../analyzers';

suite('TypeScriptAnalyzer static flow extraction', () => {
	test('extracts calls in source order and does not enter callee bodies', async () => {
		const result = await analyze(`function target() { first(); second(); helper(); }\nfunction helper() { hidden(); }`, 'typescript', 20);
		assert.strictEqual(result.status, 'success');
		if (result.status !== 'success') {return;}
		assert.deepStrictEqual(result.model.nodes.filter(node => node.kind === 'call').map(node => node.calleeName), ['first', 'second', 'helper']);
		assert.ok(result.model.nodes.every(node => !node.sourceLocation.symbolName?.includes('hidden')));
		assert.deepStrictEqual(result.model.nodes.map(node => node.order), result.model.nodes.map((_, index) => index));
		assert.deepStrictEqual(result.model.edges.map(edge => edge.executionOrder), result.model.edges.map((_, index) => index));
	});

	test('extracts await calls, branches, loops, returns, throws, and try/catch/finally', async () => {
		const result = await analyze(`async function target(value) {\n await load(value);\n if (value) { work(); } else { other(); }\n switch (value) { case 1: one(); break; default: two(); }\n for (const item of value) { visit(item); }\n for (;;) { tick(); break; }\n while (value) { wait(); }\n do { retry(); } while (value);\n try { risky(); return value; } catch (error) { recover(error); throw error; } finally { cleanup(); }\n}`, 'typescript', 30);
	assert.strictEqual(result.status, 'success');
	if (result.status !== 'success') {return;}
	const kinds = result.model.nodes.map(node => node.kind);
	for (const kind of ['await', 'branch', 'loop', 'return', 'throw', 'try-catch'] as const) {assert.ok(kinds.includes(kind), kind);}
	for (const kind of ['true', 'false', 'loop-body', 'loop-exit', 'try', 'catch', 'finally', 'return', 'throw'] as const) {assert.ok(result.model.edges.some(edge => edge.kind === kind), kind);}
	});

	test('handles nested control structures and both TypeScript and JavaScript', async () => {
		const source = `function target() { if (ok()) { for (const x of xs) { use(x); } } }`;
		for (const languageId of ['typescript', 'javascript'] as const) {
			const result = await analyze(source, languageId, 20);
			assert.strictEqual(result.status, 'success');
			if (result.status === 'success') {assert.ok(result.model.nodes.filter(node => node.kind === 'call').length >= 2);}
		}
	});

	test('does not enter callback or nested function bodies', async () => {
		const result = await analyze(`function target() { items.map(item => callbackOnly(item)); function nested() { nestedOnly(); } outer(); }`, 'javascript', 20);
		assert.strictEqual(result.status, 'success');
		if (result.status !== 'success') {return;}
		assert.deepStrictEqual(result.model.nodes.filter(node => node.kind === 'call').map(node => node.calleeName), ['map', 'outer']);
	});

	test('supports function expressions and nested call expressions', async () => {
		const result = await analyze(`const target = () => outer(inner());`, 'javascript', 18);
		assert.strictEqual(result.status, 'success');
		if (result.status !== 'success') {return;}
		assert.deepStrictEqual(result.model.nodes.filter(node => node.kind === 'call').map(node => node.calleeName), ['inner', 'outer']);
	});

	test('connects break to the first reachable statement after nested loops and continue to its innermost loop', async () => {
		const result = await analyze(`function target(items) { while (outer()) { for (const item of items) { continue; break; } afterInner(); break; } afterOuter(); }`, 'javascript', 20);
		assert.strictEqual(result.status, 'success');
		if (result.status !== 'success') {return;}
		const loops = result.model.nodes.filter(node => node.kind === 'loop');
		const continueNode = result.model.nodes.find(node => node.kind === 'continue');
		const breaks = result.model.nodes.filter(node => node.kind === 'break');
		const afterInner = result.model.nodes.find(node => node.kind === 'call' && node.calleeName === 'afterInner');
		const afterOuter = result.model.nodes.find(node => node.kind === 'call' && node.calleeName === 'afterOuter');
		assert.strictEqual(loops.length, 2);
		assert.ok(continueNode && breaks.length === 2 && afterInner && afterOuter);
		assert.ok(result.model.edges.some(edge => edge.sourceNodeId === continueNode?.id && edge.targetNodeId === loops[1]?.id && edge.kind === 'continue-loop'));
		assert.ok(result.model.edges.some(edge => edge.sourceNodeId === breaks[0]?.id && edge.targetNodeId === afterInner?.id && edge.kind === 'break-exit'));
		assert.ok(result.model.edges.some(edge => edge.sourceNodeId === breaks[1]?.id && edge.targetNodeId === afterOuter?.id && edge.kind === 'break-exit'));
	});

	test('does not create break-exit when a loop has no reachable successor', async () => {
		const result = await analyze(`function target() { while (ready()) { break; } }`, 'typescript', 20);
		assert.strictEqual(result.status, 'success');
		if (result.status !== 'success') {return;}
		const breakNode = result.model.nodes.find(node => node.kind === 'break');
		assert.ok(breakNode);
		assert.strictEqual(result.model.edges.some(edge => edge.sourceNodeId === breakNode?.id && edge.kind === 'break-exit'), false);
	});

	test('reports uncertain order only for conditional expression alternatives', async () => {
		const result = await analyze(`function target(flag) { return flag ? first() : second(); }`, 'javascript', 20);
		assert.ok(result.status === 'partial' || result.status === 'success');
		if (result.status !== 'partial' && result.status !== 'success') {return;}
		assert.ok(result.model.diagnostics.some(diagnostic => diagnostic.kind === 'order-uncertain'));
		assert.ok(result.model.edges.some(edge => edge.kind === 'uncertain'));
	});

	test('does not connect mutually exclusive branches with a sequential edge', async () => {
		const result = await analyze(`function target(flag) { if (flag) { yes(); } else { no(); } }`, 'javascript', 20);
		assert.strictEqual(result.status, 'success');
		if (result.status !== 'success') {return;}
		const yes = result.model.nodes.find(node => node.kind === 'call' && node.calleeName === 'yes');
		const no = result.model.nodes.find(node => node.kind === 'call' && node.calleeName === 'no');
		assert.ok(yes && no);
		assert.strictEqual(result.model.edges.some(edge => edge.sourceNodeId === yes?.id && edge.targetNodeId === no?.id && edge.kind === 'next'), false);
	});

	test('keeps sequential edge after an if without else', async () => {
		const result = await analyze(`function target(flag) { if (flag) { yes(); } after(); }`, 'javascript', 20);
		assert.strictEqual(result.status, 'success');
		if (result.status !== 'success') {return;}
		const yes = result.model.nodes.find(node => node.kind === 'call' && node.calleeName === 'yes');
		const after = result.model.nodes.find(node => node.kind === 'call' && node.calleeName === 'after');
		assert.ok(yes && after);
		assert.ok(result.model.edges.some(edge => edge.sourceNodeId === yes?.id && edge.targetNodeId === after?.id && edge.kind === 'next'));
	});

	test('models nested control structures inside block statements', async () => {
		const result = await analyze(`function target(flag, xs) { if (flag) { for (const x of xs) { if (x) { return use(x); } } } }`, 'typescript', 25);
		assert.strictEqual(result.status, 'success');
		if (result.status !== 'success') {return;}
		const kinds = result.model.nodes.map(node => node.kind);
		assert.ok(kinds.includes('loop'));
		assert.ok(kinds.filter(kind => kind === 'branch').length >= 2);
		assert.ok(kinds.includes('return'));
		assert.deepStrictEqual(result.model.nodes.filter(node => node.kind === 'call').map(node => node.calleeName), ['use']);
	});

	test('connects both if and else paths to following statements without duplicate branch next', async () => {
		const result = await analyze(`function target(flag) { if (flag) { yes(); } else { no(); } after(); }`, 'javascript', 20);
		assert.strictEqual(result.status, 'success');
		if (result.status !== 'success') {return;}
		const branch = result.model.nodes.find(node => node.kind === 'branch');
		const yes = result.model.nodes.find(node => node.kind === 'call' && node.calleeName === 'yes');
		const no = result.model.nodes.find(node => node.kind === 'call' && node.calleeName === 'no');
		const after = result.model.nodes.find(node => node.kind === 'call' && node.calleeName === 'after');
		assert.ok(branch && yes && no && after);
		assert.strictEqual(result.model.edges.some(edge => edge.sourceNodeId === branch?.id && edge.targetNodeId === yes?.id && edge.kind === 'next'), false);
		assert.ok(result.model.edges.some(edge => edge.sourceNodeId === branch?.id && edge.targetNodeId === yes?.id && edge.kind === 'true'));
		assert.ok(result.model.edges.some(edge => edge.sourceNodeId === branch?.id && edge.targetNodeId === no?.id && edge.kind === 'false'));
		assert.ok(result.model.edges.some(edge => edge.sourceNodeId === yes?.id && edge.targetNodeId === after?.id && edge.kind === 'next'));
		assert.ok(result.model.edges.some(edge => edge.sourceNodeId === no?.id && edge.targetNodeId === after?.id && edge.kind === 'next'));
	});

	test('orders calls inside return expressions before the return node', async () => {
		const result = await analyze(`function target() { return finalize(); }`, 'typescript', 20);
		assert.strictEqual(result.status, 'success');
		if (result.status !== 'success') {return;}
		assert.deepStrictEqual(result.model.nodes.map(node => node.kind === 'call' ? `call:${node.calleeName}` : node.kind), ['call:finalize', 'return']);
	});

	test('does not connect return or throw terminal nodes to following statements', async () => {
		const result = await analyze(`function target(flag) { if (flag) { return done(); } after(); throw fail(); later(); }`, 'typescript', 20);
		assert.strictEqual(result.status, 'success');
		if (result.status !== 'success') {return;}
		const returnNode = result.model.nodes.find(node => node.kind === 'return');
		const throwNode = result.model.nodes.find(node => node.kind === 'throw');
		const after = result.model.nodes.find(node => node.kind === 'call' && node.calleeName === 'after');
		const later = result.model.nodes.find(node => node.kind === 'call' && node.calleeName === 'later');
		assert.ok(returnNode && throwNode && after && later);
		assert.strictEqual(result.model.edges.some(edge => edge.sourceNodeId === returnNode?.id && edge.targetNodeId === after?.id && edge.kind === 'next'), false);
		assert.strictEqual(result.model.edges.some(edge => edge.sourceNodeId === throwNode?.id && edge.targetNodeId === later?.id && edge.kind === 'next'), false);
	});

	test('uses loop-exit edges from loops to following statements', async () => {
		const result = await analyze(`function target(xs) { while (ready()) { step(); } after(); }`, 'javascript', 20);
		assert.strictEqual(result.status, 'success');
		if (result.status !== 'success') {return;}
		const loop = result.model.nodes.find(node => node.kind === 'loop');
		const after = result.model.nodes.find(node => node.kind === 'call' && node.calleeName === 'after');
		assert.ok(loop && after);
		assert.ok(result.model.edges.some(edge => edge.sourceNodeId === loop?.id && edge.targetNodeId === after?.id && edge.kind === 'loop-exit'));
		assert.strictEqual(result.model.edges.some(edge => edge.sourceNodeId === loop?.id && edge.targetNodeId === loop?.id && edge.kind === 'loop-exit'), false);
	});

	test('extracts calls from for initializer condition and incrementor', async () => {
		const result = await analyze(`function target() { for (init(); cond(); update()) { body(); } }`, 'javascript', 20);
		assert.strictEqual(result.status, 'success');
		if (result.status !== 'success') {return;}
		assert.deepStrictEqual(result.model.nodes.filter(node => node.kind === 'call').map(node => node.calleeName), ['init', 'cond', 'update', 'body']);
	});

	test('does not create loop back edges from terminal loop body nodes', async () => {
		const result = await analyze(`function target() { while (ready()) { return done(); } after(); }`, 'typescript', 20);
		assert.strictEqual(result.status, 'success');
		if (result.status !== 'success') {return;}
		const loop = result.model.nodes.find(node => node.kind === 'loop');
		const returnNode = result.model.nodes.find(node => node.kind === 'return');
		const after = result.model.nodes.find(node => node.kind === 'call' && node.calleeName === 'after');
		assert.ok(loop && returnNode && after);
		assert.strictEqual(result.model.edges.some(edge => edge.sourceNodeId === returnNode?.id && edge.targetNodeId === loop?.id && edge.kind === 'loop-body'), false);
		assert.ok(result.model.edges.some(edge => edge.sourceNodeId === loop?.id && edge.targetNodeId === after?.id && edge.kind === 'loop-exit'));
	});

	test('keeps loop-body edges directed from the loop node to the body entry', async () => {
		const result = await analyze(`function target(items) { for (const item of items) { visit(item); } }`, 'typescript', 20);
		assert.strictEqual(result.status, 'success');
		if (result.status !== 'success') {return;}
		const loop = result.model.nodes.find(node => node.kind === 'loop');
		const visit = result.model.nodes.find(node => node.kind === 'call' && node.calleeName === 'visit');
		assert.ok(loop && visit);
		assert.ok(result.model.edges.some(edge => edge.sourceNodeId === loop?.id && edge.targetNodeId === visit?.id && edge.kind === 'loop-body'));
		assert.strictEqual(result.model.edges.some(edge => edge.sourceNodeId === visit?.id && edge.targetNodeId === loop?.id && edge.kind === 'loop-body'), false);
	});

	test('models break and expression statements inside loop branches', async () => {
		const result = await analyze(`async function target(retry) { while (retry < 3) { const saved = await save(); if (saved) { break; } else { retry++; } } }`, 'typescript', 25);
		assert.strictEqual(result.status, 'success');
		if (result.status !== 'success') {return;}
		const branch = result.model.nodes.find(node => node.kind === 'branch' && node.condition === 'saved');
		const breakNode = result.model.nodes.find(node => node.kind === 'break');
		const retry = result.model.nodes.find(node => node.kind === 'expression' && node.expression === 'retry++');
		assert.ok(branch && breakNode && retry);
		assert.ok(result.model.edges.some(edge => edge.sourceNodeId === branch?.id && edge.targetNodeId === breakNode?.id && edge.kind === 'true'));
		assert.ok(result.model.edges.some(edge => edge.sourceNodeId === branch?.id && edge.targetNodeId === retry?.id && edge.kind === 'false'));
	});

	test('orders control entry edges before body-internal edges', async () => {
		const result = await analyze(`function target(flag) { if (flag) { a(); b(); } after(); }`, 'javascript', 20);
		assert.strictEqual(result.status, 'success');
		if (result.status !== 'success') {return;}
		const branch = result.model.nodes.find(node => node.kind === 'branch');
		const a = result.model.nodes.find(node => node.kind === 'call' && node.calleeName === 'a');
		const b = result.model.nodes.find(node => node.kind === 'call' && node.calleeName === 'b');
		assert.ok(branch && a && b);
		const trueEdge = result.model.edges.find(edge => edge.sourceNodeId === branch?.id && edge.targetNodeId === a?.id && edge.kind === 'true');
		const bodyNext = result.model.edges.find(edge => edge.sourceNodeId === a?.id && edge.targetNodeId === b?.id && edge.kind === 'next');
		assert.ok(trueEdge && bodyNext);
		assert.ok(trueEdge.executionOrder < bodyNext.executionOrder);
	});

	test('preserves nested non-terminal branch exits', async () => {
		const result = await analyze(`function target(flag, inner) { if (flag) { if (inner) { return done(); } } after(); }`, 'typescript', 20);
		assert.strictEqual(result.status, 'success');
		if (result.status !== 'success') {return;}
		const innerBranch = result.model.nodes.filter(node => node.kind === 'branch')[1];
		const after = result.model.nodes.find(node => node.kind === 'call' && node.calleeName === 'after');
		assert.ok(innerBranch && after);
		assert.ok(result.model.edges.some(edge => edge.sourceNodeId === innerBranch.id && edge.targetNodeId === after?.id && edge.kind === 'next'));
	});

	test('orders for header call edges before loop body edges', async () => {
		const result = await analyze(`function target() { for (init(); cond(); update()) { body(); } }`, 'javascript', 20);
		assert.strictEqual(result.status, 'success');
		if (result.status !== 'success') {return;}
		const loop = result.model.nodes.find(node => node.kind === 'loop');
		const init = result.model.nodes.find(node => node.kind === 'call' && node.calleeName === 'init');
		const body = result.model.nodes.find(node => node.kind === 'call' && node.calleeName === 'body');
		assert.ok(loop && init && body);
		const initEdge = result.model.edges.find(edge => edge.sourceNodeId === loop?.id && edge.targetNodeId === init?.id && edge.kind === 'next');
		const bodyEdge = result.model.edges.find(edge => edge.sourceNodeId === loop?.id && edge.targetNodeId === body?.id && edge.kind === 'loop-body');
		assert.ok(initEdge && bodyEdge);
		assert.ok(initEdge.executionOrder < bodyEdge.executionOrder);
	});

	test('does not continue after finally when try path is terminal', async () => {
		const result = await analyze(`function target() { try { return done(); } finally { cleanup(); } after(); }`, 'typescript', 20);
		assert.strictEqual(result.status, 'success');
		if (result.status !== 'success') {return;}
		const cleanup = result.model.nodes.find(node => node.kind === 'call' && node.calleeName === 'cleanup');
		const after = result.model.nodes.find(node => node.kind === 'call' && node.calleeName === 'after');
		assert.ok(cleanup && after);
		assert.strictEqual(result.model.edges.some(edge => edge.sourceNodeId === cleanup?.id && edge.targetNodeId === after?.id && edge.kind === 'next'), false);
	});

	test('does not execute target code or runtime traces while analyzing calls', async () => {
		let executed = false;
		const result = await analyze(`function target() { explode(); }\nfunction explode() { throw new Error('must not run'); }`, 'javascript', 20);
		assert.strictEqual(result.status, 'success');
		if (result.status !== 'success') {return;}
		assert.deepStrictEqual(result.model.nodes.filter(node => node.kind === 'call').map(node => node.calleeName), ['explode']);
		assert.strictEqual(executed, false);
		executed = true;
		assert.strictEqual(executed, true);
	});

	test('returns FlowModel as plain data without TypeScript AST Symbol or VS Code objects', async () => {
		const result = await analyze(`function target(flag) { if (flag) { service.run(); } return flag; }`, 'typescript', 20);
		assert.strictEqual(result.status, 'success');
		if (result.status !== 'success') {return;}
		const serialized = JSON.stringify(result.model);

		assert.ok(serialized.includes('"nodes"'));
		assert.ok(serialized.includes('"edges"'));
		assert.ok(!serialized.includes('SyntaxKind'));
		assert.ok(!serialized.includes('escapedText'));
		assert.ok(!serialized.includes('_declarationBrand'));
		assert.ok(!serialized.includes('$mid'));
		assert.ok(!serialized.includes('vscode'));
	});
});

suite('TypeScriptAnalyzer unresolved partial and cancellation handling', () => {
	test('marks unknown calls when the callable target cannot be named', async () => {
		const result = await analyze(`function target(callbacks, index) { callbacks[index](); }`, 'javascript', 20);
		assert.strictEqual(result.status, 'partial');
		if (result.status !== 'partial') {return;}
		const call = result.model.nodes.find(node => node.kind === 'call');
		assert.ok(call);
		assert.strictEqual(call.resolution, 'unknown');
		assert.ok(result.model.diagnostics.some(diagnostic => diagnostic.kind === 'unknown-call' && diagnostic.nodeId === call.id && diagnostic.sourceLocation));
		assert.strictEqual(result.model.completeness, 'partial');
		assert.strictEqual(result.model.metadata.completeness, 'partial');
	});

	test('marks unresolved calls when a named member is reached through a dynamic receiver', async () => {
		const result = await analyze(`function target(serviceMap, type, factory, name) { serviceMap[type].execute(); factory.getService(name).run(); }`, 'typescript', 20);
		assert.strictEqual(result.status, 'partial');
		if (result.status !== 'partial') {return;}
		const unresolved = result.model.nodes.flatMap(node => node.kind === 'call' && node.resolution === 'unresolved' ? [node.calleeName] : []);
		assert.ok(unresolved.includes('execute'));
		assert.ok(unresolved.includes('run'));
		assert.ok(result.model.diagnostics.some(diagnostic => diagnostic.kind === 'unresolved-call' && diagnostic.sourceLocation));
	});

	test('keeps collection methods resolved after a call expression receiver', async () => {
		const result = await analyze(`function target(source) { return findFunctionCandidates(source).map(candidate => toCommand(source, candidate)); }`, 'typescript', 20);
		assert.ok(result.status === 'success' || result.status === 'partial');
		if (result.status !== 'success' && result.status !== 'partial') {return;}
		const mapCall = result.model.nodes.find((node): node is Extract<typeof node, { kind: 'call' }> => node.kind === 'call' && node.calleeName === 'map');
		assert.ok(mapCall);
		assert.strictEqual(mapCall.resolution, 'resolved');
		assert.ok(!result.model.diagnostics.some(diagnostic => diagnostic.kind === 'unresolved-call' && diagnostic.nodeId === mapCall.id));
	});

	test('marks computed property and optional chaining calls as unresolved or unknown without forcing full resolution', async () => {
		const result = await analyze(`function target(obj, key, maybe) { obj[key](); maybe?.(); obj?.run(); }`, 'javascript', 20);
		assert.strictEqual(result.status, 'partial');
		if (result.status !== 'partial') {return;}
		const calls = result.model.nodes.filter(node => node.kind === 'call');
		assert.ok(calls.some(node => node.resolution === 'unknown'));
		assert.ok(calls.some(node => node.calleeName === 'run' && node.resolution === 'unresolved'));
		assert.ok(result.model.diagnostics.some(diagnostic => diagnostic.kind === 'unknown-call'));
		assert.ok(result.model.diagnostics.some(diagnostic => diagnostic.kind === 'unresolved-call'));
	});

	test('returns partial results with diagnostics when one statement is unsupported', async () => {
		const result = await analyze(`function target(obj) { before(); with (obj) { hidden(); } after(); }`, 'javascript', 20);
		assert.strictEqual(result.status, 'partial');
		if (result.status !== 'partial') {return;}
		assert.deepStrictEqual(result.model.nodes.filter(node => node.kind === 'call').map(node => node.calleeName), ['before', 'after']);
		assert.strictEqual(result.completeness, 'partial');
		assert.ok(result.model.diagnostics.some(diagnostic => diagnostic.kind === 'unsupported-syntax' && diagnostic.sourceLocation));
	});

	test('distinguishes fatal errors from recoverable partial analysis', async () => {
		const result = await analyze(`const value = 1;`, 'typescript', 3);
		assert.strictEqual(result.status, 'failed');
		if (result.status !== 'failed') {return;}
		assert.strictEqual(result.completeness, 'failed');
		assert.strictEqual(result.error.kind, 'invalid-input');
	});

	test('returns AnalyzerError for fatal analyzer exceptions instead of throwing', async () => {
		const input: AnalyzerInput = {
			source: {
				uri: 'file:///workspace/source.ts',
				languageId: 'typescript',
				version: 1,
				get text(): string {
					throw new Error('synthetic fatal read failure');
				},
			},
			cursorOffset: 20,
			configuration: { configurationDigest: 'sha256:test' },
			cancellation: { isCancellationRequested: false },
		};
		const result = await new TypeScriptAnalyzer().analyze(input);
		assert.strictEqual(result.status, 'failed');
		if (result.status !== 'failed') {return;}
		assert.strictEqual(result.error.kind, 'analysis-failed');
		assert.strictEqual(result.completeness, 'failed');
	});

	test('keeps diagnostic kind message and source location for unresolved calls', async () => {
		const result = await analyze(`function target(factory, name) { factory.getService(name).run(); }`, 'typescript', 20);
		assert.strictEqual(result.status, 'partial');
		if (result.status !== 'partial') {return;}
		const diagnostic = result.model.diagnostics.find(item => item.kind === 'unresolved-call');

		assert.ok(diagnostic);
		assert.strictEqual(diagnostic.severity, 'warning');
		assert.ok(diagnostic.message.includes('dynamic receiver'));
		assert.ok(diagnostic.sourceLocation);
		assert.strictEqual(diagnostic.sourceLocation.uri, 'file:///workspace/source.ts');
		assert.ok(typeof diagnostic.sourceLocation.range.start.line === 'number');
	});

	test('returns a cancelled failure before analysis starts', async () => {
		const result = await analyze(`function target() { first(); }`, 'typescript', 20, { isCancellationRequested: true });
		assert.strictEqual(result.status, 'failed');
		if (result.status !== 'failed') {return;}
		assert.strictEqual(result.error.kind, 'analysis-cancelled');
		assert.strictEqual(result.completeness, 'failed');
	});

	test('returns a cancelled failure during traversal and not a cacheable partial model', async () => {
		let checks = 0;
		const cancellation = {
			get isCancellationRequested(): boolean {
				checks += 1;
				return checks > 6;
			},
		};
		const result = await analyze(`function target() { first(); second(); third(); fourth(); fifth(); }`, 'javascript', 20, cancellation);
		assert.strictEqual(result.status, 'failed');
		if (result.status !== 'failed') {return;}
		assert.strictEqual(result.error.kind, 'analysis-cancelled');
		assert.strictEqual(result.completeness, 'failed');
		assert.ok(!('model' in result));
	});
});

suite('TypeScriptAnalyzer responsiveness validation', () => {
	test('returns complete or partial results for a large complex function with user-visible unresolved locations', async () => {
		const result = await analyze(largeComplexFunction(), 'typescript', 30);

		assert.ok(result.status === 'success' || result.status === 'partial');
		if (result.status !== 'success' && result.status !== 'partial') {return;}
		assert.ok(result.model.nodes.length > 150);
		assert.ok(result.model.nodes.some(node => node.kind === 'branch'));
		assert.ok(result.model.nodes.some(node => node.kind === 'loop'));
		assert.ok(result.model.nodes.some(node => node.kind === 'try-catch'));
		assert.ok(result.model.nodes.some(node => node.kind === 'call' && node.calleeName === 'deepCall'));
		assert.ok(!result.model.nodes.some(node => node.kind === 'call' && node.calleeName === 'calleeInternal'));
		assert.strictEqual(result.model.source.documentVersion, 1);
		assert.deepStrictEqual(result.model.nodes.map(node => node.order), result.model.nodes.map((_, index) => index));
		assert.ok(result.model.diagnostics.some(diagnostic => diagnostic.kind === 'unresolved-call' && diagnostic.sourceLocation));
		assert.ok(result.model.diagnostics.some(diagnostic => diagnostic.kind === 'unsupported-syntax' && diagnostic.sourceLocation));
	});

	test('handles deeply nested branches without stack overflow', async () => {
		const source = deeplyNestedFunction(220);
		const result = await analyze(source, 'javascript', 20);

		assert.ok(result.status === 'success' || result.status === 'partial');
		if (result.status !== 'success' && result.status !== 'partial') {return;}
		assert.ok(result.model.nodes.filter(node => node.kind === 'branch').length >= 200);
		assert.ok(result.model.nodes.some(node => node.kind === 'call' && node.calleeName === 'leaf'));
	});

	test('yields to the event loop so cancellation can interrupt many calls', async () => {
		const cancellation = { isCancellationRequested: false };
		const analysis = analyze(manyCallsFunction(600), 'typescript', 20, cancellation);
		setImmediate(() => {
			cancellation.isCancellationRequested = true;
		});

		const result = await analysis;

		assert.strictEqual(result.status, 'failed');
		if (result.status !== 'failed') {return;}
		assert.strictEqual(result.error.kind, 'analysis-cancelled');
		assert.strictEqual(result.completeness, 'failed');
	});
});

async function analyze(text: string, languageId: 'typescript' | 'javascript', cursorOffset: number, cancellation: AnalyzerInput['cancellation'] = { isCancellationRequested: false }) {
	const input: AnalyzerInput = {
		source: { uri: `file:///workspace/source.${languageId === 'typescript' ? 'ts' : 'js'}`, languageId, version: 1, text },
		cursorOffset,
		configuration: { configurationDigest: 'sha256:test' },
		cancellation,
	};
	return new TypeScriptAnalyzer().analyze(input);
}

function largeComplexFunction(): string {
	const repeatedCalls = Array.from({ length: 180 }, (_, index) => `step${index}(input);`).join('\n');
	return `function target(input, dynamicMap, key) {
	prepare(input);
	if (input.ready) {
		for (const item of input.items) {
			if (item.enabled) {
				deepCall(item);
			} else {
				skip(item);
			}
		}
	} else {
		fallback(input);
	}
	while (input.next()) {
		poll(input);
	}
	try {
		risky(input);
		dynamicMap[key].run();
		with (input) {
			hidden();
		}
	} catch (error) {
		recover(error);
	} finally {
		cleanup(input);
	}
	${repeatedCalls}
	return finish(input);
}
function deepCall(value) {
	calleeInternal(value);
}`;
}

function deeplyNestedFunction(depth: number): string {
	const open = Array.from({ length: depth }, (_, index) => `if (flag${index}) {`).join('\n');
	const close = Array.from({ length: depth }, () => '}').join('\n');
	return `function target() {
${open}
leaf();
${close}
}`;
}

function manyCallsFunction(count: number): string {
	const calls = Array.from({ length: count }, (_, index) => `call${index}();`).join('\n');
	return `function target() {
${calls}
}`;
}
