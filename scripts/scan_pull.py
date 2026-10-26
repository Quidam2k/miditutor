"""Scan on Pinocchio, pull and verify TIFFs, then convert, classify, and run OMR.

Scans are private: never commit them. Keep --dest and --library outside the repo.
Remote files are removed only after every downloaded TIFF matches its byte size.
Blank pages are preserved in blank/; metadata is recorded in scan_log.json.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import shlex
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageStat

SCANNER = "~/Applications/sane/bin/scanimage"
SSH_OPTIONS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"]
# Show-through from the back of the sheet scans as light gray staves that homr reads
# as extra bars (a one-page song came back with 40 bars instead of 8, #9499).
BLEED_CUTOFF = 140
POLL_S = 2
SETTLE_S = 5


def progress(message: str) -> None:
    print(message.encode("ascii", "backslashreplace").decode("ascii"), file=sys.stderr)


def safe_remote_dir(stamp: str) -> str:
    directory = f"Scans/inbox/{stamp}"
    if re.fullmatch(r"Scans/inbox/[0-9]{8}-[0-9]{6}", directory) is None:
        raise ValueError("Invalid remote scan directory")
    return directory


def parse_stat(text: str) -> dict[str, int]:
    files: dict[str, int] = {}
    for line in text.splitlines():
        if not line.strip():
            continue
        match = re.fullmatch(r"([0-9]+)\s+(page[0-9]{3}\.tiff)", line)
        if match is None:
            raise ValueError(f"Invalid remote file listing: {line!r}")
        size, name = match.groups()
        if name in files:
            raise ValueError(f"Duplicate remote filename: {name}")
        files[name] = int(size)
    return files


def without_bleed(png: Path) -> Path:
    """A grayscale copy of png with the show-through whitened, for OMR."""
    clean = png.with_name(png.stem + ".omr.png")
    with Image.open(png) as img, img.convert("L") as gray:
        gray.point(lambda v: 255 if v > BLEED_CUTOFF else v).save(clean)
    return clean


def paper_bottom(img: Image.Image) -> int:
    """Height of the sheet in a long-page scan, which pads to --page-height with
    the scanner's flat gray background (mean ~221, little noise)."""
    with img.convert("L") as gray, gray.resize((max(1, gray.width // 10), gray.height)) as small:
        y = small.height
        while y > 1:
            stat = ImageStat.Stat(small.crop((0, y - 1, small.width, y)))
            if not (205 < stat.mean[0] < 234 and stat.stddev[0] < 12):
                break
            y -= 1
    return min(img.height, y + 30)


def ink_fraction(img: Image.Image) -> float:
    with img.convert("L") as gray:
        width, height = gray.size
        dx, dy = int(width * 0.03), int(height * 0.03)
        with gray.crop((dx, dy, width - dx, height - dy)) as center:
            if center.width * center.height == 0:
                raise ValueError("Cannot measure an empty image")
            histogram = center.histogram()
            return sum(histogram[:160]) / (center.width * center.height)


def run(argv: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        argv, capture_output=True, text=True, encoding="utf-8", errors="replace"
    )


def ssh(host: str, command: str) -> subprocess.CompletedProcess[str]:
    return run(["ssh", *SSH_OPTIONS, host, command])


def last_error(result: subprocess.CompletedProcess[str]) -> str:
    lines = [line for line in result.stderr.splitlines() if line.strip()]
    return lines[-1] if lines else f"Command exited with code {result.returncode}"


def sensors(host: str) -> dict[str, str]:
    """The iX500's hardware yes/no sensors (page-loaded, scan button, cover-open...)."""
    result = ssh(host, f"{SCANNER} -d fujitsu -A")
    return dict(re.findall(r"--([a-z0-9-]+)\[=\(yes\|no\)\] \[(yes|no)\] \[hardware\]",
                           result.stdout))


def wait_for_paper(host: str) -> None:
    """Return once paper has sat in the feeder for SETTLE_S (so a stack being loaded
    isn't fed half-placed), or at once when the Scan button is pressed (#9507)."""
    loaded_since = None
    while True:
        state = sensors(host)
        if state.get("scan") == "yes":
            return
        if state.get("page-loaded") == "yes":
            loaded_since = loaded_since or time.monotonic()
            if time.monotonic() - loaded_since >= SETTLE_S:
                return
        else:
            loaded_since = None
        time.sleep(POLL_S)


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=os.environ.get(
        "PINOCCHIO_HOST", "toddwalker@todds-mac-mini"
    ))
    parser.add_argument("--source", default="ADF Duplex")
    parser.add_argument("--resolution", type=int, default=300)
    parser.add_argument("--mode", default="Color")
    parser.add_argument("--dest", type=Path, default=Path("Q:/Personal/scans/inbox"))
    parser.add_argument("--music", action="store_true")
    parser.add_argument("--library", type=Path, default=Path("Q:/Personal/piano/library"))
    parser.add_argument("--blank-threshold", type=float, default=0.003)
    parser.add_argument("--list-only", action="store_true")
    # SANE defaults to letter height (279 mm); a taller sheet stops the feeder as a
    # jam. The iX500 takes up to 876 mm (#9498). Width is capped at 216 mm by the guides.
    parser.add_argument("--page-height", type=float, default=None, metavar="MM")
    parser.add_argument("--watch", action="store_true",
                        help="wait for paper in the feeder (or the Scan button), scan one batch, exit")
    args = parser.parse_args()
    if not args.host or args.host.startswith("-"):
        parser.error("--host must be a nonempty SSH destination")
    if args.page_height is not None and not 0 < args.page_height <= 876:
        parser.error("--page-height must be between 0 and 876 mm")
    if args.resolution <= 0:
        parser.error("--resolution must be positive")
    if not math.isfinite(args.blank_threshold) or not 0 <= args.blank_threshold <= 1:
        parser.error("--blank-threshold must be between 0 and 1")
    return args


def execute(args: argparse.Namespace) -> int:
    if args.list_only:
        result = ssh(args.host, f"{SCANNER} -L")
        sys.stdout.write(result.stdout.encode("ascii", "backslashreplace").decode("ascii"))
        if result.stderr:
            progress(result.stderr.rstrip())
        return result.returncode

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    rdir = safe_remote_dir(stamp)
    quoted_dir = shlex.quote(rdir)
    command = (
        f"mkdir -p {quoted_dir} && cd {quoted_dir} && "
        f"{SCANNER} -d fujitsu --source {shlex.quote(args.source)} "
        f"--resolution {shlex.quote(str(args.resolution))} "
        f"--mode {shlex.quote(args.mode)} --format=tiff --batch=page%03d.tiff"
    )
    if args.page_height:
        height = shlex.quote(f"{args.page_height:g}")
        command += f" --page-height {height} -y {height}"
    progress(f"Scanning on {args.host}")
    scanned = ssh(args.host, command)
    output = scanned.stdout + "\n" + scanned.stderr
    counts = re.findall(
        r"Batch terminated,\s*(\d+)\s+pages?\s+scanned", output, re.IGNORECASE
    )
    count = int(counts[-1]) if counts else None
    if count == 0 or (
        count is None and "document feeder out of documents" in output.lower()
    ):
        progress("No paper in the feeder.")
        cleanup = ssh(args.host, f"rmdir {quoted_dir}")
        if cleanup.returncode:
            progress(f"Remote directory retained: {last_error(cleanup)}")
        return 5
    if scanned.returncode and not count:
        progress(f"Scan failed: {last_error(scanned)}")
        return 4
    if scanned.returncode:
        progress(f"Scanner stopped after {count} pages: {last_error(scanned)}")
        for line in scanned.stderr.splitlines()[-5:]:
            progress(f"  scanimage: {line}")

    listing = ssh(args.host, f'cd {quoted_dir} && stat -f "%z %N" page*.tiff')
    if listing.returncode:
        progress(f"Cannot list scans; remote files retained: {last_error(listing)}")
        return 4
    files = parse_stat(listing.stdout)
    if not files:
        raise ValueError("No TIFF files listed; remote directory retained")
    local = (args.dest / stamp).resolve()
    local.mkdir(parents=True, exist_ok=False)
    raw = local / "raw"
    raw.mkdir()
    progress(f"Pulling {len(files)} pages to {local}")
    copied = run([
        "scp", "-o", "BatchMode=yes", "-q",
        f"{args.host}:{rdir}/page*.tiff", str(raw),
    ])
    mismatches = []
    for name, size in files.items():
        path = raw / name
        if not path.is_file():
            mismatches.append(f"{name}: missing")
        elif path.stat().st_size != size:
            mismatches.append(f"{name}: expected {size} bytes, got {path.stat().st_size}")
    if copied.returncode or mismatches:
        if copied.returncode:
            progress(f"Copy failed: {last_error(copied)}")
        for mismatch in mismatches:
            progress(mismatch)
        progress(f"Remote files retained in {rdir}")
        return 3

    assert rdir == safe_remote_dir(stamp)
    removed = ssh(args.host, f"rm -rf {quoted_dir}")
    if removed.returncode:
        progress(f"Remote cleanup failed: {last_error(removed)}")

    if args.music:
        sys.dont_write_bytecode = True
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        from importer.omr import OMRError, photo_to_musicxml

        # The OMR importer uses tempfile; keep its scratch files under --dest.
        tempfile.tempdir = str(local)

    pages = []
    for name, size in sorted(files.items()):
        tiff = raw / name
        png = local / (Path(name).stem + ".png")
        with Image.open(tiff) as img:
            if args.page_height:
                img = img.crop((0, 0, img.width, paper_bottom(img)))
            dimensions = img.size
            img.save(png, format="PNG")
        with Image.open(png) as verified:
            verified.load()
            if verified.size != dimensions:
                raise ValueError(f"PNG dimensions differ for {name}; TIFF retained")
            ink = ink_fraction(verified)
        tiff.unlink()
        blank = ink < args.blank_threshold
        if blank:
            (local / "blank").mkdir(exist_ok=True)
            png = png.rename(local / "blank" / png.name)
            progress(f"{png.name}: near-blank (ink {ink:.4f}), kept in blank/")
        musicxml = error = None
        if args.music and not blank:
            try:
                clean = without_bleed(png)
                try:
                    xml = photo_to_musicxml(clean)
                finally:
                    clean.unlink()
                target = args.library / stamp / (png.stem + ".musicxml")
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(xml, encoding="utf-8")
                musicxml = str(target.resolve())
            except OMRError as exc:
                error = str(exc)
                progress(f"{png.name}: OMR failed: {error}")
        pages.append(dict(name=png.name, bytes=size, ink=ink, blank=blank,
                          musicxml=musicxml, omr_error=error))
    log = dict(stamp=stamp, host=args.host, source=args.source,
               resolution=args.resolution, mode=args.mode,
               scanimage_stdout_tail="\n".join(scanned.stdout.splitlines()[-10:]),
               # Why a batch stopped early (jam, double-feed) is only on stderr (#9493).
               scanimage_stderr_tail="\n".join(scanned.stderr.splitlines()[-10:]),
               pages=pages)
    (local / "scan_log.json").write_text(json.dumps(log, indent=2), encoding="utf-8")
    print(json.dumps(dict(ok=True, stamp=stamp, dir=str(local), pages=len(pages),
                          blank=sum(p["blank"] for p in pages),
                          musicxml=sum(p["musicxml"] is not None for p in pages))))
    return 0


def main() -> int:
    args = arguments()
    try:
        if args.watch:
            progress("Waiting for paper in the feeder or the Scan button")
            wait_for_paper(args.host)
        return execute(args)
    except (OSError, ValueError, RuntimeError) as exc:
        progress(f"Scan failed: {exc}")
        return 4


if __name__ == "__main__":
    raise SystemExit(main())
