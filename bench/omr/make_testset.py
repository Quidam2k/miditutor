"""Build the OMR bench test set: a clean render of the Minuet in G plus
synthetic 'phone photo' variants of it.

Run with the bench venv:  .venv-omr-bench/Scripts/python bench/omr/make_testset.py
Outputs go to bench/omr/images/ (gitignored: generated images are not committed).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import cv2
import numpy as np
import skia
import verovio

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
SOURCE = REPO / "src" / "renderer" / "assets" / "minuet-in-g.musicxml"
OUT = HERE / "images"
RENDER_SCALE = 2.5  # 840x504 verovio SVG -> 2100x1260 raster


def render_clean(out_png: Path) -> None:
    """MusicXML -> verovio SVG -> skia raster (MuPDF drops verovio's <use> glyphs)."""
    tk = verovio.toolkit()
    tk.setOptions({"scale": 40, "pageWidth": 2100, "pageHeight": 2970,
                   "adjustPageHeight": True, "footer": "none", "header": "none"})
    tk.loadData(SOURCE.read_text(encoding="utf-8"))
    svg = tk.renderToSVG(1)
    # skia-python ignores verovio's stylesheet, so staff lines (stroke-width paths with no
    # stroke colour) come out invisible. Give every stroked path an explicit black stroke.
    svg = re.sub(r'<path (d="[^"]*" stroke-width="[^"]*")', r'<path stroke="#000" \1', svg)
    data = skia.Data.MakeWithCopy(svg.encode("utf-8"))
    dom = skia.SVGDOM.MakeFromStream(skia.MemoryStream(data))
    w, h = dom.containerSize().width(), dom.containerSize().height()
    surf = skia.Surface(int(w * RENDER_SCALE), int(h * RENDER_SCALE))
    canvas = surf.getCanvas()
    canvas.clear(skia.ColorWHITE)
    canvas.scale(RENDER_SCALE, RENDER_SCALE)
    dom.render(canvas)
    surf.makeImageSnapshot().save(str(out_png), skia.kPNG)


def perspective(img: np.ndarray, amount: float) -> np.ndarray:
    h, w = img.shape[:2]
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    d = amount * w
    dst = np.float32([[d, d * 0.6], [w - d * 0.4, 0], [w - d * 0.2, h - d * 0.5], [d * 0.3, h]])
    m = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(img, m, (w, h), borderValue=(200, 200, 200))


def rotate(img: np.ndarray, deg: float) -> np.ndarray:
    h, w = img.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), deg, 1.0)
    return cv2.warpAffine(img, m, (w, h), borderValue=(200, 200, 200))


def shadow(img: np.ndarray, strength: float) -> np.ndarray:
    h, w = img.shape[:2]
    grad = np.linspace(1.0, 1.0 - strength, w, dtype=np.float32)[None, :]
    grad = np.repeat(grad, h, axis=0)[..., None]
    return np.clip(img.astype(np.float32) * grad, 0, 255).astype(np.uint8)


def tint(img: np.ndarray, bgr: tuple[int, int, int]) -> np.ndarray:
    """Tint the paper (white -> bgr) while keeping the ink black."""
    scale = np.array(bgr, dtype=np.float32) / 255.0
    return np.clip(img.astype(np.float32) * scale, 0, 255).astype(np.uint8)


def jpeg(img: np.ndarray, quality: int) -> np.ndarray:
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    assert ok
    return cv2.imdecode(buf, cv2.IMREAD_COLOR)


def variants(clean: np.ndarray) -> dict[str, np.ndarray]:
    # Each variant is a plausible phone-photo failure mode, applied alone or stacked.
    out = {}
    out["persp"] = perspective(clean, 0.06)
    out["rot_blur"] = cv2.GaussianBlur(rotate(clean, 3.5), (5, 5), 1.2)
    out["shadow"] = shadow(clean, 0.55)
    out["tint_jpeg60"] = jpeg(tint(clean, (205, 225, 240)), 60)
    out["phone_combo"] = jpeg(
        shadow(cv2.GaussianBlur(perspective(rotate(clean, -2.0), 0.04), (3, 3), 0.8), 0.4), 55)
    return out


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    clean_png = OUT / "clean_minuet.png"
    render_clean(clean_png)
    clean = cv2.imread(str(clean_png), cv2.IMREAD_COLOR)
    if clean is None:
        print("could not read rendered clean image", file=sys.stderr)
        return 1
    # Copy the reference MusicXML next to the images so score.py reads a fixed truth file.
    (OUT / "minuet-in-g.truth.musicxml").write_text(SOURCE.read_text(encoding="utf-8"), encoding="utf-8")
    for name, img in variants(clean).items():
        cv2.imwrite(str(OUT / f"{name}.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 90])
        print("wrote", name)
    print("wrote clean_minuet.png and truth file")
    return 0


if __name__ == "__main__":
    sys.exit(main())
