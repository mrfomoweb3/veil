#!/usr/bin/env bash
# Build veil.near with cargo-near (handles the wasm features nearcore accepts).
set -euo pipefail
cd "$(dirname "$0")/../contracts/veil"
cargo near build non-reproducible-wasm
ls -la target/near/veil_contract.wasm
