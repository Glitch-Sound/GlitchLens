import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { createFunctionCodeLensCommands } from '../integration/codeLensCommands';
import { visualizeFunctionFlowCommandId } from '../integration/commandIds';
import { createWorkspaceTrustGuard } from '../integration/workspaceTrustPolicy';

suite('GlitchLens CodeLens provider', () => {
	test('creates CodeLens commands for TypeScript and JavaScript functions', () => {
		const typescript = createFunctionCodeLensCommands(input('typescript', 'function loadUser() { return 1; }'));
		const javascript = createFunctionCodeLensCommands(input('javascript', 'const saveUser = function () { return 2; };'));

		assert.deepStrictEqual(typescript.map(lens => lens.argument.functionName), ['loadUser']);
		assert.deepStrictEqual(javascript.map(lens => lens.argument.functionName), ['saveUser']);
		assert.strictEqual(typescript[0].command, visualizeFunctionFlowCommandId);
	});

	test('creates CodeLens commands for TSX and JSX candidates', () => {
		const tsx = createFunctionCodeLensCommands(input('typescriptreact', 'function Card() { return <div />; }'));
		const jsx = createFunctionCodeLensCommands(input('javascriptreact', 'const Button = () => <button />;'));

		assert.deepStrictEqual(tsx.map(lens => lens.argument.functionName), ['Card']);
		assert.deepStrictEqual(jsx.map(lens => lens.argument.functionName), ['Button']);
	});

	test('covers representative function forms using FunctionLocator-compatible ranges', () => {
		const source = [
			'function declared() {}',
			'const expressed = function () {};',
			'const arrowed = () => 1;',
			'const object = {',
			'  objectMethod() {},',
			'  get ready() { return true; },',
			'  set ready(value) { this.value = value; },',
			'};',
			'class Example {',
			'  constructor() {}',
			'  classMethod() {}',
			'}',
		].join('\n');

		const lenses = createFunctionCodeLensCommands(input('javascript', source));

		assert.deepStrictEqual(lenses.map(lens => lens.argument.functionName), [
			'declared',
			'expressed',
			'arrowed',
			'objectMethod',
			'ready',
			'ready',
			'constructor',
			'classMethod',
		]);
		assert.ok(lenses.every(lens => lens.title === 'GlitchLens'));
		assert.ok(lenses.every(lens => lens.argument.functionRange.startLine >= 0));
	});

	test('creates one command per function with correct command argument range', () => {
		const source = [
			'function first() {}',
			'function second() {}',
		].join('\n');
		const lenses = createFunctionCodeLensCommands(input('typescript', source));

		assert.strictEqual(lenses.length, 2);
		assert.deepStrictEqual(lenses[0].argument, {
			uri: 'file:///workspace/source.ts',
			languageId: 'typescript',
			version: 4,
			functionName: 'first',
			functionRange: lenses[0].range,
		});
		assert.strictEqual(lenses[1].command, 'glitchlens.visualizeFunctionFlow');
		assert.ok(lenses[0].range.startLine < lenses[1].range.startLine);
	});

	test('returns no commands for unsupported language empty file and cancelled provider path', () => {
		assert.deepStrictEqual(createFunctionCodeLensCommands(input('python', 'def sample(): pass')), []);
		assert.deepStrictEqual(createFunctionCodeLensCommands(input('typescript', '')), []);
	});

	test('returns no CodeLens commands in untrusted workspaces before scanning source text', () => {
		const lenses = createFunctionCodeLensCommands({
			...input('typescript', 'function blocked() {}'),
			text: lazyText(() => {
				throw new Error('source text must not be scanned in Restricted Mode');
			}),
		}, createWorkspaceTrustGuard({ isTrusted: false }));

		assert.deepStrictEqual(lenses, []);
	});

	test('returns partial candidates for syntax error editing states and latest document text', () => {
		const broken = createFunctionCodeLensCommands(input('typescript', [
			'function complete() { return 1; }',
			'const editing = () => {',
			'  return 2',
		].join('\n')));
		const changed = createFunctionCodeLensCommands(input('typescript', [
			'',
			'function shifted() {}',
		].join('\n')));

		assert.deepStrictEqual(broken.map(lens => lens.argument.functionName), ['complete', 'editing']);
		assert.strictEqual(changed[0].range.startLine, 1);
	});

	test('does not call Analyzer Renderer Application Webview or Clipboard from CodeLens generation', () => {
		const commandPath = path.resolve(__dirname, '../../src/integration/codeLensCommands.ts');
		const providerPath = path.resolve(__dirname, '../../src/integration/codeLensProvider.ts');
		const source = `${fs.readFileSync(commandPath, 'utf8')}\n${fs.readFileSync(providerPath, 'utf8')}`;

		assert.ok(!source.includes('VisualizeFunctionFlowUseCase'));
		assert.ok(!source.includes('MermaidRenderer'));
		assert.ok(!source.includes('AnalyzerRegistry'));
		assert.ok(!source.includes('Webview'));
		assert.ok(!source.includes('Clipboard'));
	});
});

function input(languageId: string, text: string) {
	return {
		uri: 'file:///workspace/source.ts',
		languageId,
		version: 4,
		text,
	};
}

function lazyText(read: () => string): string {
	return {
		toString: read,
		valueOf: read,
	} as unknown as string;
}
