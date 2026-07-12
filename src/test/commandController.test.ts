import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import {
	CommandController,
	type CommandNotification,
	type CommandProgress,
	type CommandTextDocument,
	type CommandUseCase,
} from '../integration/commandController';
import { createWorkspaceTrustGuard } from '../integration/workspaceTrustPolicy';
import type { SourceRange } from '../flow-model';
import type { VisualizationRequest, VisualizationResult } from '../application';
import type { VisualizationView, VisualizationViewModel } from '../integration/visualizationView';

suite('CommandController', () => {
	test('creates plain VisualizationRequest from cursor command', async () => {
		const useCase = new StubUseCase(successResult());
		const controller = createController(useCase);
		const document = textDocument('file:///workspace/source.ts', 'typescript', 7, 'function sample() {\n  load();\n}\n');

		await controller.visualizeFromCursor({
			document,
			position: { line: 1, character: 2 },
			cancellation: { isCancellationRequested: false },
		});

		assert.strictEqual(useCase.requests.length, 1);
		assert.deepStrictEqual(useCase.requests[0], {
			source: {
				uri: 'file:///workspace/source.ts',
				languageId: 'typescript',
				version: 7,
				text: 'function sample() {\n  load();\n}\n',
			},
			cursorOffset: document.offsetAt({ line: 1, character: 2 }),
			functionRange: {
				start: { line: 1, character: 2 },
				end: { line: 1, character: 2 },
			},
			configuration: {
				configurationDigest: 'sha256:test-config',
			},
			cancellation: useCase.requests[0].cancellation,
		});
		assert.strictEqual(useCase.requests[0].cancellation.isCancellationRequested, false);
	});

	test('creates plain VisualizationRequest from CodeLens range command', async () => {
		const useCase = new StubUseCase(successResult());
		const controller = createController(useCase);
		const document = textDocument('file:///workspace/source.ts', 'javascript', 3, 'const save = () => saveUser();\n');
		const functionRange = range(0, 6, 0, 10);

		await controller.visualizeFromCodeLens({
			document,
			functionRange,
			cancellation: { isCancellationRequested: false },
		});

		assert.strictEqual(useCase.requests.length, 1);
		assert.strictEqual(useCase.requests[0].source.uri, 'file:///workspace/source.ts');
		assert.strictEqual(useCase.requests[0].source.languageId, 'javascript');
		assert.strictEqual(useCase.requests[0].source.version, 3);
		assert.strictEqual(useCase.requests[0].source.text, 'const save = () => saveUser();\n');
		assert.strictEqual(useCase.requests[0].cursorOffset, document.offsetAt(functionRange.start));
		assert.deepStrictEqual(useCase.requests[0].functionRange, functionRange);
	});

	test('propagates cancellation and cancels older execution when a new command starts', async () => {
		const firstGate = deferred<VisualizationResult>();
		const useCase = new StubUseCase(firstGate.promise);
		const controller = createController(useCase);
		const document = textDocument('file:///workspace/source.ts', 'typescript', 1, 'function a() {}\n');
		const first = controller.visualizeFromCursor({
			document,
			position: { line: 0, character: 9 },
			cancellation: { isCancellationRequested: false },
		});

		assert.strictEqual(useCase.requests.length, 1);
		assert.strictEqual(useCase.requests[0].cancellation.isCancellationRequested, false);

		useCase.nextResult = Promise.resolve(successResult('partial'));
		await controller.visualizeFromCursor({
			document,
			position: { line: 0, character: 10 },
			cancellation: { isCancellationRequested: false },
		});

		assert.strictEqual(useCase.requests[0].cancellation.isCancellationRequested, true);
		firstGate.resolve(successResult());
		await first;
	});

	test('suppresses stale result when an older execution resolves after a newer one', async () => {
		const firstGate = deferred<VisualizationResult>();
		const useCase = new StubUseCase(firstGate.promise);
		const view = new StubView();
		const notifications = new StubNotifications();
		const controller = createController(useCase, { view, notifications });
		const document = textDocument('file:///workspace/source.ts', 'typescript', 1, 'function a() {}\n');
		const first = controller.visualizeFromCursor({
			document,
			position: { line: 0, character: 9 },
			cancellation: { isCancellationRequested: false },
		});

		useCase.nextResult = Promise.resolve(successResult('partial'));
		await controller.visualizeFromCursor({
			document,
			position: { line: 0, character: 10 },
			cancellation: { isCancellationRequested: false },
		});

		firstGate.resolve(successResult('success'));
		await first;

		assert.deepStrictEqual(view.results.map(result => result.state), ['partial']);
		assert.deepStrictEqual(notifications.messages, []);
	});

	test('cancels and suppresses an older result when the document changes during analysis', async () => {
		const firstGate = deferred<VisualizationResult>();
		const useCase = new StubUseCase(firstGate.promise);
		const view = new StubView();
		const notifications = new StubNotifications();
		const progress = new StubProgress();
		const document = textDocument('file:///workspace/source.ts', 'typescript', 1, 'function a() { oldCall(); }\n');
		const controller = createController(useCase, { view, notifications, progress });
		const first = controller.visualizeFromCursor({
			document,
			position: { line: 0, character: 15 },
			cancellation: { isCancellationRequested: false },
		});

		controller.cancelForDocument('file:///workspace/source.ts');
		firstGate.resolve(successResult('success'));
		await first;

		assert.deepStrictEqual(useCase.requests.map(request => request.source.version), [1]);
		assert.strictEqual(useCase.requests[0].cancellation.isCancellationRequested, true);
		assert.deepStrictEqual(view.results, []);
		assert.deepStrictEqual(notifications.messages, []);
		assert.deepStrictEqual(progress.events, ['start', 'end']);
	});

	test('starts and ends progress while passing success and partial results to the visualization view', async () => {
		const progress = new StubProgress();
		const view = new StubView();
		const useCase = new StubUseCase(successResult());
		const controller = createController(useCase, { progress, view });
		const document = textDocument('file:///workspace/source.ts', 'typescript', 1, 'function sample() {}\n');

		await controller.visualizeFromCursor({
			document,
			position: { line: 0, character: 9 },
			cancellation: { isCancellationRequested: false },
		});
		useCase.nextResult = Promise.resolve(successResult('partial'));
		await controller.visualizeFromCursor({
			document,
			position: { line: 0, character: 10 },
			cancellation: { isCancellationRequested: false },
		});

		assert.deepStrictEqual(progress.events, ['start', 'end', 'start', 'end']);
		assert.deepStrictEqual(view.results.map(result => result.state), ['success', 'partial']);
	});

	test('maps failure statuses to notifications and shows a failure visualization state', async () => {
		for (const status of ['unsupported-language', 'target-not-found', 'cancelled', 'failed', 'render-failed'] as const) {
			const notifications = new StubNotifications();
			const view = new StubView();
			const controller = createController(new StubUseCase(failureResult(status)), { notifications, view });
			await controller.visualizeFromCursor({
				document: textDocument('file:///workspace/source.ts', 'typescript', 1, 'function sample() {}\n'),
				position: { line: 0, character: 9 },
				cancellation: { isCancellationRequested: false },
			});

			assert.strictEqual(view.results.length, 1);
			assert.strictEqual(view.results[0].state, 'failure');
			assert.strictEqual(view.results[0].fallbackText, status);
			assert.strictEqual(notifications.messages.length, 1);
			assert.strictEqual(notifications.messages[0].status, status);
		}
	});

	test('blocks command execution before reading source text in untrusted workspaces', async () => {
		const useCase = new StubUseCase(successResult());
		const view = new StubView();
		const notifications = new StubNotifications();
		const document = textDocument('file:///workspace/source.ts', 'typescript', 1, 'function sample() {}\n');
		const controller = createController(useCase, {
			view,
			notifications,
			trustGuard: () => createWorkspaceTrustGuard({ isTrusted: false }),
		});

		await controller.visualizeFromCursor({
			document: {
				...document,
				getText: () => {
					throw new Error('source text must not be read in an untrusted workspace');
				},
			},
			position: { line: 0, character: 9 },
			cancellation: { isCancellationRequested: false },
		});

		assert.deepStrictEqual(useCase.requests, []);
		assert.deepStrictEqual(view.results, []);
		assert.deepStrictEqual(notifications.trustMessages, [
			'GlitchLens function flow visualization is disabled in Restricted Mode. Trust this workspace to analyze and display source-derived flow data.',
		]);
	});

	test('re-evaluates workspace trust for later command executions', async () => {
		let isTrusted = false;
		const useCase = new StubUseCase(successResult());
		const notifications = new StubNotifications();
		const controller = createController(useCase, {
			notifications,
			trustGuard: () => createWorkspaceTrustGuard({ isTrusted }),
		});
		const document = textDocument('file:///workspace/source.ts', 'typescript', 1, 'function sample() {}\n');

		await controller.visualizeFromCursor({
			document,
			position: { line: 0, character: 9 },
			cancellation: { isCancellationRequested: false },
		});
		isTrusted = true;
		await controller.visualizeFromCursor({
			document,
			position: { line: 0, character: 9 },
			cancellation: { isCancellationRequested: false },
		});

		assert.strictEqual(useCase.requests.length, 1);
		assert.deepStrictEqual(notifications.trustMessages, [
			'GlitchLens function flow visualization is disabled in Restricted Mode. Trust this workspace to analyze and display source-derived flow data.',
		]);
	});

	test('does not pass VS Code objects to Application and does not call Analyzer or Renderer directly', async () => {
		const useCase = new StubUseCase(successResult());
		const controller = createController(useCase);
		const document = textDocument('file:///workspace/source.ts', 'typescript', 1, 'function sample() {}\n');

		await controller.visualizeFromCursor({
			document,
			position: { line: 0, character: 9 },
			cancellation: { isCancellationRequested: false },
		});

		assertNoFunctionProperties(useCase.requests[0]);

		const source = fs.readFileSync(path.resolve(__dirname, '../../src/integration/commandController.ts'), 'utf8');
		assert.ok(!source.includes('../analyzers'));
		assert.ok(!source.includes('../renderer'));
		assert.ok(!source.includes('MermaidRenderer'));
	});
});

class StubUseCase implements CommandUseCase {
	public readonly requests: VisualizationRequest[] = [];

	public constructor(public nextResult: Promise<VisualizationResult> | VisualizationResult) {}

	public execute(request: VisualizationRequest): Promise<VisualizationResult> {
		this.requests.push(request);
		return Promise.resolve(this.nextResult);
	}
}

class StubView implements VisualizationView {
	public readonly results: VisualizationViewModel[] = [];

	public show(model: VisualizationViewModel): Promise<void> {
		this.results.push(model);
		return Promise.resolve();
	}
}

class StubNotifications implements CommandNotification {
	public readonly messages: Array<{ readonly status: VisualizationResult['status']; readonly message: string }> = [];
	public readonly trustMessages: string[] = [];

	public showStatus(status: VisualizationResult['status'], message: string): Promise<void> {
		this.messages.push({ status, message });
		return Promise.resolve();
	}

	public showWorkspaceTrustRequired(message: string): Promise<void> {
		this.trustMessages.push(message);
		return Promise.resolve();
	}
}

class StubProgress implements CommandProgress {
	public readonly events: string[] = [];

	public async withProgress<T>(task: () => Promise<T>): Promise<T> {
		this.events.push('start');
		try {
			return await task();
		} finally {
			this.events.push('end');
		}
	}
}

function createController(useCase: CommandUseCase, overrides: {
	readonly view?: VisualizationView;
	readonly notifications?: CommandNotification;
	readonly progress?: CommandProgress;
	readonly trustGuard?: () => ReturnType<typeof createWorkspaceTrustGuard>;
} = {}): CommandController {
	return new CommandController({
		useCase,
		view: overrides.view ?? new StubView(),
		notifications: overrides.notifications ?? new StubNotifications(),
		progress: overrides.progress ?? new StubProgress(),
		configuration: {
			configurationDigest: 'sha256:test-config',
		},
		trustGuard: overrides.trustGuard ?? (() => createWorkspaceTrustGuard({ isTrusted: true })),
	});
}

function textDocument(uri: string, languageId: string, version: number, text: string): CommandTextDocument {
	return {
		uri: { toString: () => uri },
		languageId,
		version,
		getText: () => text,
		offsetAt: (position: { readonly line: number; readonly character: number }) => offsetAt(text, position),
	};
}

function offsetAt(text: string, position: { readonly line: number; readonly character: number }): number {
	const lines = text.split('\n');
	let offset = 0;
	for (let line = 0; line < position.line; line += 1) {
		offset += (lines[line]?.length ?? 0) + 1;
	}
	return offset + position.character;
}

function range(startLine: number, startCharacter: number, endLine: number, endCharacter: number): SourceRange {
	return {
		start: { line: startLine, character: startCharacter },
		end: { line: endLine, character: endCharacter },
	};
}

function successResult(status: 'success' | 'partial' = 'success'): VisualizationResult {
	return {
		status,
		mermaidText: 'sequenceDiagram\n',
		canCopyMermaid: true,
		sourceMap: [],
		notices: [],
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
				sourceLocation: { uri: 'file:///workspace/source.ts', range: range(0, 0, 1, 1) },
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
		notices: [{
			id: `notice:${status}`,
			kind: status === 'failed' ? 'analysis-failed' : status,
			severity: status === 'cancelled' ? 'info' : 'error',
			message: status,
		}],
		error: {
			kind: status,
			message: status,
		},
	};
}

function deferred<T>(): { readonly promise: Promise<T>; resolve(value: T): void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(innerResolve => {
		resolve = innerResolve;
	});
	return { promise, resolve };
}

function assertNoFunctionProperties(value: unknown): void {
	if (!value || typeof value !== 'object') {
		return;
	}
	for (const nested of Object.values(value as Record<string, unknown>)) {
		assert.notStrictEqual(typeof nested, 'function');
		assertNoFunctionProperties(nested);
	}
}
