import type { VisualizationRequest, VisualizationResult } from '../application';
import type { SourceRange } from '../flow-model';
import { createVisualizationViewModel, type VisualizationView } from './visualizationView';
import type { WorkspaceTrustGuard } from './workspaceTrustPolicy';

export type WorkspaceTrustGuardProvider = () => WorkspaceTrustGuard;

export interface CommandPosition {
	readonly line: number;
	readonly character: number;
}

export interface CommandTextDocument {
	readonly uri: {
		toString(): string;
	};
	readonly languageId: string;
	readonly version: number;
	getText(): string;
	offsetAt(position: CommandPosition): number;
}

export interface CommandCancellationToken {
	readonly isCancellationRequested: boolean;
}

export interface CursorCommandInput {
	readonly document: CommandTextDocument;
	readonly position: CommandPosition;
	readonly cancellation: CommandCancellationToken;
}

export interface CodeLensExecutionInput {
	readonly document: CommandTextDocument;
	readonly functionRange: SourceRange;
	readonly cancellation: CommandCancellationToken;
}

export interface CommandUseCase {
	execute(request: VisualizationRequest): Promise<VisualizationResult>;
}

export interface CommandNotification {
	showStatus(status: VisualizationResult['status'], message: string): Promise<void>;
	showWorkspaceTrustRequired(message: string): Promise<void>;
}

export interface CommandProgress {
	withProgress<T>(task: () => Promise<T>): Promise<T>;
}

export interface CommandConfiguration {
	readonly configurationDigest: string;
	readonly maxDepth?: number;
}

export interface CommandControllerOptions {
	readonly useCase: CommandUseCase;
	readonly view: VisualizationView;
	readonly notifications: CommandNotification;
	readonly progress: CommandProgress;
	readonly configuration: CommandConfiguration;
	readonly trustGuard: WorkspaceTrustGuardProvider;
}

export class CommandController {
	private activeCancellation?: MutableCancellationSignal;
	private activeDocumentUri?: string;

	public constructor(private readonly options: CommandControllerOptions) {}

	public visualizeFromCursor(input: CursorCommandInput): Promise<void> {
		const cursorRange = {
			start: input.position,
			end: input.position,
		};
		return this.execute(input.document, input.position, cursorRange, input.cancellation);
	}

	public visualizeFromCodeLens(input: CodeLensExecutionInput): Promise<void> {
		return this.execute(input.document, input.functionRange.start, input.functionRange, input.cancellation);
	}

	private async execute(
		document: CommandTextDocument,
		position: CommandPosition,
		functionRange: SourceRange,
		externalCancellation: CommandCancellationToken,
	): Promise<void> {
		const trustGuard = this.options.trustGuard();
		if (!trustGuard.canExecuteCommand) {
			await this.options.notifications.showWorkspaceTrustRequired(trustGuard.commandRestrictedMessage);
			return;
		}

		this.activeCancellation?.cancel();
		const cancellation = new MutableCancellationSignal(externalCancellation);
		this.activeCancellation = cancellation;
		this.activeDocumentUri = document.uri.toString();

		await this.options.progress.withProgress(async () => {
			const result = await this.options.useCase.execute({
				source: {
					uri: document.uri.toString(),
					languageId: document.languageId,
					version: document.version,
					text: document.getText(),
				},
				cursorOffset: document.offsetAt(position),
				functionRange,
				configuration: this.options.configuration,
				cancellation,
			});

			if (this.activeCancellation !== cancellation || cancellation.isCancellationRequested) {
				return;
			}
			this.activeCancellation = undefined;
			this.activeDocumentUri = undefined;

			if (isDisplayableResult(result)) {
				await this.options.view.show(createVisualizationViewModel(result));
				return;
			}

			const failure = result;
			await this.options.view.show(createVisualizationViewModel(failure));
			await this.options.notifications.showStatus(failure.status, notificationMessage(failure));
		});
	}

	public cancelForDocument(documentUri: string): void {
		if (this.activeDocumentUri === documentUri) {
			this.activeCancellation?.cancel();
		}
	}
}

class MutableCancellationSignal {
	private internallyCancelled = false;

	public constructor(private readonly external: CommandCancellationToken) {}

	public get isCancellationRequested(): boolean {
		return this.internallyCancelled || this.external.isCancellationRequested;
	}

	public cancel(): void {
		this.internallyCancelled = true;
	}
}

function notificationMessage(result: Exclude<VisualizationResult, { status: 'success' | 'partial' }>): string {
	if (result.notices.length > 0) {
		return result.notices.map(notice => notice.message).join('\n');
	}
	return result.error.message;
}

function isDisplayableResult(result: VisualizationResult): result is Extract<VisualizationResult, { status: 'success' | 'partial' }> {
	return result.status === 'success' || result.status === 'partial';
}
