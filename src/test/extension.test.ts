import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import * as vscode from 'vscode';
import { GlitchLensCodeLensProvider } from '../integration/codeLensProvider';
import { visualizeFunctionFlowCommandId } from '../integration/commandIds';
import { supportedLanguageIds } from '../integration/documentSelector';
import type { VisualizationViewModel } from '../integration/visualizationView';

interface IntegrationProbeState {
	readonly lastModel?: VisualizationViewModel;
	readonly notifications: readonly string[];
	readonly panelCreateCount: number;
	readonly panelDisposeCount: number;
}

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('registers the visualization command declared by package.json without template command leftovers', async () => {
		await activateExtensionUnderTest();
		const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')) as {
			activationEvents?: string[];
			contributes?: {
				commands?: Array<{ readonly command: string }>;
				configuration?: {
					properties?: {
						readonly 'glitchlens.supportedLanguages'?: {
							readonly default?: readonly string[];
						};
					};
				};
			};
		};
		const runtimeCommands = await vscode.commands.getCommands(true);
		const packageCommands = packageJson.contributes?.commands?.map(command => command.command) ?? [];

		assert.ok(runtimeCommands.includes(visualizeFunctionFlowCommandId));
		assert.deepStrictEqual(packageCommands, [visualizeFunctionFlowCommandId]);
		assert.ok(!runtimeCommands.includes('glitchlens.helloWorld'));
		assert.ok(!packageCommands.includes('glitchlens.helloWorld'));
		assert.ok(packageJson.activationEvents?.includes(`onCommand:${visualizeFunctionFlowCommandId}`));
		assert.deepStrictEqual(packageJson.contributes?.configuration?.properties?.['glitchlens.supportedLanguages']?.default, [...supportedLanguageIds]);
	});

	test('CodeLens provider respects cancellation and uses latest document ranges', async () => {
		const provider = new GlitchLensCodeLensProvider();
		const cancelled = new vscode.CancellationTokenSource();
		cancelled.cancel();
		const document = await vscode.workspace.openTextDocument({
			language: 'typescript',
			content: 'function first() {}\n',
		});

		assert.deepStrictEqual(provider.provideCodeLenses(document, cancelled.token), []);

		const latest = await vscode.workspace.openTextDocument({
			language: 'typescript',
			content: '\nfunction shifted() {}\n',
		});
		const lenses = provider.provideCodeLenses(latest, new vscode.CancellationTokenSource().token);

		assert.strictEqual(lenses.length, 1);
		assert.strictEqual(lenses[0].command?.command, visualizeFunctionFlowCommandId);
		assert.strictEqual(lenses[0].range.start.line, 1);
		assert.strictEqual(lenses[0].command?.arguments?.[0].functionRange.startLine, 1);
	});

	test('cursor command displays complete success for TypeScript JavaScript TSX and JSX documents', async () => {
		await activateExtensionUnderTest();
		for (const fixture of [
			{ language: 'typescript', source: 'function loadUser() {\n  fetchUser();\n}\n', cursor: new vscode.Position(1, 2), expected: 'fetchUser' },
			{ language: 'javascript', source: 'function saveUser() {\n  persistUser();\n}\n', cursor: new vscode.Position(1, 2), expected: 'persistUser' },
			{ language: 'typescriptreact', source: 'function Card() {\n  renderCard();\n  return <div />;\n}\n', cursor: new vscode.Position(1, 2), expected: 'renderCard' },
			{ language: 'javascriptreact', source: 'function Button() {\n  trackClick();\n  return <button />;\n}\n', cursor: new vscode.Position(1, 2), expected: 'trackClick' },
		]) {
			await resetProbe();
			const document = await vscode.workspace.openTextDocument({ language: fixture.language, content: fixture.source });
			const editor = await vscode.window.showTextDocument(document);
			editor.selection = new vscode.Selection(fixture.cursor, fixture.cursor);

			await vscode.commands.executeCommand(visualizeFunctionFlowCommandId);

			const state = await waitForProbeModel();
			assert.strictEqual(state.lastModel?.state, 'success', fixture.language);
			assert.strictEqual(state.lastModel?.rootFunctionName, fixture.language === 'javascriptreact' ? 'Button' : fixture.language === 'typescriptreact' ? 'Card' : fixture.language === 'javascript' ? 'saveUser' : 'loadUser');
			assert.ok(state.lastModel?.mermaidText?.includes(fixture.expected), fixture.language);
			assert.strictEqual(state.panelCreateCount, 1);
		}
	});

	test('cursor command displays partial result with unknown and unresolved notices', async () => {
		await activateExtensionUnderTest();
		await resetProbe();
		const document = await vscode.workspace.openTextDocument({
			language: 'typescript',
			content: [
				'function inspect(methodName: string) {',
				'  getTarget().run();',
				'  getTarget()[methodName]();',
				'  with (dynamicTarget) { run(); }',
				'}',
			].join('\n'),
		});
		const editor = await vscode.window.showTextDocument(document);
		const cursor = new vscode.Position(1, 2);
		editor.selection = new vscode.Selection(cursor, cursor);

		await vscode.commands.executeCommand(visualizeFunctionFlowCommandId);

		const state = await waitForProbeModel();
		assert.strictEqual(state.lastModel?.state, 'partial');
		assert.ok(state.lastModel?.mermaidText?.includes('unknown call'));
		assert.ok(state.lastModel?.notices.some(notice => notice.kind === 'unresolved-call'));
		assert.ok(state.lastModel?.notices.some(notice => notice.kind === 'unknown-call'));
		assert.ok(state.lastModel?.notices.some(notice => notice.kind === 'unsupported-syntax'));
	});

	test('CodeLens command passes the selected function range into complete and unresolved visualization flows', async () => {
		await activateExtensionUnderTest();
		await resetProbe();
		const document = await openFixtureFile('codelens-flow.ts', [
				'function first() {',
				'  firstCall();',
				'}',
				'function second() {',
				'  getTarget().execute();',
				'}',
			].join('\n'));
		await vscode.window.showTextDocument(document);
		const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', document.uri);

		assert.strictEqual(lenses.length, 2);
		assert.strictEqual(lenses[0].command?.command, visualizeFunctionFlowCommandId);
		assert.strictEqual(lenses[1].command?.command, visualizeFunctionFlowCommandId);
		const firstCommand = lenses[0].command;
		const secondCommand = lenses[1].command;
		assert.ok(firstCommand);
		assert.ok(secondCommand);
		await vscode.commands.executeCommand(firstCommand.command, ...(firstCommand.arguments ?? []));
		let state = await waitForProbeModel();
		assert.strictEqual(state.lastModel?.state, 'success');
		assert.strictEqual(state.lastModel?.rootFunctionName, 'first');
		assert.ok(state.lastModel?.mermaidText?.includes('firstCall'));

		await vscode.commands.executeCommand(secondCommand.command, ...(secondCommand.arguments ?? []));
		state = await waitForProbeModel(model => model.rootFunctionName === 'second');
		assert.strictEqual(state.lastModel?.state, 'partial');
		assert.strictEqual(state.lastModel?.rootFunctionName, 'second');
		assert.ok(state.lastModel?.notices.some(notice => notice.kind === 'unresolved-call'));
	});

	test('copies displayed Mermaid text and reports when copy is unavailable', async () => {
		await activateExtensionUnderTest();
		await resetProbe();
		const document = await vscode.workspace.openTextDocument({
			language: 'typescript',
			content: 'function copyable() {\n  makeDiagram();\n}\n',
		});
		const editor = await vscode.window.showTextDocument(document);
		const cursor = new vscode.Position(1, 2);
		editor.selection = new vscode.Selection(cursor, cursor);
		await vscode.commands.executeCommand(visualizeFunctionFlowCommandId);
		await waitForProbeModel();

		await vscode.commands.executeCommand('glitchlens.test.copyCurrentMermaid');
		assert.ok((await vscode.env.clipboard.readText()).includes('makeDiagram'));

		const python = await vscode.workspace.openTextDocument({ language: 'python', content: 'def nope():\n    pass\n' });
		await vscode.window.showTextDocument(python);
		await vscode.commands.executeCommand(visualizeFunctionFlowCommandId);
		await waitForProbeModel();
		await vscode.commands.executeCommand('glitchlens.test.copyCurrentMermaid');
		const state = await getProbeState();
		assert.ok(state.notifications.includes('warning:No Mermaid text is available to copy.'));
	});

	test('reports unsupported language target not found panel reuse and lifecycle disposal', async () => {
		await activateExtensionUnderTest();
		await resetProbe();
		const python = await vscode.workspace.openTextDocument({ language: 'python', content: 'def nope():\n    pass\n' });
		await vscode.window.showTextDocument(python);
		await vscode.commands.executeCommand(visualizeFunctionFlowCommandId);
		let state = await waitForProbeModel();
		assert.strictEqual(state.lastModel?.state, 'failure');
		assert.ok(state.notifications.some(message => message.includes('unsupported-language')));

		const outside = await vscode.workspace.openTextDocument({ language: 'typescript', content: 'const value = 1;\nfunction later() {}\n' });
		const editor = await vscode.window.showTextDocument(outside);
		editor.selection = new vscode.Selection(new vscode.Position(0, 2), new vscode.Position(0, 2));
		await vscode.commands.executeCommand(visualizeFunctionFlowCommandId);
		state = await waitForProbeModel(model => model.fallbackText.includes('No target function'));
		assert.strictEqual(state.lastModel?.state, 'failure');
		assert.ok(state.notifications.some(message => message.includes('target-not-found')));

		const success = await vscode.workspace.openTextDocument({ language: 'typescript', content: 'function reusable() {\n  one();\n}\n' });
		const reusableEditor = await vscode.window.showTextDocument(success);
		const cursor = new vscode.Position(1, 2);
		reusableEditor.selection = new vscode.Selection(cursor, cursor);
		await vscode.commands.executeCommand(visualizeFunctionFlowCommandId);
		await waitForProbeModel();
		await vscode.commands.executeCommand(visualizeFunctionFlowCommandId);
		state = await waitForProbeModel();
		assert.strictEqual(state.panelCreateCount, 1);

		await vscode.commands.executeCommand('glitchlens.test.disposeVisualization');
		state = await getProbeState();
		assert.strictEqual(state.panelDisposeCount, 1);
	});
});

async function activateExtensionUnderTest(): Promise<void> {
	const extension = vscode.extensions.all.find(candidate => candidate.packageJSON.name === 'glitchlens');
	assert.ok(extension, 'GlitchLens extension should be available in the integration host.');
	await extension.activate();
}

async function resetProbe(): Promise<void> {
	await vscode.commands.executeCommand('glitchlens.test.resetProbe');
}

async function getProbeState(): Promise<IntegrationProbeState> {
	const state = await vscode.commands.executeCommand<IntegrationProbeState>('glitchlens.test.getProbeState');
	assert.ok(state, 'GlitchLens integration probe should be registered in ExtensionMode.Test.');
	return state;
}

async function waitForProbeModel(predicate: (model: VisualizationViewModel) => boolean = () => true): Promise<IntegrationProbeState> {
	const deadline = Date.now() + 2000;
	let state = await getProbeState();
	while ((!state.lastModel || !predicate(state.lastModel)) && Date.now() < deadline) {
		await delay(25);
		state = await getProbeState();
	}
	assert.ok(state.lastModel, 'Expected GlitchLens to publish a visualization model.');
	assert.ok(predicate(state.lastModel), 'Expected GlitchLens visualization model to match the requested state.');
	return state;
}

function delay(milliseconds: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function openFixtureFile(fileName: string, content: string): Promise<vscode.TextDocument> {
	const uri = vscode.Uri.file(path.join('/tmp', 'glitchlens-vscode-test-fixtures', fileName));
	await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(uri.fsPath)));
	await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
	return vscode.workspace.openTextDocument(uri);
}
