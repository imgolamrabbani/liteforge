interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let cached: VsCodeApi | null = null;

export function getVsCodeApi(): VsCodeApi {
  if (cached) return cached;
  if (typeof acquireVsCodeApi === 'function') {
    cached = acquireVsCodeApi();
  } else {
    cached = {
      postMessage: () => undefined,
      getState: () => undefined,
      setState: () => undefined,
    };
  }
  return cached;
}

export function postToExtension(message: Record<string, unknown>): void {
  getVsCodeApi().postMessage(message);
}
