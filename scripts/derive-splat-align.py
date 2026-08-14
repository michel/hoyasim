#!/usr/bin/env python3
"""
derive-splat-align.py — find the similarity transform that maps a new splat
capture onto the coordinate frame of the bundle currently shipped under
public/playcanvas/assets/splat/.

Why: the scene's placement of the splat (rotation/scale/loop tiling) is hand-tuned
in src/lib/playcanvasApp.ts against the EXISTING bundle's local frame. A fresh
render comes out in a different frame (scale/centre/orientation). To keep the swap
drop-in, we transform the new capture so its solid geometry lands on top of the
current one, then feed the result to scripts/build-splat.sh (PASS 1 ALIGN_*).

How: decode the current bundle's LOD-0 chunks back to a point cloud (via
splat-transform SOGS->PLY), then best-fit a uniform-scale + rotation + translation
from the new capture's solid core onto it. Robust to the floater/haze differences
between renders: a PCA seed (with sign disambiguation by voxel overlap) followed by
a coarse-to-fine, outlier-trimmed ICP using voxel-mean correspondences (Umeyama).

Prints ALIGN_SCALE / ALIGN_TRANSLATE for build-splat.sh. If the fitted rotation is
more than ~1 deg off identity it also prints the Euler angles to add as `-r`.

Usage:  python3 scripts/derive-splat-align.py /path/to/new_capture.ply
Requires: numpy, Pillow not needed (uses splat-transform), bunx on PATH.
"""
import os
import subprocess
import sys

import numpy as np

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUNDLE = os.path.join(REPO, "public/playcanvas/assets/splat-v7")
FMT = {"float": "f4", "double": "f8", "uchar": "u1", "int": "i4",
       "uint": "u4", "short": "i2", "ushort": "u2"}


def read_header(path):
    props = []
    with open(path, "rb") as f:
        assert f.readline().strip() == b"ply"
        f.readline()
        count = None
        while True:
            s = f.readline().strip().decode()
            if s.startswith("element vertex"):
                count = int(s.split()[-1])
            elif s.startswith("property"):
                p = s.split()
                props.append((p[-1], FMT[p[1]]))
            elif s == "end_header":
                return count, props, f.tell()


def load_xyz(path, maxn=600_000):
    count, props, hlen = read_header(path)
    dt = np.dtype([(n, "<" + t) for n, t in props])
    mm = np.memmap(path, dtype=dt, mode="r", offset=hlen, shape=(count,))
    idx = np.arange(0, count, max(1, count // maxn)) if maxn and count > maxn else np.arange(count)
    P = np.stack([mm["x"][idx], mm["y"][idx], mm["z"][idx]], 1).astype(np.float64)
    return P[np.isfinite(P).all(1)]


def core(P, pct=98):  # drop the sparse floater halo, keep the solid scene
    med = np.median(P, 0)
    d = np.linalg.norm(P - med, axis=1)
    return P[d <= np.percentile(d, pct)]


def pca(P):
    c = P.mean(0)
    w, V = np.linalg.eigh(np.cov((P - c).T))
    o = np.argsort(w)[::-1]
    return c, np.sqrt(w[o]), V[:, o]


def umeyama(X, Y):  # least-squares similarity mapping X -> Y
    mx, my = X.mean(0), Y.mean(0)
    Xc, Yc = X - mx, Y - my
    U, d, Vt = np.linalg.svd(Yc.T @ Xc / len(X))
    D = np.eye(3)
    if np.linalg.det(U @ Vt) < 0:
        D[2, 2] = -1
    R = U @ D @ Vt
    s = np.trace(np.diag(d) @ D) / ((Xc ** 2).sum() / len(X))
    return s, R, my - s * (R @ mx)


def decode_bundle_lod0():
    """splat-transform each LOD-0 SOGS chunk back to PLY, return the merged cloud."""
    lod0 = sorted(d for d in os.listdir(BUNDLE) if d.startswith("0_"))
    clouds = []
    for d in lod0:
        out = f"/tmp/_align_{d}.ply"
        subprocess.run(["bunx", "@playcanvas/splat-transform", "-w",
                        os.path.join(BUNDLE, d, "meta.json"), out],
                       check=True, capture_output=True)
        clouds.append(load_xyz(out, maxn=None))
    return np.concatenate(clouds)


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: derive-splat-align.py <new_capture.ply>")
    print("decoding current bundle LOD-0 ...")
    ref = core(decode_bundle_lod0())
    src = core(load_xyz(sys.argv[1]))
    ref = ref[np.arange(0, len(ref), max(1, len(ref) // 500_000))]
    src = src[np.arange(0, len(src), max(1, len(src) // 200_000))]
    cR, sR, VR = pca(ref)
    cF, sF, VF = pca(src)
    s = float(np.mean(sR / sF))
    occ = set(map(tuple, np.floor(ref / 1.0).astype(np.int64)))

    def overlap(Q, vs=1.0):
        q = set(map(tuple, np.floor(Q / vs).astype(np.int64)))
        return len(q & occ) / max(1, len(q)) if vs == 1.0 else None

    best = None
    for sg in [(1, 1, 1), (1, -1, -1), (-1, 1, -1), (-1, -1, 1)]:
        R = VR @ np.diag(sg) @ VF.T
        if np.linalg.det(R) < 0:
            continue
        ov = overlap(s * (R @ (src - cF).T).T + cR)
        if best is None or ov > best[0]:
            best = (ov, R)
    R = best[1]
    t = cR - s * (R @ cF)
    for vs in (1.2, 0.8, 0.5, 0.35, 0.25, 0.18, 0.12):
        keys = np.floor(ref / vs).astype(np.int64)
        acc = {}
        for k, p in zip(map(tuple, keys), ref):
            a = acc.get(k)
            acc[k] = [p.copy(), 1] if a is None else [a[0] + p, a[1] + 1]
        vm = {k: v[0] / v[1] for k, v in acc.items()}
        for _ in range(10):
            qk = np.floor((s * (R @ src.T).T + t) / vs).astype(np.int64)
            X, Y = [], []
            for p, k in zip(src, map(tuple, qk)):
                m = vm.get(k)
                if m is not None:
                    X.append(p)
                    Y.append(m)
            if len(X) < 500:
                break
            X, Y = np.array(X), np.array(Y)
            res = np.linalg.norm(s * (R @ X.T).T + t - Y, axis=1)
            keep = res <= np.percentile(res, 75)
            s, R, t = umeyama(X[keep], Y[keep])

    ang = np.degrees(np.arccos(np.clip((np.trace(R) - 1) / 2, -1, 1)))
    Q = s * (R @ src.T).T + t
    print(f"\nfit: scale={s:.8f}  rotation={ang:.3f} deg from identity  "
          f"overlap={overlap(Q):.3f}")
    print(f"ALIGN_SCALE=\"{s:.17g}\"")
    print(f"ALIGN_TRANSLATE=\"{t[0]:.6g},{t[1]:.6g},{t[2]:.6g}\"")
    if ang > 1.0:
        # ZYX Euler (PlayCanvas / splat-transform -r convention), degrees
        ey = np.degrees(np.arcsin(-R[2, 0]))
        ex = np.degrees(np.arctan2(R[2, 1], R[2, 2]))
        ez = np.degrees(np.arctan2(R[1, 0], R[0, 0]))
        print(f"# rotation is non-trivial — add to PASS 1: -r {ex:.4f},{ey:.4f},{ez:.4f}")
    else:
        print("# rotation within 1 deg of identity — no -r needed")


if __name__ == "__main__":
    main()
