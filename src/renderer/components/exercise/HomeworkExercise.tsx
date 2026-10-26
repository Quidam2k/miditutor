import { useEffect, useMemo, useRef, useState } from 'react';
import { PianoKeyboard88 } from '../homework/PianoKeyboard88';
import { useMidiStore } from '../../store/useMidiStore';
import { useSettingsStore, localDay } from '../../store/useSettingsStore';
import {
  Homework, HomeworkItem, ScaleType, SequenceState, TriadTarget,
  arpeggioOffsets, expectedNext, keyPitchClass, matchesTriad, noteNames, orderUnpracticed,
  playNote, scaleOffsets, startSequence, triadDisplayName, triadsFromGroups,
} from '../../engine/Homework';

const NEXT_DELAY = 1200;
const mod12 = (n: number) => ((n % 12) + 12) % 12;

/** Scale types he can pick for an item; JP's text wins, and an unstated minor offers all three (#5058). */
function scaleChoices(item: HomeworkItem): ScaleType[] {
  if (item.quality !== 'minor') return ['major'];
  const named = (item.types ?? []).filter((t): t is ScaleType => ['natural', 'harmonic', 'melodic'].includes(t));
  return named.length ? named : ['natural', 'harmonic', 'melodic'];
}

const colourWords = (c: string) => c.split('').map((x) => (x === 'W' ? 'white' : 'black')).join(', ');

export function HomeworkExercise() {
  const [homework, setHomework] = useState<Homework | null | undefined>(undefined);
  const [active, setActive] = useState<HomeworkItem | null>(null);
  const { homeworkPracticed, intervalGoal, setExerciseType } = useSettingsStore();

  useEffect(() => {
    const get = window.tutorBridge?.getHomework;
    if (!get) return setHomework(null);
    get().then(setHomework, () => setHomework(null));
  }, []);

  // The interval drill keeps its own daily count; reaching the goal counts as practiced today.
  const practiced = useMemo(() => {
    const merged = { ...homeworkPracticed };
    for (const item of homework?.items ?? []) {
      if (item.kind === 'intervals' && intervalGoal.correct >= (item.daily_goal ?? 10)) merged[item.id] = intervalGoal.day;
    }
    return merged;
  }, [homework, homeworkPracticed, intervalGoal]);

  // Ordered once per visit to the list, so ticking an item doesn't reshuffle what he is looking at.
  const ordered = useMemo(() => orderUnpracticed(homework?.items ?? [], practiced), [homework, active]);

  if (homework === undefined) return <p className="text-gray-300 py-12">Loading homework…</p>;
  if (!homework) {
    return (
      <p className="text-gray-300 py-12 text-center max-w-md">
        No homework yet. It appears here after JP's newest lesson entry is synced.
      </p>
    );
  }
  if (active) return <ItemDrill item={active} onBack={() => setActive(null)} />;

  const today = localDay();
  return (
    <div className="flex flex-col gap-3 w-full max-w-xl">
      <h2 className="text-xl font-bold text-white">Homework from JP's {homework.date} lesson</h2>
      {ordered.map((item) => {
        const last = practiced[item.id];
        const playable = ['scale', 'arpeggio', 'triads', 'intervals'].includes(item.kind);
        return (
          <button
            key={item.id}
            disabled={!playable}
            onClick={() => (item.kind === 'intervals' ? setExerciseType('interval') : setActive(item))}
            className={`flex items-center justify-between text-left px-4 py-3 rounded-lg ${
              playable ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-900 cursor-default'
            }`}
          >
            <span className="text-gray-100">
              {item.kind === 'piece' ? `Piece: ${item.title ?? item.label} (open it in the Score tab)` : item.label}
            </span>
            <span className={`text-sm ${last === today ? 'text-emerald-400' : 'text-gray-400'}`}>
              {last === today ? '✓ today' : last ? `last ${last}` : playable ? 'not yet' : ''}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ItemDrill({ item, onBack }: { item: HomeworkItem; onBack: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <button onClick={onBack} className="self-start text-sm text-indigo-300 hover:text-indigo-200">
        ← Homework list
      </button>
      {item.kind === 'triads' ? <TriadDrill item={item} /> : <SequenceDrill item={item} />}
    </div>
  );
}

/** Scale or arpeggio: one octave up and down from any octave, right hand then left hand. */
function SequenceDrill({ item }: { item: HomeworkItem }) {
  const choices = item.kind === 'scale' ? scaleChoices(item) : [];
  const [type, setType] = useState<ScaleType | null>(choices.length === 1 ? choices[0] : null);
  if (item.kind === 'arpeggio') return <SequenceRun item={item} offsets={arpeggioOffsets(item.quality ?? 'major')} title={item.label} />;
  if (type) {
    const title = type === 'major' ? item.label : `${item.label} (${type})`;
    return <SequenceRun key={type} item={item} offsets={scaleOffsets(type)} title={title} />;
  }
  return (
    <div className="flex flex-col items-center gap-3">
      <h2 className="text-2xl font-bold text-white">{item.label}</h2>
      <p className="text-gray-300">JP's note doesn't say which minor scale. Pick one:</p>
      <div className="flex gap-2">
        {choices.map((c) => (
          <button key={c} onClick={() => setType(c)} className="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white capitalize">
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}

function SequenceRun({ item, offsets: initial, title }: { item: HomeworkItem; offsets: number[]; title: string }) {
  // Frozen: a new array identity would re-run the note effect, whose cleanup cancels the hand-change timer.
  const [offsets] = useState(initial);
  const key = item.key ?? 'C';
  const tonicPc = keyPitchClass(key);
  const [hand, setHand] = useState<'right' | 'left' | 'done'>('right');
  const [seq, setSeq] = useState(() => startSequence(offsets));
  const [okNotes, setOkNotes] = useState<ReadonlySet<number>>(new Set());
  const held = useMidiStore((s) => s.held);
  const markPracticed = useSettingsStore((s) => s.markHomeworkPracticed);
  // Read the latest sequence through a ref: two note-ons can arrive before React re-renders.
  const seqRef = useRef(seq);

  // A right note stays "ok" only while held: scales revisit pitches going down, and a stale entry
  // would hide a later wrong press of the same key.
  useEffect(() => {
    setOkNotes((s) => {
      const kept = new Set([...s].filter((n) => held.has(n)));
      return kept.size === s.size ? s : kept;
    });
  }, [held]);

  useEffect(() => {
    if (hand === 'done') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const advance = (next: SequenceState) => {
      seqRef.current = next;
      setSeq(next);
    };
    const unsubscribe = useMidiStore.subscribe((state, prev) => {
      const ev = state.lastNoteOn;
      if (!ev || ev === prev.lastNoteOn || timer) return;
      const r = playNote(seqRef.current, ev.note, tonicPc);
      advance(r.state);
      if (!r.ok) return;
      setOkNotes((s) => new Set(s).add(ev.note));
      if (!r.done) return;
      timer = setTimeout(() => {
        setOkNotes(new Set());
        if (hand === 'right') {
          advance(startSequence(offsets));
          setHand('left');
        } else {
          setHand('done');
          markPracticed(item.id);
        }
      }, NEXT_DELAY);
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [hand, offsets, tonicPc, item.id, markPracticed]);

  const names = noteNames(key, offsets);
  const expected = hand !== 'done' ? expectedNext(seq, tonicPc) : [];
  const red = new Set([...held].filter((n) => !okNotes.has(n) && !expected.includes(n)));
  const fingering = item.fingering?.[hand === 'left' ? 'LH' : 'RH'];

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <h2 className="text-2xl font-bold text-white">{title}</h2>
      <p className="text-gray-200 text-lg">
        {hand === 'done'
          ? 'Both hands done. ✓'
          : `${hand === 'right' ? 'Right' : 'Left'} hand: up and down one octave, starting on any ${key}.`}
      </p>
      {fingering && hand !== 'done' && <p className="text-gray-300">Fingering: {fingering}</p>}
      <div className="flex gap-2 text-lg font-mono">
        {names.map((n, i) => (
          <span key={i} className={i < seq.index ? 'text-emerald-400' : i === seq.index ? 'text-white underline' : 'text-gray-400'}>
            {n}
          </span>
        ))}
      </div>
      {seq.mistakes > 0 && <p className="text-sm text-gray-400">Wrong keys this hand: {seq.mistakes}</p>}
      <div className="w-full max-w-5xl">
        <PianoKeyboard88 green={new Set(expected)} red={red} held={held} />
      </div>
    </div>
  );
}

/** Triads by name: any inversion or octave; the colour group shows once he has it. */
function TriadDrill({ item }: { item: HomeworkItem }) {
  const targets = useMemo<TriadTarget[]>(
    () => orderUnpracticed(triadsFromGroups(item.groups ?? {}).map((t) => ({ ...t, id: t.name })), {}),
    [item],
  );
  const [index, setIndex] = useState(0);
  const [solved, setSolved] = useState(false);
  const held = useMidiStore((s) => s.held);
  const markPracticed = useSettingsStore((s) => s.markHomeworkPracticed);
  const target = targets[index];
  const done = index >= targets.length;

  useEffect(() => {
    if (!done && !solved && matchesTriad(held, target.pcs)) setSolved(true);
  }, [held, done, solved, target]);

  // Its own effect, so releasing the keys doesn't cancel the move to the next triad.
  useEffect(() => {
    if (!solved) return;
    const t = setTimeout(() => {
      setSolved(false);
      if (index + 1 >= targets.length) markPracticed(item.id);
      setIndex(index + 1);
    }, NEXT_DELAY);
    return () => clearTimeout(t);
  }, [solved, index, targets.length, item.id, markPracticed]);

  if (!targets.length) return <p className="text-gray-300">No triads found in this lesson entry.</p>;
  if (done) return <p className="text-emerald-400 text-xl py-8">All {targets.length} triads done. ✓</p>;

  const inChord = (n: number) => target.pcs.includes(mod12(n));
  const green = new Set([...held].filter(inChord));
  const red = new Set([...held].filter((n) => !inChord(n)));
  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <p className="text-sm text-gray-400">Triad {index + 1} of {targets.length}</p>
      <h2 className="text-3xl font-bold text-white">{triadDisplayName(target.name)}</h2>
      <p className="text-gray-300">Any inversion, any octave. Hold all three notes.</p>
      <p className={`text-lg ${solved ? 'text-emerald-400' : 'invisible'}`}>
        ✓ {target.display}{target.colour ? `: ${target.colour} group (${colourWords(target.colour)})` : ''}
      </p>
      <div className="w-full max-w-5xl">
        <PianoKeyboard88 green={green} red={red} held={held} />
      </div>
    </div>
  );
}
