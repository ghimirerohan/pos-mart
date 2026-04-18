/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional absolute ERPNext desk origin when it differs from the SPA (e.g. http://localhost:8000). */
  readonly VITE_ERPNEXT_DESK_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  interface Window {
    csrf_token?: string;
  }
}

export {};
