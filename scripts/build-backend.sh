#!/bin/bash
# scripts/build-backend.sh
# Run from Maya/ root: bash scripts/build-backend.sh

set -e

echo "═══════════════════════════════════════"
echo "  Maya Backend Build Script"
echo "═══════════════════════════════════════"

# Activate venv
source backend/venv/bin/activate

# Clean old build artifacts
echo "Cleaning old build..."
rm -rf build/maya-backend dist/backend

# Use spec file for full control
echo "Running PyInstaller with spec file..."
pyinstaller build/maya-backend.spec \
  --distpath dist/backend/ \
  --workpath build/maya-backend \
  --noconfirm

# Verify output
BIN="dist/backend/maya-backend/maya-backend"
if [ -f "$BIN" ]; then
  echo ""
  echo "✓ Build successful!"
  echo "  Binary: $BIN"
  echo "  Size:   $(du -sh dist/backend/maya-backend | cut -f1)"
  echo ""
  echo "Test with:"
  echo "  ./dist/backend/maya-backend/maya-backend"
else
  echo "✗ Build failed — binary not found at $BIN"
  exit 1
fi
