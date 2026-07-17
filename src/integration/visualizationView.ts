import * as fs from 'fs';
import * as path from 'path';

import type { VisualizationNotice, VisualizationResult } from '../application';
import type { ProcessNoteNodeKind } from '../renderer';
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
	readonly processNoteDecorations: readonly VisualizationProcessNoteDecoration[];
}

export interface VisualizationViewNotice {
	readonly id: string;
	readonly kind: VisualizationNotice['kind'];
	readonly severity: VisualizationNotice['severity'];
	readonly message: string;
	readonly nodeId?: string;
	readonly edgeId?: string;
	readonly sourceLocation?: VisualizationSourceLocation;
}

export interface VisualizationSourceMapEntry {
	readonly elementId: string;
	readonly nodeId?: string;
	readonly edgeId?: string;
	readonly sourceLocation: VisualizationSourceLocation;
}

export interface VisualizationProcessNoteDecoration {
	readonly mermaidLine: number;
	readonly nodeKind: ProcessNoteNodeKind;
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
			processNoteDecorations: result.processNoteDecorations.map(decoration => ({
				mermaidLine: decoration.mermaidLine,
				nodeKind: decoration.nodeKind,
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
		processNoteDecorations: [],
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
		nodeId: notice.nodeId,
		edgeId: notice.edgeId,
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
		'#diagram{overflow:visible;}',
		'#diagram-viewer{overflow:auto;max-width:100%;max-height:70vh;}',
		'#diagram-canvas{transform:translate(var(--glitchlens-translate-x,0px),var(--glitchlens-translate-y,0px)) scale(var(--glitchlens-zoom,1));transform-origin:top left;touch-action:none;user-select:none;display:inline-block;}',
		'#zoom-controls{display:flex;align-items:center;gap:12px;margin:8px 0;min-width:0;white-space:nowrap;}',
		'#zoom-controls .zoom-group{display:flex;align-items:center;gap:12px;min-width:0;}',
		'#zoom-controls button{padding:3px 8px;border:1px solid var(--vscode-button-secondaryHoverBackground,var(--vscode-panel-border));border-radius:3px;background:var(--vscode-button-secondaryBackground,var(--vscode-editorWidget-background,#2d2d30));color:var(--vscode-button-secondaryForeground,var(--vscode-foreground,#cccccc));}',
		'#zoom-controls button:hover{background:var(--vscode-button-secondaryHoverBackground,var(--vscode-button-secondaryBackground,#3e3e42));}',
		'#zoom-controls button:focus-visible{outline:1px solid var(--vscode-focusBorder,#3794ff);outline-offset:2px;}',
		'#zoom-controls button:disabled{opacity:.55;cursor:not-allowed;}',
		'#zoom-level{min-width:48px;text-align:center;font-variant-numeric:tabular-nums;color:var(--vscode-foreground,#cccccc);}',
		'#copy-mermaid{background:var(--vscode-button-secondaryBackground,#2d4f73)!important;color:var(--vscode-button-secondaryForeground,var(--vscode-foreground,#cccccc))!important;border-color:var(--vscode-textLink-foreground,#4f86b8)!important;}',
		'#copy-mermaid:hover{background:var(--vscode-button-secondaryHoverBackground,#385f87)!important;}',
		'#diagram svg{max-width:none;width:max-content;height:auto;display:block;border:1px solid var(--vscode-panel-border);background:var(--vscode-editor-background);}',
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
		'#diagram svg text.glitchlens-control-loop,#diagram svg text.glitchlens-control-loop tspan{fill:#9fd0ff!important;}',
		'#diagram svg .glitchlens-control-loop:is(rect,path,line,polygon){stroke:#9fd0ff!important;fill:#202732!important;stroke-width:1.8px!important;stroke-dasharray:none!important;}',
		'#diagram svg text.glitchlens-control-alt,#diagram svg text.glitchlens-control-alt tspan{fill:#8ff2ff!important;}',
		'#diagram svg .glitchlens-control-alt:is(rect,path,line,polygon){stroke:#8ff2ff!important;fill:#202732!important;stroke-width:1.8px!important;stroke-dasharray:none!important;}',
		'#diagram svg text.glitchlens-control-opt,#diagram svg text.glitchlens-control-opt tspan{fill:#fde68a!important;}',
		'#diagram svg .glitchlens-control-opt:is(rect,path,line,polygon){stroke:#fde68a!important;fill:#202732!important;stroke-width:1.8px!important;stroke-dasharray:none!important;}',
		'#diagram svg text.glitchlens-control-critical,#diagram svg text.glitchlens-control-critical tspan{fill:#ddd6fe!important;}',
		'#diagram svg .glitchlens-control-critical:is(rect,path,line,polygon){stroke:#ddd6fe!important;fill:#202732!important;stroke-width:1.8px!important;stroke-dasharray:none!important;}',
		'#diagram svg text.glitchlens-control-option,#diagram svg text.glitchlens-control-option tspan{fill:#fbcfe8!important;}',
		'#diagram svg .glitchlens-control-option:is(rect,path,line,polygon){stroke:#fbcfe8!important;fill:#202732!important;stroke-width:1.8px!important;stroke-dasharray:none!important;}',
		'#diagram svg text.loopText[class*="glitchlens-control-"],#diagram svg text.sectionTitle[class*="glitchlens-control-"]{transform:translateY(-18px)!important;}',
		'#diagram svg g.glitchlens-process-note[data-et="note"]>rect{fill:#303b4d!important;stroke:var(--vscode-editorWidget-border,var(--vscode-panel-border,#6b7280))!important;}',
		'@supports (fill:color-mix(in srgb,black,white)){#diagram svg g.glitchlens-process-note[data-et="note"]>rect{fill:color-mix(in srgb,var(--vscode-editor-background,#1e1e1e) 82%,var(--vscode-textLink-foreground,#4f86b8) 18%)!important;}}',
		'#diagram svg g.glitchlens-process-note[data-et="note"] text,#diagram svg g.glitchlens-process-note[data-et="note"] tspan{fill:var(--vscode-editor-foreground,var(--vscode-foreground,#cccccc))!important;}',
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
		'<div id="zoom-controls" role="toolbar" aria-label="Diagram zoom controls">',
		`<button id="copy-mermaid" type="button"${canCopy ? '' : ' disabled'}>Copy Mermaid</button>`,
		'<div class="zoom-group">',
		'<button id="zoom-reset" type="button" title="Reset to 100%">100%</button>',
		'<button id="zoom-fit" type="button" title="Fit diagram">Fit</button>',
		'<button id="zoom-out" type="button" title="Zoom out" aria-label="Zoom out">−</button>',
		'<span id="zoom-level" aria-live="polite">100%</span>',
		'<button id="zoom-in" type="button" title="Zoom in" aria-label="Zoom in">+</button>',
		'</div>',
		'</div>',
		`<div id="diagram-viewer" class="diagram-viewer"><div id="diagram-canvas" class="diagram-canvas"><section id="diagram" data-render-mode="${escapeHtml(model.renderMode)}">${diagramMarkup || `<pre>${escapeHtml(model.fallbackText)}</pre>`}</section></div></div>`,
		`<details class="diagram-fallback"><summary>Mermaid text</summary><pre>${escapeHtml(model.mermaidText ?? model.fallbackText)}</pre></details>`,
		'<section>',
		...model.notices.map(notice => `<div class="notice" data-kind="${escapeHtml(notice.kind)}">${escapeHtml(notice.message)}</div>`),
		'</section>',
		`<script nonce="${nonce}">const GLITCHLENS_VIEW_MODEL=${payload};const vscode=acquireVsCodeApi();const INITIAL_ZOOM=1;const INITIAL_RENDER_SCALE=0.9;const MIN_ZOOM=0.5;const MAX_ZOOM=3;const ZOOM_STEP=0.25;const MAX_TRANSLATE=100000;let currentUiScale=INITIAL_ZOOM;let currentEffectiveScale=INITIAL_RENDER_SCALE;let initialRenderScale=INITIAL_RENDER_SCALE;let currentTranslateX=0;let currentTranslateY=0;let currentScrollLeft=0;let currentScrollTop=0;let panState;function finiteOrZero(value){return Number.isFinite(value)?value:0;}function clampTranslate(value){return Math.max(-MAX_TRANSLATE,Math.min(MAX_TRANSLATE,finiteOrZero(value)));}function updateZoomUi(){const viewer=document.getElementById('diagram-viewer');const canvas=document.getElementById('diagram-canvas');const level=document.getElementById('zoom-level');if(level)level.textContent=\`${'${Math.round(currentUiScale*100)}'}%\`;currentEffectiveScale=initialRenderScale*currentUiScale;if(canvas){canvas.style.setProperty('--glitchlens-zoom',String(currentEffectiveScale));canvas.style.setProperty('--glitchlens-translate-x',\`${'${currentTranslateX}'}px\`);canvas.style.setProperty('--glitchlens-translate-y',\`${'${currentTranslateY}'}px\`);}if(viewer){currentScrollLeft=viewer.scrollLeft;currentScrollTop=viewer.scrollTop;}}function setViewerState(scale,translateX,translateY,resetScroll=false){currentUiScale=Math.min(MAX_ZOOM,Math.max(MIN_ZOOM,finiteOrZero(scale)));currentTranslateX=clampTranslate(translateX);currentTranslateY=clampTranslate(translateY);if(resetScroll){currentScrollLeft=0;currentScrollTop=0;}updateZoomUi();}function setZoom(value){setViewerState(value,currentTranslateX,currentTranslateY);}function resetViewer(){setViewerState(INITIAL_ZOOM,0,0,true);const viewer=document.getElementById('diagram-viewer');viewer?.scrollTo(0,0);}function fitViewer(){const viewer=document.getElementById('diagram-viewer');const svg=document.querySelector('#diagram svg');if(!viewer||!svg){resetViewer();return;}const viewBox=svg.viewBox?.baseVal;const width=viewBox?.width||svg.getBoundingClientRect().width;const height=viewBox?.height||svg.getBoundingClientRect().height;const availableWidth=Math.max(1,viewer.clientWidth-4);const availableHeight=Math.max(1,viewer.clientHeight-4);const fitScale=Math.min(1,availableWidth/(width*initialRenderScale),availableHeight/(height*initialRenderScale));setViewerState(fitScale,0,0,true);viewer.scrollTo(0,0);}function isPanExcludedTarget(target){return target instanceof Element && Boolean(target.closest('button, a, input, textarea, select'));}function stopPan(event){if(!panState||panState.pointerId!==event.pointerId)return;panState=undefined;document.body.style.removeProperty('user-select');if(event.currentTarget.hasPointerCapture?.(event.pointerId)){event.currentTarget.releasePointerCapture(event.pointerId);}}const viewer=document.getElementById('diagram-viewer');viewer?.addEventListener('scroll',()=>{currentScrollLeft=viewer.scrollLeft;currentScrollTop=viewer.scrollTop;});viewer?.addEventListener('pointerdown',event=>{if(event.button!==0||isPanExcludedTarget(event.target)||!event.isPrimary)return;panState={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,originX:currentTranslateX,originY:currentTranslateY};viewer.setPointerCapture(event.pointerId);document.body.style.setProperty('user-select','none');});viewer?.addEventListener('pointermove',event=>{if(!panState||panState.pointerId!==event.pointerId)return;event.preventDefault();setViewerState(currentUiScale,panState.originX+event.clientX-panState.startX,panState.originY+event.clientY-panState.startY);});viewer?.addEventListener('pointerup',stopPan);viewer?.addEventListener('pointercancel',stopPan);viewer?.addEventListener('lostpointercapture',event=>{if(panState?.pointerId===event.pointerId)stopPan(event);});document.getElementById('zoom-reset')?.addEventListener('click',resetViewer);document.getElementById('zoom-fit')?.addEventListener('click',fitViewer);document.getElementById('zoom-in')?.addEventListener('click',()=>setZoom(currentUiScale+ZOOM_STEP));document.getElementById('zoom-out')?.addEventListener('click',()=>setZoom(currentUiScale-ZOOM_STEP));document.getElementById('copy-mermaid')?.addEventListener('click',()=>{vscode.postMessage({type:'copyMermaid',viewId:GLITCHLENS_VIEW_MODEL.viewId});});updateZoomUi();window.addEventListener('error',()=>{document.body.dataset.render='fallback';});</script>`,
		`<script nonce="${nonce}">const WHEEL_ZOOM_FACTOR=0.0025;let pinchState;const activePointers=new Map();function pointerDistance(pointA,pointB){return Math.hypot(pointA.clientX-pointB.clientX,pointA.clientY-pointB.clientY);}function endPinch(){pinchState=undefined;activePointers.clear();document.body.style.removeProperty('user-select');}viewer?.addEventListener('wheel',event=>{if(isPanExcludedTarget(event.target))return;const delta=finiteOrZero(event.deltaY);if(delta===0)return;const factor=event.ctrlKey||event.metaKey?WHEEL_ZOOM_FACTOR*2:WHEEL_ZOOM_FACTOR;event.preventDefault();setZoom(currentUiScale*(1-delta*factor));},{passive:false});viewer?.addEventListener('pointerdown',event=>{if(isPanExcludedTarget(event.target))return;activePointers.set(event.pointerId,event);if(activePointers.size===2){panState=undefined;const points=[...activePointers.values()];pinchState={startDistance:pointerDistance(points[0],points[1]),startScale:currentUiScale};event.preventDefault();document.body.style.setProperty('user-select','none');}});viewer?.addEventListener('pointermove',event=>{if(activePointers.has(event.pointerId))activePointers.set(event.pointerId,event);if(!pinchState||activePointers.size<2)return;const points=[...activePointers.values()];const distance=pointerDistance(points[0],points[1]);if(pinchState.startDistance>0){event.preventDefault();setZoom(pinchState.startScale*distance/pinchState.startDistance);}});viewer?.addEventListener('pointerup',event=>{activePointers.delete(event.pointerId);if(pinchState)endPinch();});viewer?.addEventListener('pointercancel',event=>{activePointers.delete(event.pointerId);if(pinchState)endPinch();});viewer?.addEventListener('lostpointercapture',event=>{activePointers.delete(event.pointerId);if(pinchState)endPinch();});</script>`,
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
