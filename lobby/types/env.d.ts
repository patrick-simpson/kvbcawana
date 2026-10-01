// Minimal ambient shim so `// @ts-check`'d files can touch Vite's
// import.meta.env without dragging in the full vite/client types.
interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly PROD: boolean;
  readonly DEV: boolean;
  readonly MODE: string;
  // Baked Pusher subscribe key + cluster (deploy.yml passes the repository
  // variables PUSHER_APP_KEY / PUSHER_CLUSTER through as these).
  readonly VITE_PUSHER_APP_KEY?: string;
  readonly VITE_PUSHER_CLUSTER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Vite asset imports the brand kit uses (src/lib/brand.js, src/lib/clubs.js):
// `?raw` hands over the file's text, a bare asset import its URL.
declare module '*?raw' {
  const text: string;
  export default text;
}
declare module '*.svg' {
  const url: string;
  export default url;
}
