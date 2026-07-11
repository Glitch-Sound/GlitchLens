import ts from 'typescript';

export interface SourceFileLike {
	readonly uri: string;
	readonly languageId: string;
	readonly version: number;
	readonly text: string;
}

export interface FunctionPosition {
	readonly line: number;
	readonly character: number;
}

export interface FunctionRange {
	readonly startOffset: number;
	readonly endOffset: number;
	readonly start: FunctionPosition;
	readonly end: FunctionPosition;
}

export type FunctionCandidateKind =
	| 'function-declaration'
	| 'function-expression'
	| 'arrow-function'
	| 'object-method'
	| 'class-method'
	| 'getter'
	| 'setter'
	| 'constructor';

export interface FunctionCandidate {
	readonly name: string;
	readonly kind: FunctionCandidateKind;
	readonly range: FunctionRange;
	readonly fullRange: FunctionRange;
	readonly bodyRange?: FunctionRange;
}

export type FunctionLocatorResult =
	| {
		readonly status: 'found';
		readonly function: FunctionCandidate;
	}
	| {
		readonly status: 'not-found';
		readonly reason: 'no-function-candidates' | 'cursor-outside-function' | 'range-not-matched';
	};

export function findFunctionCandidates(source: SourceFileLike): FunctionCandidate[] {
	const sourceFile = createSourceFile(source);
	const candidates: FunctionCandidate[] = [];

	visitFunctionLikeNodes(sourceFile, node => {
		candidates.push(toCandidate(sourceFile, node));
	});

	return candidates.sort((left, right) => left.fullRange.startOffset - right.fullRange.startOffset);
}

export function findFunctionContainingOffset(source: SourceFileLike, cursorOffset: number): FunctionLocatorResult {
	const candidates = findFunctionCandidates(source);

	if (candidates.length === 0) {
		return {
			status: 'not-found',
			reason: 'no-function-candidates',
		};
	}

	const containing = candidates
		.filter(candidate => candidate.fullRange.startOffset <= cursorOffset && cursorOffset <= candidate.fullRange.endOffset)
		.sort((left, right) => rangeLength(left.fullRange) - rangeLength(right.fullRange))[0];

	if (!containing) {
		return {
			status: 'not-found',
			reason: 'cursor-outside-function',
		};
	}

	return {
		status: 'found',
		function: containing,
	};
}

export function findFunctionByRange(source: SourceFileLike, range: FunctionRange): FunctionLocatorResult {
	const candidates = findFunctionCandidates(source);
	const matched = candidates.find(candidate => rangesEqual(candidate.range, range));

	if (!matched) {
		return {
			status: 'not-found',
			reason: candidates.length === 0 ? 'no-function-candidates' : 'range-not-matched',
		};
	}

	return {
		status: 'found',
		function: matched,
	};
}

type SupportedFunctionNode =
	| ts.FunctionDeclaration
	| ts.FunctionExpression
	| ts.ArrowFunction
	| ts.MethodDeclaration
	| ts.GetAccessorDeclaration
	| ts.SetAccessorDeclaration
	| ts.ConstructorDeclaration;

function createSourceFile(source: SourceFileLike): ts.SourceFile {
	return ts.createSourceFile(
		source.uri,
		source.text,
		ts.ScriptTarget.Latest,
		true,
		scriptKindFor(source.languageId),
	);
}

function scriptKindFor(languageId: string): ts.ScriptKind {
	switch (languageId) {
		case 'typescript':
			return ts.ScriptKind.TS;
		case 'typescriptreact':
			return ts.ScriptKind.TSX;
		case 'javascriptreact':
			return ts.ScriptKind.JSX;
		case 'javascript':
		default:
			return ts.ScriptKind.JS;
	}
}

function visitFunctionLikeNodes(node: ts.Node, collect: (node: SupportedFunctionNode) => void): void {
	if (isSupportedFunctionNode(node)) {
		collect(node);
	}

	ts.forEachChild(node, child => visitFunctionLikeNodes(child, collect));
}

function isSupportedFunctionNode(node: ts.Node): node is SupportedFunctionNode {
	return ts.isFunctionDeclaration(node)
		|| ts.isFunctionExpression(node)
		|| ts.isArrowFunction(node)
		|| ts.isMethodDeclaration(node)
		|| ts.isGetAccessorDeclaration(node)
		|| ts.isSetAccessorDeclaration(node)
		|| ts.isConstructorDeclaration(node);
}

function toCandidate(sourceFile: ts.SourceFile, node: SupportedFunctionNode): FunctionCandidate {
	const nameSpan = nameSpanFor(sourceFile, node);
	const fullSpan = fullSpanFor(sourceFile, node);
	const body = bodyFor(node);

	return {
		name: nameSpan.name,
		kind: kindFor(node),
		range: toRange(sourceFile, nameSpan.startOffset, nameSpan.endOffset),
		fullRange: toRange(sourceFile, fullSpan.startOffset, fullSpan.endOffset),
		bodyRange: body ? toRange(sourceFile, body.getStart(sourceFile), body.end) : undefined,
	};
}

interface NamedSpan {
	readonly name: string;
	readonly startOffset: number;
	readonly endOffset: number;
}

interface OffsetSpan {
	readonly startOffset: number;
	readonly endOffset: number;
}

function nameSpanFor(sourceFile: ts.SourceFile, node: SupportedFunctionNode): NamedSpan {
	if (ts.isConstructorDeclaration(node)) {
		const constructorKeyword = node.getFirstToken(sourceFile);
		const startOffset = constructorKeyword?.getStart(sourceFile) ?? node.getStart(sourceFile);
		return {
			name: 'constructor',
			startOffset,
			endOffset: startOffset + 'constructor'.length,
		};
	}

	if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
		const variableName = variableNameFor(node);
		if (variableName) {
			return variableName;
		}
	}

	const name = 'name' in node ? node.name : undefined;
	if (name && ts.isIdentifier(name)) {
		return {
			name: name.text,
			startOffset: name.getStart(sourceFile),
			endOffset: name.end,
		};
	}

	const fallbackStart = node.getStart(sourceFile);
	return {
		name: '<anonymous>',
		startOffset: fallbackStart,
		endOffset: fallbackStart,
	};
}

function variableNameFor(node: ts.ArrowFunction | ts.FunctionExpression): NamedSpan | undefined {
	const parent = node.parent;

	if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
		return {
			name: parent.name.text,
			startOffset: parent.name.getStart(),
			endOffset: parent.name.end,
		};
	}

	if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
		return {
			name: parent.name.text,
			startOffset: parent.name.getStart(),
			endOffset: parent.name.end,
		};
	}

	return undefined;
}

function fullSpanFor(sourceFile: ts.SourceFile, node: SupportedFunctionNode): OffsetSpan {
	if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent)) {
		return {
			startOffset: node.parent.getStart(sourceFile),
			endOffset: node.end,
		};
	}

	return {
		startOffset: node.getStart(sourceFile),
		endOffset: node.end,
	};
}

function bodyFor(node: SupportedFunctionNode): ts.ConciseBody | ts.FunctionBody | undefined {
	if (ts.isConstructorDeclaration(node)
		|| ts.isFunctionDeclaration(node)
		|| ts.isFunctionExpression(node)
		|| ts.isMethodDeclaration(node)
		|| ts.isGetAccessorDeclaration(node)
		|| ts.isSetAccessorDeclaration(node)) {
		return node.body;
	}

	return node.body;
}

function kindFor(node: SupportedFunctionNode): FunctionCandidateKind {
	if (ts.isFunctionDeclaration(node)) {
		return 'function-declaration';
	}

	if (ts.isFunctionExpression(node)) {
		return 'function-expression';
	}

	if (ts.isArrowFunction(node)) {
		return 'arrow-function';
	}

	if (ts.isGetAccessorDeclaration(node)) {
		return 'getter';
	}

	if (ts.isSetAccessorDeclaration(node)) {
		return 'setter';
	}

	if (ts.isConstructorDeclaration(node)) {
		return 'constructor';
	}

	return isInsideClass(node) ? 'class-method' : 'object-method';
}

function isInsideClass(node: ts.Node): boolean {
	return Boolean(node.parent && (ts.isClassDeclaration(node.parent) || ts.isClassExpression(node.parent)));
}

function toRange(sourceFile: ts.SourceFile, startOffset: number, endOffset: number): FunctionRange {
	return {
		startOffset,
		endOffset,
		start: positionAt(sourceFile, startOffset),
		end: positionAt(sourceFile, endOffset),
	};
}

function positionAt(sourceFile: ts.SourceFile, offset: number): FunctionPosition {
	const position = sourceFile.getLineAndCharacterOfPosition(Math.max(0, Math.min(offset, sourceFile.text.length)));

	return {
		line: position.line,
		character: position.character,
	};
}

function rangesEqual(left: FunctionRange, right: FunctionRange): boolean {
	return left.startOffset === right.startOffset
		&& left.endOffset === right.endOffset
		&& left.start.line === right.start.line
		&& left.start.character === right.start.character
		&& left.end.line === right.end.line
		&& left.end.character === right.end.character;
}

function rangeLength(range: FunctionRange): number {
	return range.endOffset - range.startOffset;
}
