import * as assert from 'assert';

import { PythonAnalyzer, PythonFunctionLocator } from '../analyzers';
import type { AnalyzerInput } from '../analyzers';
import { MermaidRenderer } from '../renderer';

function input(text: string, cursorOffset: number): AnalyzerInput {
	return {
		source: { uri: 'file:///sample.py', languageId: 'python', version: 1, text },
		cursorOffset,
		cancellation: { isCancellationRequested: false },
		configuration: { configurationDigest: 'test' },
	};
}

suite('Python function flow', () => {
	test('locates top-level, class, and nested async functions', () => {
		const text = 'def outer():\n    class C:\n        async def inner():\n            def nested():\n                return 1\n            return nested()\n';
		const locator = new PythonFunctionLocator();
		assert.strictEqual(locator.findFunctionCandidates({ uri: 'file:///sample.py', languageId: 'python', version: 1, text }).length, 3);
		const nestedOffset = text.indexOf('return 1');
		const selected = locator.findFunctionContainingOffset({ uri: 'file:///sample.py', languageId: 'python', version: 1, text }, nestedOffset);
		assert.strictEqual(selected.status, 'found');
		if (selected.status === 'found') { assert.strictEqual(selected.function.name, 'nested'); }
	});

	test('extracts nested calls in estimated execution order and loop control edges', async () => {
		const text = 'def target(value):\n    for item in value:\n        if item:\n            continue\n        break\n    return outer(inner(value))\n';
		const result = await new PythonAnalyzer().analyze(input(text, text.indexOf('target')));
		assert.strictEqual(result.status, 'success');
		if (result.status !== 'success') { return; }
		assert.deepStrictEqual(result.model.nodes.filter(node => node.kind === 'call').map(node => node.calleeName), ['inner', 'outer']);
		assert.ok(result.model.edges.some(edge => edge.kind === 'continue-loop'));
		assert.ok(result.model.edges.some(edge => edge.kind === 'break-exit'));
	});

	test('extracts calls on assignment right-hand sides without diagnosing the assignment', async () => {
		const text = 'def target():\n    value: object = outer(inner())\n    retry += increment()\n';
		const result = await new PythonAnalyzer().analyze(input(text, text.indexOf('target')));
		assert.strictEqual(result.status, 'success');
		if (result.status !== 'success') { return; }
		assert.deepStrictEqual(result.model.nodes.filter(node => node.kind === 'call').map(node => node.calleeName), ['inner', 'outer', 'increment']);
		assert.strictEqual(result.diagnostics.some(diagnostic => diagnostic.kind === 'unsupported-syntax'), false);
	});

	test('separates Python receiver participants from operation names', async () => {
		const text = [
			'def target(results, logger):',
			'    results.append(1)',
			'    logger.error("bad")',
			'    Service.save()',
			'    foo()',
			'    obj.child.run()',
			'    values[index]()',
		].join('\n');
		const result = await new PythonAnalyzer().analyze(input(text, text.indexOf('target')));
		assert.ok(result.status === 'success' || result.status === 'partial');
		if (result.status !== 'success' && result.status !== 'partial') { return; }
		const calls = result.model.nodes.filter(node => node.kind === 'call');
		assert.deepStrictEqual(calls.map(node => node.calleeName), ['append', 'error', 'save', 'foo', 'run', '<unknown>']);
		const participant = (name: string) => calls.find(node => node.calleeName === name)?.participant;
		assert.deepStrictEqual(participant('append'), { key: 'instance:results', label: 'results', kind: 'instance' });
		assert.deepStrictEqual(participant('error'), { key: 'instance:logger', label: 'logger', kind: 'instance' });
		assert.deepStrictEqual(participant('save'), { key: 'class:Service', label: 'Service', kind: 'class' });
		assert.deepStrictEqual(participant('foo'), { key: 'unknown', label: 'Unknown', kind: 'unknown' });
		assert.deepStrictEqual(participant('run'), { key: 'unresolved', label: 'Unresolved', kind: 'unresolved' });
		assert.deepStrictEqual(participant('<unknown>'), { key: 'unknown', label: 'Unknown', kind: 'unknown' });
		assert.ok(result.diagnostics.some(diagnostic => diagnostic.kind === 'unresolved-call' || diagnostic.kind === 'unknown-call'));
	});

	test('handles assignments, except bindings, loop exits, and concise control labels', async () => {
		const text = [
			'async def hoge(orders: list[Order]) -> list[str]:',
			'    results: list[str] = []',
			'',
			'    for order in orders:',
			'        try:',
			'            if order.amount <= 0:',
			'                results.append(f"{order.id}: invalid")',
			'                continue',
			'        except Exception as error:',
			'            logger.error(error)',
			'            results.append(f"{order.id}: failed")',
			'',
			'    return results',
		].join('\n');
		const result = await new PythonAnalyzer().analyze(input(text, text.indexOf('hoge')));

		assert.strictEqual(result.status, 'success');
		if (result.status !== 'success') { return; }
		assert.strictEqual(result.model.metadata.analyzerVersion, '1.0.2');
		assert.strictEqual(result.diagnostics.some(diagnostic => diagnostic.message.includes('AssignStatement')), false);
		const control = result.model.nodes.find(node => node.kind === 'try-catch');
		const loop = result.model.nodes.find(node => node.kind === 'loop');
		assert.strictEqual(control?.kind === 'try-catch' ? control.catchBinding : undefined, 'error');
		assert.strictEqual(control?.kind === 'try-catch' ? control.hasFinally : undefined, false);
		assert.ok(result.model.edges.some(edge => edge.kind === 'catch'));
		assert.ok(result.model.edges.some(edge => edge.kind === 'continue-loop'));
		assert.ok(loop && result.model.edges.some(edge => edge.kind === 'loop-exit' && edge.sourceNodeId === loop.id));
		assert.strictEqual(result.model.edges.some(edge => edge.kind === 'loop-exit' && edge.sourceNodeId !== loop?.id), false);

		const rendered = new MermaidRenderer().render(result.model);
		assert.ok(rendered.mermaidText.includes('loop for order in orders'));
		assert.ok(rendered.mermaidText.includes('opt order.amount <= 0'));
		assert.ok(rendered.mermaidText.includes('option catch error'));
		assert.strictEqual(rendered.mermaidText.includes('option finally'), false);
		assert.deepStrictEqual(rendered.warnings, []);
	});
});
