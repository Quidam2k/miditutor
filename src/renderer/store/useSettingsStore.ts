import { create } from 'zustand';
import { EYES_UP_START_MS, EyesUpMode } from '../engine/EyesUp';
import { GRAZE_MS } from '../engine/ScoreFollower';
import { persist } from 'zustand/middleware';
import { Clef } from '../types/music';
import { ExerciseType } from '../types/exercise';
import type { TrainerClef } from '../engine/NoteTrainer';
import type { SessionSnapshot } from '../components/score/sessionSnapshot';

/** Strip = one long line of music, current beat centred (#5153); pages / scroll (#5137). */
export type ScoreLayout = 'strip' | 'pages' | 'scroll';

interface SettingsState {
  clef: Clef;
  exerciseType: ExerciseType;
  audioEnabled: boolean;
  showNoteNames: boolean;
  showKeyboard: boolean;
  scoreLayout: ScoreLayout;
  /** Score-tab pieces pinned to the top of the list, by displayed title (#9610). */
  favoritePieces: string[];
  /** Version group slug -> the file of the version he last switched to (#9627). */
  pieceVersions: Record<string, string>;
  /** Interval drill: right answers today toward JP's 10 a day (local date, YYYY-MM-DD). */
  intervalGoal: { day: string; correct: number };
  /** Homework item id -> local day he last finished it on the keyboard (#5058). */
  homeworkPracticed: Record<string, string>;
  /** #10133 Build backwards: clean laps each chunk needs, e.g. "3,5" (3 first, then 5). */
  backwardTargets: string;
  /** #10160: the Score tab's piece at last look (id, and its title for a pushed piece). */
  lastPiece: { id: string; label: string } | null;
  /** #10162: the tab he was on, so a restart reopens it. */
  lastView: string;
  /** #5259: the last overall loop he set on each piece, by displayed title. */
  pieceLoops: Record<string, { first: number; last: number }>;
  /** #5259: the piece list shows only favorites (and the piece on screen). */
  favoritesOnly: boolean;
  /** #5260 note trainer: which clef(s) it draws from; #10262: accidentals on = the Keys toggle. */
  trainerClef: TrainerClef;
  trainerAccidentals: boolean;
  /** #5652 A: Notes asks only the ladder's notes, landmarks first. */
  trainerLadder: boolean;
  /** #5652 J: Intervals asks him to name the interval (JP's "require quality"). */
  intervalNameIt: boolean;
  /** #10262 Sight-read: pieces he marked simple, by displayed title. */
  simplePieces: string[];
  /** Times Sight-read has picked each piece, by displayed title. */
  sightDrilled: Record<string, number>;
  /** The piece Sight-read last opened, while he's still on it. */
  sightReadPiece: string | null;
  /** #11354 Fresh tune: the key he is drilling ("G", lower-case = minor) and the tunes he has had. */
  freshKey: string;
  freshSeen: string[];
  /** The drill he left for Sight-read, by piece id; going back to the piece puts it back. */
  parkedDrills: Record<string, SessionSnapshot>;
  /** #10254: the wheel off a note in Strip moves the other way. */
  reverseWheel: boolean;
  /** #5516: a key this many ms after the strike that finished a step is a graze (0 = off). */
  grazeMs: number;
  /** #5516: keys softer than this velocity are strays (0 = off). */
  minVelocity: number;
  /** #5522: hold the display awake while he plays; let go 15 min after the last note. */
  keepAwake: boolean;
  /** #5519: the keyboard's green keys show for a lap's first bar, then only on a hesitation. */
  trainingWheels: boolean;
  /** #11354: Fresh tunes and Sight-read picks start with no hints; a miss brings them back. */
  hintsOffNew: boolean;
  /** JP 10/9: before reading in a new key, play its sharps or flats (Notes Keys mode, new pieces in Score). */
  keyFirst: boolean;
  /** #5652 B Eyes up in Notes: the note hides after a window ('timer') or on the pedal ('pedal'). */
  eyesUp: EyesUpMode;
  /** The timer window now; shrinks as he gets faster, grows after a miss. */
  eyesUpMs: number;
  /** #5652 C Read ahead (experimental): the notes at the cursor blank out, so they must be read in advance. */
  readAhead: boolean;
  /** #5652 K Keep going: a click on every beat, and +4 after a clean lap (JP 9/11). */
  keepClick: boolean;
  keepStepUp: boolean;
  /** Keep going's tempo per piece, so he picks up where he left off. */
  keepBpms: Record<string, number>;
  /** #5521 clean-run celebrations, each on its own: a ding per clean lap, a glow wave, a finale. */
  celebrateChime: boolean;
  celebrateWave: boolean;
  celebrateFinale: boolean;
  /** #5566: a very faint tick the moment a lap stops being clean. */
  missSound: boolean;
  /** #6047: how loud the miss sound is, 0-100 (100 = its loudest). */
  missVolume: number;
  /** #5624: the notes to play now on a scrap of staff just above the keyboard. */
  miniStaff: boolean;
  /** #5630: the wheel over a note on the score changes its finger. Off: only over a key. */
  scoreWheelFingers: boolean;
  /** #5630: the wheel over a key on the keyboard changes that note's finger. */
  keyWheelFingers: boolean;
  /** #5657: Pages and Scroll number every bar, not just the bar starting each line. */
  everyBarNumbers: boolean;
  /** #6055: Strip fits the zoom to the music's ink (big notes). Off: the older box fit. */
  stripFitInk: boolean;

  /** Set any of the plain number/boolean preferences above. */
  setPrefs: (prefs: Partial<Pick<SettingsState, PrefKey>>) => void;
  setReverseWheel: (on: boolean) => void;
  toggleSimplePiece: (title: string) => void;
  markSightRead: (id: string, title: string) => void;
  setFreshKey: (key: string) => void;
  markFreshSeen: (id: string) => void;
  clearSightRead: () => void;
  parkDrill: (snapshot: SessionSnapshot) => void;
  unparkDrill: (id: string) => void;
  setTrainerClef: (clef: TrainerClef) => void;
  setTrainerAccidentals: (on: boolean) => void;
  setTrainerLadder: (on: boolean) => void;
  setIntervalNameIt: (on: boolean) => void;
  setClef: (clef: Clef) => void;
  setExerciseType: (type: ExerciseType) => void;
  setAudioEnabled: (enabled: boolean) => void;
  setShowKeyboard: (show: boolean) => void;
  setShowNoteNames: (show: boolean) => void;
  setScoreLayout: (layout: ScoreLayout) => void;
  setBackwardTargets: (text: string) => void;
  setLastPiece: (piece: { id: string; label: string }) => void;
  setLastView: (view: string) => void;
  setPieceLoop: (title: string, bars: { first: number; last: number }) => void;
  setKeepBpm: (title: string, bpm: number) => void;
  setFavoritesOnly: (on: boolean) => void;
  toggleFavoritePiece: (title: string) => void;
  setPieceVersion: (slug: string, file: string) => void;
  countIntervalCorrect: () => void;
  markHomeworkPracticed: (id: string) => void;
}

export type PrefKey = 'grazeMs' | 'minVelocity' | 'keepAwake' | 'trainingWheels' | 'hintsOffNew' | 'keyFirst' | 'eyesUp' | 'eyesUpMs' | 'readAhead' | 'keepClick' | 'keepStepUp' | 'celebrateChime' | 'celebrateWave' | 'celebrateFinale' | 'missSound' | 'missVolume' | 'miniStaff' | 'scoreWheelFingers' | 'keyWheelFingers' | 'everyBarNumbers' | 'stripFitInk';

/** Today's date on this machine's clock (Pacific on Pinocchio), so the goal resets at local midnight. */
export function localDay(now = new Date()): string {
  return now.toLocaleDateString('en-CA');
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      clef: 'treble',
      exerciseType: 'note-identification',
      showKeyboard: true,
      // He plays the notes himself; the tutor only sounds when he asks (#5059).
      audioEnabled: false,
      showNoteNames: false,
      scoreLayout: 'strip',
      favoritePieces: [],
      pieceVersions: {},
      intervalGoal: { day: '', correct: 0 },
      homeworkPracticed: {},
      backwardTargets: '3,5',
      lastPiece: null,
      lastView: 'practice',
      pieceLoops: {},
      favoritesOnly: false,
      trainerClef: 'treble',
      trainerAccidentals: true,
      trainerLadder: false,
      intervalNameIt: true,
      simplePieces: [],
      sightDrilled: {},
      sightReadPiece: null,
      freshKey: 'C',
      freshSeen: [],
      parkedDrills: {},
      reverseWheel: false,
      grazeMs: GRAZE_MS,
      minVelocity: 0,
      keepAwake: true,
      trainingWheels: false,
      hintsOffNew: true,
      keyFirst: true,
      eyesUp: 'off',
      eyesUpMs: EYES_UP_START_MS,
      readAhead: false,
      keepClick: true,
      keepStepUp: true,
      keepBpms: {},
      celebrateChime: true,
      celebrateWave: false,
      celebrateFinale: true,
      missSound: true,
      missVolume: 100,
      miniStaff: true,
      scoreWheelFingers: false,
      keyWheelFingers: true,
      everyBarNumbers: true,
      stripFitInk: true,
      setPrefs: (prefs) => set(prefs),
      setReverseWheel: (on) => set({ reverseWheel: on }),

      toggleSimplePiece: (title) =>
        set((s) => ({
          simplePieces: s.simplePieces.includes(title)
            ? s.simplePieces.filter((t) => t !== title)
            : [...s.simplePieces, title],
        })),
      markSightRead: (id, title) =>
        set((s) => ({
          sightReadPiece: id,
          sightDrilled: { ...s.sightDrilled, [title]: (s.sightDrilled[title] ?? 0) + 1 },
        })),
      clearSightRead: () => set({ sightReadPiece: null }),
      setFreshKey: (freshKey) => set({ freshKey }),
      markFreshSeen: (id) => set((s) => ({ freshSeen: s.freshSeen.includes(id) ? s.freshSeen : [...s.freshSeen, id] })),
      parkDrill: (snapshot) => set((s) => ({ parkedDrills: { ...s.parkedDrills, [snapshot.pieceId]: snapshot } })),
      unparkDrill: (id) =>
        set((s) => {
          const { [id]: _gone, ...rest } = s.parkedDrills;
          return { parkedDrills: rest };
        }),
      setTrainerClef: (clef) => set({ trainerClef: clef }),
      setTrainerAccidentals: (on) => set({ trainerAccidentals: on }),
      setTrainerLadder: (on) => set({ trainerLadder: on }),
      setIntervalNameIt: (on) => set({ intervalNameIt: on }),
      setClef: (clef) => set({ clef }),
      setShowKeyboard: (show) => set({ showKeyboard: show }),
      setExerciseType: (type) => set({ exerciseType: type }),
      setAudioEnabled: (enabled) => set({ audioEnabled: enabled }),
      setShowNoteNames: (show) => set({ showNoteNames: show }),
      setScoreLayout: (layout) => set({ scoreLayout: layout }),
      setBackwardTargets: (text) => set({ backwardTargets: text }),
      setLastPiece: (piece) => set({ lastPiece: piece }),
      setLastView: (view) => set({ lastView: view }),
      setPieceLoop: (title, bars) => set((s) => ({ pieceLoops: { ...s.pieceLoops, [title]: bars } })),
      setKeepBpm: (title, bpm) => set((s) => ({ keepBpms: { ...s.keepBpms, [title]: bpm } })),
      setFavoritesOnly: (on) => set({ favoritesOnly: on }),
      toggleFavoritePiece: (title) =>
        set((s) => ({
          favoritePieces: s.favoritePieces.includes(title)
            ? s.favoritePieces.filter((t) => t !== title)
            : [...s.favoritePieces, title],
        })),
      setPieceVersion: (slug, file) => set((s) => ({ pieceVersions: { ...s.pieceVersions, [slug]: file } })),
      countIntervalCorrect: () =>
        set((s) => {
          const day = localDay();
          return { intervalGoal: { day, correct: (s.intervalGoal.day === day ? s.intervalGoal.correct : 0) + 1 } };
        }),
      markHomeworkPracticed: (id) => set((s) => ({ homeworkPracticed: { ...s.homeworkPracticed, [id]: localDay() } })),
    }),
    {
      name: 'miditutor-settings',
      // v1 (#5059): Audio now defaults OFF; turn off the ON every earlier install saved.
      // v2 (#5153): he asked for the strip layout as the default; move him to it once.
      version: 2,
      migrate: (persisted, version) => {
        let state = persisted as Partial<SettingsState>;
        if (version < 1) state = { ...state, audioEnabled: false };
        if (version < 2) state = { ...state, scoreLayout: 'strip' };
        return state as SettingsState;
      },
    },
  ),
);
