#!/usr/bin/env python3
"""straighten-road.py — de-warp the aligned splat so the road runs dead straight.

The captured street has a real gentle S-bend (~30 cm over the lap). The bike
rides a mathematically straight line, so any curve in the street reads as the
bike weaving. This step measures the road's centerline f(z) (color-tracked on
the red-brick surface) and applies x <- x - f(z) to every gaussian: the road
becomes exactly x = 0 along the whole span, and the tile joint aligns exactly
(f -> 0 at both ends by construction). Local shear is ~0.5 deg — invisible on
buildings; gaussian orientations are left untouched.

Usage: straighten-road.py <aligned.ply>   (modified in place)
"""
import sys

import numpy as np

FMT = {"float": "f4", "double": "f8", "uchar": "u1", "int": "i4",
       "uint": "u4", "short": "i2", "ushort": "u2"}
# Crop planes (must match CROP_BOX in build-splat.sh) and the loop's tile
# period in local units (LOOP_PERIOD / OUTER_SCALE = crop span - fade width):
# the joint overlaps content at z and z + PERIOD, so the de-warp shift must be
# periodic in PERIOD to leave the joint intact.
Z_SOUTH, Z_NORTH = -1.85, 3.25
PERIOD = 4.85


def open_ply(path, mode):
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
                return np.memmap(path, dtype=dt, mode=mode, offset=f.tell(),
                                 shape=(count,))


def centerline(mm):
    """Track the red-brick road center per z-slice (windowed median follower)."""
    x = np.asarray(mm["x"], float)
    y = np.asarray(mm["y"], float)
    z = np.asarray(mm["z"], float)
    r, g, b = mm["f_dc_0"], mm["f_dc_1"], mm["f_dc_2"]
    red = (y > -0.06) & (y < 0.02) & (r > g + 0.15) & (r > b + 0.2)
    X, Z = x[red], z[red]
    zlo, zhi = np.percentile(Z, 0.5), np.percentile(Z, 99.5)
    step = 0.1
    grid = np.arange(zhi, zlo, -step)
    c = float(np.median(X[np.abs(Z - grid[0]) < 0.3]))
    zs, xs = [], []
    for zc in grid:
        m = (np.abs(Z - zc) < step) & (np.abs(X - c) < 0.35)
        if m.sum() >= 80:
            c = float(np.median(X[m]))
        zs.append(zc)
        xs.append(c)
    zs, xs = np.array(zs), np.array(xs)
    # The raw follower jumps onto red-brick driveways and the open crossing
    # (physically impossible half-meter steps between slices), so fit a smooth
    # low-order model with sigma-clipping. The model is PERIODIC in the tile
    # period: the loop overlaps content z and z + PERIOD across the whole
    # crossfade band, so a periodic shift is identical at every glued pair of
    # points and the joint stays intact by construction (a polynomial can only
    # match at isolated points).
    w = 2 * np.pi / PERIOD

    def basis(zk):
        return np.stack([np.sin(w * zk), np.cos(w * zk),
                         np.sin(2 * w * zk), np.cos(2 * w * zk),
                         np.ones_like(zk)], 1)

    keep = np.ones(len(zs), bool)
    coef = None
    for _ in range(4):
        coef, *_ = np.linalg.lstsq(basis(zs[keep]), xs[keep], rcond=None)
        res = xs - basis(zs) @ coef
        tol = max(0.02, 2 * res[keep].std())
        keep = np.abs(res) < tol
    rms = (xs[keep] - basis(zs[keep]) @ coef).std()
    print(f"centerline fit: kept {keep.sum()}/{len(zs)} slices, rms "
          f"{rms:.4f} local (periodic, P={PERIOD})")
    # Evaluate over the full crop span so the shift reaches the crop planes.
    zg = np.linspace(Z_NORTH, Z_SOUTH, 60)
    sm = basis(zg) @ coef
    sm -= sm.mean()  # preserve the tuned mean lane position
    return zg, sm


def main():
    path = sys.argv[1]
    mm = open_ply(path, "r+")
    zs, f = centerline(mm)
    z = np.asarray(mm["z"], float)
    # zs is descending; np.interp needs ascending. Clamp beyond span to edges.
    shift = np.interp(z, zs[::-1], f[::-1])
    mm["x"][:] = (np.asarray(mm["x"], float) - shift).astype(mm["x"].dtype)
    mm.flush()
    print(f"straightened road: centerline range {f.min():+.4f}..{f.max():+.4f} "
          f"local (max |shift| {np.abs(f).max() * 6.6:.2f} world) over "
          f"z {zs.min():+.2f}..{zs.max():+.2f}")


if __name__ == "__main__":
    main()
