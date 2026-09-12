"""Compare unscaled canvas captures: python3 scripts/perf-diff.py baseline candidate."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageChops

base, candidate = map(Path, sys.argv[1:])
for image in sorted(base.glob('*.png')):
    a = Image.open(image).convert('RGB')
    b = Image.open(candidate / image.name).convert('RGB')
    assert a.size == b.size, f'Resolution changed: {image.name}'
    difference = ImageChops.difference(a, b)
    pixels = list(difference.getdata())
    print(json.dumps({
        'image': image.name, 'size': a.size,
        'mean_absolute_rgb_error': sum(sum(p) for p in pixels) / (len(pixels) * 3),
        'max_channel_error': max(max(p) for p in pixels),
        'pixels_over_2_levels_pct': 100 * sum(max(p) > 2 for p in pixels) / len(pixels),
        'changed_bounds': difference.getbbox(),
    }))
