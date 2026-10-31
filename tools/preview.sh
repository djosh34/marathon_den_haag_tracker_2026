#!/bin/sh
# Publishes the current build as a preview on https://djosh34.github.io/marathon_den_haag_tracker_2026-preview/
# (a separate repo with Pages on its main branch, so the live site is not touched).
set -e
REPO=marathon_den_haag_tracker_2026-preview
BASE_PATH=/$REPO npm run build
out=$(mktemp -d)
cp -r build/. "$out"
touch "$out/.nojekyll" # Pages would otherwise skip the _app directory
git -C "$out" init -q -b main
git -C "$out" add -A
git -C "$out" commit -q -m "Preview of $(git rev-parse --short HEAD)"
git -C "$out" push -q -f "https://github.com/djosh34/$REPO.git" main
rm -rf "$out"
echo "https://djosh34.github.io/$REPO/"
