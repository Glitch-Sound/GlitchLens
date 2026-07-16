export interface SourcePosition {
	readonly line: number;
	readonly character: number;
}

export interface SourceRange {
	readonly start: SourcePosition;
	readonly end: SourcePosition;
}

export interface SourceLocation {
	readonly uri: string;
	readonly range: SourceRange;
	readonly symbolName?: string;
}

/** Language identifiers are supplied by registered analyzers. */
export type SupportedLanguageId = string;

export interface FlowSource {
	readonly uri: string;
	readonly languageId: SupportedLanguageId;
	readonly documentVersion: number;
}
