export interface WorkspaceTrustState {
	readonly isTrusted: boolean;
}

export interface WorkspaceTrustGuard {
	readonly canExecuteCommand: boolean;
	readonly canProvideCodeLens: boolean;
	readonly canShowVisualization: boolean;
	readonly canWriteClipboard: boolean;
	readonly commandRestrictedMessage: string;
	readonly visualizationRestrictedMessage: string;
}

export function createWorkspaceTrustGuard(state: WorkspaceTrustState): WorkspaceTrustGuard {
	if (state.isTrusted) {
		return {
			canExecuteCommand: true,
			canProvideCodeLens: true,
			canShowVisualization: true,
			canWriteClipboard: true,
			commandRestrictedMessage: '',
			visualizationRestrictedMessage: '',
		};
	}

	return {
		canExecuteCommand: false,
		canProvideCodeLens: false,
		canShowVisualization: false,
		canWriteClipboard: false,
		commandRestrictedMessage: 'GlitchLens function flow visualization is disabled in Restricted Mode. Trust this workspace to analyze and display source-derived flow data.',
		visualizationRestrictedMessage: 'GlitchLens visualization is disabled in Restricted Mode. Trust this workspace to display source-derived flow data.',
	};
}
