/** Ambient types for the webview message dictionary (src/i18n/webview.js). */
export type Messages = Record<string, string>;

export declare const LOCALES: Record<string, Messages>;

export declare function getMessages(pref?: string): Messages;
