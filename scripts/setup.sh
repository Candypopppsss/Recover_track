#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) { console.error("RecoverTrack requires Node.js 24 or later."); process.exit(1) }'
command -v tesseract >/dev/null || { echo 'Install Tesseract OCR using the signed OS package manager (e.g. apt-get install tesseract-ocr).' >&2; exit 1; }
npm ci --no-audit --no-fund --cache .cache/npm
python -m venv .venv
.venv/bin/python -m pip install --cache-dir .cache/pip --requirement services/intelligence/requirements-dev.txt
npm run build
