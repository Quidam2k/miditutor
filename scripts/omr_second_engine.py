"""Re-read every library page with an OMR engine for the scan audit (#9625).

oemer is the independent second read; homr re-reads each page on its own so every
bar maps to its page image (with --write-staff-positions for system crops).
Output: OUT/<slug>/<page>.musicxml, resumable (pages with output are skipped).
Pages are copyrighted: OUT must stay under Q:/Personal, never the repo.
Jobs run at BELOW_NORMAL priority and yield to Todd's input and available RAM (#pm1026:
--jobs 4 + homr froze Solace on 2026-10-26 while he was playing). Defaults: 1 job, children
capped at 4 BLAS threads, a page launches only with >= 12 GB RAM free AND >= 10 min input
idle, is suspended the moment he touches the box, resumed after 10 idle minutes, killed at
40 running minutes. --i-own-solace (his per-occasion grant) skips the idle gate and allows
--jobs > 1; the RAM gate always applies. Run with a Python that has psutil (C:/Python311);
the engines are their own venv exes.
Usage: omr_second_engine.py OUT [--engine oemer|homr] [--jobs 1] [--first slug,slug]
       [--i-own-solace] [--idle-min 10] [--ram-gb 12] [--page-cap-min 40]
"""
from __future__ import annotations

import argparse
import ctypes
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from ctypes import wintypes
from pathlib import Path

import psutil

REPO = Path(__file__).resolve().parent.parent
OEMER = REPO / '.venv-omr-oemer' / 'Scripts' / 'oemer.exe'
HOMR = REPO / '.venv-omr-homr' / 'Scripts' / 'homr.exe'
PIANO = Path('Q:/Personal/piano')
BELOW_NORMAL = 0x00004000


class LII(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]


def input_idle_s() -> float:
    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32
    li = LII()
    li.cbSize = ctypes.sizeof(LII)
    ok = user32.GetLastInputInfo(ctypes.byref(li))
    if not ok:
        return 0.0
    return ((kernel32.GetTickCount() - li.dwTime) & 0xFFFFFFFF) / 1000


def ram_avail_gb() -> float:
    return psutil.virtual_memory().available / (1024 ** 3)


def gate_ok(*, ram_gb, idle_s, own_solace, min_ram_gb=12, min_idle_s=600) -> bool:
    return ram_gb >= min_ram_gb and (own_solace or idle_s >= min_idle_s)


def child_env() -> dict:
    return dict(os.environ, OMP_NUM_THREADS='4', MKL_NUM_THREADS='4',
                OPENBLAS_NUM_THREADS='4')


def say(line: str) -> None:
    print(line.encode('ascii', 'backslashreplace').decode('ascii'), flush=True)


class ProcessTree:
    def __init__(self, pid, process_factory=psutil.Process):
        self.pid, self.process_factory = pid, process_factory
        self.members = []

    def _apply(self, action, children_first):
        try:
            parent = self.process_factory(self.pid)
            try:
                self.members = [parent] + parent.children(recursive=True)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                if not self.members:
                    self.members = [parent]
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
        members = reversed(self.members) if children_first else self.members
        for process in members:
            try:
                getattr(process, action)()
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass

    def suspend(self):
        self._apply('suspend', True)

    def resume(self):
        self._apply('resume', False)

    def kill(self):
        self._apply('kill', True)


class Yielder:
    # Pause/resume/timeout policy for ONE running page; running_s excludes paused time. #pm1026
    def __init__(self, tree, *, own_solace=False, idle_min=10, page_cap_min=40, start_s=0.0):
        self.tree = tree
        self.last_s, self.running_s = start_s, 0.0
        self.own_solace = own_solace
        self.idle_limit_s, self.cap_s = idle_min * 60, page_cap_min * 60
        self.paused = self.timed_out = False

    def running_time(self, now_s):
        extra = 0 if self.paused or self.timed_out else max(0, now_s - self.last_s)
        return self.running_s + extra

    def step(self, now_s, idle_s) -> str | None:
        self.running_s = self.running_time(now_s)
        self.last_s = now_s
        if self.timed_out:
            return None
        if self.running_s >= self.cap_s:
            self.timed_out = True
            self.tree.kill()
            return 'timeout'
        if not self.own_solace:
            if not self.paused and idle_s < self.idle_limit_s:
                self.tree.suspend()
                self.paused = True
                return 'paused'
            if self.paused and idle_s >= self.idle_limit_s:
                self.tree.resume()
                self.paused = False
                return 'resumed'
        return None


def pages() -> list[tuple[str, Path]]:
    found = [(d.name, p) for d in sorted((PIANO / 'library' / 'pages').iterdir()) if d.is_dir()
             for p in sorted(d.glob('*.png'))]
    found += [('sorcerers-apprentice', p) for p in sorted((PIANO / 'sorcerers-apprentice' / 'photos').glob('p_*.jpg'))]
    return found


def command(engine: str, dest: Path, page: Path) -> list[str]:
    if engine == 'oemer':
        return [str(OEMER), '-o', str(dest), str(page)]
    # homr writes next to its input, so it reads a copy inside dest. #pm1026
    copy = dest / page.name
    copy.write_bytes(page.read_bytes())
    return [str(HOMR), '--write-staff-positions', str(copy)]


def run(engine, out, slug, page, *, own_solace=False, sleep=time.sleep,
        popen=subprocess.Popen, clock=time.monotonic, tree_factory=ProcessTree,
        idle_min=10, ram_gb=12, page_cap_min=40, emit=say) -> str:
    # Gate before launch (RAM always, idle unless own_solace), then yield while it runs. #pm1026
    dest = out / slug
    label = f'{slug}/{page.name}'.encode('ascii', 'backslashreplace').decode('ascii')
    if (dest / f'{page.stem}.musicxml').exists():
        return f'skip {label}'
    waited = False
    while True:
        available, idle = ram_avail_gb(), input_idle_s()
        if gate_ok(ram_gb=available, idle_s=idle, own_solace=own_solace,
                   min_ram_gb=ram_gb, min_idle_s=idle_min * 60):
            break
        if not waited:
            emit(f'wait {label} ram={available:.1f} idle={idle:.0f}')
            waited = True
        sleep(5)
    dest.mkdir(parents=True, exist_ok=True)
    try:
        with open(dest / f'{page.stem}.log', 'w', encoding='utf-8') as log:
            process = popen(command(engine, dest, page), stdout=log,
                            stderr=subprocess.STDOUT, creationflags=BELOW_NORMAL,
                            env=child_env())
            yielder = Yielder(tree_factory(process.pid), own_solace=own_solace,
                              idle_min=idle_min, page_cap_min=page_cap_min, start_s=clock())
            while True:
                rc = process.poll()
                if rc is not None:
                    elapsed = yielder.running_time(clock())
                    return f'{"ok" if rc == 0 else f"FAIL rc={rc}"} {label} {elapsed:.0f}s'
                idle = 0.0 if own_solace else input_idle_s()
                state = yielder.step(clock(), idle)
                if state == 'timeout':
                    return f'FAIL timeout {label}'
                if state:
                    emit(f'{state} {label}')
                sleep(5)
    finally:
        if engine == 'homr':
            (dest / page.name).unlink(missing_ok=True)


def parse_args(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument('out', type=Path)
    ap.add_argument('--engine', choices=('oemer', 'homr'), default='oemer')
    ap.add_argument('--jobs', type=int, default=1)
    ap.add_argument('--first', default='')
    ap.add_argument('--i-own-solace', action='store_true')
    ap.add_argument('--idle-min', type=float, default=10)
    ap.add_argument('--ram-gb', type=float, default=12)
    ap.add_argument('--page-cap-min', type=float, default=40)
    args = ap.parse_args(argv)
    if args.jobs < 1 or (args.jobs > 1 and not args.i_own_solace):
        print('error: --jobs must be >= 1; --jobs > 1 requires --i-own-solace', file=sys.stderr)
        raise SystemExit(2)
    return args


def main() -> None:
    args = parse_args(sys.argv[1:])
    first = args.first.split(',') if args.first else []
    todo = sorted(pages(), key=lambda sp: (first.index(sp[0]) if sp[0] in first else len(first), sp[0], sp[1].name))
    say(f'{len(todo)} pages, {args.jobs} jobs')
    with ThreadPoolExecutor(args.jobs) as pool:
        for line in pool.map(lambda sp: run(args.engine, args.out, *sp,
                             own_solace=args.i_own_solace, idle_min=args.idle_min,
                             ram_gb=args.ram_gb, page_cap_min=args.page_cap_min), todo):
            say(line)


if __name__ == '__main__':
    sys.exit(main())
