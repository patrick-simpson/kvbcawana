#!/usr/bin/env bash
# The Journey kiosk's browser, kept alive. Chromium is started in kiosk mode
# and restarted whenever it exits or crashes (an "Aw, Snap" or an OOM kill on
# a Pi Zero used to mean a dead screen until someone brought a keyboard).
# Installed by journey-kiosk.service (PI_SETUP.md, step 4b).
set -u
URL="${JOURNEY_URL:-https://awana.kvbchurch.org/journey/}"
BROWSER="$(command -v chromium-browser || command -v chromium || true)"
if [ -z "$BROWSER" ]; then
  echo "journey-kiosk: no chromium-browser or chromium on this Pi" >&2
  exit 1
fi
# A crash leaves "Chromium didn't shut down correctly" in the profile; cleared
# so the restored session never shows that bar, and the restart loop is paced
# so a browser that dies at once cannot spin the CPU.
PROFILE="${HOME}/.config/chromium/Default/Preferences"
while true; do
  if [ -f "$PROFILE" ]; then
    sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"Crashed"/"exit_type":"Normal"/' "$PROFILE" 2>/dev/null || true
  fi
  "$BROWSER" --kiosk --noerrdialogs --disable-session-crashed-bubble --disable-infobars \
    --disable-features=TranslateUI --check-for-update-interval=31536000 --autoplay-policy=no-user-gesture-required \
    "$URL"
  echo "journey-kiosk: the browser exited ($?); starting it again in 5 s" >&2
  sleep 5
done
