import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { binderSides, EDGE_IN, FOLIO_IN, HOLE_IN, gapForFill } from '../../../shared/binderPrint';
import { orderChordFingers } from './chordFingers';
import { drawRangeByPosition } from './drawRange';

interface FingeringEntry {
  FingeringEntries?: { SVGNode?: unknown }[];
}

const hintColourPattern = /#(?:7c3aed|22c55e|16a34a|ef4444|dc2626|3b82f6|2563eb)/gi;

/** Detect the app's hint colours in printed output. */
export function hasHintColour(html: string): boolean {
  return new RegExp(hintColourPattern.source, 'i').test(html);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Fingerings navy bold sans-serif, so they never read as the (plain serif black) bar numbers, even on a grey print (#6107). */
function inkFingerings(osmd: OpenSheetMusicDisplay) {
  for (const staves of osmd.GraphicSheet.MeasureList) {
    for (const measure of staves) {
      for (const entry of measure?.staffEntries ?? []) {
        for (const label of (entry as unknown as FingeringEntry).FingeringEntries ?? []) {
          const node = label.SVGNode;
          if (!(node instanceof SVGElement)) continue;
          for (const element of [node, ...node.querySelectorAll('*')]) {
            if (!(element instanceof SVGElement)) continue;
            element.style.fill = FINGER_INK;
            element.style.fontWeight = 'bold';
            element.style.fontFamily = 'Arial, Helvetica, sans-serif';
          }
        }
      }
    }
  }
}

/** Navy, not one of the app's hint colours (those are blanked in print). */
const FINGER_INK = '#1e3a8a';

// Draw widths (px): wide keeps his paper's line breaks; no narrower than this or bars get crowded.
const WIDE_PX = 1400;
const NARROW_PX = 760;

/** Render duplicated score pages as a complete Letter print document. */
export async function renderBinderHtml(opts: {
  musicxml: string;
  title: string;
  pageStarts: number[];
}): Promise<{ html: string; pages: number }> {
  const { musicxml, title, pageStarts } = opts;
  const div = document.createElement('div');
  // Wide, so OSMD keeps his paper's lines (the XML's system breaks) instead of wrapping; the
  // page is scaled down to the sheet afterwards.
  div.style.cssText = 'position:fixed;left:-20000px;top:0;width:' + WIDE_PX + 'px;background:#fff';
  try {
    document.body.appendChild(div);
    // With his paper's page starts, each paper page is drawn on its own (just its bars) and
    // scaled to fit one sheet, so the print pages match his paper. Without, OSMD pages it.
    const ranges = pageStarts.length
      ? pageStarts.map((first, k) => [first, k + 1 < pageStarts.length ? pageStarts[k + 1] - 1 : Number.MAX_SAFE_INTEGER])
      : [null];
    const svgs: SVGSVGElement[] = [];
    for (const [k, range] of ranges.entries()) {
      const first = k === 0;
      const draw = async (width: number, gap?: number) => {
        div.replaceChildren();
        div.style.width = width + 'px';
        const osmd = new OpenSheetMusicDisplay(div, {
          autoResize: false,
          backend: 'svg',
          autoBeam: true,
          drawTitle: first,
          drawSubtitle: first,
          drawComposer: first,
          drawLyricist: first,
          drawCredits: first,
          pageFormat: range ? 'Endless' : 'Letter_P',
          pageBackgroundColor: '#FFFFFF',
          newSystemFromXML: true,
          // Bar numbers only at the start of each line (#6107), like his paper; fingering has its own ink.
          drawMeasureNumbers: true,
          drawMeasureNumbersOnlyAtSystemStart: true,
          drawPartNames: false,
          defaultColorMusic: '#000000',
          coloringEnabled: false,
          drawFingerings: true,
          cursorsOptions: [],
          // A page's last line runs full width like his paper's; the piece's very last line doesn't.
          stretchLastSystemLine: k < ranges.length - 1,
          ...(range ? { drawFromMeasureNumber: range[0], drawUpToMeasureNumber: range[1] } : {}),
        });
        await osmd.load(musicxml);
        orderChordFingers(osmd);
        drawRangeByPosition(osmd);
        if (gap !== undefined) osmd.EngravingRules.MinimumDistanceBetweenSystems = gap;
        osmd.render();
        return osmd;
      };
      const systemsOf = (osmd: OpenSheetMusicDisplay) => osmd.GraphicSheet?.MusicPages?.[0]?.MusicSystems?.length ?? 0;
      const sizeOf = () => {
        const svg = div.querySelector('svg');
        return { w: parseFloat(svg?.getAttribute('width') ?? ''), h: parseFloat(svg?.getAttribute('height') ?? '') };
      };
      let osmd = await draw(WIDE_PX);
      if (range) {
        // Bigger notes (#6090): draw as narrow as the line breaks allow (same number of lines as the wide
        // draw, which follows his paper's breaks); the notes then print larger on the sheet.
        const lines = systemsOf(osmd);
        let lo = NARROW_PX;
        let hi = WIDE_PX;
        for (let i = 0; i < 5 && hi - lo > 20; i++) {
          const mid = Math.round((lo + hi) / 2);
          if (systemsOf(await draw(mid)) === lines) hi = mid; else lo = mid;
        }
        osmd = await draw(hi);
        // Whatever height is still spare goes between the lines, re-drawn until the shape fits the sheet.
        let gap = osmd.EngravingRules.MinimumDistanceBetweenSystems;
        for (let pass = 0; pass < 3; pass++) {
          const { w, h } = sizeOf();
          const next = gapForFill(w, h, systemsOf(osmd), gap);
          if (Math.abs(next - gap) < 0.25) break;
          gap = next;
          osmd.EngravingRules.MinimumDistanceBetweenSystems = gap;
          osmd.render();
        }
      }
      inkFingerings(osmd);
      svgs.push(...Array.from(div.querySelectorAll('svg')).map((svg) => svg.cloneNode(true) as SVGSVGElement));
    }
    const pages = svgs.length;
    const serializer = new XMLSerializer();
    const pageHtml = svgs.map((svg) => {
      const clone = svg;
      if (!clone.hasAttribute('viewBox')) {
        const width = parseFloat(svg.getAttribute('width') ?? '');
        const height = parseFloat(svg.getAttribute('height') ?? '');
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
          throw new Error('Rendered score page is missing valid SVG dimensions.');
        }
        clone.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
      }
      clone.setAttribute('width', '100%');
      clone.setAttribute('height', '100%');
      clone.setAttribute('preserveAspectRatio', 'xMidYMin meet');
      return serializer.serializeToString(clone);
    });
    const sides = binderSides(pages).map((page, i) =>
      '<div class="side' + (i % 2 ? ' back' : '') + '" data-page="' + page + '">' + pageHtml[page - 1] +
      '<div class="folio">' + page + ' / ' + pages + '</div></div>',
    ).join('');
    const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' +
      escapeHtml(title) + '</title><style>' +
      '@page { size: letter; margin: 0 } html,body{margin:0;padding:0;background:#fff}' +
      '.side{width:8.5in;height:11in;box-sizing:border-box;padding:' + EDGE_IN + 'in ' + EDGE_IN + 'in ' + FOLIO_IN + 'in ' + HOLE_IN + 'in;page-break-after:always;break-after:page;overflow:hidden;position:relative}' +
      // The back of each sheet is the same page turned over: the punched edge is now on the right.
      '.side.back{padding:' + EDGE_IN + 'in ' + HOLE_IN + 'in ' + FOLIO_IN + 'in ' + EDGE_IN + 'in}' +
      '.side:last-child{page-break-after:auto;break-after:auto}' +
      '.side svg{display:block;width:100%;height:100%}' +
      '.folio{position:absolute;bottom:0.15in;right:' + EDGE_IN + 'in;font:10pt sans-serif;color:#000}' +
      '.back .folio{right:auto;left:' + EDGE_IN + 'in}' +
      '</style></head><body>' + sides + '</body></html>';
    return { html: html.replace(hintColourPattern, '#000000'), pages };
  } finally {
    div.remove();
  }
}
