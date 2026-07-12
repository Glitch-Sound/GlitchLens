import * as vscode from 'vscode';

import { createWorkspaceTrustGuard, type WorkspaceTrustGuard, type WorkspaceTrustState } from './workspaceTrustPolicy';

export { createWorkspaceTrustGuard, type WorkspaceTrustGuard, type WorkspaceTrustState } from './workspaceTrustPolicy';

export function getWorkspaceTrustState(): WorkspaceTrustState {
	return {
		isTrusted: vscode.workspace.isTrusted,
	};
}

export function getWorkspaceTrustGuard(): WorkspaceTrustGuard {
	return createWorkspaceTrustGuard(getWorkspaceTrustState());
}
