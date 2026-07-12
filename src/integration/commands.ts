import * as vscode from 'vscode';

import {
	AnalysisCache,
	AnalyzerRegistry,
	VisualizeFunctionFlowUseCase,
	type VisualizationResult,
} from '../application';
import { TypeScriptAnalyzer } from '../analyzers';
import type { SourceRange } from '../flow-model';
import { MermaidRenderer } from '../renderer';
import { CommandController, type CommandNotification, type CommandProgress } from './commandController';
import { visualizeFunctionFlowCommandId } from './commandIds';
import {
	WebviewVisualizationAdapter,
	type ClipboardAdapter,
	type VisualizationViewNotification,
	type WebviewPanelFactory,
	type WebviewPanelPort,
} from './visualizationView';
import { getWorkspaceTrustGuard } from './workspaceTrust';

export { visualizeFunctionFlowCommandId } from './commandIds';

export interface CodeLensCommandInput {
	readonly uri: string;
	readonly languageId: string;
	readonly version: number;
	readonly functionName: string;
	readonly functionRange: {
		readonly startLine: number;
		readonly startCharacter: number;
		readonly endLine: number;
		readonly endCharacter: number;
	};
}

export function registerGlitchLensCommands(context: vscode.ExtensionContext): void {
	const controller = createDefaultCommandController();
	const visualizeCommand = vscode.commands.registerCommand(visualizeFunctionFlowCommandId, (input?: CodeLensCommandInput) => {
		const editor = vscode.window.activeTextEditor;

		if (!editor) {
			void vscode.window.showInformationMessage('GlitchLens: Open a TypeScript or JavaScript file to visualize function flow.');
			return;
		}

		if (input) {
			void controller.visualizeFromCodeLens({
				document: editor.document,
				functionRange: sourceRangeFromCodeLens(input.functionRange),
				cancellation: { isCancellationRequested: false },
			});
			return;
		}

		void controller.visualizeFromCursor({
			document: editor.document,
			position: editor.selection.active,
			cancellation: { isCancellationRequested: false },
		});
	});

	context.subscriptions.push(visualizeCommand);
}

function createDefaultCommandController(): CommandController {
	const useCase = new VisualizeFunctionFlowUseCase(
		new AnalyzerRegistry([new TypeScriptAnalyzer()]),
		new MermaidRenderer(),
		new AnalysisCache(),
	);

	return new CommandController({
		useCase,
		view: new WebviewVisualizationAdapter(
			new VsCodeWebviewPanelFactory(),
			new VsCodeClipboardAdapter(),
			new VsCodeVisualizationViewNotification(),
			getWorkspaceTrustGuard,
		),
		notifications: new VsCodeCommandNotification(),
		progress: new VsCodeCommandProgress(),
		configuration: {
			configurationDigest: 'default',
		},
		trustGuard: getWorkspaceTrustGuard,
	});
}

function sourceRangeFromCodeLens(range: CodeLensCommandInput['functionRange']): SourceRange {
	return {
		start: { line: range.startLine, character: range.startCharacter },
		end: { line: range.endLine, character: range.endCharacter },
	};
}

class VsCodeWebviewPanelFactory implements WebviewPanelFactory {
	public createPanel(options: {
		readonly enableScripts: boolean;
		readonly localResourceRoots: readonly string[];
	}): WebviewPanelPort {
		const panel = vscode.window.createWebviewPanel(
			'glitchlens.visualization',
			'GlitchLens',
			vscode.ViewColumn.Beside,
			{
				enableScripts: options.enableScripts,
				localResourceRoots: options.localResourceRoots.map(root => vscode.Uri.file(root)),
			},
		);
		return {
			webview: panel.webview,
			reveal: () => panel.reveal(vscode.ViewColumn.Beside),
			onDidDispose: listener => {
				panel.onDidDispose(listener);
			},
			onDidReceiveMessage: listener => {
				panel.webview.onDidReceiveMessage(listener);
			},
		};
	}
}

class VsCodeClipboardAdapter implements ClipboardAdapter {
	public writeText(text: string): Promise<void> {
		return Promise.resolve(vscode.env.clipboard.writeText(text));
	}
}

class VsCodeVisualizationViewNotification implements VisualizationViewNotification {
	public async showInfo(message: string): Promise<void> {
		await vscode.window.showInformationMessage(`GlitchLens: ${message}`);
	}

	public async showWarning(message: string): Promise<void> {
		await vscode.window.showWarningMessage(`GlitchLens: ${message}`);
	}

	public async showError(message: string): Promise<void> {
		await vscode.window.showErrorMessage(`GlitchLens: ${message}`);
	}
}

class VsCodeCommandNotification implements CommandNotification {
	public async showWorkspaceTrustRequired(message: string): Promise<void> {
		await vscode.window.showWarningMessage(`GlitchLens: ${message}`);
	}

	public async showStatus(status: VisualizationResult['status'], message: string): Promise<void> {
		if (status === 'cancelled') {
			await vscode.window.showInformationMessage(`GlitchLens: ${message}`);
			return;
		}
		if (status === 'unsupported-language' || status === 'target-not-found') {
			await vscode.window.showWarningMessage(`GlitchLens: ${message}`);
			return;
		}
		await vscode.window.showErrorMessage(`GlitchLens: ${message}`);
	}
}

class VsCodeCommandProgress implements CommandProgress {
	public withProgress<T>(task: () => Promise<T>): Promise<T> {
		return Promise.resolve(vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'GlitchLens: Visualizing function flow',
				cancellable: false,
			},
			task,
		));
	}
}
