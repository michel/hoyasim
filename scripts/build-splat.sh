#!/usr/bin/env bash
#
# build-splat.sh — turn a raw Gaussian-splat capture into the streamed LOD bundle
# that ships under public/playcanvas/assets/splat/.
#
# The shipped bundle is NOT a single file: it is a spatial octree of small WebP
# chunks, each available at four detail tiers (LOD 0 = full, 3 = coarsest), plus
# a lod-meta.json manifest. PlayCanvas streams in only the chunks the camera can
# see and picks a tier per chunk at runtime. See the README ("The Gaussian Splat
# Environment") for how the runtime consumes it.
#
# This script is the single source of truth for HOW that bundle is built. It runs
# two passes of @playcanvas/splat-transform (via bunx, no install needed):
#
#   PASS 1 — normalise the capture into the scene's coordinate frame and match the
#            shipped bundle's format (0 spherical-harmonic bands).
#   PASS 2 — build the 4-tier LOD octree (this is what "creates the LOD").
#
# Usage:  bun run build-splat            # uses the defaults below
#         SRC=/path/to/new.ply bun run build-splat
#
# ---------------------------------------------------------------------------
# FRAME ALIGNMENT (PASS 1) — the part you must re-derive for a new capture
# ---------------------------------------------------------------------------
# The scene's placement of the splat (rotation/scale/loop tiling) is hand-tuned in
# src/lib/playcanvasApp.ts against the EXISTING bundle's local coordinate frame.
# A fresh render almost never comes out in that same frame — it is typically a
# different scale, recentred, and sometimes reoriented. So before building the LOD
# we transform the capture so its solid geometry lands exactly on top of the
# current bundle. Then playcanvasApp.ts needs no changes and the swap is drop-in.
#
# The current ALIGN_* values below map the 2026-06-15 "fixed2.ply" re-render onto
# the original shipped frame. They were derived, not guessed: decode the current
# bundle back to a point cloud and best-fit a similarity transform (uniform scale
# + rotation + translation) from the new capture onto it. For fixed2.ply the fit
# was a pure uniform scale + Z-shift (rotation within 0.06 deg of identity at
# overlap 1.000, so it is omitted). Reproduce / re-derive with
# scripts/derive-splat-align.py.
#
# splat-transform applies ACTIONS IN ORDER, so `-s` (scale) then `-t` (translate)
# realises  p' = scale * p + translate  (the order that matches the solver).
# `-H 0` strips all SH bands above DC to match the shipped 0-SH bundle.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="${SRC:-$HOME/Downloads/fixed2.ply}"         # raw capture (full-SH .ply)
OUT="${OUT:-public/playcanvas/assets/splat}"     # shipped bundle location
ALIGNED="${ALIGNED:-/tmp/splat_aligned.ply}"     # PASS 1 intermediate (0-SH, in-frame)

# similarity transform: new-capture local frame -> current shipped frame.
# derive-splat-align.py best-fits the WHOLE cloud (overlap 1.000), which seats X/Z
# but NOT the gravity axis: a fresh render's floater distribution pulls the global
# Y fit, so the dense road plane (what the bike + traffic light rest on) lands off.
# Worse, splat-transform applies the -t *Y* with a sign flip (PLY->SOG Y-axis
# convention; X/Z are unaffected) — d(road_world_Y)/d(t_y) = -1 exactly. So derive's
# t_y is not the road-seat value. Instead solve t_y directly: run PASS 1 only at two
# t_y probes, measure the dense road slab (LOD-0 |x|<0.1,|z|<1, densest Y bin), and
# pick t_y so the road centreline lands on the OLD bundle's plane (local -0.00887,
# world -0.0443). For fixed2.ply that is t_y=+0.020316 (derive gave -0.0044). Keeps
# the swap drop-in — no object re-seating in playcanvasApp.ts.
ALIGN_SCALE="0.049533579662214819"
ALIGN_TRANSLATE="0.00958941,0.020316,4.17115"

echo "===== PASS 1: align to scene frame + strip SH ====="
bunx @playcanvas/splat-transform -w "$SRC" \
  -N \
  -s "$ALIGN_SCALE" \
  -t "$ALIGN_TRANSLATE" \
  -H 0 \
  "$ALIGNED"

echo "===== PASS 2: build 4-tier LOD bundle (~128K-gaussian chunks) ====="
# -l N tags the preceding input as LOD level N; --decimate halves (then quarters,
# then eighths) each coarser tier via pairwise merge; -C 128 caps each chunk at
# ~128K gaussians so per-frame streaming uploads stay cheap. These percentages and
# the chunk size define the bundle's quality/size/streaming-smoothness trade-off.
rm -rf "$OUT"; mkdir -p "$OUT"
bunx @playcanvas/splat-transform -w \
  "$ALIGNED" -l 0 \
  "$ALIGNED" --decimate 50%   -l 1 \
  "$ALIGNED" --decimate 25%   -l 2 \
  "$ALIGNED" --decimate 12.5% -l 3 \
  -C 128 \
  "$OUT/lod-meta.json"

# splat-transform emits minified JSON; the repo keeps the bundle manifests
# biome-formatted, so normalise them (and refresh config size/hash afterwards).
echo "===== format manifests to repo convention ====="
bunx biome format --write "$OUT" >/dev/null

echo "===== DONE ====="
du -sh "$OUT"
echo "chunks per LOD:"; ls "$OUT" | sed -n 's/^\([0-9]\)_.*/\1/p' | sort | uniq -c
echo "lod-meta size:"; stat -f '%z' "$OUT/lod-meta.json"
echo "lod-meta hash:"; md5 -q "$OUT/lod-meta.json"
echo
echo "Next: update file.size + file.hash for asset 287139133 in"
echo "public/playcanvas/config.json with the two values above (cache-bust hint)."
