// #6090 Binder print on the piano Mac: send the PDF straight to the default CUPS printer with
// duplex long-edge forced on the command line (not left to a dialog he could change).
// Runs lp/lpstat with execFile (no shell). Nothing here touches the PDF or its page order.
import { execFile } from 'node:child_process';

export type Run = (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

export const runCmd: Run = (cmd, args) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout: 20000 }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || stdout || err.message).trim())) : resolve({ stdout, stderr })));

export const lpArgs = (printer: string, pdf: string, title: string) =>
  ['-d', printer, '-t', title, '-o', 'sides=two-sided-long-edge', '-o', 'media=na_letter_8.5x11in', pdf];

export const defaultPrinter = (lpstatD: string): string | null =>
  /system default destination:\s*(\S+)/.exec(lpstatD)?.[1] ?? null;

export const printerProblem = (lpstatP: string): string | null =>
  /disabled|not accepting|unreachable|offline/i.test(lpstatP) ? lpstatP.trim().split('\n')[0] : null;

export const jobId = (lpOut: string): string | null => /request id is (\S+)/.exec(lpOut)?.[1] ?? null;

/** Prints for real or throws with the actual reason: never a false "sent". */
export const sendToPaper = async (pdf: string, title: string, run: Run = runCmd) => {
  const printer = defaultPrinter((await run('lpstat', ['-d']).catch(() => ({ stdout: '' }))).stdout);
  if (!printer) throw new Error('No printer is set up on this computer');
  const problem = printerProblem((await run('lpstat', ['-p', printer])).stdout);
  if (problem) throw new Error(`Printer ${printer} is not ready: ${problem}`);
  const job = jobId((await run('lp', lpArgs(printer, pdf, title))).stdout);
  if (!job) throw new Error(`The print job to ${printer} was not accepted`);
  return { printer, job };
};
