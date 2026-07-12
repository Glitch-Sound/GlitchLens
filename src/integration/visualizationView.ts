import type { VisualizationNotice, VisualizationResult } from '../application';
import { createWorkspaceTrustGuard, type WorkspaceTrustGuard } from './workspaceTrustPolicy';

export type VisualizationWorkspaceTrustGuardProvider = () => Pick<WorkspaceTrustGuard, 'canShowVisualization' | 'canWriteClipboard' | 'visualizationRestrictedMessage'>;

export type VisualizationViewState = 'loading' | 'success' | 'partial' | 'failure';

export interface VisualizationViewModel {
	readonly state: VisualizationViewState;
	readonly rootFunctionName?: string;
	readonly mermaidText?: string;
	readonly fallbackText: string;
	readonly renderMode: 'mermaid' | 'fallback';
	readonly canCopyMermaid: boolean;
	readonly notices: readonly VisualizationViewNotice[];
	readonly sourceMap: readonly VisualizationSourceMapEntry[];
}

export interface VisualizationViewNotice {
	readonly id: string;
	readonly kind: VisualizationNotice['kind'];
	readonly severity: VisualizationNotice['severity'];
	readonly message: string;
	readonly sourceLocation?: VisualizationSourceLocation;
}

export interface VisualizationSourceMapEntry {
	readonly elementId: string;
	readonly nodeId?: string;
	readonly edgeId?: string;
	readonly sourceLocation: VisualizationSourceLocation;
}

export interface VisualizationSourceLocation {
	readonly uri: string;
	readonly range: {
		readonly start: {
			readonly line: number;
			readonly character: number;
		};
		readonly end: {
			readonly line: number;
			readonly character: number;
		};
	};
}

export interface VisualizationView {
	show(model: VisualizationViewModel): Promise<void>;
}

export interface DisposableLike {
	dispose(): void;
}

export interface ClipboardAdapter {
	writeText(text: string): Promise<void>;
}

export interface VisualizationViewNotification {
	showInfo(message: string): Promise<void>;
	showWarning(message: string): Promise<void>;
	showError(message: string): Promise<void>;
}

export interface VisualizationViewObserver {
	didShowVisualization(model: VisualizationViewModel): void;
}

export interface VisualizationViewModelOptions {
	readonly forceFallback?: boolean;
}

export interface WebviewPanelPort {
	readonly webview: {
		html: string;
	};
	reveal(): void;
	dispose(): void;
	onDidDispose(listener: () => void): DisposableLike;
	onDidReceiveMessage(listener: (message: unknown) => void): DisposableLike;
}

export interface WebviewPanelFactory {
	createPanel(options: {
		readonly enableScripts: boolean;
		readonly localResourceRoots: readonly string[];
	}): WebviewPanelPort;
}

export interface AllowedWebviewMessage {
	readonly type: 'ready' | 'sourceMapSelected' | 'copyMermaid';
	readonly elementId?: string;
	readonly viewId?: string;
}

export class WebviewVisualizationAdapter implements VisualizationView, DisposableLike {
	private panel: WebviewPanelPort | undefined;
	private currentViewId: string | undefined;
	private currentMermaidText: string | undefined;
	private readonly panelDisposables: DisposableLike[] = [];
	private readonly messageHandlers: Array<(message: AllowedWebviewMessage) => void> = [];

	public constructor(
		private readonly factory: WebviewPanelFactory,
		private readonly clipboard: ClipboardAdapter,
		private readonly notifications: VisualizationViewNotification,
		private readonly trustGuard: VisualizationWorkspaceTrustGuardProvider = () => createWorkspaceTrustGuard({ isTrusted: true }),
		private readonly observer?: VisualizationViewObserver,
	) {}

	public async show(model: VisualizationViewModel): Promise<void> {
		const trustGuard = this.trustGuard();
		if (!trustGuard.canShowVisualization) {
			this.currentViewId = undefined;
			this.currentMermaidText = undefined;
			await this.notifications.showWarning(trustGuard.visualizationRestrictedMessage);
			return;
		}
		const panel = this.panel ?? this.createPanel();
		const viewId = createViewId();
		this.currentViewId = viewId;
		this.currentMermaidText = canCopyMermaid(model) ? model.mermaidText : undefined;
		panel.webview.html = renderHtml(model, createNonce(), viewId);
		this.observer?.didShowVisualization(model);
		panel.reveal();
	}

	public onDidReceiveAllowedMessage(handler: (message: AllowedWebviewMessage) => void): void {
		this.messageHandlers.push(handler);
	}

	public dispose(): void {
		const panel = this.panel;
		this.clearPanelState();
		panel?.dispose();
	}

	public copyCurrentMermaidForTest(): Promise<void> {
		return this.copyCurrentMermaid({
			type: 'copyMermaid',
			viewId: this.currentViewId,
		});
	}

	private createPanel(): WebviewPanelPort {
		const panel = this.factory.createPanel({
			enableScripts: true,
			localResourceRoots: [],
		});
		this.panel = panel;
		this.panelDisposables.push(panel.onDidDispose(() => {
			if (this.panel === panel) {
				this.clearPanelState();
			}
		}));
		this.panelDisposables.push(panel.onDidReceiveMessage(message => {
			const allowed = parseAllowedMessage(message);
			if (!allowed) {
				return;
			}
			for (const handler of this.messageHandlers) {
				handler(allowed);
			}
			if (allowed.type === 'copyMermaid') {
				void this.copyCurrentMermaid(allowed);
			}
		}));
		return panel;
	}

	private clearPanelState(): void {
		for (const disposable of this.panelDisposables.splice(0)) {
			disposable.dispose();
		}
		this.panel = undefined;
		this.currentViewId = undefined;
		this.currentMermaidText = undefined;
	}

	private async copyCurrentMermaid(message: AllowedWebviewMessage): Promise<void> {
		const trustGuard = this.trustGuard();
		if (!trustGuard.canWriteClipboard) {
			await this.notifications.showWarning(trustGuard.visualizationRestrictedMessage);
			return;
		}
		if (!message.viewId || message.viewId !== this.currentViewId || !this.panel) {
			return;
		}
		const mermaidText = this.currentMermaidText;
		if (!mermaidText) {
			await this.notifications.showWarning('No Mermaid text is available to copy.');
			return;
		}
		try {
			await this.clipboard.writeText(mermaidText);
			await this.notifications.showInfo('Mermaid text copied.');
		} catch {
			await this.notifications.showError('Failed to copy Mermaid text.');
		}
	}
}

export function createVisualizationViewModel(result: VisualizationResult, options: VisualizationViewModelOptions = {}): VisualizationViewModel {
	if (isDisplayableResult(result)) {
		const mermaidText = result.mermaidText;
		return {
			state: result.status,
			rootFunctionName: result.model.rootFunction.name,
			mermaidText,
			fallbackText: mermaidText,
			renderMode: options.forceFallback ? 'fallback' : 'mermaid',
			canCopyMermaid: result.canCopyMermaid,
			notices: result.notices.map(toViewNotice),
			sourceMap: result.sourceMap.map(entry => ({
				elementId: entry.elementId,
				nodeId: entry.nodeId,
				edgeId: entry.edgeId,
				sourceLocation: entry.sourceLocation,
			})),
		};
	}

	return {
		state: 'failure',
		fallbackText: result.error.message,
		renderMode: 'fallback',
		canCopyMermaid: false,
		notices: result.notices.map(toViewNotice),
		sourceMap: [],
	};
}

function isDisplayableResult(result: VisualizationResult): result is Extract<VisualizationResult, { status: 'success' | 'partial' }> {
	return result.status === 'success' || result.status === 'partial';
}

function toViewNotice(notice: VisualizationNotice): VisualizationViewNotice {
	return {
		id: notice.id,
		kind: notice.kind,
		severity: notice.severity,
		message: notice.message,
		sourceLocation: notice.sourceLocation,
	};
}

function renderHtml(model: VisualizationViewModel, nonce: string, viewId: string): string {
	const canCopy = canCopyMermaid(model);
	const payload = JSON.stringify({ ...model, viewId }).replace(/</g, '\\u003c');
	const diagramMarkup = model.renderMode === 'mermaid' ? renderSequenceDiagram(model.mermaidText ?? '') : '';
	return [
		'<!DOCTYPE html>',
		'<html lang="en">',
		'<head>',
		'<meta charset="UTF-8">',
		`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">`,
		`<style nonce="${nonce}">body{font-family:var(--vscode-font-family);padding:16px;color:var(--vscode-foreground);}pre{white-space:pre-wrap;border:1px solid var(--vscode-panel-border);padding:8px;overflow:auto;}svg{max-width:100%;height:auto;border:1px solid var(--vscode-panel-border);background:var(--vscode-editor-background);} .notice{margin:4px 0;padding:4px 0;} .diagram-fallback{margin-top:12px;} .source-map{margin-top:12px;} .source-map li{margin:3px 0;}</style>`,
		'</head>',
		'<body>',
		`<h1>${escapeHtml(model.rootFunctionName ?? 'GlitchLens')}</h1>`,
		`<p>${escapeHtml(model.state)}</p>`,
		`<button id="copy-mermaid" type="button"${canCopy ? '' : ' disabled'}>Copy Mermaid</button>`,
		`<section id="diagram" data-render-mode="${escapeHtml(model.renderMode)}">${diagramMarkup || `<pre>${escapeHtml(model.fallbackText)}</pre>`}</section>`,
		`<details class="diagram-fallback"><summary>Mermaid text</summary><pre>${escapeHtml(model.mermaidText ?? model.fallbackText)}</pre></details>`,
		'<section>',
		...model.notices.map(notice => `<div class="notice" data-kind="${escapeHtml(notice.kind)}">${escapeHtml(notice.message)}</div>`),
		'</section>',
		renderSourceMap(model.sourceMap),
		`<script nonce="${nonce}">const GLITCHLENS_VIEW_MODEL=${payload};const vscode=acquireVsCodeApi();document.getElementById('copy-mermaid')?.addEventListener('click',()=>{vscode.postMessage({type:'copyMermaid',viewId:GLITCHLENS_VIEW_MODEL.viewId});});window.addEventListener('error',()=>{document.body.dataset.render='fallback';});</script>`,
		'</body>',
		'</html>',
	].join('');
}

function canCopyMermaid(model: VisualizationViewModel): boolean {
	return model.canCopyMermaid && typeof model.mermaidText === 'string' && model.mermaidText.length > 0;
}

function renderSequenceDiagram(mermaidText: string): string {
	const messages = parseMermaidMessages(mermaidText);
	if (messages.length === 0) {
		return '';
	}
	const participantNames = unique(messages.flatMap(message => [message.from, message.to]));
	const width = Math.max(420, participantNames.length * 180);
	const height = 120 + messages.length * 64;
	const xByName = new Map(participantNames.map((name, index) => [name, 90 + index * 180]));
	const parts: string[] = [
		`<svg role="img" aria-label="Mermaid sequence diagram" viewBox="0 0 ${width} ${height}">`,
		'<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="currentColor"/></marker></defs>',
	];
	for (const name of participantNames) {
		const x = xByName.get(name) ?? 90;
		parts.push(`<rect x="${x - 58}" y="16" width="116" height="32" rx="4" fill="transparent" stroke="currentColor"/>`);
		parts.push(`<text x="${x}" y="37" text-anchor="middle" fill="currentColor">${escapeHtml(name)}</text>`);
		parts.push(`<line x1="${x}" y1="52" x2="${x}" y2="${height - 28}" stroke="currentColor" stroke-dasharray="4 4" opacity="0.45"/>`);
	}
	messages.forEach((message, index) => {
		const y = 86 + index * 64;
		const fromX = xByName.get(message.from) ?? 90;
		const toX = xByName.get(message.to) ?? fromX;
		const textX = (fromX + toX) / 2;
		const strokeDash = message.arrow.startsWith('--') ? ' stroke-dasharray="6 4"' : '';
		parts.push(`<line x1="${fromX}" y1="${y}" x2="${toX}" y2="${y}" stroke="currentColor"${strokeDash} marker-end="url(#arrow)"/>`);
		parts.push(`<text x="${textX}" y="${y - 8}" text-anchor="middle" fill="currentColor">${escapeHtml(message.label)}</text>`);
	});
	parts.push('</svg>');
	return parts.join('');
}

function parseMermaidMessages(mermaidText: string): readonly MermaidMessage[] {
	return mermaidText
		.split(/\r?\n/)
		.map(line => line.trim())
		.map(line => line.match(/^(.+?)(-->>|->>|-->|->)(.+?):(.*)$/))
		.filter((match): match is RegExpMatchArray => Boolean(match))
		.map(match => ({
			from: normalizeParticipant(match[1]),
			arrow: match[2] ?? '->>',
			to: normalizeParticipant(match[3]),
			label: (match[4] ?? '').trim(),
		}));
}

interface MermaidMessage {
	readonly from: string;
	readonly arrow: string;
	readonly to: string;
	readonly label: string;
}

function normalizeParticipant(value: string): string {
	return value.trim().replace(/^participant\s+/i, '');
}

function unique(values: readonly string[]): readonly string[] {
	return [...new Set(values.filter(value => value.length > 0))];
}

function renderSourceMap(sourceMap: readonly VisualizationSourceMapEntry[]): string {
	if (sourceMap.length === 0) {
		return '';
	}
	return [
		'<details class="source-map" open>',
		'<summary>Source locations</summary>',
		'<ul>',
		...sourceMap.map(entry => `<li data-element-id="${escapeHtml(entry.elementId)}">${escapeHtml(entry.elementId)}: ${escapeHtml(formatSourceLocation(entry.sourceLocation))}</li>`),
		'</ul>',
		'</details>',
	].join('');
}

function formatSourceLocation(sourceLocation: VisualizationSourceLocation): string {
	const start = sourceLocation.range.start;
	const end = sourceLocation.range.end;
	return `${sourceLocation.uri}:${start.line + 1}:${start.character + 1}-${end.line + 1}:${end.character + 1}`;
}

function parseAllowedMessage(message: unknown): AllowedWebviewMessage | undefined {
	if (!message || typeof message !== 'object') {
		return undefined;
	}
	const record = message as Record<string, unknown>;
	if (record.type === 'ready') {
		return { type: 'ready' };
	}
	if (record.type === 'sourceMapSelected' && typeof record.elementId === 'string') {
		return { type: 'sourceMapSelected', elementId: record.elementId };
	}
	if (record.type === 'copyMermaid' && typeof record.viewId === 'string') {
		return { type: 'copyMermaid', viewId: record.viewId };
	}
	return undefined;
}

function createViewId(): string {
	return `view-${createNonce()}`;
}

function createNonce(): string {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let nonce = '';
	for (let index = 0; index < 32; index += 1) {
		nonce += alphabet[Math.floor(Math.random() * alphabet.length)];
	}
	return nonce;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
