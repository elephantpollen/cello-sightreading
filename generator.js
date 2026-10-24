// Random cello sight-reading exercises, written out as ABC notation.
//
// A port of sightreading.py: constant crotchets in common time, built from
// four-bar blocks. Each block stays in one position; the last note of a block
// shifts on the same string to the first note of the next, and only those two
// notes (plus the opening note) carry finger numbers, the arrival marked "-4".

"use strict";

const Generator = (() => {
  // Open strings as MIDI numbers: C2, G2, D3, A3.
  const STRINGS = { C: 36, G: 43, D: 50, A: 57 };

  // Semitones above the open string for the first finger; fingers 1-4 then
  // cover four consecutive semitones.
  const POSITIONS = {
    "half": 1,
    "first": 2,
    "lower second": 3,
    "upper second": 4,
    "lower third": 5,
    "upper third": 6,
    "fourth": 7,
  };

  // Tenor clef may not go below the open D string.
  const TENOR_LOWEST = STRINGS.D;

  const LETTERS = "cdefgab";
  const NATURAL_PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  const SHARP_ORDER = "fcgdaeb";
  const FLAT_ORDER = "beadgcf";

  // Key signatures with up to five sharps or flats, by number of fifths. The
  // notes are random, so only the signature matters, not major or minor.
  const MAJOR = { "-5": "Db", "-4": "Ab", "-3": "Eb", "-2": "Bb", "-1": "F", 0: "C",
                  1: "G", 2: "D", 3: "A", 4: "E", 5: "B" };
  const MINOR = { "-5": "Bb", "-4": "F", "-3": "C", "-2": "G", "-1": "D", 0: "A",
                  1: "E", 2: "B", 3: "F#", 4: "C#", 5: "G#" };
  const pretty = (name) => name.replace("b", "♭").replace("#", "♯");
  const KEYS = [];
  for (let fifths = -5; fifths <= 5; fifths++) {
    const count = Math.abs(fifths);
    const signature = fifths === 0 ? "no sharps or flats"
      : `${count} ${fifths > 0 ? "sharp" : "flat"}${count > 1 ? "s" : ""}`;
    KEYS.push({
      id: MAJOR[fifths],
      label: `${pretty(MAJOR[fifths])} major / ${pretty(MINOR[fifths])} minor (${signature})`,
      short: `${count || ""}${fifths > 0 ? "♯" : fifths < 0 ? "♭" : "no sharps or flats"}`,
      fifths,
    });
  }

  const BLOCK_BARS = 4;
  const BEATS_PER_BAR = 4;
  const BLOCK_NOTES = BLOCK_BARS * BEATS_PER_BAR;
  const ACCIDENTAL_PROBABILITY = 0.25;

  // Small seeded generator (mulberry32) so an exercise can be regenerated.
  function makeRng(seed) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      random: next,
      choice: (items) => items[Math.floor(next() * items.length)],
      shuffle: (items) => {
        for (let i = items.length - 1; i > 0; i--) {
          const j = Math.floor(next() * (i + 1));
          [items[i], items[j]] = [items[j], items[i]];
        }
        return items;
      },
    };
  }

  const midiOf = (note) => (note.octave + 1) * 12 + NATURAL_PC[note.letter] + note.alteration;

  function keySignature(fifths) {
    const sig = Object.fromEntries([...LETTERS].map((l) => [l, 0]));
    if (fifths > 0) for (const l of SHARP_ORDER.slice(0, fifths)) sig[l] = 1;
    else for (const l of FLAT_ORDER.slice(0, -fifths)) sig[l] = -1;
    return sig;
  }

  // All spellings of a MIDI pitch using a single sharp, flat or natural.
  function spellings(midi) {
    const result = [];
    for (const letter of LETTERS) {
      for (const alteration of [-1, 0, 1]) {
        const natural = midi - alteration;
        if (((natural % 12) + 12) % 12 === NATURAL_PC[letter]) {
          result.push({ letter, alteration, octave: Math.floor(natural / 12) - 1 });
        }
      }
    }
    return result;
  }

  // [midi, finger] pairs playable in a position on one string.
  function positionPitches(position, string, lowest) {
    const base = STRINGS[string] + POSITIONS[position];
    const pairs = [];
    for (let f = 0; f < 4; f++) if (base + f >= lowest) pairs.push([base + f, f + 1]);
    return pairs;
  }

  const allPitches = (position, lowest) =>
    Object.keys(STRINGS).flatMap((s) => positionPitches(position, s, lowest));

  function candidates(pairs, sig, accidental) {
    const notes = [];
    for (const [midi, finger] of pairs) {
      for (const note of spellings(midi)) {
        if ((note.alteration !== sig[note.letter]) === accidental) notes.push([note, finger]);
      }
    }
    return notes;
  }

  // Pick a note, an accidental with the given probability, avoiding an
  // immediate repeat of the previous pitch.
  function choose(rng, pairs, sig, probability, avoid) {
    const accidental = rng.random() < probability;
    const wanted = probability > 0 ? [accidental, !accidental] : [false];
    for (const want of wanted) {
      const options = candidates(pairs, sig, want).filter(([n]) => midiOf(n) !== avoid);
      if (options.length) return rng.choice(options);
    }
    return null;
  }

  // The last note in `from` and the first in `to`, on a shared string.
  function chooseShift(rng, from, to, sig, probability, lowest, avoid) {
    for (const string of rng.shuffle(Object.keys(STRINGS))) {
      const before = positionPitches(from, string, lowest);
      const after = positionPitches(to, string, lowest);
      if (!before.length || !after.length) continue;
      for (let i = 0; i < 20; i++) {
        const a = choose(rng, before, sig, probability, avoid);
        const b = a && choose(rng, after, sig, probability, midiOf(a[0]));
        if (b) return [{ ...a[0], finger: a[1] }, { ...b[0], finger: b[1], shift: true }];
      }
    }
    throw new Error(`no shift possible from ${from} to ${to}`);
  }

  // options: { clef: "bass"|"tenor"|"random",
  //            key: key id | "random",
  //            accidentals: bool, positions: [names], blocks: int }
  function generate(options, seed) {
    const rng = makeRng(seed);
    const clef = options.clef === "random" ? rng.choice(["bass", "tenor"]) : options.clef;
    const lowest = clef === "tenor" ? TENOR_LOWEST : 0;
    const chosen = KEYS.filter((k) => k.id === options.key);
    const key = rng.choice(chosen.length ? chosen : KEYS);
    const sig = keySignature(key.fifths);
    const probability = options.accidentals ? ACCIDENTAL_PROBABILITY : 0;

    const allowed = options.positions.length ? options.positions : Object.keys(POSITIONS);
    const positions = [rng.choice(allowed)];
    for (let i = 1; i < options.blocks; i++) {
      const others = allowed.filter((p) => p !== positions[i - 1]);
      positions.push(rng.choice(others.length ? others : allowed));
    }

    const notes = [];
    const last = () => (notes.length ? midiOf(notes[notes.length - 1]) : null);
    positions.forEach((position, i) => {
      const shiftsOut = i < positions.length - 1 && positions[i + 1] !== position;
      const start = i > 0 && notes.length % BLOCK_NOTES ? 1 : 0;
      const end = shiftsOut ? BLOCK_NOTES - 1 : BLOCK_NOTES;
      const pitches = allPitches(position, lowest);
      for (let j = start; j < end; j++) {
        const [note, finger] = choose(rng, pitches, sig, probability, last());
        // Finger the opening note to show the starting position.
        notes.push(notes.length ? note : { ...note, finger });
      }
      if (shiftsOut) {
        notes.push(...chooseShift(rng, position, positions[i + 1], sig, probability, lowest, last()));
      }
    });

    return { seed, clef, key, positions, notes: notes.map((n) => ({ ...n, midi: midiOf(n) })) };
  }

  // ABC for an exercise. Accidentals follow the usual rule: they last to the
  // end of the bar for the same letter in the same octave.
  function toAbc(exercise, barsPerLine) {
    const sig = keySignature(exercise.key.fifths);
    const lines = [];
    let line = [];
    let bar = [];
    let state = {};
    exercise.notes.forEach((note, i) => {
      const slot = note.letter + note.octave;
      const current = slot in state ? state[slot] : sig[note.letter];
      let text = "";
      // Fingerings are annotations so a shift can be marked "-4"; plain ABC
      // fingering decorations only allow digits.
      if (note.finger) text += `"^${note.shift ? "-" : ""}${note.finger}"`;
      if (note.alteration !== current) {
        text += { "-1": "_", 0: "=", 1: "^" }[note.alteration];
        state[slot] = note.alteration;
      }
      const upper = note.letter.toUpperCase();
      if (note.octave >= 5) text += note.letter + "'".repeat(note.octave - 5);
      else text += upper + ",".repeat(4 - note.octave);
      bar.push(text);
      if ((i + 1) % BEATS_PER_BAR === 0) {
        line.push(bar.join(" "));
        bar = [];
        state = {};
        if (line.length === barsPerLine) {
          lines.push(line.join(" | "));
          line = [];
        }
      }
    });
    if (line.length) lines.push(line.join(" | "));
    const keyId = exercise.key.id;
    return [
      "X:1",
      "M:C",
      "L:1/4",
      `K:${keyId} clef=${exercise.clef}`,
      lines.join(" |\n") + " |]",
    ].join("\n");
  }

  return { POSITIONS, KEYS, BEATS_PER_BAR, BLOCK_BARS, generate, toAbc };
})();
