#!/usr/bin/env bash
# Encrypts and archives Playwright browser profiles for prod and staging.
# Keeps the last KEEP_DAYS backups and deletes older ones.
#
# Required env var:
#   BACKUP_PASSPHRASE  — encryption passphrase (store in /etc/burgundy-bid.env)
#
# Optional env vars (override defaults):
#   PROD_DIR      — default: /srv/burgundy-bid/.ws_browser_profiles
#   STAGING_DIR   — default: /srv/burgundy-bid-staging/.ws_browser_profiles
#   BACKUP_DIR    — default: $HOME/backups/ws-profiles
#   KEEP_DAYS     — default: 7

set -euo pipefail

PROD_DIR="${PROD_DIR:-/srv/burgundy-bid/.ws_browser_profiles}"
STAGING_DIR="${STAGING_DIR:-/srv/burgundy-bid-staging/.ws_browser_profiles}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/ws-profiles}"
KEEP_DAYS="${KEEP_DAYS:-7}"
PASSPHRASE="${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE before running this script}"

DATE=$(date +%Y%m%d)
mkdir -p "$BACKUP_DIR"

backup() {
  local label="$1"
  local source="$2"
  local dest="$BACKUP_DIR/${label}_${DATE}.tar.gz.enc"

  if [[ ! -d "$source" ]]; then
    echo "[backup] $label: $source not found — skipping"
    return
  fi

  echo "[backup] $label: archiving + encrypting → $dest"
  tar czf - -C "$(dirname "$source")" "$(basename "$source")" \
    | openssl enc -aes-256-cbc -pbkdf2 -pass pass:"$PASSPHRASE" -out "$dest"
  echo "[backup] $label: done ($(du -sh "$dest" | cut -f1))"
}

rotate() {
  local count
  count=$(find "$BACKUP_DIR" -name "*.tar.gz.enc" -mtime +"$KEEP_DAYS" | wc -l)
  if [[ "$count" -gt 0 ]]; then
    echo "[backup] rotating $count backup(s) older than ${KEEP_DAYS} days"
    find "$BACKUP_DIR" -name "*.tar.gz.enc" -mtime +"$KEEP_DAYS" -delete
  fi
}

backup "prod"    "$PROD_DIR"
backup "staging" "$STAGING_DIR"
rotate

echo "[backup] complete — backups in $BACKUP_DIR"
