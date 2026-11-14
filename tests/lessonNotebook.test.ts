import { describe, it, expect } from 'vitest';
import { MAX_NOTE_CHARS, MAX_NOTES, parseNotebook } from '../src/shared/lessonNotebook';

const line = (date: string, summary_md: string) => JSON.stringify({ date, summary_md, source: 'piano-lesson' });

describe('lesson notebook reader (#6112)', () => {
  it('an empty file is an empty notebook', () => {
    expect(parseNotebook('')).toEqual([]);
    expect(parseNotebook('\n\n')).toEqual([]);
  });

  it('reads entries newest first', () => {
    const got = parseNotebook([line('2026-10-28', 'older'), line('2026-11-06', 'newer')].join('\n'));
    expect(got.map((n) => n.date)).toEqual(['2026-11-06', '2026-10-28']);
    expect(got[0].summary).toBe('newer');
  });

  it('skips bad lines without losing the good ones', () => {
    const text = ['not json', '{"date":5}', '{"date":"2026-11-06"}', line('11/06', 'x'), line('2026-11-06', '   '),
      line('2026-11-06', 'kept')].join('\n');
    expect(parseNotebook(text)).toEqual([{ date: '2026-11-06', summary: 'kept' }]);
  });

  it('skips an oversized entry', () => {
    const text = [line('2026-11-06', 'x'.repeat(MAX_NOTE_CHARS + 1)), line('2026-11-05', 'ok')].join('\n');
    expect(parseNotebook(text).map((n) => n.date)).toEqual(['2026-11-05']);
  });

  it('keeps markup as plain text and caps the count', () => {
    const got = parseNotebook(line('2026-11-06', '<img src=x onerror=alert(1)> **bold**'));
    expect(got[0].summary).toBe('<img src=x onerror=alert(1)> **bold**');
    const many = Array.from({ length: MAX_NOTES + 5 }, (_, i) => line(`2026-01-${String((i % 28) + 1).padStart(2, '0')}`, `n${i}`));
    expect(parseNotebook(many.join('\n')).length).toBe(MAX_NOTES);
  });
});
