import * as assert from 'assert';
import { JSDOM } from 'jsdom';

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
		assert.ok(result.status === 'success' || result.status === 'partial');
		if (result.status !== 'success' && result.status !== 'partial') { return; }
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
		assert.deepStrictEqual(calls.map(node => node.calleeName), ['append', 'error', 'save', 'foo', 'run', 'values[index]']);
		const participant = (name: string) => calls.find(node => node.calleeName === name)?.participant;
		assert.deepStrictEqual(participant('append'), { key: 'instance:results', label: 'results', kind: 'instance' });
		assert.deepStrictEqual(participant('error'), { key: 'instance:logger', label: 'logger', kind: 'instance' });
		assert.deepStrictEqual(participant('save'), { key: 'class:Service', label: 'Service', kind: 'class' });
		assert.strictEqual(participant('foo'), undefined);
		assert.strictEqual(participant('run'), undefined);
		assert.strictEqual(participant('values[index]'), undefined);
		assert.ok(calls.filter(node => node.invocationTarget === 'self').length >= 3);
		assert.strictEqual(result.diagnostics.some(diagnostic => diagnostic.kind === 'unresolved-call' || diagnostic.kind === 'unknown-call'), false);
	});

	test('classifies explicit self calls and extractable non-external calls as self', async () => {
		const text = [
			'async def target(self, service):',
			'    self.validate_order() ',
			'    await self.save() ',
			'    validate_order() ',
			'    obj.child.run() ',
		].join('\n');
		const result = await new PythonAnalyzer().analyze(input(text, text.indexOf('target')));
		assert.ok(result.status === 'success' || result.status === 'partial');
		if (result.status !== 'success' && result.status !== 'partial') { return; }
		const calls = result.model.nodes.filter(node => node.kind === 'call');
		assert.deepStrictEqual(calls.map(node => node.calleeName), ['validate_order', 'save', 'validate_order', 'run']);
		const selfCalls = calls.filter(node => node.invocationTarget === 'self');
		assert.deepStrictEqual(selfCalls.map(node => node.calleeName), ['validate_order', 'save', 'validate_order', 'run']);
		assert.ok(selfCalls.every(node => node.participant === undefined));
	});

	test('uses Unknown only for a recoverable malformed call while preserving order', async () => {
		const text = [
			'def target():',
			'    before()',
			'    broken(',
		].join('\n');
		const result = await new PythonAnalyzer().analyze(input(text, text.indexOf('target')));
		assert.strictEqual(result.status, 'partial');
		if (result.status !== 'partial') { return; }
		const calls = result.model.nodes.filter(node => node.kind === 'call');
		assert.deepStrictEqual(calls.map(node => node.calleeName), ['before', 'broken']);
		assert.strictEqual(calls[0].invocationTarget, 'self');
		assert.strictEqual(calls[0].participant, undefined);
		assert.strictEqual(calls[1].resolution, 'unknown');
		assert.deepStrictEqual(calls[1].participant, { key: 'unknown', label: 'Unknown', kind: 'unknown' });
		assert.ok(result.diagnostics.some(diagnostic => diagnostic.kind === 'unknown-call' && diagnostic.nodeId === calls[1].id));
		assert.ok(calls[0].order < calls[1].order);
		const rendered = new MermaidRenderer().render(result.model);
		assert.ok(rendered.mermaidText.includes('participant Unknown as Unknown'));
		assert.ok(rendered.mermaidText.includes('root->>Unknown: unknown call'));
		assert.ok(rendered.mermaidText.includes('Note over root,Unknown: unknown call'));
		const unknownEntry = rendered.sourceMap.find(entry => entry.nodeId === calls[1].id);
		assert.ok(unknownEntry);
		if (unknownEntry) {
			assert.strictEqual(rendered.mermaidText.split('\n')[Number(unknownEntry.elementId.replace('line:', '')) - 1], 'root->>Unknown: unknown call');
		}
	});

	test('does not manufacture an Unknown Mermaid diagram for a fatal Python analysis failure', async () => {
		const text = 'def target():\n    return 1\n';
		const source = { uri: 'file:///workspace/fatal.py', languageId: 'python', version: 1, text } as const;
		const candidate = new PythonFunctionLocator().findFunctionContainingOffset(source, text.indexOf('target'));
		assert.strictEqual(candidate.status, 'found');
		if (candidate.status !== 'found') { return; }
		const result = await new VisualizeFunctionFlowUseCase(new AnalyzerRegistry([new PythonAnalyzer()]), new MermaidRenderer()).execute({
			source,
			cursorOffset: text.length + 1,
			functionRange: candidate.function.range,
			configuration: { configurationDigest: 'python-fatal-failure' },
			cancellation: { isCancellationRequested: false },
		});
		assert.strictEqual(result.status, 'target-not-found');
		assert.strictEqual('mermaidText' in result, false);
		assert.strictEqual(result.canCopyMermaid, false);
		assert.ok(result.notices.some(notice => notice.kind === 'target-not-found'));
	});

	test('renders an explicitly external but unresolved Python call as Unresolved', async () => {
		const text = 'def target(service):\n    service.save()\n    validate_order()\n';
		const analyzed = await new PythonAnalyzer().analyze(input(text, text.indexOf('target')));
		assert.strictEqual(analyzed.status, 'success');
		if (analyzed.status !== 'success') { return; }
		const serviceCall = analyzed.model.nodes.find(node => node.kind === 'call' && node.calleeName === 'save');
		assert.ok(serviceCall);
		if (!serviceCall || serviceCall.kind !== 'call') { return; }
		const model = {
			...analyzed.model,
			nodes: analyzed.model.nodes.map(node => node.id === serviceCall.id
				? { ...node, resolution: 'unresolved' as const, participant: { key: 'unresolved', label: 'Unresolved', kind: 'unresolved' as const } }
				: node),
		};
		const rendered = new MermaidRenderer().render(model);
		assert.ok(rendered.mermaidText.includes('participant Unresolved as Unresolved'));
		assert.ok(rendered.mermaidText.includes('root->>Unresolved: save (unresolved)'));
		assert.ok(rendered.mermaidText.includes('Note over root,Unresolved: unresolved call'));
		assert.ok(rendered.mermaidText.includes('Note right of root: validate_order'));
		assert.strictEqual(rendered.mermaidText.includes('participant validate_order as validate_order'), false);
		assert.ok(rendered.sourceMap.some(entry => entry.nodeId === serviceCall.id));
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
		assert.strictEqual(result.model.metadata.analyzerVersion, '1.0.4');
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

	test('keeps Python call, await, return, raise, and activation order in the shared Renderer', async () => {
		const callText = [
			'async def target(service, results):',
			'    results.append(1)',
			'    await service.save()',
			'    return results',
		].join('\n');
		const callResult = await new PythonAnalyzer().analyze(input(callText, callText.indexOf('target')));
		assert.strictEqual(callResult.status, 'success');
		if (callResult.status !== 'success') { return; }
		const callRendered = new MermaidRenderer().render(callResult.model);
		const callLines = callRendered.mermaidText.split('\n');
		assert.strictEqual(callLines.filter(line => line === 'caller->>root: invoke').length, 1);
		assert.ok(callLines.indexOf('caller->>root: invoke') < callLines.indexOf('activate root'));
		assert.ok(callRendered.mermaidText.includes('participant caller as caller'));
		assert.ok(callRendered.mermaidText.includes('participant root as self'));
		assert.ok(callRendered.mermaidText.includes('root->>results: append'));
		assert.ok(callRendered.mermaidText.includes('root->>service: await save'));
		assert.ok(callRendered.mermaidText.includes('root-->>caller: return results'));
		assert.strictEqual(callRendered.mermaidText.includes('results-->>root: return results'), false);
		assert.strictEqual(callRendered.mermaidText.includes('service-->>root: return results'), false);
		assert.ok(callRendered.mermaidText.indexOf('root->>results') < callRendered.mermaidText.indexOf('root->>service'));
		assert.ok(callRendered.mermaidText.indexOf('root->>service') < callRendered.mermaidText.indexOf('root-->>caller'));
		assert.ok(callRendered.mermaidText.includes('activate root'));
		assert.ok(callRendered.mermaidText.includes('activate results'));
		assert.ok(callRendered.mermaidText.includes('activate service'));
		assert.strictEqual(callRendered.warnings.length, 0);

		const nestedText = 'def target(service, helper):\n    return service.outer(helper.inner())';
		const nestedResult = await new PythonAnalyzer().analyze(input(nestedText, nestedText.indexOf('target')));
		assert.strictEqual(nestedResult.status, 'success');
		if (nestedResult.status !== 'success') { return; }
		const nestedRendered = new MermaidRenderer().render(nestedResult.model);
		const nestedLines = nestedRendered.mermaidText.split('\n');
		assert.strictEqual(nestedLines.filter(line => line === 'caller->>root: invoke').length, 1);
		assert.ok(nestedLines.indexOf('caller->>root: invoke') < nestedLines.indexOf('activate root'));
		assert.ok(nestedRendered.mermaidText.indexOf('root->>helper: inner') < nestedRendered.mermaidText.indexOf('root->>service: outer'));
		assert.ok(nestedRendered.mermaidText.indexOf('activate helper') < nestedRendered.mermaidText.indexOf('deactivate helper'));
		assert.ok(nestedRendered.mermaidText.indexOf('activate service') < nestedRendered.mermaidText.indexOf('root-->>caller: return'));
		assert.strictEqual(nestedRendered.mermaidText.includes('service-->>root: return'), false);
		assert.ok(nestedRendered.mermaidText.includes('participant helper as helper'));
		assert.ok(nestedRendered.mermaidText.includes('participant service as service'));

		const raiseText = 'def target(results):\n    results.append(1)\n    raise error';
		const raiseResult = await new PythonAnalyzer().analyze(input(raiseText, raiseText.indexOf('target')));
		assert.strictEqual(raiseResult.status, 'success');
		if (raiseResult.status !== 'success') { return; }
		const raiseRendered = new MermaidRenderer().render(raiseResult.model);
		assert.strictEqual(raiseRendered.mermaidText.split('\n').filter(line => line === 'caller->>root: invoke').length, 1);
		assert.ok(raiseRendered.mermaidText.includes('root->>results: append'));
		assert.ok(raiseRendered.mermaidText.includes('Note over root: throw error'));
		assert.ok(raiseRendered.mermaidText.indexOf('root->>results') < raiseRendered.mermaidText.indexOf('Note over root: throw error'));
		for (const decoration of raiseRendered.processNoteDecorations) {
			assert.strictEqual(raiseRendered.mermaidText.split('\n')[decoration.mermaidLine - 1], 'Note over root: throw error');
		}
		assert.ok(raiseRendered.mermaidText.indexOf('activate results') < raiseRendered.mermaidText.indexOf('Note over root: throw error'));
		assert.ok(raiseRendered.mermaidText.indexOf('Note over root: throw error') < raiseRendered.mermaidText.indexOf('deactivate results'));
	});

	test('renders Python self calls through the shared nested activation contract', async () => {
		const text = [
			'async def target(self, service):',
			'    self.outer(self.inner())',
			'    await self.save()',
			'    service.save()',
			'    validate_order()',
			'    obj.child.run()',
			'    return build_result()',
		].join('\n');
		const result = await new PythonAnalyzer().analyze(input(text, text.indexOf('target')));
		assert.ok(result.status === 'success' || result.status === 'partial');
		if (result.status !== 'success' && result.status !== 'partial') { return; }
		const rendered = new MermaidRenderer().render(result.model);
		const lines = rendered.mermaidText.split('\n');
		assert.strictEqual(lines.filter(line => line === 'caller->>root: invoke').length, 1);
		assert.strictEqual((rendered.mermaidText.match(/Note right of root: inner/g) ?? []).length, 1);
		assert.strictEqual((rendered.mermaidText.match(/Note right of root: outer/g) ?? []).length, 1);
		assert.strictEqual((rendered.mermaidText.match(/Note right of root: await save/g) ?? []).length, 1);
		assert.strictEqual(rendered.mermaidText.includes('root->>inner'), false);
		assert.strictEqual(rendered.mermaidText.includes('root->>outer'), false);
		assert.strictEqual(rendered.mermaidText.includes('participant inner as inner'), false);
		assert.strictEqual(rendered.mermaidText.includes('participant outer as outer'), false);
		assert.ok(rendered.mermaidText.includes('participant service as service'));
		assert.strictEqual(rendered.mermaidText.includes('participant Unknown as Unknown'), false);
		assert.strictEqual(rendered.mermaidText.includes('participant Unresolved as Unresolved'), false);
		assert.ok(rendered.mermaidText.includes('root-->>caller: return build_result(...)'));
		assert.strictEqual(rendered.warnings.length, 0);
		const activationCount = lines.filter(line => line === 'activate root').length;
		assert.strictEqual(activationCount, lines.filter(line => line === 'deactivate root').length);
		assert.ok(activationCount >= 2);
		assert.ok(rendered.sourceMap.some(entry => entry.nodeId === result.model.nodes.find(node => node.kind === 'call' && node.calleeName === 'inner')?.id));
	});

	test('preserves self-call classification in a partial Python result', async () => {
		const text = [
			'async def target(self):',
			'    await self.validate_order()',
			'    self.recover()',
			'    if :',
		].join('\n');
		const result = await new PythonAnalyzer().analyze(input(text, text.indexOf('target')));
		assert.strictEqual(result.status, 'partial');
		if (result.status !== 'partial') { return; }
		const selfCalls = result.model.nodes.filter((node): node is Extract<typeof node, { kind: 'call' }> => node.kind === 'call' && node.invocationTarget === 'self');
		assert.deepStrictEqual(selfCalls.map(node => node.calleeName), ['validate_order', 'recover']);
		const rendered = new MermaidRenderer().render(result.model);
		assert.ok(rendered.mermaidText.includes('Note right of root: await validate_order'));
		assert.ok(rendered.mermaidText.includes('Note right of root: recover'));
		assert.strictEqual(rendered.mermaidText.includes('participant validate_order as validate_order'), false);
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
		assert.ok(result.mermaidText.includes('participant caller as caller'));
		const entryLine = result.mermaidText.split('\n').indexOf('caller->>root: invoke') + 1;
		assert.strictEqual(result.mermaidText.split('\n').filter(line => line === 'caller->>root: invoke').length, 1);
		assert.ok(entryLine > 0);
		assert.strictEqual(result.sourceMap.some(entry => entry.elementId === `line:${entryLine}`), false);
		assert.ok(result.mermaidText.includes('participant service as service'));
		assert.ok(result.mermaidText.includes('participant logger as logger'));
		assert.strictEqual(result.mermaidText.includes('participant Unknown as Unknown'), false);
		assert.strictEqual(result.mermaidText.includes('participant Unresolved as Unresolved'), false);
		assert.strictEqual(result.mermaidText.includes('root->>Unknown: foo'), false);
		assert.strictEqual(result.mermaidText.includes('root->>Unresolved: run (unresolved)'), false);
		assert.ok(result.mermaidText.includes('await save'));
		assert.ok(result.mermaidText.includes('return build_result(...)'));
		assert.ok(result.mermaidText.indexOf('caller->>root: invoke') < result.mermaidText.indexOf('activate root'));
		assert.strictEqual(result.mermaidText.includes('service-->>root: return build_result'), false);
		assert.ok(result.mermaidText.includes('activate root'));
		assert.ok(result.mermaidText.includes('deactivate root'));
		const serviceActivations = (result.mermaidText.match(/^activate service$/gm) ?? []).length;
		const serviceDeactivations = (result.mermaidText.match(/^deactivate service$/gm) ?? []).length;
		assert.ok(serviceActivations > 0);
		assert.strictEqual(serviceActivations, serviceDeactivations);
		assert.ok(result.sourceMap.length > 0);
		assert.ok(result.sourceMap.every(entry => entry.sourceLocation.uri === source.uri));
		const returnNode = result.model.nodes.find(node => node.kind === 'return');
		assert.ok(returnNode);
		if (returnNode) {
			const returnEntry = result.sourceMap.find(entry => entry.nodeId === returnNode.id);
			assert.ok(returnEntry);
			if (returnEntry) {
				const returnLine = Number(returnEntry.elementId.replace('line:', ''));
				assert.strictEqual(result.mermaidText.split('\n')[returnLine - 1], 'root-->>caller: return build_result(...)');
			}
		}

		const view = createVisualizationViewModel(result);
		assert.strictEqual(view.mermaidText, result.mermaidText);
		assert.strictEqual(view.fallbackText, result.mermaidText);
		const fallbackView = createVisualizationViewModel(result, { forceFallback: true });
		assert.strictEqual(fallbackView.fallbackText, result.mermaidText);
		assert.strictEqual(fallbackView.mermaidText, result.mermaidText);
		assert.deepStrictEqual(view.sourceMap, result.sourceMap);

		const factory = new PythonStubPanelFactory();
		const clipboard = new PythonStubClipboard();
		const notifications = new PythonStubNotification();
		const adapter = new WebviewVisualizationAdapter(factory, clipboard, notifications);
		await adapter.show(view);
		assert.ok(factory.panel.webview.html.includes('participant root as self'));
		assert.ok(factory.panel.webview.html.includes('activate root'));
		assert.ok(factory.panel.webview.html.includes('activate service'));
		assert.ok(view.mermaidText && result.mermaidText === view.mermaidText);
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

	test('uses the shared caller participant without inferring Python or TypeScript names', async () => {
		const pythonText = [
			'class OrdersService:',
			'    async def process_orders(self, service):',
			'        await service.save()',
			'        return result',
		].join('\n');
		const pythonSource = { uri: 'file:///workspace/orders_service.py', languageId: 'python', version: 1, text: pythonText } as const;
		const pythonCandidate = new PythonFunctionLocator().findFunctionContainingOffset(pythonSource, pythonText.indexOf('process_orders'));
		assert.strictEqual(pythonCandidate.status, 'found');
		if (pythonCandidate.status !== 'found') { return; }
		const pythonResult = await new VisualizeFunctionFlowUseCase(new AnalyzerRegistry([new PythonAnalyzer()]), new MermaidRenderer()).execute({
			source: pythonSource,
			cursorOffset: pythonText.indexOf('process_orders'),
			functionRange: pythonCandidate.function.range,
			configuration: { configurationDigest: 'python-cross-language' },
			cancellation: { isCancellationRequested: false },
		});
		assert.ok(pythonResult.status === 'success' || pythonResult.status === 'partial');
		if (pythonResult.status !== 'success' && pythonResult.status !== 'partial') { return; }

		const typescriptText = 'async function process_orders(service: Service) {\n  await service.save();\n  return result;\n}';
		const typescriptSource = { uri: 'file:///workspace/orders_service.ts', languageId: 'typescript', version: 1, text: typescriptText } as const;
		const typescriptCandidate = new TypeScriptFunctionLocator().findFunctionContainingOffset(typescriptSource, typescriptText.indexOf('process_orders'));
		assert.strictEqual(typescriptCandidate.status, 'found');
		if (typescriptCandidate.status !== 'found') { return; }
		const typescriptResult = await new VisualizeFunctionFlowUseCase(new AnalyzerRegistry([new TypeScriptAnalyzer()]), new MermaidRenderer()).execute({
			source: typescriptSource,
			cursorOffset: typescriptText.indexOf('process_orders'),
			functionRange: typescriptCandidate.function.range,
			configuration: { configurationDigest: 'typescript-cross-language' },
			cancellation: { isCancellationRequested: false },
		});
		assert.strictEqual(typescriptResult.status, 'success');
		if (typescriptResult.status !== 'success') { return; }

		for (const mermaid of [pythonResult.mermaidText, typescriptResult.mermaidText]) {
			assert.ok(mermaid.includes('participant caller as caller'));
			assert.ok(mermaid.includes('root-->>caller: return result'));
			assert.strictEqual(mermaid.includes('process_orders as process_orders'), false);
			assert.strictEqual(mermaid.includes('OrdersService as OrdersService'), false);
			assert.strictEqual(mermaid.includes('orders_service as orders_service'), false);
			assert.strictEqual(mermaid.includes('service-->>root: return result'), false);
		}
	});

	test('keeps Python caller entry Mermaid byte-for-byte across Webview, fallback, and Clipboard', async () => {
		const text = [
			'class OrdersService:',
			'    async def process_orders(self, service):',
			'        await service.save()',
			'        return result',
		].join('\n');
		const source = { uri: 'file:///workspace/orders_service.py', languageId: 'python', version: 2, text } as const;
		const candidate = new PythonFunctionLocator().findFunctionContainingOffset(source, text.indexOf('process_orders'));
		assert.strictEqual(candidate.status, 'found');
		if (candidate.status !== 'found') { return; }
		const result = await new VisualizeFunctionFlowUseCase(new AnalyzerRegistry([new PythonAnalyzer()]), new MermaidRenderer()).execute({
			source,
			cursorOffset: text.indexOf('process_orders'),
			functionRange: candidate.function.range,
			configuration: { configurationDigest: 'python-entry-copy' },
			cancellation: { isCancellationRequested: false },
		});
		assert.ok(result.status === 'success' || result.status === 'partial');
		if (result.status !== 'success' && result.status !== 'partial') { return; }

		const mermaid = result.mermaidText;
		assert.strictEqual(mermaid.split('\n').filter(line => line === 'caller->>root: invoke').length, 1);
		assert.ok(mermaid.indexOf('caller->>root: invoke') < mermaid.indexOf('activate root'));
		assert.strictEqual(mermaid.includes('process_orders as process_orders'), false);
		assert.strictEqual(mermaid.includes('OrdersService as OrdersService'), false);
		const entryLine = mermaid.split('\n').indexOf('caller->>root: invoke') + 1;
		assert.ok(entryLine > 0);
		assert.strictEqual(result.sourceMap.some(entry => entry.elementId === `line:${entryLine}`), false);

		const model = createVisualizationViewModel(result);
		assert.strictEqual(model.mermaidText, mermaid);
		assert.strictEqual(model.fallbackText, mermaid);
		const fallbackModel = createVisualizationViewModel(result, { forceFallback: true });
		assert.strictEqual(fallbackModel.mermaidText, mermaid);
		assert.strictEqual(fallbackModel.fallbackText, mermaid);

		const factory = new PythonStubPanelFactory();
		const clipboard = new PythonStubClipboard();
		const adapter = new WebviewVisualizationAdapter(factory, clipboard, new PythonStubNotification());
		const selected: string[] = [];
		adapter.onDidReceiveAllowedMessage(message => {
			if (message.type === 'sourceMapSelected' && message.elementId) { selected.push(message.elementId); }
		});
		await adapter.show(model);
		const html = factory.panel.webview.html;
		const payloadMatch = html.match(/const GLITCHLENS_VIEW_MODEL=(\{.*?\});const vscode=/);
		assert.ok(payloadMatch);
		const payload = JSON.parse(payloadMatch?.[1] ?? '{}') as { mermaidText?: string; fallbackText?: string };
		assert.strictEqual(payload.mermaidText, mermaid);
		assert.strictEqual(payload.fallbackText, mermaid);
		assert.ok(html.includes('caller-&gt;&gt;root: invoke'));
		assert.ok(html.includes('root--&gt;&gt;caller: return result'));
		assert.ok(html.includes('<details class="diagram-fallback">'));
		assert.ok(html.includes('caller-&gt;&gt;root: invoke'));
		factory.panel.emitMessage({ type: 'sourceMapSelected', elementId: `line:${entryLine}` });
		assert.deepStrictEqual(selected, []);
		await adapter.copyCurrentMermaidForTest();
		assert.deepStrictEqual(clipboard.writes, [mermaid]);

		await adapter.show(fallbackModel);
		assert.ok(factory.panel.webview.html.includes('caller-&gt;&gt;root: invoke'));
		await adapter.copyCurrentMermaidForTest();
		assert.deepStrictEqual(clipboard.writes, [mermaid, mermaid]);
	});

	test('keeps Python self-call Mermaid byte-for-byte across Webview, fallback, and Clipboard', async () => {
		const text = [
			'async def target(self):',
			'    await self.validate_order()',
			'    return result',
		].join('\n');
		const source = { uri: 'file:///workspace/self_call.py', languageId: 'python', version: 1, text } as const;
		const candidate = new PythonFunctionLocator().findFunctionContainingOffset(source, text.indexOf('target'));
		assert.strictEqual(candidate.status, 'found');
		if (candidate.status !== 'found') { return; }
		const result = await new VisualizeFunctionFlowUseCase(new AnalyzerRegistry([new PythonAnalyzer()]), new MermaidRenderer()).execute({
			source,
			cursorOffset: text.indexOf('target'),
			functionRange: candidate.function.range,
			configuration: { configurationDigest: 'python-self-call-copy' },
			cancellation: { isCancellationRequested: false },
		});
		assert.ok(result.status === 'success' || result.status === 'partial');
		if (result.status !== 'success' && result.status !== 'partial') { return; }
		const mermaid = result.mermaidText;
		assert.strictEqual((mermaid.match(/Note right of root: await validate_order/g) ?? []).length, 1);
		assert.strictEqual(mermaid.includes('participant validate_order as validate_order'), false);
		assert.strictEqual(mermaid.includes('root->>validate_order'), false);
		const model = createVisualizationViewModel(result);
		const fallbackModel = createVisualizationViewModel(result, { forceFallback: true });
		assert.strictEqual(model.mermaidText, mermaid);
		assert.strictEqual(model.fallbackText, mermaid);
		assert.strictEqual(fallbackModel.mermaidText, mermaid);
		assert.strictEqual(fallbackModel.fallbackText, mermaid);

		const factory = new PythonStubPanelFactory();
		const clipboard = new PythonStubClipboard();
		const adapter = new WebviewVisualizationAdapter(factory, clipboard, new PythonStubNotification());
		await adapter.show(model);
		const normalHtml = factory.panel.webview.html;
		const payloadMatch = normalHtml.match(/const GLITCHLENS_VIEW_MODEL=(\{.*?\});const vscode=/);
		assert.ok(payloadMatch);
		const payload = JSON.parse(payloadMatch?.[1] ?? '{}') as { mermaidText?: string; fallbackText?: string };
		assert.strictEqual(payload.mermaidText, mermaid);
		assert.strictEqual(payload.fallbackText, mermaid);
		assert.ok(normalHtml.includes('Note right of root: await validate_order'));
		const normalDom = new JSDOM(normalHtml);
		assert.strictEqual(normalDom.window.document.querySelector('.diagram-fallback pre')?.textContent, mermaid);
		normalDom.window.close();
		await adapter.copyCurrentMermaidForTest();
		await adapter.show(fallbackModel);
		const fallbackDom = new JSDOM(factory.panel.webview.html);
		assert.strictEqual(fallbackDom.window.document.querySelector('.diagram-fallback pre')?.textContent, mermaid);
		fallbackDom.window.close();
		await adapter.copyCurrentMermaidForTest();
		assert.deepStrictEqual(clipboard.writes, [mermaid, mermaid]);
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

	public emitMessage(message: unknown): void {
		this.messageHandler?.(message);
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
