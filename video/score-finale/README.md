# The scoreboard's winner films

Owner 2026-11-15: "make epic animations. Use blender where it makes sense". Picked: 3D for
the winner only, 20 seconds, no characters, one film coloured live for any team, and
"one of each, and each night a different one plays".

| Film | What happens |
| --- | --- |
| `trophy` | A dark stage; spots hunt, then find the trophy as it rises out of its plinth; rays fan out, two confetti cannons fire, confetti keeps falling. |
| `stadium` | A night arena: the towers' beams come up, a wave of the winner's colour runs round the crowd until all of it is, and fireworks build to a barrage. |
| `takeover` | A grey wall of balls; a wave of the winner's colour spreads from the middle, then rings keep rolling out and sparks drift up. |

`finale.py` builds and renders them (Blender 5.2, EEVEE). Owner 2026-11-15: "60fps
professional grade movie studio quality", however long it takes: 60 frames a second, 128
samples, real motion blur (a frame handler places every piece at each blur step's
sub-frame), a fog-glow bloom in the compositor, and sparks, crowd lights and glints as soft
round glowing points. About 3 to 8 seconds a frame on the laptop's RTX 4050, so a film is
one to three hours:

    blender --python finale.py -- trophy <frames folder>                (1200 frames, 1920 wide)
    blender --python finale.py -- trophy <folder> 60,300,600 0 960      (a few small frames to look at)

then each film is encoded and committed to `lobby/public/finale/<film>.mp4`:

    ffmpeg -framerate 60 -i <frames folder>/%04d.png -c:v libx264 -preset veryslow -crf 24 -pix_fmt yuv420p -movflags +faststart -an trophy.mp4

(veryslow at CRF 24 keeps each film under the 12 MB the site test allows, `site/test/largeFiles.test.mjs`:
the films stream to the projector over the church Wi-Fi.)

**The inks.** A film is rendered in three pure colours on black, and the projector paints
them (`lobby/src/presentation/components/FinaleFilm.jsx`, an SVG colour matrix): red becomes
the winner's colour, green stays white, blue becomes the winner's deep shade (in a tie, the
second team's colour). So anything that should be "team coloured" is pure red in Blender.
Team colour plus white turns pastel, so white is kept for small things.

**Nothing is simulated**: every moving piece is placed each frame from the time alone, so any
frame renders by itself and a stopped render carries on (frames already written are skipped).
No words are in the films: the projector draws "<TEAM> WINS!" and the scores over them, at
the moments in `shared/scoreboard.js` `FINALE_FILMS`.

Blender runs with its window open (the owner watches; one frame per timer step, so the
window keeps drawing and shows each finished frame), and closes it at the end, an error
included. The battery rule applies: at 20% the render waits until the battery is back to 80%.
