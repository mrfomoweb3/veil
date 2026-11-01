#!/usr/bin/env bash
# Everything for local Practice play: build the engine + verifier, start the devnet and the web app.
set -euo pipefail
cd "$(dirname "$0")/.."
cargo build --release -p veil-engine --bin veil-engine-local -p veil-verify
scripts/build-web-wasm.sh
(cd web && [[ -d node_modules ]] || npm install)
node devnet/server.mjs &
DEVNET=$!
trap 'kill $DEVNET' EXIT
cd web && npx vite
