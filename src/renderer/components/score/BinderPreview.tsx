import { binderWarning } from '../../../shared/binderPrint';

export interface BinderPreviewData {
  html: string;
  pages: number;
  /** Review's confirmed lines out of total, for the warning text. */
  confirmed: number;
  total: number;
  verified: boolean;
}

/**
 * #6083: what "Print for binder" is about to print, before it prints. The iframe shows the very HTML
 * that gets printed. An unverified score still prints, behind a plain amber warning.
 */
export function BinderPreview({ data, busy, onPrint, onCancel }: {
  data: BinderPreviewData;
  busy: boolean;
  onPrint: () => void;
  onCancel: () => void;
}) {
  const warning = binderWarning(data.verified, data.confirmed, data.total);
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80 p-4" data-testid="binder-preview">
      <div className="mb-2 flex items-center gap-3 text-sm text-gray-200">
        <span data-testid="binder-preview-summary">
          {data.pages} page{data.pages === 1 ? '' : 's'}, {data.pages * 2} sides, two-sided long edge
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onPrint}
          disabled={busy}
          className="rounded bg-emerald-700 px-3 py-1 text-white hover:bg-emerald-600 disabled:opacity-50"
          data-testid="binder-preview-print"
        >
          {busy ? 'Printing…' : 'Print'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded bg-gray-700 px-3 py-1 text-gray-100 hover:bg-gray-600 disabled:opacity-50"
          data-testid="binder-preview-cancel"
        >
          Cancel
        </button>
      </div>
      {warning && (
        <div className="mb-2 rounded bg-amber-900/70 px-3 py-2 text-sm text-amber-200" data-testid="binder-preview-warning">
          {warning}
        </div>
      )}
      <iframe
        title="Binder print preview"
        srcDoc={data.html}
        sandbox=""
        className="min-h-0 flex-1 rounded bg-white"
        data-testid="binder-preview-frame"
      />
    </div>
  );
}
