import { describe, it, expect } from 'vitest';
import { lpArgs, defaultPrinter, printerProblem, jobId, sendToPaper, Run } from '../src/main/binderPaper';

const fake = (replies: Record<string, string | Error>): { run: Run; calls: string[][] } => {
  const calls: string[][] = [];
  const run: Run = async (cmd, args) => {
    calls.push([cmd, ...args]);
    const r = replies[cmd];
    if (r instanceof Error) throw r;
    return { stdout: r ?? '', stderr: '' };
  };
  return { run, calls };
};

describe('binder paper (#6090)', () => {
  it('forces duplex long-edge and Letter on the lp command line', () => {
    const a = lpArgs('Brother', '/x/p-binder.pdf', 't');
    expect(a).toContain('sides=two-sided-long-edge');
    expect(a).toContain('media=na_letter_8.5x11in');
    expect(a[a.length - 1]).toBe('/x/p-binder.pdf');
  });
  it('parses lpstat and lp output', () => {
    expect(defaultPrinter('system default destination: Brother\n')).toBe('Brother');
    expect(defaultPrinter('no system default destination\n')).toBeNull();
    expect(printerProblem('printer Brother is idle.  enabled since x')).toBeNull();
    expect(printerProblem('printer Brother disabled since x -\n\treason unknown')).toMatch(/disabled/);
    expect(jobId('request id is Brother-12 (1 file(s))')).toBe('Brother-12');
  });
  it('sends one lp job to the default printer', async () => {
    const { run, calls } = fake({ lpstat: 'system default destination: Brother\nprinter Brother is idle.', lp: 'request id is Brother-3 (1 file(s))' });
    expect(await sendToPaper('/a.pdf', 't', run)).toEqual({ printer: 'Brother', job: 'Brother-3' });
    expect(calls.filter((c) => c[0] === 'lp')).toHaveLength(1);
    expect(calls.find((c) => c[0] === 'lp')).toContain('sides=two-sided-long-edge');
  });
  it('never claims success: no printer, disabled printer, lp failure', async () => {
    await expect(sendToPaper('/a.pdf', 't', fake({ lpstat: 'no system default destination' }).run)).rejects.toThrow(/No printer/);
    await expect(sendToPaper('/a.pdf', 't', fake({ lpstat: 'system default destination: B\nprinter B disabled since x' }).run)).rejects.toThrow(/not ready/);
    await expect(sendToPaper('/a.pdf', 't', fake({ lpstat: 'system default destination: B\nprinter B is idle.', lp: new Error('lp: Unable to connect') }).run)).rejects.toThrow(/Unable to connect/);
    await expect(sendToPaper('/a.pdf', 't', fake({ lpstat: 'system default destination: B\nprinter B is idle.', lp: 'weird' }).run)).rejects.toThrow(/not accepted/);
  });
});
