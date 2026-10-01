// The React hooks the `// @ts-check`'d code imports, declared here for the
// same reason as types/react-dom.d.ts: there is no @types/react, and
// TypeScript 7's parallel program load reads react/index.js's cjs/ files on
// some runs and not others, so inferring React from its own JS failed a
// deploy with TS2305 "no exported member 'useState'" (it passed 30 of 30
// runs locally). jsconfig.json maps the bare 'react' specifier here;
// 'react/jsx-runtime' still resolves to the package. The checked files only
// ever import hooks (src/hooks/*.js); add a declaration here before a
// checked file imports anything else from bare 'react'.
type Deps = readonly unknown[];
type SetState<S> = (value: S | ((prev: S) => S)) => void;
export function useState<S>(initial: S | (() => S)): [S, SetState<S>];
export function useState<S = undefined>(): [S | undefined, SetState<S | undefined>];
export function useEffect(effect: () => void | (() => void), deps?: Deps): void;
export function useLayoutEffect(effect: () => void | (() => void), deps?: Deps): void;
export function useCallback<T extends (...args: any[]) => any>(callback: T, deps: Deps): T;
export function useRef<T>(initial: T): { current: T };
export function useRef<T = undefined>(): { current: T | undefined };
export function useSyncExternalStore<S>(subscribe: (onChange: () => void) => () => void, getSnapshot: () => S, getServerSnapshot?: () => S): S;
