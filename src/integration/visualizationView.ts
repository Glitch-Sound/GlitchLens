import * as fs from 'fs';
import * as path from 'path';

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
	const payload = JSON.stringify({ ...model, viewId, cspNonce: nonce }).replace(/</g, '\\u003c');
	const diagramMarkup = model.renderMode === 'mermaid' ? '<div class="mermaid-render-target" aria-label="Mermaid sequence diagram"></div>' : '';
	const webviewScript = readWebviewMermaidScript();
	const styles = [
		'body{font-family:var(--vscode-font-family);padding:16px;color:var(--vscode-foreground);}',
		'pre{white-space:pre-wrap;border:1px solid var(--vscode-panel-border);padding:8px;overflow:auto;}',
		'#diagram{overflow:auto;}',
		'#zoom-controls{display:flex;align-items:center;gap:6px;margin:8px 0;}',
		'#zoom-controls button{padding:3px 8px;}',
		'#zoom-level{min-width:48px;text-align:center;font-variant-numeric:tabular-nums;}',
		'#diagram-viewer{transform:translate(var(--glitchlens-translate-x,0px),var(--glitchlens-translate-y,0px)) scale(var(--glitchlens-zoom,1));transform-origin:top left;touch-action:pan-y;user-select:none;}',
		'#diagram svg{max-width:100%;width:100%;height:auto;display:block;border:1px solid var(--vscode-panel-border);background:var(--vscode-editor-background);}',
		'.mermaid-render-target{min-height:160px;border:1px solid var(--vscode-panel-border);background:var(--vscode-editor-background);}',
		'.notice{margin:4px 0;padding:4px 0;}',
		'.diagram-fallback{margin-top:12px;}',
		'#diagram svg .actor-line{stroke:#f4f7fb!important;stroke-width:1.25px!important;opacity:0.82!important;}',
		'#diagram svg .actor{stroke:#b8c0cc!important;stroke-width:1.4px!important;fill:#262b33!important;}',
		'#diagram svg .actor-top,#diagram svg .actor-bottom{filter:drop-shadow(0 0 2px rgba(184,192,204,0.35));}',
		'#diagram svg [class*="activation"]{fill:#33506f!important;stroke:#8ecbff!important;stroke-width:1.4px!important;opacity:0.9!important;}',
		'.glitchlens-root-participant :is(rect,path,polygon){stroke:#f8fafc!important;stroke-width:2.2px!important;fill:#303846!important;}',
		'.glitchlens-root-participant text{fill:#f8fafc!important;font-weight:700!important;}',
		'.glitchlens-await-message :is(path,line,polygon,marker path){stroke:#22d3ee!important;fill:#22d3ee!important;}',
		'.glitchlens-await-message text{fill:#a5f3fc!important;font-weight:600!important;}',
		'.glitchlens-return-message :is(path,line,polygon,marker path){stroke:#8b949e!important;fill:#8b949e!important;opacity:0.75!important;}',
		'.glitchlens-return-message text{fill:#aeb6c2!important;font-style:italic!important;}',
	].join('');
	return [
		'<!DOCTYPE html>',
		'<html lang="en">',
		'<head>',
		'<meta charset="UTF-8">',
		`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">`,
		`<style nonce="${nonce}">${styles}</style>`,
		'</head>',
		'<body>',
		`<h1>${escapeHtml(model.rootFunctionName ?? 'GlitchLens')}</h1>`,
		`<p>${escapeHtml(model.state)}</p>`,
		`<button id="copy-mermaid" type="button"${canCopy ? '' : ' disabled'}>Copy Mermaid</button>`,
		'<div id="zoom-controls" role="toolbar" aria-label="Diagram zoom controls">',
		'<button id="zoom-reset" type="button" title="Reset to 100%">100%</button>',
		'<button id="zoom-fit" type="button" title="Fit diagram">Fit</button>',
		'<button id="zoom-out" type="button" title="Zoom out" aria-label="Zoom out">−</button>',
		'<span id="zoom-level" aria-live="polite">100%</span>',
		'<button id="zoom-in" type="button" title="Zoom in" aria-label="Zoom in">+</button>',
		'</div>',
		`<div id="diagram-viewer" class="diagram-viewer"><section id="diagram" data-render-mode="${escapeHtml(model.renderMode)}">${diagramMarkup || `<pre>${escapeHtml(model.fallbackText)}</pre>`}</section></div>`,
		`<details class="diagram-fallback"><summary>Mermaid text</summary><pre>${escapeHtml(model.mermaidText ?? model.fallbackText)}</pre></details>`,
		'<section>',
		...model.notices.map(notice => `<div class="notice" data-kind="${escapeHtml(notice.kind)}">${escapeHtml(notice.message)}</div>`),
		'</section>',
		`<script nonce="${nonce}">const GLITCHLENS_VIEW_MODEL=${payload};const vscode=acquireVsCodeApi();const INITIAL_ZOOM=1;const FIT_ZOOM=1;const MIN_ZOOM=0.5;const MAX_ZOOM=3;const ZOOM_STEP=0.25;const MAX_TRANSLATE=100000;let currentScale=INITIAL_ZOOM;let currentTranslateX=0;let currentTranslateY=0;let viewerZoom=currentScale;let panState;function finiteOrZero(value){return Number.isFinite(value)?value:0;}function clampTranslate(value){return Math.max(-MAX_TRANSLATE,Math.min(MAX_TRANSLATE,finiteOrZero(value)));}function updateZoomUi(){const viewer=document.getElementById('diagram-viewer');const level=document.getElementById('zoom-level');if(level)level.textContent=\`${'${Math.round(currentScale*100)}'}%\`;if(viewer){viewer.style.setProperty('--glitchlens-zoom',String(currentScale));viewer.style.setProperty('--glitchlens-translate-x',\`${'${currentTranslateX}'}px\`);viewer.style.setProperty('--glitchlens-translate-y',\`${'${currentTranslateY}'}px\`);}}function setViewerState(scale,translateX,translateY){currentScale=Math.min(MAX_ZOOM,Math.max(MIN_ZOOM,finiteOrZero(scale)));currentTranslateX=clampTranslate(translateX);currentTranslateY=clampTranslate(translateY);updateZoomUi();}function setZoom(value){setViewerState(value,currentTranslateX,currentTranslateY);}function resetViewer(){setViewerState(INITIAL_ZOOM,0,0);}function fitViewer(){setViewerState(FIT_ZOOM,0,0);}function isPanExcludedTarget(target){return target instanceof Element && Boolean(target.closest('button, a, input, textarea, select'));}function stopPan(event){if(!panState||panState.pointerId!==event.pointerId)return;panState=undefined;document.body.style.removeProperty('user-select');if(event.currentTarget.hasPointerCapture?.(event.pointerId)){event.currentTarget.releasePointerCapture(event.pointerId);}}const viewer=document.getElementById('diagram-viewer');viewer?.addEventListener('pointerdown',event=>{if(event.button!==0||isPanExcludedTarget(event.target)||!event.isPrimary)return;panState={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,originX:currentTranslateX,originY:currentTranslateY};viewer.setPointerCapture(event.pointerId);document.body.style.setProperty('user-select','none');});viewer?.addEventListener('pointermove',event=>{if(!panState||panState.pointerId!==event.pointerId)return;event.preventDefault();setViewerState(currentScale,panState.originX+event.clientX-panState.startX,panState.originY+event.clientY-panState.startY);});viewer?.addEventListener('pointerup',stopPan);viewer?.addEventListener('pointercancel',stopPan);viewer?.addEventListener('lostpointercapture',event=>{if(panState?.pointerId===event.pointerId)stopPan(event);});document.getElementById('zoom-reset')?.addEventListener('click',resetViewer);document.getElementById('zoom-fit')?.addEventListener('click',fitViewer);document.getElementById('zoom-in')?.addEventListener('click',()=>setZoom(currentScale+ZOOM_STEP));document.getElementById('zoom-out')?.addEventListener('click',()=>setZoom(currentScale-ZOOM_STEP));document.getElementById('copy-mermaid')?.addEventListener('click',()=>{vscode.postMessage({type:'copyMermaid',viewId:GLITCHLENS_VIEW_MODEL.viewId});});updateZoomUi();window.addEventListener('error',()=>{document.body.dataset.render='fallback';});</script>`,
		webviewScript ? `<script nonce="${nonce}">${webviewScript}</script>` : `<script nonce="${nonce}">document.body.dataset.render='fallback';</script>`,
		'</body>',
		'</html>',
	].join('');
}

function canCopyMermaid(model: VisualizationViewModel): boolean {
	return model.canCopyMermaid && typeof model.mermaidText === 'string' && model.mermaidText.length > 0;
}

function readWebviewMermaidScript(): string {
	try {
		return fs.readFileSync(path.join(__dirname, 'webviewMermaid.js'), 'utf8');
	} catch {
		return '';
	}
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
