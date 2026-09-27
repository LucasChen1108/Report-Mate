#!/usr/bin/env bash
# Build a deployable Report Mate release into ./release:
#   release/reportmate-server   the Go backend binary (Linux amd64 for Lightsail)
#   release/web/                 the built frontend (frontend/dist)
#   release/.env.production.example  the prod env template to fill in on the box
#
# The backend serves release/web as the SPA when STATIC_DIR points at it, so one
# process serves both the API and the app on a single origin.
#
# Usage:  ./scripts/build-release.sh
# Requires: go, node/npm. Override GOOS/GOARCH if your instance differs.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/release"
GOOS="${GOOS:-linux}"
GOARCH="${GOARCH:-amd64}"

echo "==> Clean $OUT"
rm -rf "$OUT"
mkdir -p "$OUT/web"

echo "==> Build frontend (VITE_AUTH_MODE=api for production)"
cd "$ROOT/frontend"
npm ci
VITE_AUTH_MODE=api VITE_API_BASE_URL="" npm run build
cp -R dist/. "$OUT/web/"

echo "==> Build backend ($GOOS/$GOARCH)"
cd "$ROOT/backend"
CGO_ENABLED=0 GOOS="$GOOS" GOARCH="$GOARCH" go build -trimpath -o "$OUT/reportmate-server" ./cmd/server

echo "==> Stage env template"
cp "$ROOT/.env.production.example" "$OUT/.env.production.example"

echo "==> Done. release/ contains:"
ls -la "$OUT"
echo
echo "Next: copy release/ to the Lightsail instance, fill in .env, then run"
echo "  STATIC_DIR=\$PWD/web ./reportmate-server   (or set STATIC_DIR in .env)"
