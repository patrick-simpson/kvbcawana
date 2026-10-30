## 2024-10-30 - Memoizing pure UI elements
**Learning:** In a codebase with deterministic UI components rendered at the root layer, such as ParticleLayer and ParticleField, memoizing them avoids costly DOM re-diffing and re-renders when parent states change, improving overall app performance.
**Action:** Use React.memo on purely declarative or context-dependent display layers.
