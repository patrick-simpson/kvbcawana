## YYYY-MM-DD - ESLint and Dependency Array Optimization
**Learning:** The ESLint configuration in this codebase strictly enforces `react-hooks/exhaustive-deps`. Using logical expressions like `|| []` directly inside dependency arrays (or inside useMemo/useEffect when not included in dependency arrays, or in ways that cause warnings when trying to satisfy the linter) is considered an anti-pattern because the default array instance changes on every render.
**Action:** Move fallback initializations inside the hook callback and ensure dependency arrays are clean.
