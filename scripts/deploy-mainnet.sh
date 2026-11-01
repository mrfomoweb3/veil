#!/usr/bin/env bash
# MAINNET. Real money. Do not run without an explicit go-ahead from the project owner.
set -euo pipefail
echo "This deploys veil.near to MAINNET. Type the contract account id to continue:"
read -r CONFIRM
: "${CONTRACT:?}" "${OWNER:?}" "${ENGINE_PROJECT:?}" "${ENGINE_VERSION:?}" "${USDC:?}"
[[ "$CONFIRM" == "$CONTRACT" ]] || { echo "aborted"; exit 1; }
cd "$(dirname "$0")/.."
scripts/build-contract.sh
VRF_PUBKEY=$(curl -fsS https://api.outlayer.ai/vrf/pubkey | python3 -c 'import json,sys;print(json.load(sys.stdin)["vrf_public_key_hex"])')
NEAR="${NEAR_CLI:-npx --yes near-cli-rs}"
$NEAR contract deploy "$CONTRACT" use-file contracts/veil/target/near/veil_contract.wasm \
  with-init-call new json-args "{\"owner\":\"$OWNER\",\"outlayer\":\"outlayer.near\",\"engine_project\":\"$ENGINE_PROJECT\",\"engine_version\":\"$ENGINE_VERSION\",\"vrf_pubkey_hex\":\"$VRF_PUBKEY\",\"usdc\":\"$USDC\"}" \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config mainnet sign-with-keychain send
