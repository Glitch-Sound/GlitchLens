import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

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
		assert.ok(html.includes('<svg role="img" aria-label="Mermaid sequence diagram"'));
		assert.ok(html.includes('Copy Mermaid'));
		assert.ok(html.includes('<details class="diagram-fallback">'));
		assert.ok(html.includes('<details class="source-map" open>'));
		assert.ok(html.includes('line:1: file:///workspace/source.ts:2:3-2:9'));
		assert.ok(!html.includes('https://'));
		assert.ok(!html.includes('http://'));
		assert.ok(!html.includes('<script>alert(1)</script>'));
		assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
		assert.ok(html.includes('&lt;b&gt;unknown&lt;/b&gt;'));
		assert.deepStrictEqual(factory.options.localResourceRoots, []);
		assert.strictEqual(factory.options.enableScripts, true);
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
		await adapter.show(createVisualizationViewModel(successResult('success', { mermaidText: 'sequenceDiagram\nroot->>load: success\n' })));

		factory.panel.emitMessage({ type: 'copyMermaid', viewId: factory.panel.currentViewId(), text: 'attacker supplied text' });

		await clipboard.flush();
		assert.deepStrictEqual(clipboard.writes, ['sequenceDiagram\nroot->>load: success\n']);
		assert.deepStrictEqual(notifications.messages, ['info:Mermaid text copied.']);

		await adapter.show(createVisualizationViewModel(successResult('partial', { mermaidText: 'sequenceDiagram\nroot->>load: partial\n' })));
		factory.panel.emitMessage({ type: 'copyMermaid', viewId: factory.panel.currentViewId() });

		await clipboard.flush();
		assert.deepStrictEqual(clipboard.writes, [
			'sequenceDiagram\nroot->>load: success\n',
			'sequenceDiagram\nroot->>load: partial\n',
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
} = {}): VisualizationResult {
	return {
		status,
		mermaidText: overrides.mermaidText ?? 'sequenceDiagram\nroot->>load: load\n',
		canCopyMermaid: true,
		sourceMap: [{
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

function assertNoForbiddenModelObjects(value: VisualizationViewModel): void {
	const text = JSON.stringify(value);
	assert.ok(!text.includes('"nodes"'));
	assert.ok(!text.includes('"edges"'));
	assert.ok(!text.includes('"diagnostics"'));
	assert.ok(!text.includes('"metadata"'));
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
