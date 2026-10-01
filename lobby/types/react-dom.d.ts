// The one piece of react-dom the `// @ts-check`'d code imports, declared
// here so `tsc` never has to infer react-dom's shape from its own JS.
// There is no @types/react-dom; inferring from react-dom/index.js depends on
// whether tsc happens to read its cjs/ files, which TypeScript 7's parallel
// program load decides differently from run to run (a flaky TS2305 on
// flushSync). jsconfig.json maps the bare 'react-dom' specifier here;
// 'react-dom/client' and friends still resolve to the real package. Add a
// declaration here before importing anything else from bare 'react-dom'.
export function flushSync<R>(fn: () => R): R;
