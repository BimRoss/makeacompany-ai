#!/usr/bin/env python3
"""
Turn studio-style black backgrounds into transparency for PNG headshots.

Canva (and some exporters) sometimes bake “transparent” areas as solid #000000.
This script flood-fills pixels connected to the *image border* where max(R,G,B)
is at or below a threshold, and sets their alpha to 0.

Requires: pip install pillow (or use project venv if you add one).

Example:
  python3 scripts/headshots-remove-edge-black.py public/headshots/tim.png public/headshots/garth.png
"""

from __future__ import annotations

import argparse
import sys
from collections import deque
from pathlib import Path

from PIL import Image


def remove_edge_connected_dark(im: Image.Image, threshold: int) -> Image.Image:
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()

    def dark(x: int, y: int) -> bool:
        r, g, b, _a = px[x, y]
        return max(r, g, b) <= threshold

    def idx(x: int, y: int) -> int:
        return y * w + x

    in_q = bytearray(w * h)
    q: deque[tuple[int, int]] = deque()

    def try_seed(x: int, y: int) -> None:
        if not dark(x, y):
            return
        i = idx(x, y)
        if in_q[i]:
            return
        in_q[i] = 1
        q.append((x, y))

    for x in range(w):
        try_seed(x, 0)
        try_seed(x, h - 1)
    for y in range(h):
        try_seed(0, y)
        try_seed(w - 1, y)

    while q:
        x, y = q.popleft()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if nx < 0 or nx >= w or ny < 0 or ny >= h:
                continue
            try_seed(nx, ny)

    out = im.copy()
    opx = out.load()
    for y in range(h):
        for x in range(w):
            if in_q[idx(x, y)]:
                r, g, b, _ = opx[x, y]
                opx[x, y] = (r, g, b, 0)
    return out


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("paths", nargs="+", type=Path, help="PNG files to process in place")
    p.add_argument(
        "--threshold",
        type=int,
        default=48,
        help="Max channel value (0-255) treated as background black (default: 48)",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Analyze corner pixels only; do not write files",
    )
    args = p.parse_args()

    for path in args.paths:
        if not path.is_file():
            print(f"skip (missing): {path}", file=sys.stderr)
            continue
        im = Image.open(path)
        if args.dry_run:
            px = im.convert("RGBA").load()
            w, h = im.size
            for label, xy in (
                ("TL", (0, 0)),
                ("TR", (w - 1, 0)),
                ("BL", (0, h - 1)),
                ("BR", (w - 1, h - 1)),
            ):
                x, y = xy
                r, g, b, a = px[x, y]
                print(f"{path.name} corner {label}: RGBA=({r},{g},{b},{a}) max_rgb={max(r, g, b)}")
            continue
        out = remove_edge_connected_dark(im, args.threshold)
        out.save(path, format="PNG", optimize=True)
        print(f"updated {path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
