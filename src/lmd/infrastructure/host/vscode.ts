export type VsCodeApiLike = {
  postMessage(message: unknown): void;
};

export function acquireVsCodeApi(): VsCodeApiLike | null {
  const acquire = (window as Window & { acquireVsCodeApi?: () => VsCodeApiLike }).acquireVsCodeApi;
  return typeof acquire === 'function' ? acquire() : null;
}
