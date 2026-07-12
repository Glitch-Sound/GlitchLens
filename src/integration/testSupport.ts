import * as vscode from 'vscode';

import type { VisualizationViewModel, VisualizationViewObserver } from './visualizationView';
import type { WebviewVisualizationAdapter } from './visualizationView';

export interface IntegrationProbeState {
	readonly lastModel?: VisualizationViewModel;
	readonly notifications: readonly string[];
	readonly panelCreateCount: number;
	readonly panelDisposeCount: number;
}

export class IntegrationTestProbe implements VisualizationViewObserver {
	private lastModel: VisualizationViewModel | undefined;
	private readonly notifications: string[] = [];
	private panelCreateCount = 0;
	private panelDisposeCount = 0;

	public didShowVisualization(model: VisualizationViewModel): void {
		this.lastModel = model;
	}

	public didCreatePanel(): void {
		this.panelCreateCount += 1;
	}

	public didDisposePanel(): void {
		this.panelDisposeCount += 1;
	}

	public recordNotification(severity: 'info' | 'warning' | 'error', message: string): void {
		this.notifications.push(`${severity}:${message}`);
	}

	public reset(): void {
		this.lastModel = undefined;
		this.notifications.length = 0;
		this.panelCreateCount = 0;
		this.panelDisposeCount = 0;
	}

	public state(): IntegrationProbeState {
		return {
			lastModel: this.lastModel,
			notifications: [...this.notifications],
			panelCreateCount: this.panelCreateCount,
			panelDisposeCount: this.panelDisposeCount,
		};
	}
}

export function registerIntegrationTestSupport(context: vscode.ExtensionContext, probe: IntegrationTestProbe, view: WebviewVisualizationAdapter): void {
	if (context.extensionMode !== vscode.ExtensionMode.Test) {
		return;
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('glitchlens.test.resetProbe', () => {
			view.dispose();
			probe.reset();
		}),
		vscode.commands.registerCommand('glitchlens.test.getProbeState', () => probe.state()),
		vscode.commands.registerCommand('glitchlens.test.copyCurrentMermaid', () => view.copyCurrentMermaidForTest()),
		vscode.commands.registerCommand('glitchlens.test.disposeVisualization', () => view.dispose()),
	);
}
