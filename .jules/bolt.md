## 2026-11-04 - React.memo for pure ambient layer
**Learning:** `ParticleLayer` is a purely decorative ambient component that sits in the root `App.jsx` tree. While it's already optimized by doing zero per-frame JS and precomputing particle layouts at module load, its position in `App.jsx` means it will needlessly be re-evaluated on every state change in the main app (e.g. check-ins, config changes, timer updates).
**Action:** Wrap such pure functional leaf components in `React.memo` to skip unnecessary React renders when their props (like `effect` in this case) haven't changed.
