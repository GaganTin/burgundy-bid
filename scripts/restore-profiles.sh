#!/usr/bin/env bash
# Restores a Playwright browser profile from an encrypted backup.
#
# Usage:
#   BACKUP_PASSPHRASE=<pass> bash scripts/restore-profiles.sh <backup-file> <dest-dir>
#
# Example (restore prod profiles on a fresh server):
#   BACKUP_PASSPHRASE=secret bash scripts/restore-profiles.sh \
#     ~/backups/ws-profiles/prod_20260510.tar.gz.enc \
#     /srv/burgundy-bid
#
# The .ws_browser_profiles/ folder will be extracted into <dest-dir>.

set -euo pipefail

BACKUP_FILE="${1:?Usage: $0 <backup-file> <dest-dir>}"
DEST_DIR="${2:?Usage: $0 <backup-file> <dest-dir>}"
PASSPHRASE="${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE before running this script}"

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Error: backup file not found: $BACKUP_FILE"
  exit 1
fi

echo "[restore] decrypting $BACKUP_FILE → $DEST_DIR"
mkdir -p "$DEST_DIR"
openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:"$PASSPHRASE" -in "$BACKUP_FILE" \
  | tar xzf - -C "$DEST_DIR"
echo "[restore] done — profiles restored to $DEST_DIR/.ws_browser_profiles"
