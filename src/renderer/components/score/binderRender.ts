import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { binderSides } from '../../../shared/binderPrint';
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

/** Fingerings bold black, so they read apart from the (normal-weight) bar numbers. */
function inkFingerings(osmd: OpenSheetMusicDisplay) {
  for (const staves of osmd.GraphicSheet.MeasureList) {
    for (const measure of staves) {
      for (const entry of measure?.staffEntries ?? []) {
        for (const label of (entry as unknown as FingeringEntry).FingeringEntries ?? []) {
          const node = label.SVGNode;
          if (!(node instanceof SVGElement)) continue;
          for (const element of [node, ...node.querySelectorAll('*')]) {
            if (!(element instanceof SVGElement)) continue;
            element.style.fill = '#000000';
            element.style.fontWeight = 'bold';
          }
        }
      }
    }
  }
}

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
  div.style.cssText = 'position:fixed;left:-20000px;top:0;width:1400px;background:#fff';
  try {
    document.body.appendChild(div);
    // With his paper's page starts, each paper page is drawn on its own (just its bars) and
    // scaled to fit one sheet, so the print pages match his paper. Without, OSMD pages it.
    const ranges = pageStarts.length
      ? pageStarts.map((first, k) => [first, k + 1 < pageStarts.length ? pageStarts[k + 1] - 1 : Number.MAX_SAFE_INTEGER])
      : [null];
    const svgs: SVGSVGElement[] = [];
    for (const [k, range] of ranges.entries()) {
      div.replaceChildren();
      const first = k === 0;
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
        measureNumberInterval: 1,
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
      osmd.render();
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
    const sides = binderSides(pages).map((page) =>
      '<div class="side" data-page="' + page + '">' + pageHtml[page - 1] +
      '<div class="folio">' + page + ' / ' + pages + '</div></div>',
    ).join('');
    const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' +
      escapeHtml(title) + '</title><style>' +
      '@page { size: letter; margin: 0 } html,body{margin:0;padding:0;background:#fff}' +
      '.side{width:8.5in;height:11in;box-sizing:border-box;padding:0.3in;page-break-after:always;break-after:page;overflow:hidden;position:relative}' +
      '.side:last-child{page-break-after:auto;break-after:auto}' +
      '.side svg{display:block;width:100%;height:100%}' +
      '.folio{position:absolute;bottom:0.15in;right:0.4in;font:10pt sans-serif;color:#000}' +
      '</style></head><body>' + sides + '</body></html>';
    return { html: html.replace(hintColourPattern, '#000000'), pages };
  } finally {
    div.remove();
  }
}
