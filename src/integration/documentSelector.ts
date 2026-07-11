export const supportedLanguageIds = ['typescript', 'javascript'] as const;

export type SupportedLanguageId = typeof supportedLanguageIds[number];

export function isSupportedLanguage(languageId: string): languageId is SupportedLanguageId {
	return supportedLanguageIds.includes(languageId as SupportedLanguageId);
}
