#!/bin/bash
# scripts/build-app.sh
# Builds Maya into a real Mac .app file
# Run from Maya/ root: bash scripts/build-app.sh

set -e
echo "═══════════════════════════════════════"
echo "  Maya — Building Mac App"
echo "═══════════════════════════════════════"

# ── Step 1: Generate app icon ──────────────────────────────────────────────
echo ""
echo "▸ Generating app icon..."
mkdir -p build/icons

# Create icon using Python (available on all Macs)
python3 << 'PYTHON'
from PIL import Image, ImageDraw, ImageFont
import os

sizes = [16, 32, 64, 128, 256, 512, 1024]
icon_dir = "build/icons/maya.iconset"
os.makedirs(icon_dir, exist_ok=True)

for size in sizes:
    img  = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Teal gradient circle background
    padding = size * 0.05
    draw.ellipse([padding, padding, size-padding, size-padding],
                 fill=(13, 148, 136, 255))

    # Inner lighter circle for depth
    p2 = size * 0.15
    draw.ellipse([p2, p2, size-p2, size-p2],
                 fill=(20, 184, 166, 255))

    # "M" letter
    font_size = int(size * 0.55)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", font_size)
    except:
        font = ImageFont.load_default()

    text = "M"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw   = bbox[2] - bbox[0]
    th   = bbox[3] - bbox[1]
    x    = (size - tw) / 2 - bbox[0]
    y    = (size - th) / 2 - bbox[1]
    draw.text((x, y), text, fill=(240, 253, 250, 255), font=font)

    # Save both 1x and 2x
    img.save(f"{icon_dir}/icon_{size}x{size}.png")
    if size <= 512:
        img_2x = img.resize((size*2, size*2), Image.LANCZOS)
        img_2x.save(f"{icon_dir}/icon_{size}x{size}@2x.png")

print("✓ Icon images created")
PYTHON

# Convert to .icns using iconutil (built into macOS)
if [ -d "build/icons/maya.iconset" ]; then
    iconutil -c icns build/icons/maya.iconset -o build/icons/icon.icns
    echo "✓ icon.icns created"
else
    echo "⚠ Skipping icns — iconset not created"
fi

# ── Step 2: Build React frontend ───────────────────────────────────────────
echo ""
echo "▸ Building React frontend..."
cd frontend && npm run build && cd ..
echo "✓ Frontend built → dist/frontend/"

# ── Step 3: Build Python backend binary ────────────────────────────────────
echo ""
echo "▸ Building Python backend..."
source backend/venv/bin/activate
pyinstaller build/maya-backend.spec \
  --distpath dist/backend/ \
  --workpath build/maya-backend \
  --noconfirm
echo "✓ Backend built → dist/backend/maya-backend/"

# ── Step 4: Package into .app ──────────────────────────────────────────────
echo ""
echo "▸ Packaging into Mac app..."
npx electron-builder --mac --arm64
# For Intel Mac use: --x64
# For both:          --universal

echo ""
echo "═══════════════════════════════════════"
echo "  ✓ Build complete!"
echo "  App: dist/app/Maya-1.0.0-arm64.dmg"
echo ""
echo "  Install: open dist/app/Maya-1.0.0-arm64.dmg"
echo "  Drag Maya.app to Applications folder"
echo "═══════════════════════════════════════"
