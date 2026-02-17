export interface RuntimeConfig {
  apiBaseUrl: string;
  vapidPublicKey: string;
}

declare global {
  interface Window {
    __SECRETARY_CONFIG__?: Partial<RuntimeConfig>;
  }
}

export function readRuntimeConfig(): RuntimeConfig {
  const apiBaseUrl = window.__SECRETARY_CONFIG__?.apiBaseUrl?.trim() ?? '';
  const vapidPublicKey = window.__SECRETARY_CONFIG__?.vapidPublicKey?.trim() ?? '';
  return {
    apiBaseUrl,
    vapidPublicKey
  };
}
