import * as assert from 'assert';

import { PythonAnalyzer, PythonFunctionLocator, TypeScriptAnalyzer, TypeScriptFunctionLocator } from '../analyzers';
import type { AnalyzerInput } from '../analyzers';
import { AnalyzerRegistry, VisualizeFunctionFlowUseCase } from '../application';
import {
	createVisualizationViewModel,
	WebviewVisualizationAdapter,
	type ClipboardAdapter,
	type WebviewPanelFactory,
	type WebviewPanelPort,
	type VisualizationViewNotification,
} from '../integration/visualizationView';
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

	test('places await before its call and renders an awaited operation once', async () => {
		const text = 'async def target(service):\n    await service.save()\n';
		const result = await new PythonAnalyzer().analyze(input(text, text.indexOf('target')));
		assert.strictEqual(result.status, 'success');
		if (result.status !== 'success') { return; }
		const awaitNode = result.model.nodes.find(node => node.kind === 'await');
		const callNode = result.model.nodes.find(node => node.kind === 'call');
		assert.ok(awaitNode && callNode);
		if (!awaitNode || !callNode) { return; }
		assert.ok(awaitNode.order < callNode.order);
		assert.ok(result.model.edges.some(edge => edge.sourceNodeId === awaitNode.id && edge.targetNodeId === callNode.id));
		const rendered = new MermaidRenderer().render(result.model);
		assert.strictEqual((rendered.mermaidText.match(/await save/g) ?? []).length, 1);
	});

	test('keeps return and raise expressions keyword-free and orders calls before terminals', async () => {
		const text = [
			'def target():',
			'    return build()',
			'',
			'def other():',
			'    raise create_error()',
		].join('\n');
		const returnResult = await new PythonAnalyzer().analyze(input(text, text.indexOf('target')));
		assert.strictEqual(returnResult.status, 'success');
		if (returnResult.status !== 'success') { return; }
		const returnCall = returnResult.model.nodes.find(node => node.kind === 'call');
		const returnNode = returnResult.model.nodes.find(node => node.kind === 'return');
		assert.ok(returnCall && returnNode);
		if (!returnCall || !returnNode) { return; }
		assert.ok(returnCall.order < returnNode.order);
		assert.strictEqual(returnNode.expression, 'build()');
		const returnRendered = new MermaidRenderer().render(returnResult.model);
		assert.ok(returnRendered.mermaidText.includes('return build(...)'));
		assert.strictEqual(returnRendered.mermaidText.includes('return return'), false);

		const raiseOffset = text.indexOf('other');
		const raiseResult = await new PythonAnalyzer().analyze(input(text, raiseOffset));
		assert.strictEqual(raiseResult.status, 'success');
		if (raiseResult.status !== 'success') { return; }
		const raiseCall = raiseResult.model.nodes.find(node => node.kind === 'call');
		const raiseNode = raiseResult.model.nodes.find(node => node.kind === 'throw');
		assert.ok(raiseCall && raiseNode);
		if (!raiseCall || !raiseNode) { return; }
		assert.ok(raiseCall.order < raiseNode.order);
		assert.strictEqual(raiseNode.expression, 'create_error()');
		const raiseRendered = new MermaidRenderer().render(raiseResult.model);
		assert.ok(raiseRendered.mermaidText.includes('throw create_error(...)'));
		assert.strictEqual(raiseRendered.mermaidText.includes('throw raise'), false);
	});

	test('preserves the shared Mermaid, SourceMap, and view contract for Python', async () => {
		const text = [
			'async def process_orders(service, logger):',
			'    await service.save()',
			'    logger.error("failed")',
			'    foo()',
			'    obj.child.run()',
			'    return build_result()',
		].join('\n');
		const source = { uri: 'file:///workspace/process_orders.py', languageId: 'python', version: 3, text } as const;
		const candidate = new PythonFunctionLocator().findFunctionContainingOffset(source, text.indexOf('process_orders'));
		assert.strictEqual(candidate.status, 'found');
		if (candidate.status !== 'found') { return; }

		const result = await new VisualizeFunctionFlowUseCase(
			new AnalyzerRegistry([new PythonAnalyzer()]),
			new MermaidRenderer(),
		).execute({
			source,
			cursorOffset: text.indexOf('process_orders'),
			functionRange: candidate.function.range,
			configuration: { configurationDigest: 'python-contract' },
			cancellation: { isCancellationRequested: false },
		});

		assert.ok(result.status === 'success' || result.status === 'partial');
		if (result.status !== 'success' && result.status !== 'partial') { return; }
		assert.strictEqual(result.canCopyMermaid, true);
		assert.strictEqual(result.mermaidText, new MermaidRenderer().render(result.model).mermaidText);
		assert.ok(result.mermaidText.includes('participant root as self'));
		assert.ok(result.mermaidText.includes('participant service as service'));
		assert.ok(result.mermaidText.includes('participant logger as logger'));
		assert.ok(result.mermaidText.includes('participant Unknown as Unknown'));
		assert.ok(result.mermaidText.includes('participant Unresolved as Unresolved'));
		assert.ok(result.mermaidText.includes('root->>Unknown: foo'));
		assert.ok(result.mermaidText.includes('root->>Unresolved: run (unresolved)'));
		assert.ok(result.mermaidText.includes('await save'));
		assert.ok(result.mermaidText.includes('return build_result(...)'));
		assert.ok(result.sourceMap.length > 0);
		assert.ok(result.sourceMap.every(entry => entry.sourceLocation.uri === source.uri));

		const view = createVisualizationViewModel(result);
		assert.strictEqual(view.mermaidText, result.mermaidText);
		assert.strictEqual(view.fallbackText, result.mermaidText);
		assert.deepStrictEqual(view.sourceMap, result.sourceMap);

		const factory = new PythonStubPanelFactory();
		const clipboard = new PythonStubClipboard();
		const notifications = new PythonStubNotification();
		const adapter = new WebviewVisualizationAdapter(factory, clipboard, notifications);
		await adapter.show(view);
		assert.ok(factory.panel.webview.html.includes('participant root as self'));
		await adapter.copyCurrentMermaidForTest();
		assert.deepStrictEqual(clipboard.writes, [result.mermaidText]);
		assert.deepStrictEqual(notifications.messages, ['info:Mermaid text copied.']);

		const tsText = 'async function process_orders(service: Service) {\n  await service.save();\n  return build_result();\n}';
		const tsSource = { uri: 'file:///workspace/process_orders.ts', languageId: 'typescript', version: 3, text: tsText } as const;
		const tsCandidate = new TypeScriptFunctionLocator().findFunctionContainingOffset(tsSource, tsText.indexOf('process_orders'));
		assert.strictEqual(tsCandidate.status, 'found');
		if (tsCandidate.status !== 'found') { return; }
		const tsResult = await new VisualizeFunctionFlowUseCase(
			new AnalyzerRegistry([new TypeScriptAnalyzer()]),
			new MermaidRenderer(),
		).execute({
			source: tsSource,
			cursorOffset: tsText.indexOf('process_orders'),
			functionRange: tsCandidate.function.range,
			configuration: { configurationDigest: 'typescript-contract' },
			cancellation: { isCancellationRequested: false },
		});
		assert.strictEqual(tsResult.status, 'success');
		if (tsResult.status !== 'success') { return; }
		assert.ok(tsResult.mermaidText.includes('participant service as service'));
		assert.ok(tsResult.mermaidText.includes('await save'));
		assert.ok(tsResult.mermaidText.includes('return build_result(...)'));
	});
});

class PythonStubPanelFactory implements WebviewPanelFactory {
	public readonly panel = new PythonStubPanel();

	public createPanel(): WebviewPanelPort {
		return this.panel;
	}
}

class PythonStubPanel implements WebviewPanelPort {
	public readonly webview = { html: '' };
	private disposeHandler: (() => void) | undefined;
	private messageHandler: ((message: unknown) => void) | undefined;

	public reveal(): void {}

	public dispose(): void { this.disposeHandler?.(); }

	public onDidDispose(listener: () => void) {
		this.disposeHandler = listener;
		return { dispose: () => { this.disposeHandler = undefined; } };
	}

	public onDidReceiveMessage(listener: (message: unknown) => void) {
		this.messageHandler = listener;
		return { dispose: () => { this.messageHandler = undefined; } };
	}
}

class PythonStubClipboard implements ClipboardAdapter {
	public readonly writes: string[] = [];

	public writeText(text: string): Promise<void> {
		this.writes.push(text);
		return Promise.resolve();
	}
}

class PythonStubNotification implements VisualizationViewNotification {
	public readonly messages: string[] = [];

	public showInfo(message: string): Promise<void> {
		this.messages.push(`info:${message}`);
		return Promise.resolve();
	}

	public showWarning(message: string): Promise<void> {
		this.messages.push(`warning:${message}`);
		return Promise.resolve();
	}

	public showError(message: string): Promise<void> {
		this.messages.push(`error:${message}`);
		return Promise.resolve();
	}
}
