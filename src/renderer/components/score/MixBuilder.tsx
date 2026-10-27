import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { MixChoice, mixTrust, spliceMix } from '../../../shared/mix';
import type { PieceTrust } from '../../../shared/trust';
import type { MixPlan } from '../../../shared/versions';

// "My mix" builder (#9627): each section of the song is drawn twice, Easy on the left and
// Harder on the right, and he clicks the one he wants to play. Picking is by sight.

interface Props {
  title: string;
  plan: MixPlan;
  easyXml: string;
  harderXml: string;
  easyTrust?: PieceTrust;
  harderTrust?: PieceTrust;
  onSave: (choice: MixChoice[], musicxml: string, trust: PieceTrust) => Promise<void>;
  onClose: () => void;
}

// OSMD renders block the thread, so thumbnails draw one at a time with a breath between.
let queue: Promise<unknown> = Promise.resolve();
const enqueue = (job: () => Promise<void>) => {
  const run = queue.then(job).catch(() => undefined);
  queue = run.then(() => new Promise((resolve) => setTimeout(resolve, 0)));
};

/** A few bars of one version, drawn small. Draws once it scrolls into view. */
function Thumb({ xml, range }: { xml: string; range: [number, number] }) {
  const box = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(typeof IntersectionObserver === 'undefined');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (seen || !el) return;
    const watcher = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setSeen(true), {
      rootMargin: '200px',
    });
    watcher.observe(el);
    return () => watcher.disconnect();
  }, [seen]);

  useEffect(() => {
    const el = box.current;
    if (!seen || !el) return;
    let disposed = false;
    enqueue(async () => {
      if (disposed) return;
      try {
        const osmd = new OpenSheetMusicDisplay(el, {
          autoResize: false,
          backend: 'svg',
          drawTitle: false,
          drawSubtitle: false,
          drawComposer: false,
          drawLyricist: false,
          drawCredits: false,
          drawPartNames: false,
          drawFromMeasureNumber: range[0],
          drawUpToMeasureNumber: range[1],
        });
        await osmd.load(xml);
        if (disposed) return;
        osmd.zoom = 0.45;
        osmd.render();
      } catch (err) {
        console.warn('[mix] thumbnail failed:', err);
        if (!disposed) setFailed(true);
      }
    });
    return () => {
      disposed = true;
      el.innerHTML = '';
    };
  }, [seen, xml, range]);

  return (
    <div className="min-h-16 rounded bg-white p-1 text-black">
      <div ref={box} />
      {failed && <p className="text-xs text-red-600">Can&apos;t draw these bars.</p>}
    </div>
  );
}

export function MixBuilder({ title, plan, easyXml, harderXml, easyTrust, harderTrust, onSave, onClose }: Props) {
  const [choice, setChoice] = useState<MixChoice[]>(() => plan.choice ?? plan.sections.map(() => 'easy'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const trust = useMemo(
    () => mixTrust(easyTrust, harderTrust, plan.sections, choice),
    [easyTrust, harderTrust, plan.sections, choice],
  );

  const pick = (k: number, value: MixChoice) => setChoice((c) => c.map((v, i) => (i === k ? value : v)));
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const musicxml = spliceMix(easyXml, harderXml, plan.sections, choice, plan.semis, title);
      await onSave(choice, musicxml, trust);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  const sources = [
    { key: 'easy', label: 'Easy', xml: easyXml },
    { key: 'harder', label: 'Harder', xml: harderXml },
  ] as const;

  // A portal: the toolbar it is opened from would otherwise be its fixed-position box.
  return createPortal(
    <div role="dialog" aria-label="My mix" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-full w-full max-w-4xl flex-col rounded-lg border border-gray-700 bg-gray-900 text-gray-200">
        <div className="border-b border-gray-700 px-4 py-3">
          <h2 className="text-lg font-semibold">My mix: {title}</h2>
          <p className="text-sm text-gray-400">Click the version of each section you want to play.</p>
        </div>
        <div className="min-h-0 flex-auto space-y-3 overflow-y-auto px-4 py-3">
          {plan.sections.map((section, k) => (
            <div key={k} className="rounded-md bg-gray-800 p-2">
              <div className="mb-1 text-sm text-gray-300">
                {section.easy[0] === section.easy[1] ? `Bar ${section.easy[0]}` : `Bars ${section.easy[0]}-${section.easy[1]}`}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {sources.map(({ key, label, xml }) => (
                  <button
                    key={key}
                    type="button"
                    data-section={k}
                    data-choice={key}
                    aria-pressed={choice[k] === key}
                    onClick={() => pick(k, key)}
                    className={`rounded-md p-1 text-left ${
                      choice[k] === key ? 'bg-gray-700 ring-2 ring-sky-600' : 'bg-gray-900 hover:bg-gray-700'
                    }`}
                  >
                    <span className={`block pb-1 text-xs ${choice[k] === key ? 'text-sky-400' : 'text-gray-400'}`}>{label}</span>
                    <Thumb xml={xml} range={section[key]} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-1 border-t border-gray-700 px-4 py-3">
          <p className="text-xs text-gray-400">Harder sections have no fingering.</p>
          <p className={`text-xs ${trust.status === 'issues' ? 'text-amber-400' : 'text-gray-400'}`}>
            {trust.note || 'From checked versions'}
          </p>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-md bg-gray-800 px-3 py-1 text-sm hover:bg-gray-700">
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-md bg-sky-600 px-3 py-1 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
