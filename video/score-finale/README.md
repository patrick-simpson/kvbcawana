# The scoreboard's winner films

Owner 2026-11-15: "make epic animations. Use blender where it makes sense". Picked: 3D for
the winner only, 20 seconds, no characters, one film coloured live for any team, and
"one of each, and each night a different one plays".

| Film | What happens |
| --- | --- |
| `trophy` | A dark stage; spots hunt, then find the trophy as it rises out of its plinth; rays fan out, two confetti cannons fire, confetti keeps falling. |
| `stadium` | A night arena: the towers' beams come up, a wave of the winner's colour runs round the crowd until all of it is, and fireworks build to a barrage. |
| `takeover` | A grey wall of balls; a wave of the winner's colour spreads from the middle, then rings keep rolling out and sparks drift up. |

`finale.py` builds and renders them (Blender 5.2, EEVEE, about a second a frame on the
laptop's RTX 4050, so a film is about 5 to 10 minutes):

    blender --python finale.py -- trophy <frames folder>               (600 frames, 1920 wide)
    blender --python finale.py -- trophy <folder> 30,150,300 0 640     (a few small frames to look at)

then each film is encoded and committed to `lobby/public/finale/<film>.mp4`:

    ffmpeg -framerate 30 -i <frames folder>/%04d.png -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p -movflags +faststart -an trophy.mp4

**The inks.** A film is rendered in three pure colours on black, and the projector paints
them (`lobby/src/presentation/components/FinaleFilm.jsx`, an SVG colour matrix): red becomes
the winner's colour, green stays white, blue becomes the winner's deep shade (in a tie, the
second team's colour). So anything that should be "team coloured" is pure red in Blender.
Team colour plus white turns pastel, so white is kept for small things.

**Nothing is simulated**: every moving piece is placed each frame from the time alone, so any
frame renders by itself and a stopped render carries on (frames already written are skipped).
No words are in the films: the projector draws "<TEAM> WINS!" and the scores over them, at
the moments in `shared/scoreboard.js` `FINALE_FILMS`.

Blender runs with its window open (the owner watches), and closes it at the end, an error
included. The battery rule applies: at 20% the render waits until the battery is back to 80%.
