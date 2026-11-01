#!/usr/bin/env bash
# Publish the engine to OutLayer and give it its NEAR AI key.
# Needs the OutLayer CLI (`cargo install --git https://github.com/out-layer/outlayer-cli`)
# and `outlayer login testnet` (or mainnet) done by you first.
#
#   VEIL_CONTRACT=veil.testnet PROJECT=veil-engine NEARAI_API_KEY=… scripts/upload-engine.sh
set -euo pipefail
: "${VEIL_CONTRACT:?set VEIL_CONTRACT (the only contract allowed to run this engine)}"
: "${PROJECT:=veil-engine}"
cd "$(dirname "$0")/.."
VEIL_CONTRACT="$VEIL_CONTRACT" scripts/build-engine.sh
WASM=engine/outlayer/target/wasm32-wasip2/release/veil-engine.wasm
HASH=$(shasum -a 256 "$WASM" | cut -d' ' -f1)
echo "Uploading $WASM ($HASH) to FastFS…"
outlayer upload "$WASM" | tee /tmp/veil-upload.txt
URL=$(grep -o 'https://[^ ]*\.wasm' /tmp/veil-upload.txt | tail -1)
[[ -n "$URL" ]] || { echo "could not read the FastFS URL" >&2; exit 1; }
echo "Waiting 2 minutes for FastFS indexing…"; sleep 120
outlayer deploy "$PROJECT" "$URL"
if [[ -n "${NEARAI_API_KEY:-}" ]]; then
  # Author secret, profile `prod`, readable only by runs the contract makes.
  outlayer secrets set "{\"NEARAI_API_KEY\":\"$NEARAI_API_KEY\",\"NEARAI_MODEL\":\"${NEARAI_MODEL:-zai-org/GLM-5.1-FP8}\"}" \
    --project "$(outlayer whoami | awk '/account/{print $NF; exit}')/$PROJECT" --profile prod --access "whitelist:$VEIL_CONTRACT"
else
  echo "NEARAI_API_KEY not set: AI warlords will use the heuristic bot."
fi
echo
echo "Engine version (pin this in the contract): $HASH"
echo "  near contract call-function as-transaction $VEIL_CONTRACT set_engine json-args '{\"project\":\"<owner>/$PROJECT\",\"version\":\"$HASH\"}' …"
