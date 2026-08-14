/** Types for the Pug template compiled to `webview-template.cjs` by the build. */
interface WebviewLocals {
  standalone: boolean;
  csp: string | null;
  nonce?: string;
  cssHref: string;
  viewerSrc: string;
  editorSrc: string | null;
  t: Record<string, string>;
  lang: string;
}
declare const renderWebview: (locals: WebviewLocals) => string;
export = renderWebview;
