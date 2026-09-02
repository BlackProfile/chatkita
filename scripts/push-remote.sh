#!/usr/bin/env bash
# push-remote.sh — dorong seluruh repo ke remote offsite (GitHub).
# Setup SEKALI (butuh repo private + Personal Access Token dari user):
#   git remote add origin https://<TOKEN>@github.com/<user>/chatkita.git
# Lalu tiap kali ingin aman ke luar sandbox:
#   bash scripts/push-remote.sh
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "[push-remote] remote 'origin' belum diset."
  echo "Contoh: git remote add origin https://<TOKEN>@github.com/<user>/chatkita.git"
  exit 1
fi

git push -u origin HEAD --tags
bash "$(dirname "$0")/make-backup.sh"

REMOTE="$(git remote get-url origin | sed -E 's#https://[^@]+@#https://***@#')"
echo "[push-remote] OK → $REMOTE"
