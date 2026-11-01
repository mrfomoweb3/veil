#!/usr/bin/env bash
# Build the OutLayer engine (wasm32-wasip2) and print its sha256 — the version key the
# contract pins per match.
#
#   VEIL_CONTRACT=veil.testnet scripts/build-engine.sh     # production: only that contract may run it
#   scripts/build-engine.sh                                # development: open doors
set -euo pipefail
cd "$(dirname "$0")/../engine/outlayer"
cargo build --release --target wasm32-wasip2
WASM=target/wasm32-wasip2/release/veil-engine.wasm
if ! grep -aq '"storage_account": "predecessor"' "$WASM"; then
  echo "manifest missing from $WASM" >&2; exit 1
fi
if [[ -n "${VEIL_CONTRACT:-}" ]] && ! grep -aq "\"only\": \[\"$VEIL_CONTRACT\"\]" "$WASM"; then
  echo "callers gate for $VEIL_CONTRACT missing" >&2; exit 1
fi
echo "engine: $PWD/$WASM"
echo "sha256: $(shasum -a 256 "$WASM" | cut -d' ' -f1)"
echo "callers: ${VEIL_CONTRACT:-<open: development build>}"
