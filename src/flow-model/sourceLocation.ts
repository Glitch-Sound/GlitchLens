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

export type SupportedLanguageId = 'typescript' | 'javascript';

export interface FlowSource {
	readonly uri: string;
	readonly languageId: SupportedLanguageId;
	readonly documentVersion: number;
}
