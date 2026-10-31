## 2026-10-31 - Memoization in cascading layout loops
**Learning:** Wrapping leaf components in `React.memo()` is critical when parent components use  to interactively adjust layouts based on refs (which forces repeated rendering).
**Action:** Always check if leaf components rendering inside layout-measuring components can be memoized, especially if they perform expensive tasks like measuring text/canvas ink.
## 2026-10-31 - Memoization in cascading layout loops
**Learning:** Wrapping leaf components in React.memo() is critical when parent components use useLayoutEffect to interactively adjust layouts based on refs (which forces repeated rendering).
**Action:** Always check if leaf components rendering inside layout-measuring components can be memoized, especially if they perform expensive tasks like measuring text/canvas ink.
