#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../.."
npm run build
npm exec -- electron-builder --linux AppImage
echo 'Portable package: build-output/electron/Mardikor*.AppImage'
