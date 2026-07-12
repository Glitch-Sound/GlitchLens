import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { GlitchLensCodeLensProvider } from '../integration/codeLensProvider';
import { visualizeFunctionFlowCommandId } from '../integration/commandIds';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
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
});
