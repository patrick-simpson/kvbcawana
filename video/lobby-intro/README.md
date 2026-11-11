# The lobby's intro film: "Six doors"

The 8 second film the lobby TV plays now and then over its welcome slide
(`lobby/src/components/FlagshipIntro.jsx`). It replaced the Blender 3D film
(`video/awana-intro/`, kept for history) on 2026-11-11: the owner found that one
cheesy (too busy, the mascots, the 3D look itself).

What happens: the welcome slide sits still, six flat doors in the six club
colours close down over it, each showing its club's mark, the doors nod, then
lift away from the middle out while the church's logo rises back into place.
Flat like the brand kit: no blur, no gradient, no 3D.

## The one rule

Its first 0.6 s and everything from 7.1 s on must be the lobby's own welcome
slide at rest, pixel for pixel, because the lobby fades the film in and out over
that slide. So the film is built on pictures taken of the real lobby.

## Making it again

    cd lobby && npm ci && npm run build      # the lobby the plates are taken from
    node video/lobby-intro/capture.mjs       # plates/ (do this when the welcome slide's look changes)
    node video/lobby-intro/render.mjs --stills 1.2,2.6,5.3   # a quick look, PNGs in out/
    node video/lobby-intro/render.mjs        # the real one -> lobby/public/intro/awana-intro.mp4

Needs ffmpeg. `film.html` is the whole film: a page that draws any moment when
asked (`window.setTime(seconds)`), which `render.mjs` photographs 60 times a
second. Its timeline is the `T` table at the top of its script. If the length or
the moment it is home again changes, change `FLAGSHIP_INTRO.homeAt` in
`lobby/src/lib/flagship.js` to match.
