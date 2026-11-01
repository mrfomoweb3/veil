#!/usr/bin/env bash
# Compile the verifier for the browser (The Reveal) and copy it into the web app.
set -euo pipefail
cd "$(dirname "$0")/.."
cargo build --release -p veil-wasm --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/veil_wasm.wasm web/public/veil.wasm
ls -la web/public/veil.wasm
