import * as vscode from 'vscode';

import { AnalysisCache, AnalyzerRegistry, VisualizeFunctionFlowUseCase, type VisualizationResult } from '../application';
import { FunctionLocatorRegistry, PythonAnalyzer, PythonFunctionLocator, TypeScriptAnalyzer, TypeScriptFunctionLocator } from '../analyzers';
import { MermaidRenderer } from '../renderer';
import { CommandController, type CommandNotification, type CommandProgress } from './commandController';
import type { IntegrationTestProbe } from './testSupport';
import {
	WebviewVisualizationAdapter,
	type ClipboardAdapter,
	type VisualizationViewNotification,
	type WebviewPanelFactory,
	type WebviewPanelPort,
} from './visualizationView';
import { getWorkspaceTrustGuard } from './workspaceTrust';

export function createVsCodeVisualizationView(probe?: IntegrationTestProbe): WebviewVisualizationAdapter {
	return new WebviewVisualizationAdapter(
		new VsCodeWebviewPanelFactory(probe),
		new VsCodeClipboardAdapter(),
		new VsCodeVisualizationViewNotification(probe),
		getWorkspaceTrustGuard,
		probe,
	);
}

export function createVsCodeFunctionLocatorRegistry(): FunctionLocatorRegistry {
	return new FunctionLocatorRegistry([
		new TypeScriptFunctionLocator(),
		new PythonFunctionLocator(),
	]);
}

export function createVsCodeCommandController(view: WebviewVisualizationAdapter, probe?: IntegrationTestProbe): CommandController {
	const useCase = new VisualizeFunctionFlowUseCase(
		new AnalyzerRegistry([new TypeScriptAnalyzer(), new PythonAnalyzer()]),
		new MermaidRenderer(),
		new AnalysisCache(),
	);

	return new CommandController({
		useCase,
		view,
		notifications: new VsCodeCommandNotification(probe),
		progress: new VsCodeCommandProgress(),
		configuration: {
			configurationDigest: 'default',
		},
		trustGuard: getWorkspaceTrustGuard,
	});
}

class VsCodeWebviewPanelFactory implements WebviewPanelFactory {
	public constructor(private readonly probe?: IntegrationTestProbe) {}

	public createPanel(options: {
		readonly enableScripts: boolean;
		readonly localResourceRoots: readonly string[];
	}): WebviewPanelPort {
		this.probe?.didCreatePanel();
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
			dispose: () => {
				this.probe?.didDisposePanel();
				panel.dispose();
			},
			onDidDispose: listener => panel.onDidDispose(listener),
			onDidReceiveMessage: listener => panel.webview.onDidReceiveMessage(listener),
		};
	}
}

class VsCodeClipboardAdapter implements ClipboardAdapter {
	public writeText(text: string): Promise<void> {
		return Promise.resolve(vscode.env.clipboard.writeText(text));
	}
}

class VsCodeVisualizationViewNotification implements VisualizationViewNotification {
	public constructor(private readonly probe?: IntegrationTestProbe) {}

	public async showInfo(message: string): Promise<void> {
		this.probe?.recordNotification('info', message);
		if (this.probe) {
			return;
		}
		await vscode.window.showInformationMessage(`GlitchLens: ${message}`);
	}

	public async showWarning(message: string): Promise<void> {
		this.probe?.recordNotification('warning', message);
		if (this.probe) {
			return;
		}
		await vscode.window.showWarningMessage(`GlitchLens: ${message}`);
	}

	public async showError(message: string): Promise<void> {
		this.probe?.recordNotification('error', message);
		if (this.probe) {
			return;
		}
		await vscode.window.showErrorMessage(`GlitchLens: ${message}`);
	}
}

class VsCodeCommandNotification implements CommandNotification {
	public constructor(private readonly probe?: IntegrationTestProbe) {}

	public async showWorkspaceTrustRequired(message: string): Promise<void> {
		this.probe?.recordNotification('warning', message);
		if (this.probe) {
			return;
		}
		await vscode.window.showWarningMessage(`GlitchLens: ${message}`);
	}

	public async showStatus(status: VisualizationResult['status'], message: string): Promise<void> {
		if (status === 'cancelled') {
			this.probe?.recordNotification('info', `${status}:${message}`);
			if (this.probe) {
				return;
			}
			await vscode.window.showInformationMessage(`GlitchLens: ${message}`);
			return;
		}
		if (status === 'unsupported-language' || status === 'target-not-found') {
			this.probe?.recordNotification('warning', `${status}:${message}`);
			if (this.probe) {
				return;
			}
			await vscode.window.showWarningMessage(`GlitchLens: ${message}`);
			return;
		}
		this.probe?.recordNotification('error', `${status}:${message}`);
		if (this.probe) {
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
