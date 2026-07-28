export interface WebViewObservation {
  title: string;
  url: string;
  text: string;
  viewport: {
    width: number;
    height: number;
  };
  elements: {
    index: number;
    tag: string;
    text: string;
    role: string;
    selector: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
}

export interface WebViewTapResult {
  x: number;
  y: number;
  target: string;
  text: string;
  selector?: string;
}

export interface WebViewScreenshot {
  title: string;
  url: string;
  dataUrl: string;
  format: 'jpg' | 'png';
  viewport: {
    width: number;
    height: number;
  };
  capturedAt: number;
}

export interface WebViewEvalJsResult {
  title: string;
  url: string;
  result: unknown;
  resultType: string;
}

export interface WebViewOpenOptions {
  userAgent?: 'mobile' | 'desktop';
}

export interface HtmlArtifactOpenOptions {
  messageId?: string;
  htmlBlockIndex?: number;
  artifactId?: string;
  artifactName?: string;
  html: string;
  title?: string;
}

export interface HtmlArtifactInfo {
  messageId?: string;
  htmlBlockIndex?: number;
  artifactId?: string;
  artifactName?: string;
  title: string;
  dirty: boolean;
}

export interface HtmlArtifactPatch {
  text?: string;
  html?: string;
  style?: Record<string, string | number | null | undefined>;
  attributes?: Record<string, string | number | boolean | null | undefined>;
}

export interface WebViewHostActions {
  show: () => void;
  isOpen: () => boolean;
  observeIfOpen: () => Promise<WebViewObservation | null>;
  open: (url: string, options?: WebViewOpenOptions) => Promise<WebViewObservation>;
  openHtmlArtifact: (options: HtmlArtifactOpenOptions) => Promise<WebViewObservation>;
  observe: () => Promise<WebViewObservation>;
  tap: (x: number, y: number) => Promise<WebViewTapResult>;
  clickElement: (index: number) => Promise<WebViewTapResult>;
  clickSelector: (selector: string) => Promise<WebViewTapResult>;
  wait: (ms: number) => Promise<WebViewObservation>;
  evalJs: (script: string) => Promise<WebViewEvalJsResult>;
  screenshot: () => Promise<WebViewScreenshot>;
  getHtmlArtifactSource: () => Promise<{ html: string; info: HtmlArtifactInfo }>;
  replaceHtmlArtifactSource: (html: string) => Promise<WebViewObservation>;
  patchHtmlArtifactElement: (selector: string, patch: HtmlArtifactPatch) => Promise<WebViewObservation>;
  saveHtmlArtifact: () => Promise<{ messageId?: string; htmlBlockIndex?: number; artifactId?: string }>;
}

let hostActions: WebViewHostActions | null = null;

export function registerWebViewHost(actions: WebViewHostActions): () => void {
  hostActions = actions;
  return () => {
    if (hostActions === actions) {
      hostActions = null;
    }
  };
}

function getHostActions(): WebViewHostActions {
  if (!hostActions) {
    throw new Error('网页交互面板尚未就绪');
  }
  return hostActions;
}

export async function openWebView(
  url: string,
  options?: WebViewOpenOptions
): Promise<WebViewObservation> {
  return getHostActions().open(url, options);
}

export async function openHtmlArtifact(options: HtmlArtifactOpenOptions): Promise<WebViewObservation> {
  return getHostActions().openHtmlArtifact(options);
}

export function showWebViewPanel(): void {
  getHostActions().show();
}

export async function observeActiveWebView(): Promise<WebViewObservation | null> {
  return getHostActions().observeIfOpen();
}

export async function observeWebView(): Promise<WebViewObservation> {
  return getHostActions().observe();
}

export async function tapWebView(x: number, y: number): Promise<WebViewTapResult> {
  return getHostActions().tap(x, y);
}

export async function clickWebViewElement(index: number): Promise<WebViewTapResult> {
  return getHostActions().clickElement(index);
}

export async function clickWebViewSelector(selector: string): Promise<WebViewTapResult> {
  return getHostActions().clickSelector(selector);
}

export async function waitWebView(ms: number): Promise<WebViewObservation> {
  return getHostActions().wait(ms);
}

export async function evalWebViewJs(script: string): Promise<WebViewEvalJsResult> {
  return getHostActions().evalJs(script);
}

export async function screenshotWebView(): Promise<WebViewScreenshot> {
  return getHostActions().screenshot();
}

export async function getHtmlArtifactSource(): Promise<{ html: string; info: HtmlArtifactInfo }> {
  return getHostActions().getHtmlArtifactSource();
}

export async function replaceHtmlArtifactSource(html: string): Promise<WebViewObservation> {
  return getHostActions().replaceHtmlArtifactSource(html);
}

export async function patchHtmlArtifactElement(
  selector: string,
  patch: HtmlArtifactPatch
): Promise<WebViewObservation> {
  return getHostActions().patchHtmlArtifactElement(selector, patch);
}

export async function saveHtmlArtifact(): Promise<{ messageId?: string; htmlBlockIndex?: number; artifactId?: string }> {
  return getHostActions().saveHtmlArtifact();
}
