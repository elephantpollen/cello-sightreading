// Options screen, sheet music display and play-along player.

"use strict";

const COUNT_IN = 8;  // two bars of crotchets
const LOOKAHEAD = 0.15;  // seconds of audio scheduled ahead
const BLOCKS = 10;
const STORAGE_KEY = "cello-sightreading";

const $ = (id) => document.getElementById(id);
const smooth = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

// --- Saved settings --------------------------------------------------------

const DEFAULTS = {
  clef: "random",
  key: "random",
  accidentals: true,
  positions: Object.keys(Generator.POSITIONS),
  tempo: 72,
  metronome: true,
};

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

const settings = loadSettings();

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    // Storage can be unavailable (private windows); settings just won't persist.
  }
}

// --- Options screen --------------------------------------------------------

const form = $("form");

function buildOptions() {
  const key = $("key");
  const add = (parent, value, label) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    parent.appendChild(option);
  };
  add(key, "random", "Random");
  for (const k of Generator.KEYS) add(key, k.id, k.label);

  for (const name of Object.keys(Generator.POSITIONS)) {
    const label = document.createElement("label");
    label.className = "check";
    label.innerHTML = `<input type="checkbox" name="positions" value="${name}"> ${name}`;
    $("positions").appendChild(label);
  }

  form.clef.value = settings.clef;
  form.key.value = settings.key;
  if (!form.key.value) form.key.value = "random";  // a key saved by an older version
  form.accidentals.value = settings.accidentals ? "on" : "off";
  for (const box of form.positions) box.checked = settings.positions.includes(box.value);
  validate();
}

function chosenPositions() {
  return [...form.positions].filter((box) => box.checked).map((box) => box.value);
}

function validate() {
  const ok = chosenPositions().length >= 2;
  $("generate").disabled = !ok;
  $("error").textContent = ok ? "" : "Choose at least two positions.";
  return ok;
}

form.addEventListener("change", validate);

form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!validate()) return;
  settings.clef = form.clef.value;
  settings.key = form.key.value;
  settings.accidentals = form.accidentals.value === "on";
  settings.positions = chosenPositions();
  saveSettings();
  $("options").hidden = true;
  $("player").hidden = false;
  newExercise();  // after showing the player, so the layout knows its width
});

$("back").addEventListener("click", () => {
  stop();
  $("player").hidden = true;
  $("options").hidden = false;
});

// --- Sheet music -----------------------------------------------------------

let exercise = null;
let noteEls = [];
let indexByElem = new Map();
let barsPerLine = 0;

function newExercise() {
  startFrom = null;
  stop();
  const seed = Math.floor(Math.random() * 1e6);
  exercise = Generator.generate(
    {
      clef: settings.clef,
      key: settings.key,
      accidentals: settings.accidentals,
      positions: settings.positions,
      blocks: BLOCKS,
    },
    seed,
  );
  $("info").textContent = `${exercise.key.short} · ${exercise.clef} clef`;
  barsPerLine = 0;
  render();
  $("page").scrollTo({ top: 0 });
}

function chooseBarsPerLine() {
  const width = $("page").clientWidth;
  return width >= 1000 ? 8 : width >= 560 ? 4 : 2;
}

function render() {
  const bars = chooseBarsPerLine();
  if (!exercise || bars === barsPerLine) return;
  barsPerLine = bars;
  const [tune] = ABCJS.renderAbc("music", Generator.toAbc(exercise, bars), {
    add_classes: true,
    responsive: "resize",
    staffwidth: { 8: 1400, 4: 760, 2: 400 }[bars],
    paddingtop: 10,
    paddingbottom: 10,
    paddingleft: 0,
    paddingright: 0,
    selectionColor: "currentColor",  // no abcjs click highlight; we do our own
    clickListener: (abcElem) => {
      if (indexByElem.has(abcElem)) seek(indexByElem.get(abcElem));
    },
  });

  // The rendered notes, in playing order.
  noteEls = [];
  indexByElem = new Map();
  for (const line of tune.lines) {
    for (const staff of line.staff || []) {
      for (const voice of staff.voices) {
        for (const el of voice) {
          if (el.el_type === "note" && !el.rest) {
            indexByElem.set(el, noteEls.length);
            noteEls.push(el.abselem.elemset[0]);
          }
        }
      }
    }
  }
  placeFingerings();
  const index = current;
  current = null;
  highlight(index);
}

// abcjs puts every annotation on a line at one height, clear of the highest
// note anywhere on that line. Move each fingering down to sit just above its
// own note, or just above the staff if the note is inside it.
function placeFingerings() {
  for (const g of noteEls) {
    const text = g.querySelector("text.abcjs-annotation");
    if (!text) continue;
    let top = Infinity;
    for (const child of g.children) if (child !== text) top = Math.min(top, child.getBBox().y);
    const line = lineOf(g);
    const staffLine = $("music").querySelector(`.abcjs-staff.${line} .abcjs-top-line`);
    if (staffLine) top = Math.min(top, staffLine.getBBox().y);
    const box = text.getBBox();
    // The box includes room for descenders, which digits don't use; that
    // leaves a small gap above the note.
    text.setAttribute("transform", `translate(0, ${top - (box.y + box.height)})`);
  }
}

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 150);
});

let current = null;

function highlight(index) {
  if (index === current) return;
  if (current !== null && noteEls[current]) noteEls[current].classList.remove("playing");
  current = index;
  if (index === null || !noteEls[index]) return;
  const el = noteEls[index];
  el.classList.add("playing");
  followLine(lineOf(el));
}

// Which line of music (system) an element is on.
const lineOf = (el) => [...el.classList].find((c) => /^abcjs-l\d+$/.test(c));

// The on-screen extent of a line, including notes above and below the staff.
function lineBox(line) {
  let top = Infinity;
  let bottom = -Infinity;
  for (const el of $("music").getElementsByClassName(line)) {
    const r = el.getBoundingClientRect();
    if (r.height) {
      top = Math.min(top, r.top);
      bottom = Math.max(bottom, r.bottom);
    }
  }
  return top < bottom ? { top, bottom } : null;
}

// Scroll just enough that the line after the one being played is fully
// visible, without pushing the current line off the top. Scroll the page
// directly: scrollIntoView on SVG elements isn't reliable in every browser.
function followLine(line) {
  const margin = 12;
  const page = $("page");
  const view = page.getBoundingClientRect();
  const now = lineBox(line);
  if (!now) return;
  const next = lineBox(`abcjs-l${Number(line.slice(7)) + 1}`) || now;
  let delta = Math.max(0, next.bottom - (view.bottom - margin));
  delta = Math.min(delta, now.top - (view.top + margin));
  if (Math.abs(delta) > 1) page.scrollTo({ top: page.scrollTop + delta, behavior: smooth() });
}

// --- Audio -----------------------------------------------------------------

let ctx = null;
let state = "stopped";  // stopped | playing | paused
let timer = null;
let nextBeat = 0;  // next note to schedule
let countLeft = 0;  // count-in beats still to schedule
let startFrom = null;  // note chosen by clicking, or null for the beginning
let nextTime = 0;
let starts = [];  // [beat, time] for every scheduled beat
let voices = [];
let wakeLock = null;

const tempo = () => Number($("tempo").value);

function tone(midi, time, length) {
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.value = 440 * 2 ** ((midi - 69) / 12);
  filter.type = "lowpass";
  filter.frequency.value = 1500;
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(0.22, time + 0.03);
  gain.gain.setValueAtTime(0.22, time + length - 0.06);
  gain.gain.linearRampToValueAtTime(0, time + length);
  osc.connect(filter).connect(gain).connect(ctx.destination);
  osc.start(time);
  osc.stop(time + length);
  voices.push({ osc, end: time + length });
}

function click(time, accent) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = accent ? 1800 : 1200;
  gain.gain.setValueAtTime(accent ? 0.5 : 0.3, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
  osc.connect(gain).connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.06);
  voices.push({ osc, end: time + 0.06 });
}

function schedule() {
  const total = exercise.notes.length;
  while (nextBeat < total && nextTime < ctx.currentTime + LOOKAHEAD) {
    const beatLength = 60 / tempo();
    if (countLeft > 0) {
      // Count-in beats are recorded as negative beats, -COUNT_IN up to -1.
      click(nextTime, countLeft % 4 === 0);
      starts.push([-countLeft, nextTime]);
      countLeft--;
    } else {
      if ($("metronome").checked) click(nextTime, nextBeat % 4 === 0);
      tone(exercise.notes[nextBeat].midi, nextTime, beatLength * 0.92);
      starts.push([nextBeat, nextTime]);
      nextBeat++;
    }
    nextTime += beatLength;
  }
  voices = voices.filter((v) => v.end > ctx.currentTime);
  if (nextBeat >= total && ctx.currentTime >= nextTime) {
    startFrom = null;
    stop();
  }
}

function draw() {
  if (state === "stopped") return;
  const now = ctx.currentTime;
  let beat = null;
  for (let i = starts.length - 1; i >= 0; i--) {
    if (starts[i][1] <= now) {
      beat = starts[i][0];
      break;
    }
  }
  if (beat !== null && beat < 0) {
    $("count").textContent = ((beat + COUNT_IN) % 4) + 1;
    $("count").hidden = false;
  } else {
    $("count").hidden = true;
    highlight(beat);
  }
  requestAnimationFrame(draw);
}

async function keepAwake(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock) wakeLock = await navigator.wakeLock.request("screen");
    if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (e) {
    wakeLock = null;  // not supported or refused; playback still works
  }
}

function play() {
  if (!exercise) return;
  if (state === "playing") return pause();
  ctx ??= new AudioContext();
  ctx.resume();
  if (state === "stopped") {
    nextBeat = startFrom ?? 0;
    countLeft = COUNT_IN;
    nextTime = ctx.currentTime + 0.1;
    starts = [];
    timer = setInterval(schedule, 25);
    schedule();
  }
  state = "playing";
  $("play").textContent = "Pause";
  keepAwake(true);
  requestAnimationFrame(draw);
}

function pause() {
  ctx.suspend();
  state = "paused";
  $("play").textContent = "Resume";
  keepAwake(false);
}

function silence() {
  for (const v of voices) v.osc.stop();
  voices = [];
}

// Stopping keeps any clicked starting note highlighted, ready for Play.
function stop() {
  clearInterval(timer);
  silence();
  state = "stopped";
  $("play").textContent = "Play";
  $("count").hidden = true;
  highlight(startFrom);
  keepAwake(false);
}

// Clicking a note: jump straight there while playing, otherwise make it the
// starting point for the next Play (which counts in first).
function seek(index) {
  if (state === "playing") {
    silence();
    countLeft = 0;
    nextBeat = index;
    nextTime = ctx.currentTime + 0.05;
    starts = [];
    schedule();
  } else {
    startFrom = index;
    if (state === "paused") stop();
    else highlight(index);
  }
}

// --- Player controls -------------------------------------------------------

function showTempo() {
  $("tempo-value").textContent = tempo();
}

$("tempo").value = settings.tempo;
$("metronome").checked = settings.metronome;
showTempo();

$("tempo").addEventListener("input", () => {
  showTempo();
  settings.tempo = tempo();
  saveSettings();
});
$("metronome").addEventListener("change", () => {
  settings.metronome = $("metronome").checked;
  saveSettings();
});
$("play").addEventListener("click", play);
$("stop").addEventListener("click", () => {
  startFrom = null;
  stop();
  $("page").scrollTo({ top: 0, behavior: smooth() });
});
$("new").addEventListener("click", newExercise);

// Keep focus off the controls so Space never double-triggers a button.
for (const el of document.querySelectorAll("#bar button, #bar input")) {
  el.addEventListener("click", () => el.blur());
  el.addEventListener("change", () => el.blur());
}

document.addEventListener("keydown", (e) => {
  if ($("player").hidden || e.ctrlKey || e.altKey || e.metaKey) return;
  const step = (delta) => {
    $("tempo").value = tempo() + delta;
    $("tempo").dispatchEvent(new Event("input"));
  };
  switch (e.key) {
    case " ": play(); break;
    case "s": case "S": $("stop").click(); break;
    case "n": case "N": newExercise(); break;
    case "m": case "M": $("metronome").click(); break;
    case "Escape": $("back").click(); break;
    case "ArrowUp": step(e.shiftKey ? 10 : 2); break;
    case "ArrowDown": step(e.shiftKey ? -10 : -2); break;
    default: return;
  }
  e.preventDefault();
});

buildOptions();
