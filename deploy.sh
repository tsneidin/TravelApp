#!/bin/sh
# Update TravelApp on Unraid: pull latest code, rebuild images, restart stack.
# Usage:  sh deploy.sh   (run from the repo root, e.g. /mnt/user/appdata/travelapp/repo)
set -e

echo "== git pull =="
git pull

echo "== docker compose up -d --build =="
docker compose up -d --build

echo "== done. Check the version in the bottom of the left sidebar. =="