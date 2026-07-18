import ts from 'typescript';

import type { AnalyzerInput, AnalyzerResult, LanguageAnalyzer } from '../languageAnalyzer';
import { findFunctionContainingOffset, type FunctionCandidate } from './functionLocator';
import { fallbackParticipant, namedParticipant, type FlowDiagnostic, type FlowEdge, type FlowNode, type FlowModel, type FlowFunction, type FlowParticipant, type SourceLocation } from '../../flow-model';

export class TypeScriptAnalyzer implements LanguageAnalyzer {
	public readonly id = 'typescript';
	public readonly version = '0.7.0';
	public readonly languageIds = ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'] as const;

	public async analyze(input: AnalyzerInput): Promise<AnalyzerResult> {
		try {
			if (input.cancellation.isCancellationRequested) {
				return cancelledResult(this.id, input.source.languageId);
			}
			if (!this.languageIds.includes(input.source.languageId as typeof this.languageIds[number])) {
				return { status: 'failed', completeness: 'failed', diagnostics: [], error: { kind: 'unsupported-language', message: `No TypeScript analyzer support for language "${input.source.languageId}".`, analyzerId: this.id, languageId: input.source.languageId } };
			}
			const languageId = input.source.languageId as typeof this.languageIds[number];
			const sourceFile = ts.createSourceFile(input.source.uri, input.source.text, ts.ScriptTarget.Latest, true, scriptKindForLanguage(languageId));
			const target = findFunctionContainingOffset(input.source, input.cursorOffset);
			if (target.status !== 'found') {
				return { status: 'failed', completeness: 'failed', diagnostics: [], error: { kind: 'invalid-input', message: `No target function found (${target.reason}).`, analyzerId: this.id, languageId: input.source.languageId } };
			}

			const candidate = target.function;
			const node = findFunctionNode(sourceFile, candidate);
			if (!node || !node.body) {
				return { status: 'failed', completeness: 'failed', diagnostics: [], error: { kind: 'invalid-input', message: 'The target function has no analyzable body.', analyzerId: this.id, languageId: input.source.languageId } };
			}

			const builder = new FlowBuilder(input, sourceFile, candidate);
			builder.setRecoverableParseDiagnostics(parseDiagnosticsFor(sourceFile));
			await builder.extractBody(node.body);
			builder.addRecoverableParseErrorsBefore(node.body.end + 1);
			const model = builder.model();
			const completeness = model.completeness === 'partial' ? 'partial' : 'complete';
			return { status: completeness === 'partial' ? 'partial' : 'success', completeness, diagnostics: builder.diagnostics, model };
		} catch (error) {
			if (error instanceof AnalysisCancelledError) {
				return cancelledResult(this.id, input.source.languageId);
			}
			return { status: 'failed', completeness: 'failed', diagnostics: [], error: { kind: 'analysis-failed', message: 'TypeScript analysis failed before a usable partial result could be produced.', analyzerId: this.id, languageId: input.source.languageId, cause: error } };
		}
	}
}

function scriptKindForLanguage(languageId: typeof TypeScriptAnalyzer.prototype.languageIds[number]): ts.ScriptKind {
	if (languageId === 'typescriptreact') {
		return ts.ScriptKind.TSX;
	}
	if (languageId === 'javascriptreact') {
		return ts.ScriptKind.JSX;
	}
	return languageId === 'typescript' ? ts.ScriptKind.TS : ts.ScriptKind.JS;
}

function parseDiagnosticsFor(sourceFile: ts.SourceFile): readonly ts.DiagnosticWithLocation[] {
	return (sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.DiagnosticWithLocation[] }).parseDiagnostics ?? [];
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
	private static readonly yieldEveryWorkItems = 50;

	private readonly nodes: FlowNode[] = [];
	private readonly edges: FlowEdge[] = [];
	public readonly diagnostics: FlowDiagnostic[] = [];
	private nextNode = 0;
	private nextEdge = 0;
	private nextDiagnostic = 0;
	private workItemsSinceYield = 0;
	private completeness: 'complete' | 'partial' = 'complete';
	private recoverableParseDiagnostics: readonly ts.DiagnosticWithLocation[] = [];
	private readonly consumedParseDiagnostics = new Set<number>();
	private skipNextEdge = false;
	private readonly terminalNodeIds = new Set<string>();
	private pendingNextEdges: PendingEdge[] = [];
	private readonly loopStack: LoopContext[] = [];

	public constructor(private readonly input: AnalyzerInput, private readonly sourceFile: ts.SourceFile, private readonly candidate: FunctionCandidate) {}

	public model(): FlowModel {
		const languageId = this.input.source.languageId as TypeScriptAnalyzer['languageIds'][number];
		const rootFunction: FlowFunction = { id: `function:${this.candidate.range.startOffset}`, name: this.candidate.name, sourceLocation: this.location(this.candidate.range.startOffset, this.candidate.range.endOffset, this.candidate.name) };
		const edges = this.orderedEdges();
		return {
			metadata: { schemaVersion: '1.0.0', analyzerId: 'typescript', analyzerVersion: '0.7.0', languageId, generatedAt: new Date().toISOString(), sourceDocumentVersion: this.input.source.version, completeness: this.completeness, configurationDigest: this.input.configuration.configurationDigest, rootFunctionIdentifier: rootFunction.id },
			rootFunction, nodes: this.nodes, edges, diagnostics: this.diagnostics,
			source: { uri: this.input.source.uri, languageId, documentVersion: this.input.source.version }, completeness: this.completeness,
		};
	}

	public async extractBody(body: ts.ConciseBody | ts.FunctionBody): Promise<void> {
		await this.cooperate();
		if (ts.isBlock(body)) {await this.extractStatements(body.statements);}
		else {
			this.addRecoverableParseErrorsBefore(body.getStart(this.sourceFile));
			await this.extractExpression(body);
		}
	}

	public setRecoverableParseDiagnostics(diagnostics: readonly ts.DiagnosticWithLocation[]): void {
		this.recoverableParseDiagnostics = diagnostics;
	}

	public addRecoverableParseErrorsBefore(boundary: number): void {
		const bodyStart = this.candidate.fullRange.startOffset;
		const pending = this.recoverableParseDiagnostics.map((diagnostic, index) => ({ diagnostic, index })).filter(({ diagnostic, index }) => {
			const start = diagnostic.start;
			return !this.consumedParseDiagnostics.has(index) && start !== undefined && start >= bodyStart && start < Math.min(boundary, this.candidate.fullRange.endOffset);
		});
		if (pending.length === 0) {return;}

		for (const { index } of pending) {this.consumedParseDiagnostics.add(index);}
		const parseError = pending[0].diagnostic;
		if (parseError.start === undefined) {return;}
		const start = parseError.start;
		const end = Math.min(this.candidate.fullRange.endOffset, Math.max(start + 1, start + (parseError.length ?? 0)));
		const sourceLocation = this.location(start, end);
		const call = this.addSyntheticUnknownCall(sourceLocation);
		this.addDiagnostic('unknown-call', 'warning', 'A recoverable parser error prevented a call from being analyzed.', sourceLocation, call.id);
	}

	private async extractStatements(statements: ts.NodeArray<ts.Statement> | readonly ts.Statement[]): Promise<void> {
		for (const statement of statements) {
			await this.cooperate();
			this.addRecoverableParseErrorsBefore(statement.getStart(this.sourceFile));
			await this.extractStatement(statement);
		}
	}


	private async extractStatement(statement: ts.Statement): Promise<void> {
		await this.cooperate();
		if (ts.isFunctionDeclaration(statement)) {return;}
		if (ts.isWithStatement(statement)) {
			this.addDiagnostic('unsupported-syntax', 'warning', 'Unsupported with statement was skipped during partial analysis.', statement);
			return;
		}
		if (ts.isBlock(statement)) {
			await this.extractStatements(statement.statements);
			return;
		}
		if (ts.isIfStatement(statement)) {
			const branch = this.addNode({ kind: 'branch', condition: statement.expression.getText(this.sourceFile), node: statement });
			await this.extractCalls(statement.expression, branch.id);
			const before = this.nodes.length;
			this.skipNextEdge = true;
			await this.extractStatement(statement.thenStatement);
			const thenNode = this.nodes[before];
			if (thenNode) {this.addEdge(branch.id, thenNode.id, 'true', statement.expression);}
			const thenExits = this.consumePendingOrTail(before, 'next');
			const elseStart = this.nodes.length;
			if (statement.elseStatement) {
				this.skipNextEdge = true;
				await this.extractStatement(statement.elseStatement);
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
				await this.extractStatements(clause.statements);
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
				await this.extractCalls(statement.initializer, loop.id);
				await this.extractCalls(statement.condition, loop.id);
			}
			if (!ts.isForStatement(statement) && 'expression' in statement && statement.expression) {await this.extractCalls(statement.expression, loop.id);}
			if (ts.isForStatement(statement)) {
				await this.extractCalls(statement.incrementor, loop.id);
			}
			const start = this.nodes.length;
			const loopContext: LoopContext = { nodeId: loop.id, breakNodeIds: [] };
			this.loopStack.push(loopContext);
			this.skipNextEdge = true;
			await this.extractStatement(statement.statement);
			this.loopStack.pop();
			const first = this.nodes[start];
			if (first) {this.addEdge(loop.id, first.id, 'loop-body', statement);}
			this.consumePendingOrTail(start, 'loop-body');
			this.pendingNextEdges = [
				{ sourceNodeId: loop.id, kind: 'loop-exit' },
				...loopContext.breakNodeIds.map(sourceNodeId => ({ sourceNodeId, kind: 'break-exit' as const })),
			];
			return;
		}
		if (ts.isTryStatement(statement)) {
			const control = this.addNode({ kind: 'try-catch', catchBinding: statement.catchClause?.variableDeclaration?.getText(this.sourceFile), hasFinally: Boolean(statement.finallyBlock), node: statement });
			const tails: PendingEdge[] = [];
			const tryStart = this.nodes.length;
			this.skipNextEdge = true;
			await this.extractStatements(statement.tryBlock.statements);
			const tryNode = this.nodes[tryStart];
			if (tryNode) {this.addEdge(control.id, tryNode.id, 'try', statement.tryBlock);}
			tails.push(...this.consumePendingOrTail(tryStart, 'next'));
			if (statement.catchClause) {
				const catchStart = this.nodes.length;
				this.skipNextEdge = true;
				await this.extractStatements(statement.catchClause.block.statements);
				const catchNode = this.nodes[catchStart];
				if (catchNode) {this.addEdge(control.id, catchNode.id, 'catch', statement.catchClause);}
				tails.push(...this.consumePendingOrTail(catchStart, 'next'));
			}
			if (statement.finallyBlock) {
				const finallyStart = this.nodes.length;
				this.skipNextEdge = true;
				await this.extractStatements(statement.finallyBlock.statements);
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
			await this.extractCalls(statement.expression, undefined);
			const node = this.addNode({ kind: 'return', expression: statement.expression?.getText(this.sourceFile), node: statement });
			this.addEdge(node.id, node.id, 'return', statement);
			this.terminalNodeIds.add(node.id);
			return;
		}
		if (ts.isThrowStatement(statement)) {
			await this.extractCalls(statement.expression, undefined);
			const node = this.addNode({ kind: 'throw', expression: statement.expression.getText(this.sourceFile), node: statement });
			this.addEdge(node.id, node.id, 'throw', statement);
			this.terminalNodeIds.add(node.id);
			return;
		}
		if (ts.isBreakStatement(statement)) {
			const node = this.addNode({ kind: 'break', label: statement.label?.getText(this.sourceFile), node: statement });
			this.terminalNodeIds.add(node.id);
			this.loopStack[this.loopStack.length - 1]?.breakNodeIds.push(node.id);
			return;
		}
		if (ts.isContinueStatement(statement)) {
			const node = this.addNode({ kind: 'continue', label: statement.label?.getText(this.sourceFile), node: statement });
			this.terminalNodeIds.add(node.id);
			const loop = this.loopStack[this.loopStack.length - 1];
			if (loop) {this.addEdge(node.id, loop.nodeId, 'continue-loop', statement);}
			return;
		}
		if (ts.isExpressionStatement(statement)) {
			const before = this.nodes.length;
			await this.extractCalls(statement.expression, undefined);
			if (this.nodes.length === before) {
				this.addNode({ kind: 'expression', expression: statement.expression.getText(this.sourceFile), node: statement });
			}
			return;
		}
		await this.extractCalls(statement, undefined);
	}

	private async extractExpression(expression: ts.Expression): Promise<void> { await this.extractCalls(expression, undefined); }

	private async extractCalls(root: ts.Node | undefined, ownerId: string | undefined): Promise<void> {
		if (!root) {return;}
		const visit = async (node: ts.Node): Promise<void> => {
			await this.cooperate();
			if (isFunctionNode(node)) {return;}
			if (ts.isConditionalExpression(node)) {
				await visit(node.condition);
				const whenTrueStart = this.nodes.length;
				await visit(node.whenTrue);
				const trueCalls = this.nodes.slice(whenTrueStart).filter(candidate => candidate.kind === 'call');
				const whenFalseStart = this.nodes.length;
				// The alternatives are mutually exclusive; do not imply a sequential
				// edge from the last call in the true arm into the false arm.
				this.skipNextEdge = true;
				await visit(node.whenFalse);
				const falseCalls = this.nodes.slice(whenFalseStart).filter(candidate => candidate.kind === 'call');
				if (trueCalls.length > 0 && falseCalls.length > 0) {
					const source = trueCalls[trueCalls.length - 1];
					const target = falseCalls[0];
					this.addEdge(source.id, target.id, 'uncertain', node);
					this.addDiagnostic('order-uncertain', 'warning', 'Conditional expression alternatives have no statically determinable execution order.', node, source.id);
				}
				return;
			}
			if (ts.isAwaitExpression(node)) {
				const awaitNode = this.addNode({ kind: 'await', expression: node.expression.getText(this.sourceFile), node });
				await this.extractCalls(node.expression, awaitNode.id);
				return;
			}
			if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
				const callInfo = this.callInfo(node);
				for (const child of childNodes(node)) {await visit(child);}
				if (ownerId) {this.skipNextEdge = true;}
				const call = this.addNode({ kind: 'call', calleeName: callInfo.calleeName, participant: callInfo.participant, invocationTarget: callInfo.invocationTarget, resolution: callInfo.resolution, label: callInfo.calleeName, node });
				if (callInfo.resolution !== 'resolved') {
					this.addDiagnostic(callInfo.resolution === 'unknown' ? 'unknown-call' : 'unresolved-call', 'warning', callInfo.message, node, call.id);
				}
				if (ownerId) {this.addEdge(ownerId, call.id, 'next', node);}
				return;
			}
			for (const child of childNodes(node)) {await visit(child);}
		};
		await visit(root);
	}

	private addNode(data: { kind: FlowNode['kind']; node: ts.Node; condition?: string; expression?: string; catchBinding?: string; hasFinally?: boolean; calleeName?: string; participant?: FlowParticipant; invocationTarget?: 'participant' | 'self'; resolution?: 'resolved' | 'unknown' | 'unresolved'; label?: string }): FlowNode {
		const id = `node:${this.nextNode++}`;
		const base = { id, kind: data.kind, order: this.nodes.length, sourceLocation: this.location(data.node.getStart(this.sourceFile), data.node.end) } as const;
		let node: FlowNode;
		switch (data.kind) {
			case 'call': node = { ...base, kind: 'call', calleeName: data.calleeName ?? '<call>', participant: data.participant, invocationTarget: data.invocationTarget, resolution: data.resolution ?? 'resolved', label: data.label }; break;
			case 'branch': node = { ...base, kind: 'branch', condition: data.condition }; break;
			case 'loop': node = { ...base, kind: 'loop', condition: data.condition }; break;
			case 'await': node = { ...base, kind: 'await', expression: data.expression }; break;
			case 'return': node = { ...base, kind: 'return', expression: data.expression }; break;
			case 'throw': node = { ...base, kind: 'throw', expression: data.expression }; break;
			case 'break': node = { ...base, kind: 'break', label: data.label }; break;
			case 'continue': node = { ...base, kind: 'continue', label: data.label }; break;
			case 'expression': node = { ...base, kind: 'expression', expression: data.expression ?? data.node.getText(this.sourceFile) }; break;
			case 'try-catch': node = { ...base, kind: 'try-catch', catchBinding: data.catchBinding, hasFinally: data.hasFinally }; break;
		}
		this.appendNode(node, data.node);
		return node;
	}

	private addSyntheticUnknownCall(sourceLocation: SourceLocation): Extract<FlowNode, { kind: 'call' }> {
		const node: Extract<FlowNode, { kind: 'call' }> = {
			id: `node:${this.nextNode++}`,
			kind: 'call',
			order: this.nodes.length,
			sourceLocation,
			calleeName: '<unknown>',
			participant: fallbackParticipant('unknown'),
			resolution: 'unknown',
			label: '<unknown>',
		};
		this.appendNode(node, sourceLocation);
		return node;
	}

	private appendNode(node: FlowNode, connectionSource: ts.Node | SourceLocation): void {
		this.nodes.push(node);
		const previous = this.nodes[this.nodes.length - 2];
		if (this.pendingNextEdges.length > 0) {
			for (const edge of this.pendingNextEdges) {this.addEdge(edge.sourceNodeId, node.id, edge.kind, connectionSource);}
			this.pendingNextEdges = [];
			this.skipNextEdge = false;
		} else if (previous && this.skipNextEdge) {
			this.skipNextEdge = false;
		} else if (previous && !this.terminalNodeIds.has(previous.id)) {
			this.addEdge(previous.id, node.id, 'next', connectionSource);
		}
	}

	private addEdge(sourceNodeId: string, targetNodeId: string, kind: FlowEdge['kind'], source: ts.Node | SourceLocation): void {
		const executionOrder = this.nextEdge++;
		const sourceLocation = 'uri' in source ? source : this.location(source.getStart(this.sourceFile), source.end);
		this.edges.push({ id: `edge:${executionOrder}`, sourceNodeId, targetNodeId, kind, executionOrder, sourceLocation });
	}

	private addDiagnostic(kind: FlowDiagnostic['kind'], severity: FlowDiagnostic['severity'], message: string, source: ts.Node | SourceLocation, nodeId?: string): void {
		this.completeness = 'partial';
		this.diagnostics.push({
			id: `diagnostic:${this.nextDiagnostic++}`,
			kind,
			severity,
			message,
			nodeId,
			sourceLocation: 'uri' in source ? source : this.location(source.getStart(this.sourceFile), source.end),
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
		if (ts.isElementAccessExpression(expression)) {
			return selfCall('<unknown>');
		}
		if (ts.isPropertyAccessExpression(expression)) {
			if (expression.expression.kind === ts.SyntaxKind.ThisKeyword) {
				return selfCall(expression.name.text);
			}
			if (ts.isIdentifier(expression.expression)) {
				if (isOptionalCall(node) || isOptionalAccess(expression)) {
					return {
						calleeName: expression.name.text,
						participant: this.participantForReceiver(expression.expression, expression.name.text),
						resolution: 'unresolved',
						message: `Optional external call "${expression.name.text}" could not be fully resolved statically.`,
					};
				}
				return { calleeName: expression.name.text, participant: this.participantForReceiver(expression.expression, expression.name.text), resolution: 'resolved', message: '' };
			}
			return selfCall(expression.name.text);
		}
		if (ts.isIdentifier(expression) || expression.kind === ts.SyntaxKind.SuperKeyword) {
			return selfCall(expression.getText(this.sourceFile));
		}
		return selfCall('<unknown>');
	}

	private participantForReceiver(receiver: ts.Identifier, methodName?: string): FlowParticipant {
		if (methodName && collectionMethodNames.has(methodName)) {
			return namedParticipant('class', 'Array');
		}
		const name = receiver.text;
		return namedParticipant(/^[A-Z]/.test(name) ? 'class' : 'instance', name);
	}

	private throwIfCancelled(): void {
		if (this.input.cancellation.isCancellationRequested) {
			throw new AnalysisCancelledError();
		}
	}

	private async cooperate(): Promise<void> {
		this.throwIfCancelled();
		this.workItemsSinceYield += 1;
		if (this.workItemsSinceYield < FlowBuilder.yieldEveryWorkItems) {
			return;
		}
		this.workItemsSinceYield = 0;
		await yieldToEventLoop();
		this.throwIfCancelled();
	}
}

const collectionMethodNames = new Set([
	'at', 'concat', 'entries', 'every', 'filter', 'find', 'findIndex', 'flat', 'flatMap', 'forEach',
	'includes', 'indexOf', 'join', 'keys', 'lastIndexOf', 'map', 'reduce', 'reduceRight', 'reverse',
	'slice', 'some', 'sort', 'values',
]);

interface PendingEdge {
	readonly sourceNodeId: string;
	readonly kind: FlowEdge['kind'];
}

interface LoopContext {
	readonly nodeId: string;
	readonly breakNodeIds: string[];
}

interface CallInfo {
	readonly calleeName: string;
	readonly participant?: FlowParticipant;
	readonly invocationTarget?: 'participant' | 'self';
	readonly resolution: 'resolved' | 'unknown' | 'unresolved';
	readonly message: string;
}

function selfCall(calleeName: string): CallInfo {
	return { calleeName, invocationTarget: 'self', resolution: 'resolved', message: '' };
}

function isOptionalCall(node: ts.CallExpression | ts.NewExpression): boolean {
	return ts.isCallExpression(node) && Boolean(node.questionDotToken);
}

function isOptionalAccess(expression: ts.Expression): boolean {
	return (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) && Boolean(expression.questionDotToken);
}

function childNodes(node: ts.Node): ts.Node[] {
	const children: ts.Node[] = [];
	node.forEachChild(child => {
		children.push(child);
	});
	return children;
}

function yieldToEventLoop(): Promise<void> {
	return new Promise(resolve => {
		setImmediate(resolve);
	});
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
		case 'break-exit': return 8;
		case 'continue-loop': return 9;
		case 'return': return 10;
		case 'throw': return 11;
		case 'uncertain': return 12;
	}
}
