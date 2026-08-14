#!/usr/bin/env python3
"""fade-splat-edges.py — feather a splat PLY's opacity at both Z ends.

The loop tiles two copies of the bundle; with hard crop planes the tile joint
is a visible seam (sliced houses butting sliced houses). Instead, fade opacity
to ~zero over a band at each end and overlap the tiles by exactly that band:
tile A fades out while tile B fades in, the two alphas sum to 1, and the joint
becomes a soft crossfade. LOOP_PERIOD in playcanvasApp.ts must equal
(cropSpan - fadeWidth) * OUTER_SCALE for the fades to line up.

Usage: fade-splat-edges.py <aligned.ply> <southEdge> <southFadeEnd> <northFadeStart> <northEdge>
       (z values in bundle-local units; opacity is modified in place)
"""
import sys

import numpy as np

FMT = {"float": "f4", "double": "f8", "uchar": "u1", "int": "i4",
       "uint": "u4", "short": "i2", "ushort": "u2"}


def open_ply(path):
    props = []
    with open(path, "rb") as f:
        assert f.readline().strip() == b"ply"
        f.readline()
        count = None
        while True:
            s = f.readline().strip().decode()
            if s.startswith("element vertex"):
                count = int(s.split()[-1])
            elif count is not None and s.startswith("property"):
                p = s.split()
                props.append((p[-1], FMT[p[1]]))
            elif s == "end_header":
                dt = np.dtype([(n, "<" + t) for n, t in props])
                return np.memmap(path, dtype=dt, mode="r+", offset=f.tell(),
                                 shape=(count,))


def main():
    path, s_edge, s_end, n_start, n_edge = sys.argv[1:6]
    s_edge, s_end, n_start, n_edge = map(float, (s_edge, s_end, n_start, n_edge))
    mm = open_ply(path)
    z = np.asarray(mm["z"], np.float64)
    a = np.ones(len(z))
    south = z < s_end
    a[south] = (z[south] - s_edge) / (s_end - s_edge)
    north = z > n_start
    a[north] = (n_edge - z[north]) / (n_edge - n_start)

    # Road paint (the white dashes/markings) is irregular, so the two tiles'
    # stripes can never phase-align in the overlap — mismatched double stripes
    # were the most visible seam artifact. Erase the paint entirely across the
    # crossfade (plus a short pre-roll) so the joint reads as a stretch of
    # worn-off markings instead.
    y = np.asarray(mm["y"], np.float64)
    x = np.asarray(mm["x"], np.float64)
    r, g, b = (np.asarray(mm[k], np.float64)
               for k in ("f_dc_0", "f_dc_1", "f_dc_2"))
    lum = (r + g + b) / 3
    paint = ((y > -0.05) & (y < 0.01) & (np.abs(x) < 0.4) & (lum > 1.1)
             & (np.abs(r - g) < 0.3) & (np.abs(g - b) < 0.3))
    PRE = 0.15
    a[paint & ((z < s_end + PRE) | (z > n_start - PRE))] = 0.01

    np.clip(a, 0.01, 1.0, out=a)
    faded = a < 1.0
    # opacity is a sigmoid logit; adding ln(a) scales the low-opacity regime by
    # ~a and monotonically darkens the rest — perceptually a clean fade.
    mm["opacity"][faded] = (mm["opacity"][faded] + np.log(a[faded])).astype(
        mm["opacity"].dtype
    )
    mm.flush()
    print(f"faded {faded.sum()} of {len(z)} gaussians "
          f"(south {south.sum()}, north {north.sum()}, paint {paint.sum()})")


if __name__ == "__main__":
    main()
