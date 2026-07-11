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
			const target = this.nodeById(edge.targetNodeId);
			if (!target) {
				this.addWarning('unsupported-edge', `Edge "${edge.id}" targets a missing FlowNode.`, edge);
				continue;
			}
			if (edge.kind === 'true' || edge.kind === 'false') {
				this.renderBranchEdge(edge, target);
				continue;
			}
			if (edge.kind === 'loop-body') {
				this.renderLoopEdge(edge, target);
				continue;
			}
			if (edge.kind === 'try' || edge.kind === 'catch' || edge.kind === 'finally') {
				this.renderTryCatchEdge(edge, target);
				continue;
			}
			this.renderTarget(target, edge);
		}
	}

	private renderTarget(target: FlowNode, edge: FlowEdge): void {
		if (target.kind === 'call') {
			this.renderCall(target, edge);
			return;
		}
		if (target.kind === 'return') {
			this.renderReturn(target, edge);
			return;
		}
		if (target.kind === 'await') {
			this.addSourceMap(target.sourceLocation, target.id, edge.id);
			return;
		}
		if (target.kind === 'throw') {
			this.renderNote(`throw ${target.expression ?? ''}`.trim(), target, edge);
		}
	}

	private renderBranchEdge(edge: FlowEdge, target: FlowNode): void {
		const branch = this.nodeById(edge.sourceNodeId);
		if (!branch || branch.kind !== 'branch') {
			this.addWarning('unsupported-edge', `Branch edge "${edge.id}" does not originate from a branch node.`, edge);
			this.renderTarget(target, edge);
			return;
		}
		this.renderedControlNodeIds.add(branch.id);
		if (edge.kind === 'true') {
			const line = this.addLine(this.hasSiblingEdge(branch.id, 'false') ? `alt ${escapeText(branch.condition ?? 'true')}` : `opt ${escapeText(branch.condition ?? 'true')}`);
			this.addSourceMap(branch.sourceLocation, branch.id, edge.id, line);
			this.renderTarget(target, edge);
			if (!this.hasSiblingEdge(branch.id, 'false')) {
				this.addLine('end');
			}
			return;
		}

		const line = this.addLine(`else ${escapeText(branch.condition ?? 'else')}`);
		this.addSourceMap(branch.sourceLocation, branch.id, edge.id, line);
		this.renderTarget(target, edge);
		this.addLine('end');
	}

	private renderLoopEdge(edge: FlowEdge, target: FlowNode): void {
		const loop = this.nodeById(edge.sourceNodeId);
		if (!loop || loop.kind !== 'loop') {
			this.addWarning('unsupported-edge', `Loop edge "${edge.id}" does not originate from a loop node.`, edge);
			this.renderTarget(target, edge);
			return;
		}
		this.renderedControlNodeIds.add(loop.id);
		const line = this.addLine(`loop ${escapeText(loop.condition ?? 'loop')}`);
		this.addSourceMap(loop.sourceLocation, loop.id, edge.id, line);
		this.renderTarget(target, edge);
		this.addLine('end');
	}

	private renderTryCatchEdge(edge: FlowEdge, target: FlowNode): void {
		const control = this.nodeById(edge.sourceNodeId);
		if (!control || control.kind !== 'try-catch') {
			this.addWarning('unsupported-edge', `Try/Catch edge "${edge.id}" does not originate from a try-catch node.`, edge);
			this.renderTarget(target, edge);
			return;
		}
		this.renderedControlNodeIds.add(control.id);
		if (edge.kind === 'try') {
			const line = this.addLine('critical try');
			this.addSourceMap(control.sourceLocation, control.id, edge.id, line);
			this.renderTarget(target, edge);
			if (!this.hasAnySiblingEdge(control.id, ['catch', 'finally'])) {
				this.addLine('end');
			}
			return;
		}
		if (edge.kind === 'catch') {
			const line = this.addLine(`option catch${control.catchBinding ? ` ${escapeText(control.catchBinding)}` : ''}`);
			this.addSourceMap(control.sourceLocation, control.id, edge.id, line);
			this.renderTarget(target, edge);
			if (!this.hasSiblingEdge(control.id, 'finally')) {
				this.addLine('end');
			}
			return;
		}

		const line = this.addLine('option finally');
		this.addSourceMap(control.sourceLocation, control.id, edge.id, line);
		this.renderTarget(target, edge);
		this.addLine('end');
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
			if ((node.kind === 'branch' || node.kind === 'loop' || node.kind === 'try-catch') && !this.renderedControlNodeIds.has(node.id)) {
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

	private hasSiblingEdge(sourceNodeId: string, kind: FlowEdge['kind']): boolean {
		return this.model.edges.some(edge => edge.sourceNodeId === sourceNodeId && edge.kind === kind);
	}

	private hasAnySiblingEdge(sourceNodeId: string, kinds: readonly FlowEdge['kind'][]): boolean {
		return this.model.edges.some(edge => edge.sourceNodeId === sourceNodeId && kinds.includes(edge.kind));
	}
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
