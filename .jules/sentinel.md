## 2024-11-20 - [Replace Math.random() for secure temporary file names]
**Vulnerability:** Predictable temporary file generation. `Math.random()` was used in `printer/print-server/print-helper.js` and `printer/print-server/server/images.js` to append pseudo-random strings to temporary files.
**Learning:** Even when combined with `Date.now()`, `Math.random()` is not cryptographically secure and can be guessed or manipulated, potentially leading to file overwrite or symlink attacks.
**Prevention:** Always use cryptographically secure random number generators like `crypto.randomBytes(4).toString("hex")` or `crypto.randomUUID()` when generating tokens, session IDs, or temporary file names to ensure unpredictability.
