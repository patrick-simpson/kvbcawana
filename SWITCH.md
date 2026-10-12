# Switch-day cleanup checklist

Switch day is done: every screen runs on awana.kvbchurch.org, the old repos
are archived, and the Pusher keys are cleared. This is what is still open.

- **Pusher publisher code.** Remove it from the print server (`printer/`,
  the Pusher publisher), then remove the `PUSHER_*` block from
  `.github/workflows/ci.yml`. Each app's `CLAUDE.md` says the code stays
  until this step.
- **Pusher secrets and variables.** Delete the `PUSHER_*` secrets and the
  `PUSHER_APP_KEY` / `PUSHER_CLUSTER` variables in this repo. The next deploy
  deletes the Worker's own copies.
- **Pusher app.** Delete the Pusher app itself.
- **Stray screens.** Find any screen still on the old github.io address
  (it stops getting check-ins once Pusher is off) and open
  awana.kvbchurch.org on it.
