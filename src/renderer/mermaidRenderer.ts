import type { FlowEdge, FlowModel, FlowNode, SourceLocation } from '../flow-model';

export const rendererWarningKinds = ['unsupported-node', 'unsupported-edge'] as const;

export type RendererWarningKind = typeof rendererWarningKinds[number];

export interface RendererWarning {
	readonly id: string;
	readonly kind: RendererWarningKind;
	readonly message: string;
	readonly nodeId?: string;
	readonly edgeId?: string;
	readonly sourceLocation?: SourceLocation;
}

export interface RenderSourceMapEntry {
	readonly elementId: string;
	readonly nodeId?: string;
	readonly edgeId?: string;
	readonly sourceLocation: SourceLocation;
}

export interface RenderResult {
	readonly mermaidText: string;
	readonly warnings: readonly RendererWarning[];
	readonly sourceMap: readonly RenderSourceMapEntry[];
}

interface Participant {
	readonly id: string;
	readonly label: string;
}

export class MermaidRenderer {
	public render(model: FlowModel): RenderResult {
		const context = new RenderContext(model);
		return context.render();
	}
}

class RenderContext {
	private readonly lines: string[] = ['sequenceDiagram'];
	private readonly participants = new Map<string, Participant>();
	private readonly participantIdsByLabel = new Map<string, string>();
	private readonly nodeParticipants = new Map<string, string>();
	private readonly renderedControlNodeIds = new Set<string>();
	private readonly renderedNodeIds = new Set<string>();
	private readonly renderedEdgeIds = new Set<string>();
	private readonly warnings: RendererWarning[] = [];
	private readonly sourceMap: RenderSourceMapEntry[] = [];
	private nextUnknownParticipant = 1;
	private nextWarning = 0;

	public constructor(private readonly model: FlowModel) {}

	public render(): RenderResult {
		this.addParticipant('root', this.model.rootFunction.name);
		this.prepareParticipants();
		this.renderParticipants();
		this.renderEdges();
		this.renderDiagnostics();
		this.warnUnsupportedNodes();

		return {
			mermaidText: `${this.lines.join('\n')}\n`,
			warnings: this.warnings,
			sourceMap: this.sourceMap,
		};
	}

	private prepareParticipants(): void {
		for (const node of this.orderedNodes()) {
			if (node.kind === 'call') {
				this.nodeParticipants.set(node.id, this.participantForCall(node));
			}
		}
	}

	private renderParticipants(): void {
		for (const participant of this.participants.values()) {
			this.addLine(`participant ${participant.id} as ${escapeText(participant.label)}`);
		}
	}

	private renderEdges(): void {
		for (const edge of this.orderedEdges()) {
			if (this.renderedEdgeIds.has(edge.id)) {
				continue;
			}
			const target = this.nodeById(edge.targetNodeId);
			if (!target) {
				this.addWarning('unsupported-edge', `Edge "${edge.id}" targets a missing FlowNode.`, edge);
				continue;
			}
			if (edge.kind === 'true' || edge.kind === 'false') {
				this.renderBranch(edge);
				continue;
			}
			if (edge.kind === 'loop-body') {
				this.renderLoopBodyEdge(edge);
				continue;
			}
			if (edge.kind === 'try' || edge.kind === 'catch' || edge.kind === 'finally') {
				this.renderTryCatch(edge);
				continue;
			}
			this.renderPath(edge);
		}
	}

	private renderTarget(target: FlowNode, edge: FlowEdge): void {
		if (this.renderedNodeIds.has(target.id)) {
			this.renderedEdgeIds.add(edge.id);
			return;
		}
		if (target.kind === 'call') {
			this.markRendered(target, edge);
			this.renderCall(target, edge);
			return;
		}
		if (target.kind === 'return') {
			this.markRendered(target, edge);
			this.renderReturn(target, edge);
			return;
		}
		if (target.kind === 'await') {
			this.markRendered(target, edge);
			this.addSourceMap(target.sourceLocation, target.id, edge.id);
			return;
		}
		if (target.kind === 'throw') {
			this.markRendered(target, edge);
			this.renderNote(`throw ${target.expression ?? ''}`.trim(), target, edge);
			return;
		}
		if (target.kind === 'break') {
			this.markRendered(target, edge);
			this.renderNote(`break${target.label ? ` ${target.label}` : ''}`, target, edge);
			return;
		}
		if (target.kind === 'continue') {
			this.markRendered(target, edge);
			this.renderNote(`continue${target.label ? ` ${target.label}` : ''}`, target, edge);
			return;
		}
		if (target.kind === 'expression') {
			this.markRendered(target, edge);
			this.renderNote(target.expression, target, edge);
		}
	}

	private renderBranch(edge: FlowEdge, outerBoundary?: FlowNode): void {
		const branch = this.nodeById(edge.sourceNodeId);
		if (!branch || branch.kind !== 'branch') {
			this.addWarning('unsupported-edge', `Branch edge "${edge.id}" does not originate from a branch node.`, edge);
			this.renderPath(edge);
			return;
		}
		if (this.renderedControlNodeIds.has(branch.id)) {
			this.renderedEdgeIds.add(edge.id);
			this.renderedNodeIds.add(branch.id);
			return;
		}
		this.renderedControlNodeIds.add(branch.id);
		this.renderedNodeIds.add(branch.id);
		const trueEdges = this.outgoingEdges(branch.id, ['true']);
		const falseEdges = this.outgoingEdges(branch.id, ['false']);
		const hasFalse = falseEdges.length > 0;
		const firstEdge = trueEdges[0] ?? falseEdges[0] ?? edge;
		const line = this.addLine(hasFalse ? `alt ${escapeText(branch.condition ?? 'true')}` : `opt ${escapeText(branch.condition ?? 'true')}`);
		this.addSourceMap(branch.sourceLocation, branch.id, firstEdge.id, line);
		const exitEdges: FlowEdge[] = [];
		for (const trueEdge of trueEdges) {
			exitEdges.push(...this.renderPath(trueEdge, branch));
		}
		if (hasFalse) {
			const elseLine = this.addLine('else');
			this.addSourceMap(branch.sourceLocation, branch.id, falseEdges[0]?.id, elseLine);
			for (const falseEdge of falseEdges) {
				exitEdges.push(...this.renderPath(falseEdge, branch));
			}
		}
		this.addLine('end');
		this.renderExitEdges(exitEdges, outerBoundary);
	}

	private renderLoop(edge: FlowEdge, outerBoundary?: FlowNode): void {
		const loop = this.nodeById(edge.sourceNodeId);
		if (!loop || loop.kind !== 'loop') {
			this.addWarning('unsupported-edge', `Loop edge "${edge.id}" does not originate from a loop node.`, edge);
			this.renderPath(edge);
			return;
		}
		if (this.renderedControlNodeIds.has(loop.id)) {
			this.renderedEdgeIds.add(edge.id);
			this.renderedNodeIds.add(loop.id);
			return;
		}
		this.renderedControlNodeIds.add(loop.id);
		this.renderedNodeIds.add(loop.id);
		const line = this.addLine(`loop ${escapeText(loop.condition ?? 'loop')}`);
		this.addSourceMap(loop.sourceLocation, loop.id, edge.id, line);
		const exitEdges: FlowEdge[] = [];
		for (const bodyEdge of this.loopBodyEntryEdges(loop.id)) {
			exitEdges.push(...this.renderPath(bodyEdge, loop));
		}
		this.addLine('end');
		this.renderExitEdges(exitEdges, outerBoundary);
	}

	private renderLoopBodyEdge(edge: FlowEdge): void {
		const source = this.nodeById(edge.sourceNodeId);
		const target = this.nodeById(edge.targetNodeId);
		if (source?.kind === 'loop' && target && isWithinBoundary(target, source)) {
			this.renderLoop(edge);
			return;
		}
		this.addWarning('unsupported-edge', `Loop body edge "${edge.id}" does not originate from a loop node with a body target.`, edge);
		this.renderPath(edge);
	}

	private renderTryCatch(edge: FlowEdge, outerBoundary?: FlowNode): void {
		const control = this.nodeById(edge.sourceNodeId);
		if (!control || control.kind !== 'try-catch') {
			this.addWarning('unsupported-edge', `Try/Catch edge "${edge.id}" does not originate from a try-catch node.`, edge);
			this.renderPath(edge);
			return;
		}
		if (this.renderedControlNodeIds.has(control.id)) {
			this.renderedEdgeIds.add(edge.id);
			this.renderedNodeIds.add(control.id);
			return;
		}
		this.renderedControlNodeIds.add(control.id);
		this.renderedNodeIds.add(control.id);
		const tryEdges = this.outgoingEdges(control.id, ['try']);
		const catchEdges = this.outgoingEdges(control.id, ['catch']);
		const finallyEdges = this.outgoingEdges(control.id, ['finally']);
		const line = this.addLine('critical try');
		this.addSourceMap(control.sourceLocation, control.id, tryEdges[0]?.id ?? edge.id, line);
		const exitEdges: FlowEdge[] = [];
		for (const tryEdge of tryEdges) {
			exitEdges.push(...this.renderPath(tryEdge, control));
		}
		if (catchEdges.length > 0) {
			const catchLine = this.addLine(`option catch${control.catchBinding ? ` ${escapeText(control.catchBinding)}` : ''}`);
			this.addSourceMap(control.sourceLocation, control.id, catchEdges[0]?.id, catchLine);
			for (const catchEdge of catchEdges) {
				exitEdges.push(...this.renderPath(catchEdge, control));
			}
		}
		if (finallyEdges.length > 0) {
			const finallyLine = this.addLine('option finally');
			this.addSourceMap(control.sourceLocation, control.id, finallyEdges[0]?.id, finallyLine);
			for (const finallyEdge of finallyEdges) {
				exitEdges.push(...this.renderPath(finallyEdge, control));
			}
		}
		this.addLine('end');
		this.renderExitEdges(exitEdges, outerBoundary);
	}

	private renderPath(edge: FlowEdge, boundary?: FlowNode): readonly FlowEdge[] {
		const target = this.nodeById(edge.targetNodeId);
		if (!target) {
			this.addWarning('unsupported-edge', `Edge "${edge.id}" targets a missing FlowNode.`, edge);
			return [];
		}
		if (edge.kind === 'loop-exit' && this.nodeById(edge.sourceNodeId)?.kind !== 'loop') {
			this.addWarning('unsupported-edge', `Loop exit edge "${edge.id}" does not originate from a loop node.`, edge);
			this.renderedEdgeIds.add(edge.id);
			return [];
		}
		const source = this.nodeById(edge.sourceNodeId);
		if (edge.kind === 'loop-exit' && source?.kind === 'loop' && isWithinBoundary(target, source)) {
			this.addWarning('unsupported-edge', `Loop exit edge "${edge.id}" targets a node inside the loop body.`, edge);
			this.renderedEdgeIds.add(edge.id);
			return [];
		}
		if (boundary && !isWithinBoundary(target, boundary)) {
			return [edge];
		}
		if (target.kind === 'branch' && this.outgoingEdges(target.id, ['true', 'false']).length > 0) {
			this.renderedEdgeIds.add(edge.id);
			this.renderBranch(this.outgoingEdges(target.id, ['true', 'false'])[0], boundary);
		} else if (target.kind === 'loop' && this.outgoingEdges(target.id, ['loop-body']).length > 0) {
			this.renderedEdgeIds.add(edge.id);
			this.renderLoop(this.loopBodyEntryEdges(target.id)[0] ?? this.outgoingEdges(target.id, ['loop-body'])[0], boundary);
		} else if (target.kind === 'try-catch' && this.outgoingEdges(target.id, ['try', 'catch', 'finally']).length > 0) {
			this.renderedEdgeIds.add(edge.id);
			this.renderTryCatch(this.outgoingEdges(target.id, ['try', 'catch', 'finally'])[0], boundary);
		} else {
			this.renderTarget(target, edge);
		}
		if (target.kind === 'return' || target.kind === 'throw' || target.kind === 'break' || target.kind === 'continue') {
			return [];
		}
		const exitEdges: FlowEdge[] = [];
		for (const nextEdge of this.outgoingEdges(target.id, ['next', 'loop-exit', 'return', 'throw', 'uncertain'])) {
			if (this.renderedEdgeIds.has(nextEdge.id)) {
				continue;
			}
			exitEdges.push(...this.renderPath(nextEdge, boundary));
		}
		return exitEdges;
	}

	private renderExitEdges(edges: readonly FlowEdge[], boundary?: FlowNode): void {
		const seen = new Set<string>();
		for (const edge of edges) {
			if (seen.has(edge.id) || this.renderedEdgeIds.has(edge.id)) {
				continue;
			}
			seen.add(edge.id);
			this.renderPath(edge, boundary);
		}
	}

	private renderCall(node: Extract<FlowNode, { kind: 'call' }>, edge: FlowEdge): void {
		const participantId = this.nodeParticipants.get(node.id) ?? this.participantForCall(node);
		if (edge.kind === 'uncertain') {
			const uncertainLine = this.addLine(`Note over root,${participantId}: order uncertain`);
			this.addSourceMap(edge.sourceLocation ?? node.sourceLocation, node.id, edge.id, uncertainLine);
		}
		const awaitPrefix = this.isAwaitedCall(edge) ? 'await ' : '';
		const resolutionSuffix = node.resolution === 'unresolved' ? ' (unresolved)' : '';
		const message = node.resolution === 'unknown' ? 'unknown call' : `${awaitPrefix}${node.calleeName}${resolutionSuffix}`;
		const line = this.addLine(`root->>${participantId}: ${escapeText(message)}`);
		this.addSourceMap(node.sourceLocation, node.id, edge.id, line);

		if (node.resolution === 'unknown' || node.resolution === 'unresolved') {
			const note = node.resolution === 'unknown' ? 'unknown call' : 'unresolved call';
			const noteLine = this.addLine(`Note over root,${participantId}: ${note}`);
			this.addSourceMap(node.sourceLocation, node.id, edge.id, noteLine);
		}
	}

	private renderReturn(node: Extract<FlowNode, { kind: 'return' }>, edge: FlowEdge): void {
		const sourceParticipant = this.nodeParticipants.get(edge.sourceNodeId) ?? 'root';
		const message = `return ${node.expression ?? ''}`.trim();
		const line = this.addLine(`${sourceParticipant}-->>root: ${escapeText(message)}`);
		this.addSourceMap(node.sourceLocation, node.id, edge.id, line);
	}

	private renderNote(message: string, node: FlowNode, edge: FlowEdge): void {
		const line = this.addLine(`Note over root: ${escapeText(message)}`);
		this.addSourceMap(node.sourceLocation, node.id, edge.id, line);
	}

	private renderDiagnostics(): void {
		for (const diagnostic of this.model.diagnostics) {
			if (diagnostic.kind !== 'order-uncertain' || !diagnostic.sourceLocation) {
				continue;
			}
			const line = this.addLine(`Note over root: ${escapeText(diagnostic.message)}`);
			this.addSourceMap(diagnostic.sourceLocation, diagnostic.nodeId, diagnostic.edgeId, line, `diagnostic:${diagnostic.id}`);
		}
	}

	private warnUnsupportedNodes(): void {
		for (const node of this.orderedNodes()) {
			if ((node.kind === 'branch' || node.kind === 'loop' || node.kind === 'try-catch') && !this.renderedControlNodeIds.has(node.id) && !this.renderedNodeIds.has(node.id)) {
				this.addWarning('unsupported-node', `FlowNode kind "${node.kind}" is not rendered with advanced Mermaid syntax in this renderer task.`, undefined, node);
			}
		}
	}

	private participantForCall(node: Extract<FlowNode, { kind: 'call' }>): string {
		if (node.resolution === 'unknown') {
			const id = `unknown_${this.nextUnknownParticipant++}`;
			this.addParticipant(id, 'Unknown');
			return id;
		}
		const existing = this.participantIdsByLabel.get(node.calleeName);
		if (existing) {
			return existing;
		}
		const id = uniqueParticipantId(sanitizeIdentifier(node.calleeName), this.participants);
		this.addParticipant(id, node.calleeName);
		this.participantIdsByLabel.set(node.calleeName, id);
		return id;
	}

	private addParticipant(id: string, label: string): void {
		if (!this.participants.has(id)) {
			this.participants.set(id, { id, label });
		}
	}

	private addLine(line: string): number {
		this.lines.push(line);
		return this.lines.length;
	}

	private addSourceMap(sourceLocation: SourceLocation, nodeId?: string, edgeId?: string, lineNumber?: number, elementId?: string): void {
		const line = lineNumber ?? this.lines.length;
		this.sourceMap.push({
			elementId: elementId ?? `line:${line}`,
			nodeId,
			edgeId,
			sourceLocation,
		});
	}

	private addWarning(kind: RendererWarningKind, message: string, edge?: FlowEdge, node?: FlowNode): void {
		this.warnings.push({
			id: `warning:${this.nextWarning++}`,
			kind,
			message,
			nodeId: node?.id,
			edgeId: edge?.id,
			sourceLocation: node?.sourceLocation ?? edge?.sourceLocation,
		});
	}

	private markRendered(node: FlowNode, edge: FlowEdge): void {
		this.renderedEdgeIds.add(edge.id);
		this.renderedNodeIds.add(node.id);
	}

	private isAwaitedCall(edge: FlowEdge): boolean {
		return this.nodeById(edge.sourceNodeId)?.kind === 'await';
	}

	private orderedNodes(): readonly FlowNode[] {
		return [...this.model.nodes].sort((left, right) => left.order - right.order);
	}

	private orderedEdges(): readonly FlowEdge[] {
		return [...this.model.edges].sort((left, right) => left.executionOrder - right.executionOrder);
	}

	private nodeById(id: string): FlowNode | undefined {
		return this.model.nodes.find(node => node.id === id);
	}

	private outgoingEdges(sourceNodeId: string, kinds: readonly FlowEdge['kind'][]): readonly FlowEdge[] {
		return this.orderedEdges().filter(edge => edge.sourceNodeId === sourceNodeId && kinds.includes(edge.kind));
	}

	private loopBodyEntryEdges(loopNodeId: string): readonly FlowEdge[] {
		const loop = this.nodeById(loopNodeId);
		if (!loop) {
			return [];
		}
		return this.outgoingEdges(loopNodeId, ['loop-body']).filter(edge => {
			const target = this.nodeById(edge.targetNodeId);
			return target !== undefined && isWithinBoundary(target, loop);
		});
	}
}

function isWithinBoundary(node: FlowNode, boundary: FlowNode): boolean {
	if (node.id === boundary.id) {
		return false;
	}
	const nodeStart = node.sourceLocation.range.start.line;
	const nodeEnd = node.sourceLocation.range.end.line;
	const boundaryStart = boundary.sourceLocation.range.start.line;
	const boundaryEnd = boundary.sourceLocation.range.end.line;
	if (boundaryEnd > boundaryStart) {
		return nodeStart >= boundaryStart && nodeEnd <= boundaryEnd;
	}
	return node.order > boundary.order;
}

function sanitizeIdentifier(value: string): string {
	const sanitized = value.replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z_]+/, '');
	return sanitized.length > 0 ? sanitized : 'participant';
}

function uniqueParticipantId(base: string, participants: ReadonlyMap<string, Participant>): string {
	if (!participants.has(base)) {
		return base;
	}
	let index = 2;
	while (participants.has(`${base}_${index}`)) {
		index += 1;
	}
	return `${base}_${index}`;
}

function escapeText(value: string): string {
	return value.replace(/\s+/g, ' ').replace(/:/g, '&#58;').trim();
}
