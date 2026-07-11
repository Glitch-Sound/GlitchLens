import * as assert from 'assert';

import {
	findFunctionCandidates,
	findFunctionContainingOffset,
	findFunctionByRange,
	type FunctionRange,
} from '../analyzers/typescript/functionLocator';

suite('TypeScript function locator', () => {
	test('detects representative TypeScript function forms', () => {
		const source = [
			'function declared(value: string) { return value; }',
			'const expressed = function namedExpression(count: number) { return count; };',
			'const arrowed = async (item: Item) => item.id;',
			'const object = {',
			'  objectMethod(flag: boolean) { return flag; },',
			'  get ready() { return true; },',
			'  set ready(value: boolean) { this.value = value; },',
			'};',
			'class Example {',
			'  constructor(private readonly id: string) {}',
			'  classMethod() { return this.id; }',
			'}',
		].join('\n');

		const candidates = findFunctionCandidates(input(source, 'typescript'));

		assert.deepStrictEqual(candidates.map(candidate => candidate.kind), [
			'function-declaration',
			'function-expression',
			'arrow-function',
			'object-method',
			'getter',
			'setter',
			'constructor',
			'class-method',
		]);
		assert.deepStrictEqual(candidates.map(candidate => candidate.name), [
			'declared',
			'expressed',
			'arrowed',
			'objectMethod',
			'ready',
			'ready',
			'constructor',
			'classMethod',
		]);
		assert.ok(candidates.every(candidate => candidate.range.startOffset < candidate.range.endOffset));
		assert.ok(candidates.every(candidate => candidate.bodyRange && candidate.bodyRange.startOffset < candidate.bodyRange.endOffset));
	});

	test('detects JavaScript and JSX friendly function forms', () => {
		const source = [
			'export default function Component(props) { return <div>{props.title}</div>; }',
			'const handle = (event) => <button onClick={event} />;',
			'class View { render() { return <span />; } }',
		].join('\n');

		const candidates = findFunctionCandidates(input(source, 'javascriptreact'));

		assert.deepStrictEqual(candidates.map(candidate => candidate.name), ['Component', 'handle', 'render']);
		assert.deepStrictEqual(candidates.map(candidate => candidate.kind), [
			'function-declaration',
			'arrow-function',
			'class-method',
		]);
	});

	test('handles TypeScript TSX JavaScript and JSX language ids as plain source inputs', () => {
		const cases = [
			{ languageId: 'typescript', source: 'const typed = (value: string) => value;' },
			{ languageId: 'typescriptreact', source: 'function TsxComponent() { return <div />; }' },
			{ languageId: 'javascript', source: 'const plain = function () { return 1; };' },
			{ languageId: 'javascriptreact', source: 'const JsxComponent = () => <section />;' },
		];

		const names = cases.map(testCase => findFunctionCandidates(input(testCase.source, testCase.languageId))[0]?.name);

		assert.deepStrictEqual(names, ['typed', 'TsxComponent', 'plain', 'JsxComponent']);
	});

	test('returns the innermost function containing the cursor offset', () => {
		const source = [
			'function outer() {',
			'  const nested = () => {',
			'    return 1;',
			'  };',
			'  return nested();',
			'}',
		].join('\n');
		const result = findFunctionContainingOffset(input(source, 'typescript'), source.indexOf('return 1'));

		assert.strictEqual(result.status, 'found');
		if (result.status === 'found') {
			assert.strictEqual(result.function.name, 'nested');
			assert.strictEqual(result.function.kind, 'arrow-function');
		}
	});

	test('detects class methods when the class body brace is on the next line', () => {
		const source = [
			'class BracedLater',
			'{',
			'  method() {',
			'    return 1;',
			'  }',
			'}',
		].join('\n');

		const candidates = findFunctionCandidates(input(source, 'typescript'));

		assert.deepStrictEqual(candidates.map(candidate => candidate.kind), ['class-method']);
		assert.deepStrictEqual(candidates.map(candidate => candidate.name), ['method']);
	});

	test('treats function name, parameters, and body as part of the target function', () => {
		const source = 'function selected(first: string, second: string) { return first + second; }';
		const locations = [
			source.indexOf('selected'),
			source.indexOf('second'),
			source.indexOf('return'),
		];

		for (const offset of locations) {
			const result = findFunctionContainingOffset(input(source, 'typescript'), offset);
			assert.strictEqual(result.status, 'found');
			if (result.status === 'found') {
				assert.strictEqual(result.function.name, 'selected');
			}
		}
	});

	test('returns not-found for cursor outside function bodies and empty files', () => {
		const outside = findFunctionContainingOffset(input('const value = 1;\nfunction later() { return value; }', 'typescript'), 3);
		const empty = findFunctionContainingOffset(input('', 'typescript'), 0);

		assert.deepStrictEqual(outside, {
			status: 'not-found',
			reason: 'cursor-outside-function',
		});
		assert.deepStrictEqual(empty, {
			status: 'not-found',
			reason: 'no-function-candidates',
		});
	});

	test('returns partial candidates for syntax error editing states', () => {
		const source = [
			'function complete() { return 1; }',
			'const broken = (value: string) => {',
			'  return value',
		].join('\n');

		const candidates = findFunctionCandidates(input(source, 'typescript'));
		const names = candidates.map(candidate => candidate.name);

		assert.ok(names.includes('complete'));
		assert.ok(names.includes('broken'));
	});

	test('resolves the target function from a CodeLens range', () => {
		const source = [
			'function first() { return 1; }',
			'const second = () => { return 2; };',
		].join('\n');
		const candidates = findFunctionCandidates(input(source, 'typescript'));
		const second = candidates.find(candidate => candidate.name === 'second');

		assert.ok(second);
		const result = findFunctionByRange(input(source, 'typescript'), second.range);

		assert.strictEqual(result.status, 'found');
		if (result.status === 'found') {
			assert.strictEqual(result.function.name, 'second');
			assert.deepStrictEqual(result.function.range, second.range);
		}
	});
});

function input(text: string, languageId: string) {
	return {
		uri: 'file:///workspace/example.tsx',
		languageId,
		version: 1,
		text,
	};
}
