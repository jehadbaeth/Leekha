/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of apps/server's socket.io endpoint. Defaults to http://localhost:8080 in dev. */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
