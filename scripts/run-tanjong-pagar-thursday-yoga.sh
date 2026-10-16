#!/bin/zsh
set -euo pipefail

ROOT="/Users/elsssiee/SideProject/af-class-schedule"
PYTHON="/Library/Frameworks/Python.framework/Versions/3.9/bin/python3"
SCRIPT="$ROOT/scripts/book-tanjong-pagar-thursday-yoga.py"
ENV_FILE="$HOME/.config/af-class-booking/env"
LOG="$HOME/Library/Logs/af-book-tp-thursday-yoga.log"

mkdir -p "$(dirname "$LOG")" "$HOME/.config/af-class-booking"
{
  echo "===== $(date '+%Y-%m-%d %H:%M:%S %Z') ====="
} >> "$LOG"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >> "$LOG"
  echo "Create it with AF_BOOKING_EMAIL and AF_BOOKING_WHATSAPP." >> "$LOG"
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

if [[ -z "${AF_BOOKING_EMAIL:-}" || -z "${AF_BOOKING_WHATSAPP:-}" ]]; then
  echo "AF_BOOKING_EMAIL / AF_BOOKING_WHATSAPP are empty in $ENV_FILE" >> "$LOG"
  exit 1
fi

exec "$PYTHON" "$SCRIPT" >> "$LOG" 2>&1
