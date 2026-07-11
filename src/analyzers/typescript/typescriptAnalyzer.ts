import ts from 'typescript';

import type { AnalyzerInput, AnalyzerResult, LanguageAnalyzer } from '../languageAnalyzer';
import { findFunctionContainingOffset, type FunctionCandidate } from './functionLocator';
import type { FlowDiagnostic, FlowEdge, FlowNode, FlowModel, FlowFunction, SourceLocation } from '../../flow-model';

export class TypeScriptAnalyzer implements LanguageAnalyzer {
	public readonly id = 'typescript';
	public readonly version = '0.3.0';
	public readonly languageIds = ['typescript', 'javascript'] as const;

	public analyze(input: AnalyzerInput): Promise<AnalyzerResult> {
		try {
			if (input.cancellation.isCancellationRequested) {
				return Promise.resolve(cancelledResult(this.id, input.source.languageId));
			}
			if (input.source.languageId !== 'typescript' && input.source.languageId !== 'javascript') {
				return Promise.resolve({ status: 'failed', completeness: 'failed', diagnostics: [], error: { kind: 'unsupported-language', message: `No TypeScript analyzer support for language "${input.source.languageId}".`, analyzerId: this.id, languageId: input.source.languageId } });
			}
			const languageId = input.source.languageId as 'typescript' | 'javascript';
			const sourceFile = ts.createSourceFile(input.source.uri, input.source.text, ts.ScriptTarget.Latest, true, languageId === 'typescript' ? ts.ScriptKind.TS : ts.ScriptKind.JS);
			const target = findFunctionContainingOffset(input.source, input.cursorOffset);
			if (target.status !== 'found') {
				return Promise.resolve({ status: 'failed', completeness: 'failed', diagnostics: [], error: { kind: 'invalid-input', message: `No target function found (${target.reason}).`, analyzerId: this.id, languageId: input.source.languageId } });
			}

			const candidate = target.function;
			const node = findFunctionNode(sourceFile, candidate);
			if (!node || !node.body) {
				return Promise.resolve({ status: 'failed', completeness: 'failed', diagnostics: [], error: { kind: 'invalid-input', message: 'The target function has no analyzable body.', analyzerId: this.id, languageId: input.source.languageId } });
			}

			const builder = new FlowBuilder(input, sourceFile, candidate);
			builder.extractBody(node.body);
			const model = builder.model();
			const completeness = model.completeness === 'partial' ? 'partial' : 'complete';
			return Promise.resolve({ status: completeness === 'partial' ? 'partial' : 'success', completeness, diagnostics: builder.diagnostics, model });
		} catch (error) {
			if (error instanceof AnalysisCancelledError) {
				return Promise.resolve(cancelledResult(this.id, input.source.languageId));
			}
			return Promise.resolve({ status: 'failed', completeness: 'failed', diagnostics: [], error: { kind: 'analysis-failed', message: 'TypeScript analysis failed before a usable partial result could be produced.', analyzerId: this.id, languageId: input.source.languageId, cause: error } });
		}
	}
}

function cancelledResult(analyzerId: string, languageId: string): AnalyzerResult {
	return {
		status: 'failed',
		completeness: 'failed',
		diagnostics: [],
		error: { kind: 'analysis-cancelled', message: 'Analysis was cancelled before completion.', analyzerId, languageId },
	};
}

class AnalysisCancelledError extends Error {
	public constructor() {
		super('Analysis cancelled.');
	}
}

type FunctionNode = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration | ts.ConstructorDeclaration;

function findFunctionNode(sourceFile: ts.SourceFile, candidate: FunctionCandidate): FunctionNode | undefined {
	let found: FunctionNode | undefined;
	function visit(node: ts.Node): void {
		if (node.end === candidate.fullRange.endOffset && candidate.fullRange.startOffset <= node.getStart(sourceFile) && isFunctionNode(node)) {found = node;}
		if (!found) {ts.forEachChild(node, visit);}
	}
	visit(sourceFile);
	return found;
}

function isFunctionNode(node: ts.Node): node is FunctionNode {
	return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isConstructorDeclaration(node);
}

class FlowBuilder {
	private readonly nodes: FlowNode[] = [];
	private readonly edges: FlowEdge[] = [];
	public readonly diagnostics: FlowDiagnostic[] = [];
	private nextNode = 0;
	private nextEdge = 0;
	private nextDiagnostic = 0;
	private completeness: 'complete' | 'partial' = 'complete';
	private skipNextEdge = false;
	private readonly terminalNodeIds = new Set<string>();
	private pendingNextEdges: PendingEdge[] = [];

	public constructor(private readonly input: AnalyzerInput, private readonly sourceFile: ts.SourceFile, private readonly candidate: FunctionCandidate) {}

	public model(): FlowModel {
		const languageId = this.input.source.languageId as 'typescript' | 'javascript';
		const rootFunction: FlowFunction = { id: `function:${this.candidate.range.startOffset}`, name: this.candidate.name, sourceLocation: this.location(this.candidate.range.startOffset, this.candidate.range.endOffset, this.candidate.name) };
		const edges = this.orderedEdges();
		return {
			metadata: { schemaVersion: '1.0.0', analyzerId: 'typescript', analyzerVersion: '0.3.0', languageId, generatedAt: new Date().toISOString(), sourceDocumentVersion: this.input.source.version, completeness: this.completeness, configurationDigest: this.input.configuration.configurationDigest, rootFunctionIdentifier: rootFunction.id },
			rootFunction, nodes: this.nodes, edges, diagnostics: this.diagnostics,
			source: { uri: this.input.source.uri, languageId, documentVersion: this.input.source.version }, completeness: this.completeness,
		};
	}

	public extractBody(body: ts.ConciseBody | ts.FunctionBody): void {
		this.throwIfCancelled();
		if (ts.isBlock(body)) {this.extractStatements(body.statements);}
		else {this.extractExpression(body);}
	}

	private extractStatements(statements: ts.NodeArray<ts.Statement> | readonly ts.Statement[]): void {
		for (const statement of statements) {
			this.throwIfCancelled();
			this.extractStatement(statement);
		}
	}

	private extractStatement(statement: ts.Statement): void {
		this.throwIfCancelled();
		if (ts.isFunctionDeclaration(statement)) {return;}
		if (ts.isWithStatement(statement)) {
			this.addDiagnostic('unsupported-syntax', 'warning', 'Unsupported with statement was skipped during partial analysis.', statement);
			return;
		}
		if (ts.isBlock(statement)) {
			this.extractStatements(statement.statements);
			return;
		}
		if (ts.isIfStatement(statement)) {
			const branch = this.addNode({ kind: 'branch', condition: statement.expression.getText(this.sourceFile), node: statement });
			this.extractCalls(statement.expression, branch.id);
			const before = this.nodes.length;
			this.skipNextEdge = true;
			this.extractStatement(statement.thenStatement);
			const thenNode = this.nodes[before];
			if (thenNode) {this.addEdge(branch.id, thenNode.id, 'true', statement.expression);}
			const thenExits = this.consumePendingOrTail(before, 'next');
			const elseStart = this.nodes.length;
			if (statement.elseStatement) {
				this.skipNextEdge = true;
				this.extractStatement(statement.elseStatement);
			}
			const elseNode = this.nodes[elseStart];
			if (elseNode) {this.addEdge(branch.id, elseNode.id, 'false', statement.expression);}
			const elseExits: PendingEdge[] = statement.elseStatement ? this.consumePendingOrTail(elseStart, 'next') : [{ sourceNodeId: branch.id, kind: 'next' }];
			this.pendingNextEdges = [...thenExits, ...elseExits];
			return;
		}
		if (ts.isSwitchStatement(statement)) {
			const branch = this.addNode({ kind: 'branch', condition: statement.expression.getText(this.sourceFile), node: statement });
			const exits: PendingEdge[] = [];
			for (const clause of statement.caseBlock.clauses) {
				const start = this.nodes.length;
				this.skipNextEdge = true;
				this.extractStatements(clause.statements);
				const first = this.nodes[start];
				if (first) {this.addEdge(branch.id, first.id, clause.kind === ts.SyntaxKind.CaseClause ? 'true' : 'false', clause);}
				exits.push(...this.consumePendingOrTail(start, 'next'));
			}
			this.pendingNextEdges = exits.length > 0 ? exits : [{ sourceNodeId: branch.id, kind: 'next' }];
			return;
		}
		if (ts.isForStatement(statement) || ts.isForInStatement(statement) || ts.isForOfStatement(statement) || ts.isWhileStatement(statement) || ts.isDoStatement(statement)) {
			const expression = this.loopConditionText(statement);
			const loop = this.addNode({ kind: 'loop', condition: expression, node: statement });
			if (ts.isForStatement(statement)) {
				this.extractCalls(statement.initializer, loop.id);
				this.extractCalls(statement.condition, loop.id);
			}
			if (!ts.isForStatement(statement) && 'expression' in statement && statement.expression) {this.extractCalls(statement.expression, loop.id);}
			if (ts.isForStatement(statement)) {
				this.extractCalls(statement.incrementor, loop.id);
			}
			const start = this.nodes.length;
			this.skipNextEdge = true;
			this.extractStatement(statement.statement);
			const first = this.nodes[start];
			if (first) {this.addEdge(loop.id, first.id, 'loop-body', statement);}
			const bodyExits = this.consumePendingOrTail(start, 'loop-body');
			for (const edge of bodyExits) {this.addEdge(edge.sourceNodeId, loop.id, 'loop-body', statement);}
			this.pendingNextEdges = [{ sourceNodeId: loop.id, kind: 'loop-exit' }];
			return;
		}
		if (ts.isTryStatement(statement)) {
			const control = this.addNode({ kind: 'try-catch', catchBinding: statement.catchClause?.variableDeclaration?.getText(this.sourceFile), hasFinally: Boolean(statement.finallyBlock), node: statement });
			const tails: PendingEdge[] = [];
			const tryStart = this.nodes.length;
			this.skipNextEdge = true;
			this.extractStatements(statement.tryBlock.statements);
			const tryNode = this.nodes[tryStart];
			if (tryNode) {this.addEdge(control.id, tryNode.id, 'try', statement.tryBlock);}
			tails.push(...this.consumePendingOrTail(tryStart, 'next'));
			if (statement.catchClause) {
				const catchStart = this.nodes.length;
				this.skipNextEdge = true;
				this.extractStatements(statement.catchClause.block.statements);
				const catchNode = this.nodes[catchStart];
				if (catchNode) {this.addEdge(control.id, catchNode.id, 'catch', statement.catchClause);}
				tails.push(...this.consumePendingOrTail(catchStart, 'next'));
			}
			if (statement.finallyBlock) {
				const finallyStart = this.nodes.length;
				this.skipNextEdge = true;
				this.extractStatements(statement.finallyBlock.statements);
				const finallyNode = this.nodes[finallyStart];
				if (finallyNode) {this.addEdge(control.id, finallyNode.id, 'finally', statement.finallyBlock);}
				const finallyExits = this.consumePendingOrTail(finallyStart, 'next');
				this.pendingNextEdges = tails.length > 0 ? finallyExits : [];
				if (tails.length === 0) {this.skipNextEdge = true;}
				return;
			}
			this.pendingNextEdges = tails.length > 0 ? tails : [{ sourceNodeId: control.id, kind: 'next' }];
			return;
		}
		if (ts.isReturnStatement(statement)) {
			this.extractCalls(statement.expression, undefined);
			const node = this.addNode({ kind: 'return', expression: statement.expression?.getText(this.sourceFile), node: statement });
			this.addEdge(node.id, node.id, 'return', statement);
			this.terminalNodeIds.add(node.id);
			return;
		}
		if (ts.isThrowStatement(statement)) {
			this.extractCalls(statement.expression, undefined);
			const node = this.addNode({ kind: 'throw', expression: statement.expression.getText(this.sourceFile), node: statement });
			this.addEdge(node.id, node.id, 'throw', statement);
			this.terminalNodeIds.add(node.id);
			return;
		}
		this.extractCalls(statement, undefined);
	}

	private extractExpression(expression: ts.Expression): void { this.extractCalls(expression, undefined); }

	private extractCalls(root: ts.Node | undefined, ownerId: string | undefined): void {
		if (!root) {return;}
		const visit = (node: ts.Node): void => {
			this.throwIfCancelled();
			if (isFunctionNode(node)) {return;}
			if (ts.isAwaitExpression(node)) {
				const awaitNode = this.addNode({ kind: 'await', expression: node.expression.getText(this.sourceFile), node });
				this.extractCalls(node.expression, awaitNode.id);
				return;
			}
			if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
				const callInfo = this.callInfo(node);
				if (ownerId) {this.skipNextEdge = true;}
				const call = this.addNode({ kind: 'call', calleeName: callInfo.calleeName, resolution: callInfo.resolution, label: callInfo.calleeName, node });
				if (callInfo.resolution !== 'resolved') {
					this.addDiagnostic(callInfo.resolution === 'unknown' ? 'unknown-call' : 'unresolved-call', 'warning', callInfo.message, node, call.id);
				}
				if (ownerId) {this.addEdge(ownerId, call.id, 'next', node);}
				ts.forEachChild(node, visit);
				return;
			}
			ts.forEachChild(node, visit);
		};
		visit(root);
	}

	private addNode(data: { kind: FlowNode['kind']; node: ts.Node; condition?: string; expression?: string; catchBinding?: string; hasFinally?: boolean; calleeName?: string; resolution?: 'resolved' | 'unknown' | 'unresolved'; label?: string }): FlowNode {
		const id = `node:${this.nextNode++}`;
		const base = { id, kind: data.kind, order: this.nodes.length, sourceLocation: this.location(data.node.getStart(this.sourceFile), data.node.end) } as const;
		let node: FlowNode;
		switch (data.kind) {
			case 'call': node = { ...base, kind: 'call', calleeName: data.calleeName ?? '<call>', resolution: data.resolution ?? 'resolved', label: data.label }; break;
			case 'branch': node = { ...base, kind: 'branch', condition: data.condition }; break;
			case 'loop': node = { ...base, kind: 'loop', condition: data.condition }; break;
			case 'await': node = { ...base, kind: 'await', expression: data.expression }; break;
			case 'return': node = { ...base, kind: 'return', expression: data.expression }; break;
			case 'throw': node = { ...base, kind: 'throw', expression: data.expression }; break;
			case 'try-catch': node = { ...base, kind: 'try-catch', catchBinding: data.catchBinding, hasFinally: data.hasFinally }; break;
		}
		this.nodes.push(node);
		const previous = this.nodes[this.nodes.length - 2];
		if (this.pendingNextEdges.length > 0) {
			for (const edge of this.pendingNextEdges) {this.addEdge(edge.sourceNodeId, node.id, edge.kind, data.node);}
			this.pendingNextEdges = [];
			this.skipNextEdge = false;
		} else if (previous && this.skipNextEdge) {
			this.skipNextEdge = false;
		} else if (previous && !this.terminalNodeIds.has(previous.id)) {
			this.addEdge(previous.id, node.id, 'next', data.node);
		}
		return node;
	}

	private addEdge(sourceNodeId: string, targetNodeId: string, kind: FlowEdge['kind'], source: ts.Node): void {
		this.edges.push({ id: `edge:${this.nextEdge}`, sourceNodeId, targetNodeId, kind, executionOrder: this.nextEdge++, sourceLocation: this.location(source.getStart(this.sourceFile), source.end) });
	}

	private addDiagnostic(kind: FlowDiagnostic['kind'], severity: FlowDiagnostic['severity'], message: string, source: ts.Node, nodeId?: string): void {
		this.completeness = 'partial';
		this.diagnostics.push({
			id: `diagnostic:${this.nextDiagnostic++}`,
			kind,
			severity,
			message,
			nodeId,
			sourceLocation: this.location(source.getStart(this.sourceFile), source.end),
		});
	}

	private location(start: number, end: number, symbolName?: string): SourceLocation {
		const from = this.sourceFile.getLineAndCharacterOfPosition(start);
		const to = this.sourceFile.getLineAndCharacterOfPosition(end);
		return { uri: this.input.source.uri, range: { start: { line: from.line, character: from.character }, end: { line: to.line, character: to.character } }, symbolName };
	}

	private lastNodeIdSince(startIndex: number): string | undefined {
		return this.nodes.length > startIndex ? this.nodes[this.nodes.length - 1].id : undefined;
	}

	private loopConditionText(statement: ts.ForStatement | ts.ForInStatement | ts.ForOfStatement | ts.WhileStatement | ts.DoStatement): string {
		if (ts.isForStatement(statement)) {
			return statement.condition?.getText(this.sourceFile) ?? statement.getText(this.sourceFile).split('{')[0].trim();
		}
		return 'expression' in statement && statement.expression ? statement.expression.getText(this.sourceFile) : statement.getText(this.sourceFile).split('{')[0].trim();
	}

	private continuingEdges(nodeIds: readonly (string | undefined)[], kind: FlowEdge['kind']): PendingEdge[] {
		return nodeIds
			.filter((id): id is string => id !== undefined && !this.terminalNodeIds.has(id))
			.map(sourceNodeId => ({ sourceNodeId, kind }));
	}

	private consumePendingOrTail(startIndex: number, kind: FlowEdge['kind']): PendingEdge[] {
		if (this.pendingNextEdges.length > 0) {
			const pending = this.pendingNextEdges;
			this.pendingNextEdges = [];
			return pending.filter(edge => !this.terminalNodeIds.has(edge.sourceNodeId));
		}
		return this.continuingEdges([this.lastNodeIdSince(startIndex)], kind);
	}

	private orderedEdges(): FlowEdge[] {
		const ordered = [...this.edges].sort((left, right) => {
			const targetDelta = this.nodeOrder(left.targetNodeId) - this.nodeOrder(right.targetNodeId);
			if (targetDelta !== 0) {return targetDelta;}
			const startDelta = this.edgeStart(left) - this.edgeStart(right);
			if (startDelta !== 0) {return startDelta;}
			return edgeKindOrder(left.kind) - edgeKindOrder(right.kind);
		});
		return ordered.map((edge, index) => ({ ...edge, id: `edge:${index}`, executionOrder: index }));
	}

	private locationStart(location: SourceLocation): number {
		return location.range.start.line * 1_000_000 + location.range.start.character;
	}

	private edgeStart(edge: FlowEdge): number {
		return edge.sourceLocation ? this.locationStart(edge.sourceLocation) : Number.MAX_SAFE_INTEGER;
	}

	private nodeOrder(nodeId: string): number {
		return this.nodes.find(node => node.id === nodeId)?.order ?? Number.MAX_SAFE_INTEGER;
	}

	private callInfo(node: ts.CallExpression | ts.NewExpression): CallInfo {
		const expression = node.expression;
		if (isOptionalCall(node) || isOptionalAccess(expression)) {
			if (ts.isPropertyAccessExpression(expression)) {
				return { calleeName: expression.name.text, resolution: 'unresolved', message: `Optional member call "${expression.name.text}" could not be fully resolved statically.` };
			}
			return { calleeName: '<unknown>', resolution: 'unknown', message: 'Optional call target could not be named statically.' };
		}
		if (ts.isElementAccessExpression(expression)) {
			return { calleeName: '<unknown>', resolution: 'unknown', message: 'Computed callable target could not be named statically.' };
		}
		if (ts.isPropertyAccessExpression(expression)) {
			if (this.isDynamicReceiver(expression.expression)) {
				return { calleeName: expression.name.text, resolution: 'unresolved', message: `Call "${expression.name.text}" has a dynamic receiver and was kept unresolved.` };
			}
			return { calleeName: expression.name.text, resolution: 'resolved', message: '' };
		}
		if (ts.isIdentifier(expression) || expression.kind === ts.SyntaxKind.SuperKeyword) {
			return { calleeName: expression.getText(this.sourceFile), resolution: 'resolved', message: '' };
		}
		return { calleeName: '<unknown>', resolution: 'unknown', message: 'Call target could not be named statically.' };
	}

	private isDynamicReceiver(expression: ts.Expression): boolean {
		return ts.isCallExpression(expression) || ts.isNewExpression(expression) || ts.isElementAccessExpression(expression) || isOptionalAccess(expression);
	}

	private throwIfCancelled(): void {
		if (this.input.cancellation.isCancellationRequested) {
			throw new AnalysisCancelledError();
		}
	}
}

interface PendingEdge {
	readonly sourceNodeId: string;
	readonly kind: FlowEdge['kind'];
}

interface CallInfo {
	readonly calleeName: string;
	readonly resolution: 'resolved' | 'unknown' | 'unresolved';
	readonly message: string;
}

function isOptionalCall(node: ts.CallExpression | ts.NewExpression): boolean {
	return ts.isCallExpression(node) && Boolean(node.questionDotToken);
}

function isOptionalAccess(expression: ts.Expression): boolean {
	return (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) && Boolean(expression.questionDotToken);
}

function edgeKindOrder(kind: FlowEdge['kind']): number {
	switch (kind) {
		case 'true': return 0;
		case 'false': return 1;
		case 'loop-body': return 2;
		case 'try': return 3;
		case 'catch': return 4;
		case 'finally': return 5;
		case 'next': return 6;
		case 'loop-exit': return 7;
		case 'return': return 8;
		case 'throw': return 9;
		case 'uncertain': return 10;
	}
}
