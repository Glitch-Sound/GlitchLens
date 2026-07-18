import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

import {
	ClipboardAdapter,
	createVisualizationViewModel,
	WebviewVisualizationAdapter,
	type WebviewPanelPort,
	type WebviewPanelFactory,
	type VisualizationViewModel,
	type VisualizationViewNotification,
} from '../integration/visualizationView';
import { createWorkspaceTrustGuard } from '../integration/workspaceTrustPolicy';
import type { VisualizationResult } from '../application';

suite('VisualizationView', () => {
	test('creates success partial and failure view models from plain VisualizationResult', () => {
		const success = createVisualizationViewModel(successResult('success'));
		const partial = createVisualizationViewModel(successResult('partial', {
			notices: [notice('unresolved-call', 'warning', 'Could not resolve call.')],
		}));
		const failure = createVisualizationViewModel(failureResult('render-failed'));

		assert.strictEqual(success.state, 'success');
		assert.strictEqual(success.rootFunctionName, 'sample');
		assert.strictEqual(success.mermaidText, 'sequenceDiagram\nroot->>load: load\n');
		assert.strictEqual(success.renderMode, 'mermaid');
		assert.strictEqual(partial.state, 'partial');
		assert.strictEqual(partial.notices[0].kind, 'unresolved-call');
		assert.strictEqual(failure.state, 'failure');
		assert.strictEqual(failure.canCopyMermaid, false);
		assert.ok(!JSON.stringify(success).includes('function sample()'));
		assertNoForbiddenModelObjects(success);
	});

	test('preserves diagnostic and renderer warning source identifiers in the view model', () => {
		const model = createVisualizationViewModel(successResult('partial', {
			notices: [
				noticeWithLocation('order-uncertain', 'warning', 'Execution order is uncertain.', 'node:branch', 'edge:uncertain'),
				noticeWithLocation('renderer-warning', 'warning', 'Edge could not be rendered.', undefined, 'edge:unsupported'),
			],
		}));

		assert.deepStrictEqual(model.notices.map(item => ({ kind: item.kind, nodeId: item.nodeId, edgeId: item.edgeId })), [
			{ kind: 'order-uncertain', nodeId: 'node:branch', edgeId: 'edge:uncertain' },
			{ kind: 'renderer-warning', nodeId: undefined, edgeId: 'edge:unsupported' },
		]);
	});

	test('preserves Mermaid text, SourceMap, process order, and partial notices for integration display', () => {
		const mermaidText = 'sequenceDiagram\nparticipant root as self\nroot->>service: load\nNote over root: break\n';
		const model = createVisualizationViewModel(successResult('partial', {
			mermaidText,
			sourceMap: [{ elementId: 'line:3', nodeId: 'node:load', edgeId: 'edge:load', sourceLocation: testSourceLocation() }],
			processNoteDecorations: [{ mermaidLine: 4, nodeKind: 'break' }],
			notices: [notice('order-uncertain', 'warning', 'Execution order is uncertain.')],
		}));

		assert.strictEqual(model.state, 'partial');
		assert.strictEqual(model.mermaidText, mermaidText);
		assert.strictEqual(model.fallbackText, mermaidText);
		assert.deepStrictEqual(model.sourceMap[0], {
			elementId: 'line:3', nodeId: 'node:load', edgeId: 'edge:load', sourceLocation: testSourceLocation(),
		});
		assert.deepStrictEqual(model.processNoteDecorations, [{ mermaidLine: 4, nodeKind: 'break' }]);
		assert.strictEqual(model.notices[0].kind, 'order-uncertain');
	});

	test('uses fallback mode when Mermaid text is absent or render fallback is requested', () => {
		const failedMermaid = createVisualizationViewModel(successResult('success'), { forceFallback: true });
		const failure = createVisualizationViewModel(failureResult('failed'));

		assert.strictEqual(failedMermaid.renderMode, 'fallback');
		assert.ok(failedMermaid.fallbackText.includes('sequenceDiagram'));
		assert.strictEqual(failure.renderMode, 'fallback');
		assert.ok(failure.notices.some(item => item.kind === 'analysis-failed'));
	});

	test('renders Webview HTML with strict CSP nonce no external URLs and escaped content', async () => {
		const factory = new StubPanelFactory();
		const adapter = new WebviewVisualizationAdapter(factory, new StubClipboard(), new StubNotification());
		const model = createVisualizationViewModel(successResult('partial', {
			mermaidText: 'sequenceDiagram\nroot->>load: <script>alert(1)</script>\n',
			notices: [notice('unknown-call', 'warning', '<b>unknown</b>')],
		}));

		await adapter.show(model);

		const html = factory.panel.webview.html;
		assert.ok(html.includes("default-src 'none'"));
		assert.ok(/script-src 'nonce-[A-Za-z0-9]+'/.test(html));
		assert.ok(html.includes('style-src'));
		assert.ok(html.includes('class="mermaid-render-target" aria-label="Mermaid sequence diagram"'));
		assert.ok(html.includes('Copy Mermaid'));
		assert.ok(html.includes('<details class="diagram-fallback">'));
		assert.ok(html.includes('id="zoom-controls"'));
		assert.ok(html.includes('#zoom-controls{display:flex;align-items:center;gap:12px'));
		assert.ok(html.includes('#zoom-controls .zoom-group{display:flex;align-items:center;gap:12px'));
		assert.ok(html.includes('id="diagram-viewer" class="diagram-viewer"'));
		assert.ok(html.includes('id="diagram-canvas" class="diagram-canvas"'));
		assert.ok(html.includes('id="diagram"'));
		assert.ok(html.includes('id="zoom-reset"'));
		assert.ok(html.includes('id="zoom-fit"'));
		assert.ok(html.includes('id="zoom-in"'));
		assert.ok(html.includes('id="zoom-out"'));
		assert.ok(html.includes('id="zoom-level"'));
		assert.ok(!html.includes('<details class="source-map" open>'));
		assert.ok(!html.includes('Source locations'));
		assert.ok(!html.includes('line:1: file:///workspace/source.ts:2:3-2:9'));
		assert.ok(!html.includes('.source-map'));
		assert.ok(html.includes('"sourceMap":[{"elementId":"line:1"'));
		assertNoExternalResourceReferences(html);
		assert.ok(!html.includes('<script>alert(1)</script>'));
		assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
		assert.ok(html.includes('&lt;b&gt;unknown&lt;/b&gt;'));
		assert.deepStrictEqual(factory.options.localResourceRoots, []);
		assert.strictEqual(factory.options.enableScripts, true);
	});

	test('renders the compact themed toolbar without exposing internal state names', async () => {
		const factory = new StubPanelFactory();
		const adapter = new WebviewVisualizationAdapter(factory, new StubClipboard(), new StubNotification());
		await adapter.show(createVisualizationViewModel(successResult('success', {
			notices: [notice('unknown-call', 'warning', 'Call could not be resolved.')],
		})));

		const html = factory.panel.webview.html;
		assert.ok(!html.includes('<p>success</p>'));
		assert.ok(html.includes('Call could not be resolved.'));
		assert.ok(html.includes('id="zoom-controls"'));
		assert.ok(html.indexOf('id="copy-mermaid"') < html.indexOf('id="zoom-reset"'));
		assert.ok(html.indexOf('id="zoom-reset"') < html.indexOf('id="zoom-fit"'));
		assert.ok(html.indexOf('id="zoom-fit"') < html.indexOf('id="zoom-out"'));
		assert.ok(html.indexOf('id="zoom-out"') < html.indexOf('id="zoom-level"'));
		assert.ok(html.indexOf('id="zoom-level"') < html.indexOf('id="zoom-in"'));
		assert.ok(!html.includes('margin-left:auto'));
		assert.ok(html.includes('--vscode-button-secondaryBackground'));
		assert.ok(html.includes('--vscode-button-secondaryForeground'));
		assert.ok(html.includes('--vscode-textLink-foreground'));
		assert.ok(html.includes('#2d4f73'));
		assert.ok(html.includes(':focus-visible'));
	});

	test('includes fixed initial zoom state and zoom controls', async () => {
		const factory = new StubPanelFactory();
		const adapter = new WebviewVisualizationAdapter(factory, new StubClipboard(), new StubNotification());
		await adapter.show(createVisualizationViewModel(successResult('success')));
		const html = factory.panel.webview.html;
		assert.ok(html.includes('const INITIAL_ZOOM=1'));
		assert.ok(html.includes('function fitViewer'));
		assert.ok(html.includes('currentScrollLeft'));
		assert.ok(html.includes('currentScrollTop'));
		assert.ok(html.includes('const MIN_ZOOM=0.5'));
		assert.ok(html.includes('const MAX_ZOOM=3'));
		assert.ok(html.includes('updateZoomUi'));
		assert.ok(html.includes('zoom-in'));
		assert.ok(html.includes('zoom-out'));
		assert.ok(html.includes('zoom-fit'));
		assert.ok(html.includes('document.getElementById(\'diagram-viewer\')'));
		assert.ok(html.includes('canvas.style.setProperty(\'--glitchlens-zoom\''));
	});

	test('includes Pointer Events pan state on the Viewer without Mermaid redraw or button capture', async () => {
		const factory = new StubPanelFactory();
		const adapter = new WebviewVisualizationAdapter(factory, new StubClipboard(), new StubNotification());
		await adapter.show(createVisualizationViewModel(successResult('success')));
		const html = factory.panel.webview.html;
		assert.ok(html.includes('currentUiScale'));
		assert.ok(html.includes('currentEffectiveScale'));
		assert.ok(html.includes('INITIAL_RENDER_SCALE'));
		assert.ok(html.includes('currentTranslateX'));
		assert.ok(html.includes('currentTranslateY'));
		assert.ok(html.includes('pointerdown'));
		assert.ok(html.includes('pointermove'));
		assert.ok(html.includes('pointerup'));
		assert.ok(html.includes('setPointerCapture'));
		assert.ok(html.includes('releasePointerCapture'));
		assert.ok(html.includes('translate(var(--glitchlens-translate-x,0px)'));
		assert.ok(html.includes('scale(var(--glitchlens-zoom,1))'));
		assert.ok(html.includes('Number.isFinite'));
		assert.ok(html.includes('preventDefault'));
		assert.ok(html.includes('isPanExcludedTarget'));
		assert.ok(html.includes('setViewerState'));
	});

	test('bundles official Mermaid renderer with safe initialization and text fallback', () => {
		const webviewSource = fs.readFileSync(path.resolve(__dirname, '../../src/integration/webviewMermaid.js'), 'utf8');
		const viewSource = fs.readFileSync(path.resolve(__dirname, '../../src/integration/visualizationView.ts'), 'utf8');

		assert.ok(webviewSource.includes("import mermaid from 'mermaid'"));
		assert.ok(webviewSource.includes("securityLevel: 'strict'"));
		assert.ok(webviewSource.includes("theme: 'base'"));
		assert.ok(webviewSource.includes('actorMargin: 40'));
		assert.ok(webviewSource.includes('messageMargin: 70'));
		assert.ok(webviewSource.includes('diagramMarginX: 8'));
		assert.ok(webviewSource.includes('diagramMarginY: 10'));
		assert.ok(webviewSource.includes('boxMargin: 22'));
		assert.ok(webviewSource.includes('noteMargin: 12'));
		assert.ok(webviewSource.includes('useMaxWidth: false'));
		assert.ok(!webviewSource.includes('useMaxWidth: true'));
		assert.ok(webviewSource.includes('getComputedStyle(document.documentElement)'));
		assert.ok(webviewSource.includes('let mermaidInitialized = false'));
		assert.ok(webviewSource.includes('if (!mermaidInitialized)'));
		assert.ok(webviewSource.includes('showFallback(diagram, mermaidText)'));
		assert.ok(webviewSource.includes("value === 'currentColor'"));
		assert.ok(webviewSource.includes("value.includes('var(')"));
		assert.ok(webviewSource.includes("background: '#1e1e1e'"));
		assert.ok(!webviewSource.match(/\b[a-zA-Z]+:\s*['"]currentColor['"]/));
		assert.ok(!webviewSource.match(/\b[a-zA-Z]+:\s*['"]var\(--vscode-/));
		assert.ok(webviewSource.includes('mermaid.render'));
		assert.ok(webviewSource.includes('buildMermaidRenderText(mermaidText)'));
		assert.ok(webviewSource.includes('centerParticipantLabels(diagram)'));
		assert.ok(webviewSource.includes("querySelectorAll('svg text.actor.actor-box, svg g.actor text, svg g.actor-top text, svg g.actor-bottom text')"));
		assert.ok(webviewSource.includes("setAttribute('text-anchor', 'middle')"));
		assert.ok(webviewSource.includes("setAttribute('dominant-baseline', 'middle')"));
		assert.ok(webviewSource.includes("setAttribute('alignment-baseline', 'middle')"));
		assert.ok(webviewSource.includes("style.setProperty('text-anchor', 'middle')"));
		assert.ok(webviewSource.includes('readRootParticipantId(lines)'));
		assert.ok(webviewSource.includes('shape.classList.add(className)'));
		assert.ok(webviewSource.includes('text.classList.add(className)'));
		assert.ok(webviewSource.includes("shape.setAttribute('stroke', color)"));
		assert.ok(webviewSource.includes("svg text.labelText"));
		assert.ok(webviewSource.includes("svg text.loopText, svg text.sectionTitle"));
		assert.ok(webviewSource.includes("g[data-et=\"control-structure\"]"));
		assert.ok(webviewSource.includes('styleControlConditionLabel(conditionLabel'));
		assert.ok(webviewSource.includes("text.setAttribute('fill', color)"));
		assert.ok(webviewSource.includes('styleControlFragmentTypeLabel(text, className, color)'));
		assert.ok(!webviewSource.includes('styleControlLabel(text, className, color)'));
		assert.ok(!webviewSource.includes('CONTROL_LABEL_BOX_EXTRA_WIDTH'));
		assert.ok(webviewSource.includes("shape.setAttribute('stroke-dasharray', 'none')"));
		assert.ok(webviewSource.includes('activate ${rootParticipantId}'));
		assert.ok(webviewSource.includes('deactivate ${rootParticipantId}'));
		assert.ok(webviewSource.includes('activate ${message.to}'));
		assert.ok(webviewSource.includes('deactivate ${message.to}'));
		assert.ok(webviewSource.includes('deactivate ${message.from}'));
		assert.ok(webviewSource.includes('if (message.to === rootParticipantId)'));
		assert.ok(webviewSource.includes('parseSequenceMessage'));
		assert.ok(!webviewSource.includes('relaxSvgTextLayout'));
		assert.ok(!webviewSource.includes("removeAttribute('textLength')"));
		assert.ok(!webviewSource.includes("removeAttribute('lengthAdjust')"));
		assert.ok(!webviewSource.includes("removeAttribute('x')"));
		assert.ok(!webviewSource.includes("removeAttribute('y')"));
		assert.ok(!webviewSource.match(/svg text[^\n]*font-size/));
		assert.ok(webviewSource.includes('decorateSequenceParticipants(diagram)'));
		assert.ok(webviewSource.includes('decorateSequenceMessages(diagram)'));
		assert.ok(webviewSource.includes("querySelectorAll('svg text.messageText')"));
		assert.ok(webviewSource.includes('GLITCHLENS_MESSAGE_LABEL_OFFSET_Y'));
		assert.ok(webviewSource.includes("style.setProperty('transform'"));
		assert.ok(webviewSource.includes('decorateSequenceControls(diagram)'));
		assert.ok(webviewSource.includes('glitchlens-root-participant'));
		assert.ok(webviewSource.includes('glitchlens-await-message'));
		assert.ok(webviewSource.includes('glitchlens-return-message'));
		assert.ok(webviewSource.includes('glitchlens-control-loop'));
		assert.ok(webviewSource.includes('glitchlens-control-alt'));
		assert.ok(webviewSource.includes('glitchlens-control-opt'));
		assert.ok(webviewSource.includes('glitchlens-control-critical'));
		assert.ok(webviewSource.includes('glitchlens-control-option'));
		assert.ok(!webviewSource.includes("text.style.setProperty('fill', color, 'important')"));
		assert.ok(!webviewSource.includes("shape.style.setProperty('stroke', color, 'important')"));
		assert.ok(viewSource.includes('#diagram svg text.glitchlens-control-loop'));
		assert.ok(viewSource.includes('#diagram svg text.loopText[class*="glitchlens-control-"]'));
		assert.ok(viewSource.includes('transform:translateY(-18px)!important'));
		assert.ok(webviewSource.includes("closest('g[data-et=\"control-structure\"]')"));
		assert.ok(webviewSource.includes('addNonceToSvgStyles'));
		assert.ok(webviewSource.includes("style.setAttribute('nonce', nonce)"));
		assert.ok(webviewSource.includes('showFallback(diagram, mermaidText)'));
		assert.ok(viewSource.includes('readWebviewMermaidScript'));
		assert.ok(!viewSource.includes('https://cdn'));
		assert.ok(!viewSource.includes('unpkg.com'));
		assert.ok(!viewSource.includes('jsdelivr'));
	});

	test('keeps advanced Mermaid control syntax as render input for Webview Mermaid', async () => {
		const factory = new StubPanelFactory();
		const adapter = new WebviewVisualizationAdapter(factory, new StubClipboard(), new StubNotification());
		const mermaidText = [
			'sequenceDiagram',
			'participant root as processOrders',
			'loop orders',
			'critical try',
			'opt order.amount <= 0',
			'root->>root: await continue',
			'end',
			'alt order.status === "new"',
			'root->>charge: await charge',
			'charge-->>root: return receipt',
			'else',
			'root->>notify: notify',
			'end',
			'loop retry < 3',
			'root->>save: save',
			'opt saved',
			'root->>root: break',
			'end',
			'end',
			'option catch error',
			'root->>error: error',
			'end',
			'end',
			'',
		].join('\n');

		await adapter.show(createVisualizationViewModel(successResult('success', { mermaidText })));

		const html = factory.panel.webview.html;
		assert.ok(html.includes('loop orders'));
		assert.ok(html.includes('opt order.amount \\u003c= 0'));
		assert.ok(html.includes('alt order.status === \\\"new\\\"'));
		assert.ok(html.includes('else'));
		assert.ok(html.includes('critical try'));
		assert.ok(html.includes('option catch error'));
		assert.ok(html.includes('loop retry \\u003c 3'));
		assert.ok(html.includes('charge-->>root: return receipt'));
		assert.ok(html.includes('id="diagram-viewer"'));
		assert.ok(html.includes('id="diagram"'));
		assert.match(html, /#diagram-canvas\{[^}]*transform:translate\([^}]*scale\(var\(--glitchlens-zoom,1\)\)/);
		assert.ok(!html.includes('#diagram-viewer{transform:translate'));
		assert.match(html, /#diagram svg\{[^}]*width:max-content[^}]*height:auto/);
		assert.match(html, /#diagram-viewer\{[^}]*overflow:auto/);
		assert.ok(html.includes('max-width:none'));
		assert.ok(!html.includes('min-width:100%'));
		assert.ok(html.includes('#diagram-viewer{overflow:auto'));
		assert.ok(html.includes('width:max-content'));
		assert.ok(!html.includes('#diagram svg text{font-size:13px!important'));
		assert.match(html, /#diagram svg \.actor-line\{[^}]*stroke:[^;]+/);
		assert.match(html, /#diagram svg \.actor\{[^}]*stroke:[^;]+/);
		assert.match(html, /#diagram svg \[class\*="activation"\]\{[^}]*fill:[^;]+/);
		assert.ok(html.includes('.glitchlens-root-participant'));
		assert.ok(html.includes('.glitchlens-await-message'));
		assert.ok(html.includes('.glitchlens-return-message'));
		assert.ok(/"cspNonce":"[A-Za-z0-9]+"/.test(html));
		assert.ok(!html.includes('<svg role="img" aria-label="Mermaid sequence diagram"'));
	});

	test('guards the Task 11.1-11.3 Viewer and Mermaid regression contract', async () => {
		const webviewSource = fs.readFileSync(path.resolve(__dirname, '../../src/integration/webviewMermaid.js'), 'utf8');
		const viewSource = fs.readFileSync(path.resolve(__dirname, '../../src/integration/visualizationView.ts'), 'utf8');
		const factory = new StubPanelFactory();
		const adapter = new WebviewVisualizationAdapter(factory, new StubClipboard(), new StubNotification());
		const mermaidText = [
			'sequenceDiagram',
			'participant root as processOrders',
			'loop orders',
			'root->>load: await load',
			'alt order.status',
			'root->>charge: charge',
			'else',
			'root->>notify: notify',
			'end',
			'critical try',
			'root->>save: save',
			'option catch error',
			'root->>error: error',
			'end',
			'end',
		].join('\n');

		await adapter.show(createVisualizationViewModel(successResult('success', { mermaidText })));
		const html = factory.panel.webview.html;

		for (const id of ['zoom-in', 'zoom-out', 'zoom-reset', 'zoom-fit', 'zoom-level', 'diagram-viewer', 'diagram-canvas', 'diagram']) {
			assert.ok(html.includes(`id="${id}"`));
		}
		for (const state of ['currentUiScale', 'currentEffectiveScale', 'initialRenderScale', 'currentTranslateX', 'currentTranslateY', 'setViewerState']) {
			assert.ok(html.includes(state));
		}
		assert.ok(html.includes('const INITIAL_ZOOM=1'));
		assert.ok(html.includes('const MIN_ZOOM=0.5'));
		assert.ok(html.includes('const MAX_ZOOM=3'));
		assert.ok(html.includes('pointerdown'));
		assert.ok(html.includes('pointermove'));
		assert.ok(html.includes('pointerup'));
		assert.ok(html.includes('pointercancel'));
		assert.ok(html.includes('setPointerCapture'));
		assert.ok(html.includes('releasePointerCapture'));
		assert.ok(html.includes('isPanExcludedTarget'));
		assert.ok(html.includes('Number.isFinite'));
		assert.ok(html.includes('preventDefault'));
		assert.ok(html.includes("addEventListener('wheel'"));
		assert.ok(html.includes('deltaY'));
		assert.ok(html.includes('ctrlKey'));
		assert.ok(html.includes('pinchState'));
		assert.ok(html.includes('distance'));
		assert.ok(html.includes('activePointers'));
		assert.ok(html.includes('touch-action:none'));

		assert.ok(html.includes('sequenceDiagram'));
		assert.ok(html.includes('Copy Mermaid'));
		assert.ok(html.includes('<details class="diagram-fallback">'));
		assert.ok(!html.includes('Source locations'));
		assert.ok(/script-src 'nonce-[A-Za-z0-9]+'/.test(html));
		assert.ok(!html.includes('unsafe-inline'));
		assert.ok(!html.includes('https://cdn'));
		assert.ok(!html.includes('unpkg.com'));

		for (const className of [
			'glitchlens-control-loop',
			'glitchlens-control-alt',
			'glitchlens-control-opt',
			'glitchlens-control-critical',
			'glitchlens-control-option',
			'glitchlens-root-participant',
			'glitchlens-await-message',
		]) {
			assert.ok(webviewSource.includes(className));
		}
		assert.ok(viewSource.includes('#diagram svg text.glitchlens-control-loop'));
		assert.ok(viewSource.includes('#diagram svg text.loopText[class*="glitchlens-control-"]'));
		assert.ok(!webviewSource.includes("text.style.setProperty('fill', color, 'important')"));
		assert.ok(!webviewSource.includes("shape.style.setProperty('stroke', color, 'important')"));
		assert.ok(webviewSource.includes('activate ${rootParticipantId}'));
		assert.ok(webviewSource.includes('activate ${message.to}'));
		assert.ok(webviewSource.includes('mermaid.render'));
		assert.ok(webviewSource.includes('showFallback(diagram, mermaidText)'));
		assert.ok(viewSource.includes('readWebviewMermaidScript'));
		assert.ok(!viewSource.includes('mermaid.render'));
	});

	test('decorates nested control-condition labels using their own Mermaid control-structure group', async () => {
		const mermaidText = [
			'sequenceDiagram',
			'participant root as processOrders',
			'participant push as push',
			'participant error as error',
			'loop pending orders',
			'critical retry transaction',
			'opt amount is not positive',
			'root->>push: push',
			'end',
			'option recover from failure',
			'root->>error: error',
			'end',
			'end',
			'',
		].join('\n');
		const { window, diagram } = await renderWebviewMermaidFixture(mermaidText);
		const conditionLabels = [...diagram.querySelectorAll<SVGTextElement>('text.loopText, text.sectionTitle')];

		assert.ok(conditionLabels.length >= 4, 'Mermaid must render all nested condition-label segments');
		const observedFragmentTypes = new Set<string>();
		for (const conditionLabel of conditionLabels) {
			const group = conditionLabel.closest('g[data-et="control-structure"]');
			assert.ok(group, 'each condition label must resolve to a Mermaid control-structure group');
			const typeLabel = findOwnFragmentTypeLabel(group);
			assert.ok(typeLabel, 'each condition label group must contain its own fragment type label');
			assert.ok(typeLabel.className.baseVal.includes('glitchlens-control-'));
			assert.ok(conditionLabel.className.baseVal.includes('glitchlens-control-'));
			const expectedColor = window.getComputedStyle(typeLabel).fill;
			const ownFrame = findOwnControlFrame(group);
			assert.ok(expectedColor, 'fragment type label must have its color decoration');
			assert.ok(ownFrame, 'fragment group must have its own frame shape');
			assert.strictEqual(window.getComputedStyle(conditionLabel).fill, expectedColor);
			assert.strictEqual(window.getComputedStyle(ownFrame).stroke, expectedColor);
			assert.strictEqual(window.getComputedStyle(conditionLabel).transform, 'translateY(-18px)');
			assert.strictEqual(window.getComputedStyle(typeLabel).transform, 'none');
			observedFragmentTypes.add(typeLabel.textContent?.trim() ?? '');
		}

		assert.deepStrictEqual([...observedFragmentTypes].sort(), ['critical', 'loop', 'opt']);
		assert.ok(conditionLabels.some(label => label.classList.contains('sectionTitle') && fragmentTypeOf(label) === 'critical'));
		const loopCondition = conditionLabels.find(label => fragmentTypeOf(label) === 'loop');
		const optCondition = conditionLabels.find(label => fragmentTypeOf(label) === 'opt');
		assert.ok(loopCondition && optCondition);
		assert.notStrictEqual(window.getComputedStyle(loopCondition).fill, window.getComputedStyle(optCondition).fill, 'outer fragment color must not overwrite nested fragment labels');

		window.close();
	});

		test('decorates process notes from semantic metadata in an actual Mermaid SVG fixture', async () => {
		const mermaidText = [
			'sequenceDiagram',
			'participant root as self',
			'Note over root: arbitrary expression result',
			'root->>root: continue with any label',
			'Note over root,unknown: unresolved arbitrary text',
		].join('\n');
		const { window, diagram } = await renderWebviewMermaidFixture(mermaidText, [
			{ mermaidLine: 3, nodeKind: 'expression' },
		]);
		assert.ok(diagram.querySelector('svg g[id^="root-"] .glitchlens-root-participant, svg g[id^="root-"].glitchlens-root-participant'));
		const noteGroups = [...diagram.querySelectorAll<SVGGElement>('svg g[data-et="note"]')];

		assert.strictEqual(noteGroups.length, 2);
		assert.strictEqual(noteGroups.filter(group => group.classList.contains('glitchlens-process-note')).length, 1);
		const processNote = noteGroups.find(group => group.classList.contains('glitchlens-process-note'));
		assert.ok(processNote);
		assert.strictEqual(processNote?.dataset.processNoteKind, 'expression');
		assert.strictEqual(window.getComputedStyle(processNote?.querySelector('rect') as Element).fill, 'rgb(48, 59, 77)');
		assert.strictEqual(window.getComputedStyle(processNote?.querySelector('text') as Element).fill, 'var(--vscode-editor-foreground,var(--vscode-foreground,#cccccc))');

		window.close();
	});

	test('reuses the same panel and replaces stale content safely', async () => {
		const factory = new StubPanelFactory();
		const adapter = new WebviewVisualizationAdapter(factory, new StubClipboard(), new StubNotification());

		await adapter.show(createVisualizationViewModel(successResult('success', { mermaidText: 'first' })));
		const firstPanel = factory.panel;
		await adapter.show(createVisualizationViewModel(successResult('success', { mermaidText: 'second' })));

		assert.strictEqual(factory.createCount, 1);
		assert.strictEqual(factory.panel, firstPanel);
		assert.ok(factory.panel.webview.html.includes('second'));
		assert.ok(!factory.panel.webview.html.includes('first'));
	});

	test('ignores disallowed Webview messages and accepts only allowlisted messages', async () => {
		const factory = new StubPanelFactory();
		const adapter = new WebviewVisualizationAdapter(factory, new StubClipboard(), new StubNotification());
		const accepted: string[] = [];
		adapter.onDidReceiveAllowedMessage(message => accepted.push(message.type));
		await adapter.show(createVisualizationViewModel(successResult('success')));

		factory.panel.emitMessage({ type: 'openExternal', url: 'https://example.com' });
		factory.panel.emitMessage({ type: 'copyMermaid', viewId: factory.panel.currentViewId(), text: 'evil' });
		factory.panel.emitMessage({ type: 'ready' });
		factory.panel.emitMessage({ type: 'sourceMapSelected', elementId: 'line:1' });

		assert.deepStrictEqual(accepted, ['copyMermaid', 'ready', 'sourceMapSelected']);
	});

	test('copies current Mermaid text for success and partial results from explicit Webview request', async () => {
		const factory = new StubPanelFactory();
		const clipboard = new StubClipboard();
		const notifications = new StubNotification();
		const adapter = new WebviewVisualizationAdapter(factory, clipboard, notifications);
		await adapter.show(createVisualizationViewModel(successResult('success', { mermaidText: 'sequenceDiagram\nparticipant root as self\nroot->>load: success\n' })));
		assert.ok(factory.panel.webview.html.includes('participant root as self'));

		factory.panel.emitMessage({ type: 'copyMermaid', viewId: factory.panel.currentViewId(), text: 'attacker supplied text' });

		await clipboard.flush();
		assert.deepStrictEqual(clipboard.writes, ['sequenceDiagram\nparticipant root as self\nroot->>load: success\n']);
		assert.deepStrictEqual(notifications.messages, ['info:Mermaid text copied.']);

		await adapter.show(createVisualizationViewModel(successResult('partial', { mermaidText: 'sequenceDiagram\nparticipant root as self\nroot->>load: partial\n' })));
		factory.panel.emitMessage({ type: 'copyMermaid', viewId: factory.panel.currentViewId() });

		await clipboard.flush();
		assert.deepStrictEqual(clipboard.writes, [
			'sequenceDiagram\nparticipant root as self\nroot->>load: success\n',
			'sequenceDiagram\nparticipant root as self\nroot->>load: partial\n',
		]);
	});

	test('does not copy failure or missing Mermaid text and notifies the reason', async () => {
		const factory = new StubPanelFactory();
		const clipboard = new StubClipboard();
		const notifications = new StubNotification();
		const adapter = new WebviewVisualizationAdapter(factory, clipboard, notifications);

		await adapter.show(createVisualizationViewModel(failureResult('failed')));
		assert.ok(factory.panel.webview.html.includes('disabled'));
		factory.panel.emitMessage({ type: 'copyMermaid', viewId: factory.panel.currentViewId() });

		await adapter.show({ ...createVisualizationViewModel(successResult('success')), mermaidText: undefined, canCopyMermaid: false });
		factory.panel.emitMessage({ type: 'copyMermaid', viewId: factory.panel.currentViewId() });

		await clipboard.flush();
		assert.deepStrictEqual(clipboard.writes, []);
		assert.deepStrictEqual(notifications.messages, [
			'warning:No Mermaid text is available to copy.',
			'warning:No Mermaid text is available to copy.',
		]);
	});

	test('reports clipboard failures without leaking Webview provided text', async () => {
		const factory = new StubPanelFactory();
		const clipboard = new StubClipboard();
		clipboard.failNext = true;
		const notifications = new StubNotification();
		const adapter = new WebviewVisualizationAdapter(factory, clipboard, notifications);
		await adapter.show(createVisualizationViewModel(successResult('success', { mermaidText: 'sequenceDiagram\nroot->>load: safe\n' })));

		factory.panel.emitMessage({ type: 'copyMermaid', viewId: factory.panel.currentViewId(), text: 'evil' });

		await clipboard.flush();
		assert.deepStrictEqual(clipboard.writes, []);
		assert.deepStrictEqual(clipboard.attempts, ['sequenceDiagram\nroot->>load: safe\n']);
		assert.deepStrictEqual(notifications.messages, ['error:Failed to copy Mermaid text.']);
	});

	test('does not create a visualization panel or expose Mermaid text in untrusted workspaces', async () => {
		const factory = new StubPanelFactory();
		const clipboard = new StubClipboard();
		const notifications = new StubNotification();
		const adapter = new WebviewVisualizationAdapter(
			factory,
			clipboard,
			notifications,
			() => createWorkspaceTrustGuard({ isTrusted: false }),
		);

		await adapter.show(createVisualizationViewModel(successResult('success', {
			mermaidText: 'sequenceDiagram\nroot->>secret: do not expose\n',
		})));

		assert.strictEqual(factory.createCount, 0);
		assert.strictEqual(factory.panel.webview.html, '');
		assert.deepStrictEqual(clipboard.writes, []);
		assert.deepStrictEqual(notifications.messages, [
			'warning:GlitchLens visualization is disabled in Restricted Mode. Trust this workspace to display source-derived flow data.',
		]);
	});

	test('blocks clipboard writes in untrusted workspaces even if a stale panel sends copy', async () => {
		const factory = new StubPanelFactory();
		const clipboard = new StubClipboard();
		const notifications = new StubNotification();
		const adapter = new WebviewVisualizationAdapter(
			factory,
			clipboard,
			notifications,
			() => createWorkspaceTrustGuard({ isTrusted: false }),
		);

		await adapter.show(createVisualizationViewModel(failureResult('failed')));
		factory.panel.emitMessage({ type: 'copyMermaid', viewId: factory.panel.currentViewId() });

		await clipboard.flush();
		assert.deepStrictEqual(clipboard.attempts, []);
		assert.deepStrictEqual(notifications.messages, [
			'warning:GlitchLens visualization is disabled in Restricted Mode. Trust this workspace to display source-derived flow data.',
		]);
	});

	test('re-evaluates workspace trust for visualization and clipboard after trust is granted', async () => {
		let isTrusted = false;
		const factory = new StubPanelFactory();
		const clipboard = new StubClipboard();
		const notifications = new StubNotification();
		const adapter = new WebviewVisualizationAdapter(
			factory,
			clipboard,
			notifications,
			() => createWorkspaceTrustGuard({ isTrusted }),
		);
		const model = createVisualizationViewModel(successResult('success', {
			mermaidText: 'sequenceDiagram\nroot->>load: safe after trust\n',
		}));

		await adapter.show(model);
		assert.strictEqual(factory.createCount, 0);

		isTrusted = true;
		await adapter.show(model);
		factory.panel.emitMessage({ type: 'copyMermaid', viewId: factory.panel.currentViewId() });

		await clipboard.flush();
		assert.strictEqual(factory.createCount, 1);
		assert.deepStrictEqual(clipboard.writes, ['sequenceDiagram\nroot->>load: safe after trust\n']);
		assert.deepStrictEqual(notifications.messages, [
			'warning:GlitchLens visualization is disabled in Restricted Mode. Trust this workspace to display source-derived flow data.',
			'info:Mermaid text copied.',
		]);
	});

	test('ignores stale and disposed panel copy requests', async () => {
		const factory = new StubPanelFactory();
		const clipboard = new StubClipboard();
		const notifications = new StubNotification();
		const adapter = new WebviewVisualizationAdapter(factory, clipboard, notifications);
		await adapter.show(createVisualizationViewModel(successResult('success', { mermaidText: 'sequenceDiagram\nroot->>load: first\n' })));
		const staleViewId = factory.panel.currentViewId();
		await adapter.show(createVisualizationViewModel(successResult('success', { mermaidText: 'sequenceDiagram\nroot->>load: second\n' })));

		factory.panel.emitMessage({ type: 'copyMermaid', viewId: staleViewId });
		factory.panel.dispose();
		factory.panel.emitMessage({ type: 'copyMermaid', viewId: factory.panel.currentViewId() });

		await clipboard.flush();
		assert.deepStrictEqual(clipboard.writes, []);
		assert.deepStrictEqual(notifications.messages, []);
	});

	test('disposes active panel listeners and clears clipboard state through extension lifecycle', async () => {
		const factory = new StubPanelFactory();
		const clipboard = new StubClipboard();
		const notifications = new StubNotification();
		const adapter = new WebviewVisualizationAdapter(factory, clipboard, notifications);

		await adapter.show(createVisualizationViewModel(successResult('success', { mermaidText: 'sequenceDiagram\nroot->>load: active\n' })));
		const viewId = factory.panel.currentViewId();
		adapter.dispose();

		factory.panel.emitMessage({ type: 'copyMermaid', viewId });
		await clipboard.flush();

		assert.strictEqual(factory.panel.disposeCount, 1);
		assert.strictEqual(factory.panel.listenerDisposeCount, 2);
		assert.deepStrictEqual(clipboard.writes, []);
		assert.deepStrictEqual(notifications.messages, []);
	});

	test('Clipboard remains inside integration boundary and upstream layers stay independent', () => {
		const files = [
			path.resolve(__dirname, '../../src/integration/visualizationView.ts'),
			path.resolve(__dirname, '../../src/integration/commands.ts'),
			path.resolve(__dirname, '../../src/integration/webviewVisualizationAdapter.ts'),
		].filter(file => fs.existsSync(file));
		const integrationSource = files.map(file => fs.readFileSync(file, 'utf8')).join('\n');
		const viewSource = fs.readFileSync(path.resolve(__dirname, '../../src/integration/visualizationView.ts'), 'utf8');
		const upstreamSource = [
			path.resolve(__dirname, '../../src/application'),
			path.resolve(__dirname, '../../src/analyzers'),
			path.resolve(__dirname, '../../src/renderer'),
		].flatMap(readTree);

		assert.ok(integrationSource.includes('Clipboard'));
		assert.ok(!viewSource.includes('../analyzers'));
		assert.ok(!viewSource.includes('RendererWarning'));
		assert.ok(!viewSource.includes('FlowDiagnostic'));
		assert.ok(!viewSource.includes('FlowModel'));
		assert.ok(!viewSource.includes('WebviewPanel') || viewSource.includes('WebviewPanelPort'));
		assert.ok(!upstreamSource.join('\n').includes('Clipboard'));
	});
});

async function renderWebviewMermaidFixture(mermaidText: string, processNoteDecorations: readonly { readonly mermaidLine: number; readonly nodeKind: string }[] = []) {
	const bundle = await build({
		entryPoints: [path.resolve(__dirname, '../../src/integration/webviewMermaid.js')],
		bundle: true,
		format: 'iife',
		platform: 'browser',
		write: false,
	});
	const dom = new JSDOM('<!doctype html><html><body><div id="diagram"></div></body></html>', {
		runScripts: 'dangerously',
		url: 'https://glitchlens.test/',
	});
	const { window } = dom;
	installControlDecorationStyles(window.document);
	Object.defineProperty(window.SVGElement.prototype, 'getBBox', {
		value: function getBBox() {
			return { x: 0, y: 0, width: Math.max(1, this.textContent?.length ?? 0) * 8, height: 16 };
		},
	});
	Object.assign(window, {
		GLITCHLENS_VIEW_MODEL: {
			renderMode: 'mermaid',
			mermaidText,
			fallbackText: mermaidText,
			cspNonce: 'test-nonce',
			rootFunctionName: 'processOrders',
			processNoteDecorations,
		},
	});
	const nodeGlobals = globalThis as typeof globalThis & Record<string, unknown>;
	const previousGlobals = new Map<string, unknown>([
		['window', nodeGlobals.window],
		['document', nodeGlobals.document],
		['getComputedStyle', nodeGlobals.getComputedStyle],
		['CSSStyleSheet', nodeGlobals.CSSStyleSheet],
		['SVGElement', nodeGlobals.SVGElement],
		['GLITCHLENS_VIEW_MODEL', nodeGlobals.GLITCHLENS_VIEW_MODEL],
	]);
	Object.assign(nodeGlobals, {
		window,
		document: window.document,
		getComputedStyle: window.getComputedStyle.bind(window),
		CSSStyleSheet: window.CSSStyleSheet,
		SVGElement: window.SVGElement,
		GLITCHLENS_VIEW_MODEL: window.GLITCHLENS_VIEW_MODEL,
	});
	try {
		window.eval(bundle.outputFiles[0].text);
		for (let attempt = 0; attempt < 50 && window.document.body.dataset.render !== 'mermaid'; attempt += 1) {
			await new Promise<void>(resolve => setTimeout(resolve, 10));
		}
	} finally {
		for (const [name, value] of previousGlobals) {
			nodeGlobals[name] = value;
		}
	}
	assert.strictEqual(window.document.body.dataset.render, 'mermaid');
	const diagram = window.document.getElementById('diagram');
	assert.ok(diagram);
	return { window, diagram };
}

function installControlDecorationStyles(document: Document): void {
	const style = document.createElement('style');
	style.textContent = [
		'#diagram svg text.glitchlens-control-loop,#diagram svg text.glitchlens-control-loop tspan{fill:#9fd0ff!important;}',
		'#diagram svg .glitchlens-control-loop:is(rect,path,line,polygon){stroke:#9fd0ff!important;}',
		'#diagram svg text.glitchlens-control-alt,#diagram svg text.glitchlens-control-alt tspan{fill:#8ff2ff!important;}',
		'#diagram svg .glitchlens-control-alt:is(rect,path,line,polygon){stroke:#8ff2ff!important;}',
		'#diagram svg text.glitchlens-control-opt,#diagram svg text.glitchlens-control-opt tspan{fill:#fde68a!important;}',
		'#diagram svg .glitchlens-control-opt:is(rect,path,line,polygon){stroke:#fde68a!important;}',
		'#diagram svg text.glitchlens-control-critical,#diagram svg text.glitchlens-control-critical tspan{fill:#ddd6fe!important;}',
		'#diagram svg .glitchlens-control-critical:is(rect,path,line,polygon){stroke:#ddd6fe!important;}',
		'#diagram svg text.glitchlens-control-option,#diagram svg text.glitchlens-control-option tspan{fill:#fbcfe8!important;}',
		'#diagram svg .glitchlens-control-option:is(rect,path,line,polygon){stroke:#fbcfe8!important;}',
		'#diagram svg text.loopText[class*="glitchlens-control-"],#diagram svg text.sectionTitle[class*="glitchlens-control-"]{transform:translateY(-18px)!important;}',
		'#diagram svg g.glitchlens-process-note[data-et="note"]>rect{fill:#303b4d!important;stroke:var(--vscode-editorWidget-border,var(--vscode-panel-border,#6b7280))!important;}',
		'@supports (fill:color-mix(in srgb,black,white)){#diagram svg g.glitchlens-process-note[data-et="note"]>rect{fill:color-mix(in srgb,var(--vscode-editor-background,#1e1e1e) 82%,var(--vscode-textLink-foreground,#4f86b8) 18%)!important;}}',
		'#diagram svg g.glitchlens-process-note[data-et="note"] text,#diagram svg g.glitchlens-process-note[data-et="note"] tspan{fill:var(--vscode-editor-foreground,var(--vscode-foreground,#cccccc))!important;}',
	].join('');
	document.head.append(style);
}

function findOwnFragmentTypeLabel(group: Element): SVGTextElement | undefined {
	return [...group.querySelectorAll<SVGTextElement>('text.labelText')].find(label => label.closest('g[data-et="control-structure"]') === group);
}

function findOwnControlFrame(group: Element): SVGElement | undefined {
	return [...group.querySelectorAll<SVGElement>('rect,path,line,polygon')].find(shape => shape.closest('g[data-et="control-structure"]') === group);
}

function fragmentTypeOf(conditionLabel: SVGTextElement): string | undefined {
	const group = conditionLabel.closest('g[data-et="control-structure"]');
	return group ? findOwnFragmentTypeLabel(group)?.textContent?.trim() : undefined;
}

class StubPanelFactory implements WebviewPanelFactory {
	public readonly options = { enableScripts: false, localResourceRoots: ['not-set'] as readonly string[] };
	public readonly panel = new StubPanel();
	public createCount = 0;

	public createPanel(options: { readonly enableScripts: boolean; readonly localResourceRoots: readonly string[] }): WebviewPanelPort {
		this.createCount += 1;
		this.options.enableScripts = options.enableScripts;
		this.options.localResourceRoots = options.localResourceRoots;
		return this.panel;
	}
}

class StubPanel implements WebviewPanelPort {
	public readonly webview = { html: '' };
	public disposeCount = 0;
	public listenerDisposeCount = 0;
	private messageHandler: ((message: unknown) => void) | undefined;
	private disposeHandler: (() => void) | undefined;

	public reveal(): void {}

	public dispose(): void {
		this.disposeCount += 1;
		this.disposeHandler?.();
	}

	public onDidDispose(listener: () => void) {
		this.disposeHandler = listener;
		return {
			dispose: () => {
				this.listenerDisposeCount += 1;
				this.disposeHandler = undefined;
			},
		};
	}

	public onDidReceiveMessage(handler: (message: unknown) => void) {
		this.messageHandler = handler;
		return {
			dispose: () => {
				this.listenerDisposeCount += 1;
				this.messageHandler = undefined;
			},
		};
	}

	public emitMessage(message: unknown): void {
		this.messageHandler?.(message);
	}

	public currentViewId(): string {
		const match = this.webview.html.match(/"viewId":"([^"]+)"/);
		return match?.[1] ?? '';
	}
}

class StubClipboard implements ClipboardAdapter {
	public readonly writes: string[] = [];
	public readonly attempts: string[] = [];
	public failNext = false;
	private pending: Promise<void> = Promise.resolve();

	public writeText(text: string): Promise<void> {
		this.attempts.push(text);
		this.pending = this.pending.then(() => {
			if (this.failNext) {
				this.failNext = false;
				throw new Error('copy failed');
			}
			this.writes.push(text);
		});
		return this.pending;
	}

	public async flush(): Promise<void> {
		try {
			await this.pending;
		} catch {
			// Tests assert notification side effects for failures.
		}
	}
}

class StubNotification implements VisualizationViewNotification {
	public readonly messages: string[] = [];

	public showInfo(message: string): Promise<void> {
		this.messages.push(`info:${message}`);
		return Promise.resolve();
	}

	public showWarning(message: string): Promise<void> {
		this.messages.push(`warning:${message}`);
		return Promise.resolve();
	}

	public showError(message: string): Promise<void> {
		this.messages.push(`error:${message}`);
		return Promise.resolve();
	}
}

function successResult(status: 'success' | 'partial', overrides: {
	readonly mermaidText?: string;
	readonly notices?: VisualizationResult['notices'];
	readonly sourceMap?: Extract<VisualizationResult, { status: 'success' | 'partial' }>['sourceMap'];
	readonly processNoteDecorations?: Extract<VisualizationResult, { status: 'success' | 'partial' }>['processNoteDecorations'];
} = {}): VisualizationResult {
	return {
		status,
		mermaidText: overrides.mermaidText ?? 'sequenceDiagram\nroot->>load: load\n',
		canCopyMermaid: true,
		processNoteDecorations: overrides.processNoteDecorations ?? [],
		sourceMap: overrides.sourceMap ?? [{
			elementId: 'line:1',
			nodeId: 'node:load',
			sourceLocation: {
				uri: 'file:///workspace/source.ts',
				range: { start: { line: 1, character: 2 }, end: { line: 1, character: 8 } },
			},
		}],
		notices: overrides.notices ?? [],
		completeness: status === 'partial' ? 'partial' : 'complete',
		model: {
			metadata: {
				schemaVersion: '1.0.0',
				analyzerId: 'typescript',
				analyzerVersion: '0.1.0',
				languageId: 'typescript',
				generatedAt: '2026-07-12T00:00:00.000Z',
				sourceDocumentVersion: 1,
				completeness: status === 'partial' ? 'partial' : 'complete',
				configurationDigest: 'sha256:test',
			},
			rootFunction: {
				id: 'function:sample',
				name: 'sample',
				sourceLocation: {
					uri: 'file:///workspace/source.ts',
					range: { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } },
				},
			},
			nodes: [],
			edges: [],
			diagnostics: [],
			source: {
				uri: 'file:///workspace/source.ts',
				languageId: 'typescript',
				documentVersion: 1,
			},
			completeness: status === 'partial' ? 'partial' : 'complete',
		},
	};
}

function failureResult(status: Exclude<VisualizationResult['status'], 'success' | 'partial'>): VisualizationResult {
	return {
		status,
		canCopyMermaid: false,
		notices: [notice(status === 'failed' ? 'analysis-failed' : status, 'error', status)],
		error: {
			kind: status,
			message: status,
		},
	};
}

function notice(kind: VisualizationResult['notices'][number]['kind'], severity: VisualizationResult['notices'][number]['severity'], message: string): VisualizationResult['notices'][number] {
	return {
		id: `notice:${kind}`,
		kind,
		severity,
		message,
		sourceLocation: {
			uri: 'file:///workspace/source.ts',
			range: { start: { line: 1, character: 2 }, end: { line: 1, character: 8 } },
		},
	};
}

function noticeWithLocation(
	kind: VisualizationResult['notices'][number]['kind'],
	severity: VisualizationResult['notices'][number]['severity'],
	message: string,
	nodeId?: string,
	edgeId?: string,
): VisualizationResult['notices'][number] {
	return { ...notice(kind, severity, message), nodeId, edgeId };
}

function testSourceLocation() {
	return {
		uri: 'file:///workspace/source.ts',
		range: { start: { line: 2, character: 2 }, end: { line: 2, character: 14 } },
	};
}

function assertNoForbiddenModelObjects(value: VisualizationViewModel): void {
	const text = JSON.stringify(value);
	assert.ok(!text.includes('"nodes"'));
	assert.ok(!text.includes('"edges"'));
	assert.ok(!text.includes('"diagnostics"'));
	assert.ok(!text.includes('"metadata"'));
}

function assertNoExternalResourceReferences(html: string): void {
	assert.ok(!/\s(?:src|href)=["']https?:\/\//i.test(html));
	assert.ok(!/connect-src[^"']*https?:\/\//i.test(html));
	assert.ok(!/default-src[^"']*https?:\/\//i.test(html));
	assert.ok(!/script-src[^"']*https?:\/\//i.test(html));
}

function readTree(root: string): string[] {
	if (!fs.existsSync(root)) {
		return [];
	}
	const stat = fs.statSync(root);
	if (stat.isFile() && root.endsWith('.ts')) {
		return [fs.readFileSync(root, 'utf8')];
	}
	if (!stat.isDirectory()) {
		return [];
	}
	return fs.readdirSync(root).flatMap(entry => readTree(path.join(root, entry)));
}
