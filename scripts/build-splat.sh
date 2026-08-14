#!/usr/bin/env bash
#
# build-splat.sh — turn the raw Gaussian-splat capture into the streamed LOD
# bundle that ships under public/playcanvas/assets/.
#
# Two passes of @playcanvas/splat-transform (via bunx, no install needed):
#
#   PASS 1 — place the capture in the scene frame and strip SH to match the
#            shipped 0-SH format.
#   PASS 2 — build the 4-tier LOD octree (spatial chunks the runtime streams).
#
# Usage:  bun run build-splat            # uses the defaults below
#         SRC=/path/to/new.ply bun run build-splat
#
# The bundle directory name carries a version (splat-v8, -v9, ...): chunk URLs
# are identical across rebuilds, so browsers/CDNs serve stale chunks unless the
# directory changes. Bump it on every geometry rebuild and update the asset url
# + size/hash in public/playcanvas/config.json (printed at the end).
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="${SRC:-$HOME/Downloads/Aanlevermap/Cleaned Up/Omgeving - v03 -100k.compressed2.ply}"
OUT="${OUT:-public/playcanvas/assets/splat-v8}"
ALIGNED="${ALIGNED:-/tmp/splat_aligned.ply}"

# Scene placement, solved against the raw capture (probe road landmarks):
#   ROTATE     near-identity — the capture is already street-along-z; the 0.58
#              roll levels the road crossways.
#   SCALE      world size (the scene magnifies a further OUTER_SCALE x in
#              src/lib/playcanvasApp.ts).
#   TRANSLATE  seats the road under the bike: lane offset (note: the CLI
#              applies this X sign-flipped), road plane at local y -0.009,
#              street span onto the lap window (local z -1.75..+3.25).
ROTATE="-0.0117,-0.0126,0.5810"
SCALE="0.026437995666495091"
TRANSLATE="-0.047,0,3.20"

echo "===== PASS 1: place in scene frame + strip SH ====="
bunx @playcanvas/splat-transform -w "$SRC" \
  -N \
  -r "$ROTATE" \
  -s "$SCALE" \
  -t "$TRANSLATE" \
  -H 0 \
  "$ALIGNED"

echo "===== PASS 2: build 4-tier LOD bundle (~128K-gaussian chunks) ====="
# --decimate halves (then quarters, then eighths) each coarser tier; since
# splat-transform 3.3.0 each decimate is its own invocation and the last run
# assembles the tiers. --lod-chunk-count 128 keeps per-frame streaming cheap.
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

# splat-transform emits minified JSON; the repo keeps manifests biome-formatted.
echo "===== format manifests to repo convention ====="
bunx biome format --write "$OUT" >/dev/null

echo "===== DONE ====="
du -sh "$OUT"
echo "chunks per LOD:"; ls "$OUT" | sed -n 's/^\([0-9]\)_.*/\1/p' | sort | uniq -c
echo "lod-meta size:"; stat -f '%z' "$OUT/lod-meta.json"
echo "lod-meta hash:"; md5 -q "$OUT/lod-meta.json"
echo
echo "Next: update url/file.size/file.hash for asset 287139133 in"
echo "public/playcanvas/config.json."
