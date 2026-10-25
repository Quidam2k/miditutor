"""scan_pull's pure helpers: remote listing parse, remote-dir guard, blank-page ink measure."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import pytest
from PIL import Image, ImageDraw

from scan_pull import ink_fraction, parse_stat, safe_remote_dir


def test_parse_stat_reads_sizes():
    assert parse_stat("123 page001.tiff\n\n4567 page002.tiff\n") == {
        "page001.tiff": 123, "page002.tiff": 4567}


@pytest.mark.parametrize("text", [
    "123 ../page001.tiff",
    "123 page001.tiff; rm -rf ~",
    "abc page001.tiff",
    "1 page001.tiff\n2 page001.tiff",
])
def test_parse_stat_rejects_odd_listings(text):
    with pytest.raises(ValueError):
        parse_stat(text)


def test_safe_remote_dir():
    assert safe_remote_dir("20261025-221500") == "Scans/inbox/20261025-221500"
    for bad in ["", "..", "20261025-2215", "20261025-221500/../.."]:
        with pytest.raises(ValueError):
            safe_remote_dir(bad)


def test_ink_fraction_blank_vs_printed():
    blank = Image.new("RGB", (1000, 1300), "white")
    # A dark scanner-edge border sits outside the 3% crop and must not count as ink.
    ImageDraw.Draw(blank).rectangle((0, 0, 999, 1299), outline="black", width=20)
    assert ink_fraction(blank) == 0
    page = blank.copy()
    ImageDraw.Draw(page).rectangle((200, 200, 800, 260), fill="black")
    assert ink_fraction(page) > 0.003
