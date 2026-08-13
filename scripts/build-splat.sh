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
# The current ALIGN_* values below map the 2026-08-13 "Omgeving v03" cleaned
# render onto the original shipped frame. They were derived, not guessed: decode
# the current bundle back to a point cloud and best-fit a similarity transform
# (uniform scale + rotation + translation) from the new capture onto it. v03 came
# out in a genuinely different frame (~91 deg rotation + 0.0264 scale vs the old
# 0.0495), so unlike fixed2.ply the `-r` rotation is required. Reproduce /
# re-derive with scripts/derive-splat-align.py.
#
# splat-transform applies ACTIONS IN ORDER, so `-r` (rotate) then `-s` (scale)
# then `-t` (translate) realises  p' = scale * (R @ p) + translate  (the order
# that matches the solver; uniform scale commutes with R).
# `-H 0` strips all SH bands above DC to match the shipped 0-SH bundle.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="${SRC:-$HOME/Downloads/Aanlevermap/Cleaned Up/Omgeving - v03 -100k.compressed2.ply}"  # raw capture (.ply, plain or compressed)
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
# world -0.0443). For v03 the slope re-measured to exactly -1 and t_y solved to
# +0.0503902 (derive gave +0.0531902), seating the road within 0.0004 local. Keeps
# the swap drop-in — no object re-seating in playcanvasApp.ts.
ALIGN_ROTATE="-148.3097,-88.9157,147.5934"
ALIGN_SCALE="0.026437995666495091"
ALIGN_TRANSLATE="-2.49607,0.0503902,1.4554"

# v03's street ends at a T-junction: south of local z=-0.6 (world -14.6) a hedge
# and garden strip cross the riding line, so the rig would plough through them.
# Crop everything south of the junction; the loop then butts the next tile's
# street straight onto the cross-street (LOOP_PERIOD/START_Z in playcanvasApp.ts
# are tuned to wrap right at this edge). Box is min-corner,max-corner in the
# ALIGNED (bundle-local) frame.
CROP_BOX="-1000,-1000,-0.6,1000,1000,1000"

echo "===== PASS 1: align to scene frame + strip SH ====="
bunx @playcanvas/splat-transform -w "$SRC" \
  -N \
  -r "$ALIGN_ROTATE" \
  -s "$ALIGN_SCALE" \
  -t "$ALIGN_TRANSLATE" \
  -B "$CROP_BOX" \
  -H 0 \
  "$ALIGNED"

echo "===== PASS 2: build 4-tier LOD bundle (~128K-gaussian chunks) ====="
# --decimate halves (then quarters, then eighths) each coarser tier via pairwise
# merge. Since splat-transform 3.3.0 a decimate must be the FINAL action writing a
# .ply, so each tier is its own invocation; the assembly run then tags each input
# with -l N (LOD level of the PRECEDING input) and chunks the octree.
# --lod-chunk-count 128 caps each chunk at ~128K gaussians so per-frame streaming
# uploads stay cheap (this was `-C 128` before 3.3.0 repurposed -C). These
# percentages and the chunk size define the bundle's quality/size/streaming-
# smoothness trade-off.
for tier in "50:1" "25:2" "12.5:3"; do
  pct="${tier%%:*}"; lvl="${tier##*:}"
  bunx @playcanvas/splat-transform -w "$ALIGNED" --decimate "$pct%" "/tmp/splat_lod$lvl.ply"
done
rm -rf "$OUT"; mkdir -p "$OUT"
bunx @playcanvas/splat-transform -w \
  "$ALIGNED" -l 0 \
  /tmp/splat_lod1.ply -l 1 \
  /tmp/splat_lod2.ply -l 2 \
  /tmp/splat_lod3.ply -l 3 \
  --lod-chunk-count 128 \
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
