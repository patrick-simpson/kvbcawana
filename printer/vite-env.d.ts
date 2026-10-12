// Vite's asset imports, as the public pages use them (the brand kit's shapes
// and doodles as ?raw strings, its club marks as URLs).
declare module '*.svg?raw' {
  const svg: string;
  export default svg;
}
declare module '*.svg' {
  const url: string;
  export default url;
}
interface ImportMeta {
  glob<T = unknown>(pattern: string, options?: { query?: string; import?: string; eager?: boolean }): Record<string, T>;
}
