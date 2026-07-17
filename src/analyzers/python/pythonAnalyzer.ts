import type { SyntaxNode } from '@lezer/common';

import type { AnalyzerInput, AnalyzerResult, LanguageAnalyzer } from '../languageAnalyzer';
import type { FlowDiagnostic, FlowEdge, FlowModel, FlowNode, FlowFunction, SourceLocation } from '../../flow-model';
import { fallbackParticipant, namedParticipant } from '../../flow-model';
import type { FlowParticipant } from '../../flow-model';
import { PythonFunctionLocator } from './pythonFunctionLocator';
import { directChildren, firstChildNamed, parsePython } from './pythonParser';

export class PythonAnalyzer implements LanguageAnalyzer {
	public readonly id = 'python';
	public readonly version = '1.0.2';
	public readonly languageIds = ['python'] as const;
	private readonly locator = new PythonFunctionLocator();

	public async analyze(input: AnalyzerInput): Promise<AnalyzerResult> {
		try {
			if (input.cancellation.isCancellationRequested) {
				return cancelledResult(this.id, input.source.languageId);
			}
			if (input.source.languageId !== 'python') {
				return failedResult('unsupported-language', `No Python analyzer support for language "${input.source.languageId}".`, input.source.languageId, this.id);
			}
			const target = this.locator.findFunctionContainingOffset(input.source, input.cursorOffset);
			if (target.status !== 'found') {
				return failedResult('invalid-input', `No target function found (${target.reason}).`, input.source.languageId, this.id);
			}
			const parsed = parsePython(input.source.text);
			if (input.cancellation.isCancellationRequested) {
				return cancelledResult(this.id, input.source.languageId);
			}
			let functionNode: SyntaxNode | undefined;
			parsed.tree.iterate({
				enter: node => {
					if (node.name === 'FunctionDefinition' && node.from === target.function.fullRange.startOffset) {
						functionNode = node.node;
					}
				},
			});
			if (!functionNode) {
				return failedResult('invalid-input', 'The target Python function node could not be resolved.', input.source.languageId, this.id);
			}
			const body = firstChildNamed(functionNode, 'Body');
			if (!body) {
				return failedResult('invalid-input', 'The target Python function has no analyzable body.', input.source.languageId, this.id);
			}
			const builder = new PythonFlowBuilder(input, target.function, parsed.hasErrors);
			await builder.extractStatements(directChildren(body).filter(node => node.name !== ':'));
			if (input.cancellation.isCancellationRequested) {
				return cancelledResult(this.id, input.source.languageId);
			}
			const model = builder.model();
			const completeness = model.completeness === 'partial' ? 'partial' : 'complete';
			return { status: completeness === 'partial' ? 'partial' : 'success', completeness, diagnostics: builder.diagnostics, model };
		} catch (error) {
			if (error instanceof AnalysisCancelledError) {
				return cancelledResult(this.id, input.source.languageId);
			}
			return failedResult('analysis-failed', 'Python analysis failed before a usable partial result could be produced.', input.source.languageId, this.id, error);
		}
	}
}

class PythonFlowBuilder {
	private readonly nodes: FlowNode[] = [];
	private readonly edges: FlowEdge[] = [];
	public readonly diagnostics: FlowDiagnostic[] = [];
	private readonly terminalNodeIds = new Set<string>();
	private readonly loopStack: LoopContext[] = [];
	private pendingEdges: PendingEdge[] = [];
	private nextNode = 0;
	private nextEdge = 0;
	private nextDiagnostic = 0;
	private workItems = 0;
	private completeness: 'complete' | 'partial';

	public constructor(private readonly input: AnalyzerInput, private readonly candidate: { readonly name: string; readonly range: { readonly startOffset: number; readonly endOffset: number } }, hasParseErrors: boolean) {
		this.completeness = hasParseErrors ? 'partial' : 'complete';
		if (hasParseErrors) {
			this.addDiagnostic('partial-analysis', 'warning', 'Python source contains syntax errors; available flow was analyzed partially.');
		}
	}

	public model(): FlowModel {
		const rootFunction: FlowFunction = {
			id: `function:${this.candidate.range.startOffset}`,
			name: this.candidate.name,
			sourceLocation: this.location(this.candidate.range.startOffset, this.candidate.range.endOffset, this.candidate.name),
		};
		return {
			metadata: {
				schemaVersion: '1.0.0', analyzerId: 'python', analyzerVersion: '1.0.2', languageId: 'python',
				generatedAt: new Date().toISOString(), sourceDocumentVersion: this.input.source.version,
				completeness: this.completeness, configurationDigest: this.input.configuration.configurationDigest,
				rootFunctionIdentifier: rootFunction.id,
			},
			rootFunction, nodes: this.nodes, edges: this.edges, diagnostics: this.diagnostics,
			source: { uri: this.input.source.uri, languageId: 'python', documentVersion: this.input.source.version },
			completeness: this.completeness,
		};
	}

	public async extractStatements(statements: readonly SyntaxNode[]): Promise<void> {
		for (const statement of statements) {
			await this.cooperate();
			await this.extractStatement(statement);
		}
	}

	private async extractStatement(statement: SyntaxNode): Promise<void> {
		if (statement.name === 'FunctionDefinition') { return; }
		if (statement.name === 'IfStatement') { await this.extractIf(statement); return; }
		if (statement.name === 'ForStatement' || statement.name === 'WhileStatement') { await this.extractLoop(statement); return; }
		if (statement.name === 'TryStatement') { await this.extractTry(statement); return; }
		if (statement.name === 'WithStatement') { await this.extractWith(statement); return; }
		if (statement.name === 'AssignStatement' || statement.name === 'AugAssignStatement' || statement.name === 'UpdateStatement') { await this.extractAssignment(statement); return; }
		if (statement.name === 'ReturnStatement') { await this.extractTerminal(statement, 'return'); return; }
		if (statement.name === 'RaiseStatement') { await this.extractTerminal(statement, 'throw'); return; }
		if (statement.name === 'BreakStatement') {
			const node = this.addNode('break', statement);
			this.terminalNodeIds.add(node.id);
			this.loopStack[this.loopStack.length - 1]?.breakNodeIds.push(node.id);
			return;
		}
		if (statement.name === 'ContinueStatement') {
			const node = this.addNode('continue', statement);
			this.terminalNodeIds.add(node.id);
			const loop = this.loopStack[this.loopStack.length - 1];
			if (loop) { this.addEdge(node.id, loop.nodeId, 'continue-loop', statement); }
			return;
		}
		if (statement.name === 'ExpressionStatement') {
			const before = this.nodes.length;
			await this.extractCalls(statement);
			if (this.nodes.length === before) { this.addNode('expression', statement, this.text(statement)); }
			return;
		}
		if (statement.name === 'PassStatement' || statement.name === 'GlobalStatement' || statement.name === 'NonlocalStatement') {
			this.addNode('expression', statement, this.text(statement));
			return;
		}
		this.markPartial(statement, `Unsupported Python syntax "${statement.name}" was skipped.`);
	}

	private async extractIf(statement: SyntaxNode): Promise<void> {
		const condition = this.conditionText(statement, 'if');
		const branch = this.addNode('branch', statement, condition);
		const conditionNode = directChildren(statement).find(child => child.name !== 'if' && child.name !== 'Body');
		if (conditionNode) { await this.extractCalls(conditionNode); }
		const bodies = directChildren(statement).filter(child => child.name === 'Body');
		const exits: PendingEdge[] = [];
		for (let index = 0; index < bodies.length; index += 1) {
			this.pendingEdges = [{ sourceNodeId: branch.id, kind: index === 0 ? 'true' : 'false' }];
			await this.extractStatements(directChildren(bodies[index]).filter(node => node.name !== ':'));
			exits.push(...this.consumeTail());
		}
		this.pendingEdges = exits;
	}

	private async extractLoop(statement: SyntaxNode): Promise<void> {
		const loop = this.addNode('loop', statement, this.headerText(statement));
		for (const child of directChildren(statement).filter(node => node.name !== 'Body' && !['for', 'while', 'in', ':'].includes(node.name))) {
			await this.extractCalls(child);
		}
		const bodies = directChildren(statement).filter(child => child.name === 'Body');
		const body = bodies[0];
		if (body) {
			const context: LoopContext = { nodeId: loop.id, breakNodeIds: [] };
			this.loopStack.push(context);
			this.pendingEdges = [{ sourceNodeId: loop.id, kind: 'loop-body' }];
			await this.extractStatements(directChildren(body).filter(node => node.name !== ':'));
			this.consumeTail();
			this.loopStack.pop();
			this.pendingEdges = [
				{ sourceNodeId: loop.id, kind: 'loop-exit' },
				...context.breakNodeIds.map(sourceNodeId => ({ sourceNodeId, kind: 'break-exit' as const })),
			];
		}
	}

	private async extractTry(statement: SyntaxNode): Promise<void> {
		const clauses = this.tryClauses(statement);
		const control = this.addNode(
			'try-catch',
			statement,
			undefined,
			undefined,
			clauses.find(clause => clause.kind === 'catch')?.catchBinding,
			clauses.some(clause => clause.kind === 'finally'),
		);
		const exits: PendingEdge[] = [];
		for (const clause of clauses) {
			this.pendingEdges = [{ sourceNodeId: control.id, kind: clause.kind }];
			await this.extractStatements(directChildren(clause.body).filter(node => node.name !== ':'));
			exits.push(...this.consumeTail());
		}
		this.pendingEdges = exits;
	}

	private async extractAssignment(statement: SyntaxNode): Promise<void> {
		const children = directChildren(statement);
		const operator = children.findIndex(child => child.name === 'AssignOp' || child.name === 'UpdateOp');
		for (const child of children.slice(operator >= 0 ? operator + 1 : 0)) {
			await this.extractCalls(child);
		}
	}

	private async extractWith(statement: SyntaxNode): Promise<void> {
		const bodies = directChildren(statement).filter(child => child.name === 'Body');
		const body = bodies[bodies.length - 1];
		for (const child of directChildren(statement).filter(node => node.name !== 'Body' && !['with', ':', ','].includes(node.name))) {
			await this.extractCalls(child);
		}
		if (body) { await this.extractStatements(directChildren(body).filter(node => node.name !== ':')); }
	}

	private async extractTerminal(statement: SyntaxNode, kind: 'return' | 'throw'): Promise<void> {
		await this.extractCalls(statement);
		const node = this.addNode(kind, statement, this.text(statement));
		this.terminalNodeIds.add(node.id);
	}

	private async extractCalls(root: SyntaxNode): Promise<void> {
		if (root.name === 'FunctionDefinition' || root.name === 'LambdaExpression') { return; }
		if (root.name === 'AwaitExpression') {
			for (const child of directChildren(root)) { if (child.name !== 'await') { await this.extractCalls(child); } }
			this.addNode('await', root, this.text(root));
			return;
		}
		if (root.name === 'CallExpression') {
			const children = directChildren(root);
			for (const child of children) { await this.extractCalls(child); }
			const expression = children.find(child => child.name !== 'ArgList');
			const info = this.callInfo(expression, root);
			const call = this.addNode('call', root, info.name, info.resolution, undefined, undefined, info.participant);
			if (info.resolution !== 'resolved') { this.addDiagnostic(info.resolution === 'unknown' ? 'unknown-call' : 'unresolved-call', 'warning', info.message, root, call.id); }
			return;
		}
		for (const child of directChildren(root)) { await this.extractCalls(child); }
	}

	private callInfo(expression: SyntaxNode | undefined, call: SyntaxNode): { readonly name: string; readonly participant: FlowParticipant; readonly resolution: 'resolved' | 'unknown' | 'unresolved'; readonly message: string } {
		if (!expression) { return { name: '<unknown>', participant: fallbackParticipant('unknown'), resolution: 'unknown', message: 'Call target could not be named statically.' }; }
		const text = this.text(expression);
		if (expression.name === 'VariableName') { return { name: text, participant: fallbackParticipant('unknown'), resolution: 'resolved', message: '' }; }
		if (expression.name === 'MemberExpression' && !text.includes('(')) {
			const children = directChildren(expression);
			const property = children[children.length - 1];
			const receiver = children[0];
			const name = property ? this.text(property) : text.split('.').pop() ?? text;
			if (children.some(child => child.name === '[' || child.name === ']')) {
				return { name: '<unknown>', participant: fallbackParticipant('unknown'), resolution: 'unknown', message: 'Computed Python call target could not be named statically.' };
			}
			if (receiver?.name === 'VariableName') {
				return { name, participant: namedParticipant(/^[A-Z]/.test(this.text(receiver)) ? 'class' : 'instance', this.text(receiver)), resolution: 'resolved', message: '' };
			}
			return { name, participant: fallbackParticipant('unresolved'), resolution: 'unresolved', message: `Call target "${name}" has a dynamic receiver and was kept unresolved.` };
		}
		if (text.includes('[') || text.startsWith('getattr')) { return { name: '<unknown>', participant: fallbackParticipant('unknown'), resolution: 'unknown', message: 'Dynamic Python call target could not be named statically.' }; }
		return { name: text || '<unknown>', participant: fallbackParticipant('unresolved'), resolution: 'unresolved', message: `Call target "${text || call.name}" could not be fully resolved statically.` };
	}

	private tryClauses(statement: SyntaxNode): readonly TryClause[] {
		const clauses: TryClause[] = [];
		let kind: TryClause['kind'] = 'try';
		let catchBinding: string | undefined;
		for (const child of directChildren(statement)) {
			if (child.name === 'except') {
				kind = 'catch';
				catchBinding = undefined;
				continue;
			}
			if (child.name === 'finally') {
				kind = 'finally';
				continue;
			}
			if (kind === 'catch' && child.name === 'VariableName') {
				catchBinding = this.text(child);
				continue;
			}
			if (child.name === 'Body') {
				clauses.push({ kind, body: child, catchBinding });
			}
		}
		return clauses;
	}

	private conditionText(statement: SyntaxNode, keyword: string): string {
		const children = directChildren(statement);
		const keywordNode = children.find(child => child.name === keyword);
		const body = children.find(child => child.name === 'Body');
		return keywordNode && body ? this.input.source.text.slice(keywordNode.to, body.from).replace(/:\s*$/, '').trim() : this.text(statement);
	}

	private headerText(statement: SyntaxNode): string {
		const body = firstChildNamed(statement, 'Body');
		return body ? this.input.source.text.slice(statement.from, body.from).replace(/:\s*$/, '').trim() : this.text(statement);
	}

	private addNode(kind: FlowNode['kind'], source: SyntaxNode, expression?: string, resolution?: 'resolved' | 'unknown' | 'unresolved', catchBinding?: string, hasFinally?: boolean, participant?: FlowParticipant): FlowNode {
		const id = `node:${this.nextNode++}`;
		const base = { id, kind, order: this.nodes.length, sourceLocation: this.location(source.from, source.to) } as const;
		let node: FlowNode;
		switch (kind) {
			case 'call': node = { ...base, kind, calleeName: expression ?? '<unknown>', participant, resolution: resolution ?? 'resolved', label: expression }; break;
			case 'branch': node = { ...base, kind, condition: expression }; break;
			case 'loop': node = { ...base, kind, condition: expression }; break;
			case 'await': node = { ...base, kind, expression }; break;
			case 'return': node = { ...base, kind, expression }; break;
			case 'throw': node = { ...base, kind, expression }; break;
			case 'break': node = { ...base, kind }; break;
			case 'continue': node = { ...base, kind }; break;
			case 'expression': node = { ...base, kind, expression: expression ?? '' }; break;
			case 'try-catch': node = { ...base, kind, catchBinding, hasFinally: hasFinally ?? false }; break;
		}
		this.nodes.push(node);
		if (this.pendingEdges.length > 0) {
			for (const edge of this.pendingEdges) { this.addEdge(edge.sourceNodeId, node.id, edge.kind, source); }
			this.pendingEdges = [];
		} else {
			const previous = this.nodes[this.nodes.length - 2];
			if (previous && !this.terminalNodeIds.has(previous.id)) { this.addEdge(previous.id, node.id, 'next', source); }
		}
		return node;
	}

	private addEdge(sourceNodeId: string, targetNodeId: string, kind: FlowEdge['kind'], source: SyntaxNode): void {
		const executionOrder = this.nextEdge++;
		this.edges.push({ id: `edge:${executionOrder}`, sourceNodeId, targetNodeId, kind, executionOrder, sourceLocation: this.location(source.from, source.to) });
	}

	private consumeTail(): PendingEdge[] {
		if (this.pendingEdges.length > 0) { const pending = this.pendingEdges; this.pendingEdges = []; return pending; }
		const last = this.nodes[this.nodes.length - 1];
		return last && !this.terminalNodeIds.has(last.id) ? [{ sourceNodeId: last.id, kind: 'next' }] : [];
	}

	private markPartial(source: SyntaxNode, message: string): void {
		this.completeness = 'partial';
		this.addDiagnostic('unsupported-syntax', 'warning', message, source);
	}

	private addDiagnostic(kind: FlowDiagnostic['kind'], severity: FlowDiagnostic['severity'], message: string, source?: SyntaxNode, nodeId?: string): void {
		this.completeness = 'partial';
		this.diagnostics.push({ id: `diagnostic:${this.nextDiagnostic++}`, kind, severity, message, nodeId, sourceLocation: source ? this.location(source.from, source.to) : undefined });
	}

	private text(node: SyntaxNode): string { return this.input.source.text.slice(node.from, node.to); }

	private location(start: number, end: number, symbolName?: string): SourceLocation {
		const position = (offset: number) => {
			const before = this.input.source.text.slice(0, offset);
			const line = (before.match(/\n/g) ?? []).length;
			const lastNewline = before.lastIndexOf('\n');
			return { line, character: offset - lastNewline - 1 };
		};
		return { uri: this.input.source.uri, range: { start: position(start), end: position(end) }, symbolName };
	}

	private async cooperate(): Promise<void> {
		if (this.input.cancellation.isCancellationRequested) { throw new AnalysisCancelledError(); }
		this.workItems += 1;
		if (this.workItems % 50 === 0) {
			await new Promise<void>(resolve => setImmediate(resolve));
			if (this.input.cancellation.isCancellationRequested) { throw new AnalysisCancelledError(); }
		}
	}
}

interface PendingEdge { readonly sourceNodeId: string; readonly kind: FlowEdge['kind']; }
interface LoopContext { readonly nodeId: string; readonly breakNodeIds: string[]; }
interface TryClause {
	readonly kind: Extract<FlowEdge['kind'], 'try' | 'catch' | 'finally'>;
	readonly body: SyntaxNode;
	readonly catchBinding?: string;
}

class AnalysisCancelledError extends Error {}

function cancelledResult(analyzerId: string, languageId: string): AnalyzerResult {
	return failedResult('analysis-cancelled', 'Analysis was cancelled before completion.', languageId, analyzerId);
}

function failedResult(kind: 'unsupported-language' | 'invalid-input' | 'analysis-cancelled' | 'analysis-failed', message: string, languageId: string, analyzerId: string, cause?: unknown): AnalyzerResult {
	return { status: 'failed', completeness: 'failed', diagnostics: [], error: { kind, message, analyzerId, languageId, cause } };
}
