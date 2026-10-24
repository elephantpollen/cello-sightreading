# Cello Sight-Reading

Random sight-reading exercises for the cello, with play-along.

**Use it:** https://elephantpollen.github.io/cello-sightreading/

Each exercise is forty bars of crotchets in common time, in four-bar blocks.
Each block stays in one position (half to fourth). The last note of a block
shifts on the same string to the first note of the next. Only the shifting
notes and the opening note have finger numbers, and the arrival note of a
shift is marked with a dash, e.g. `-4`.

On the options screen you can choose the clef (bass, tenor or random), the
key signature, whether to include accidentals, and which positions to use.
The player counts in for two bars, plays the exercise, and highlights each
note as it sounds. Click a note to start from there.

| Key | Action |
| --- | --- |
| Space | Play / pause |
| S | Stop |
| ↑ / ↓ | Tempo ±2 (Shift: ±10) |
| M | Metronome on/off |
| N | New exercise |
| Esc | Back to options |

It is a static site with no build step: `index.html`, `generator.js` (the
exercise generator) and `app.js` (options, layout and player). The music is
engraved with [abcjs](https://www.abcjs.net/), loaded from cdnjs.
