## 2026-11-01 - Fix leaking stack trace in electron app
**Vulnerability:** The electron app exposed internal server error stack traces into the UI component via `serverState.error`.
**Learning:** This exposes system internals which can be leveraged by attackers.
**Prevention:** Always verify that error objects caught are sanitized before passing their details to state or responses that can be accessed by the client. Specifically, catch blocks that assign `e.stack` to exposed structures must be avoided.
