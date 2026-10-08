# OMR bench (slice E, #4045)

Which optical-music-recognition engine reads a phone photo of a score best?
Winner: **homr 0.7.0**, wired into `importer/omr.py`.

## Results (synthetic phone photos, Minuet in G, 80 notes, 16 bars, 2 staves)

Scores are strict sequence alignment (difflib) over the flattened notes of the
ground-truth MusicXML. Pitch = MIDI number after key signature. Pitch+dur adds the
quarter length. Seconds = wall time for one image on Solace (CPU, no GPU).

| engine | image | pitch % | pitch+dur % | seconds |
|---|---|---|---|---|
| homr 0.7.0 | clean_minuet.png (raw render) | 100.0 | 100.0 | 13.0 |
| homr 0.7.0 | persp.jpg (perspective warp) | 100.0 | 100.0 | 13.2 |
| homr 0.7.0 | rot_blur.jpg (3.5 deg, blur) | 100.0 | 100.0 | 13.1 |
| homr 0.7.0 | shadow.jpg (lighting gradient) | 100.0 | 100.0 | 12.5 |
| homr 0.7.0 | tint_jpeg60.jpg (paper tint, JPEG q60) | 100.0 | 100.0 | 13.1 |
| homr 0.7.0 | phone_combo.jpg (all of the above, stacked) | 100.0 | 100.0 | 12.4 |
| oemer 0.1.8 | clean_minuet.png | 92.8 | 40.5 | 296.3 |
| oemer 0.1.8 | persp.jpg | 60.0 | 40.0 | 158.8 |
| oemer 0.1.8 | rot_blur.jpg | 97.5 | 28.7 | 129.9 |
| oemer 0.1.8 | shadow.jpg | 100.0 | 83.8 | 123.3 |
| oemer 0.1.8 | tint_jpeg60.jpg | 98.8 | 87.5 | 123.6 |
| oemer 0.1.8 | phone_combo.jpg | 52.5 | 47.5 | 132.8 |
| Audiveris 5.11.0 | (all) | not run | not run | - |

Audiveris: not run. Docker Desktop's engine was not running, and the Windows
MSI download was unpacked with an admin-image extract that the auto-mode
classifier denied. No install was done. Unblock it with a permission rule for
`msiexec` (or a portable JDK 21 + the 5.11.0 app-image), then rerun.

Caveat: the test set is synthetic and easy. homr at 100% on every variant means
the bench does not separate good engines from very good ones. **Real phone photos
have not been tested** (none supplied yet); expect lower numbers.

## Why homr

- Only engine that scored 100% pitch and 100% pitch+duration on every variant.
- About 10x faster (13 s vs 120-300 s per image).
- Its failure mode is loud: a photo with no detectable staff raises "No staffs found",
  which becomes OMRError, so the app falls back to showing the photo alone.

## Setup on another machine (Windows, no admin)

    py -3.11 -m venv .venv-omr-homr
    .venv-omr-homr\Scripts\python -m pip install homr==0.7.0
    .venv-omr-homr\Scripts\homr.exe --init      # downloads ~85 MB of model weights into the venv
    
The importer finds `.venv-omr-homr\Scripts\homr.exe` automatically. To use a
different install, set `MIDITUTOR_OMR_HOMR` to the executable path. Footprint: the
homr venv is about 460 MB, mostly onnxruntime and the model weights.

oemer (not used) needed pins to run: `onnxruntime==1.18.1` (CPU) and
`opencv-python-headless==4.10.0.84` in its venv; otherwise its ConvTranspose and
Hough-line code fail on current releases.

## Files

- `make_testset.py`: renders the Minuet (verovio -> SVG -> skia raster) and writes
  six images to `images/`. Gitignored. Run with `.venv-omr-bench`.
- `score.py`: music21 flattening + difflib scoring. `python bench/omr/score.py truth.musicxml pred.musicxml`.
- `run_bench.py`: runs the engines over `images/`, writes `out/results.json` and prints the table.
  `python bench/omr/run_bench.py homr oemer`. Engine executables can be overridden with
  `MIDITUTOR_BENCH_HOMR` / `MIDITUTOR_BENCH_OEMER`.
- Bench venv (`.venv-omr-bench`): verovio, skia-python, opencv-python-headless, numpy, music21.

Per-engine venvs are `.venv-omr-homr`, `.venv-omr-oemer`, and `.venv-omr-bench`
(all gitignored), so the main `.venv` is untouched.
