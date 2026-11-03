#!/usr/bin/env bash
# Deploy veil.near to TESTNET. Uses near-cli-rs (`npx near-cli-rs` works) with keys in
# ~/.near-credentials (set NEAR_SIGN=sign-with-keychain for the OS keychain). You create and
# fund the accounts; this script never creates accounts or spends
# beyond the deploy itself.
#
#   CONTRACT=veil-dev.testnet OWNER=you.testnet ENGINE_PROJECT=you.testnet/veil-engine \
#   ENGINE_VERSION=<sha256 from upload-engine.sh> USDC=<usdc contract on testnet> scripts/deploy-testnet.sh
set -euo pipefail
: "${CONTRACT:?}" "${OWNER:?}" "${ENGINE_PROJECT:?}" "${ENGINE_VERSION:?}" "${USDC:?}"
cd "$(dirname "$0")/.."
scripts/build-contract.sh
VRF_PUBKEY=$(curl -fsS https://testnet-api.outlayer.ai/vrf/pubkey | python3 -c 'import json,sys;print(json.load(sys.stdin)["vrf_public_key_hex"])')
echo "OutLayer testnet VRF key: $VRF_PUBKEY"
NEAR="${NEAR_CLI:-npx --yes near-cli-rs}"
$NEAR contract deploy "$CONTRACT" use-file contracts/veil/target/near/veil_contract.wasm \
  with-init-call new json-args "{\"owner\":\"$OWNER\",\"outlayer\":\"outlayer.testnet\",\"engine_project\":\"$ENGINE_PROJECT\",\"engine_version\":\"$ENGINE_VERSION\",\"vrf_pubkey_hex\":\"$VRF_PUBKEY\",\"usdc\":\"$USDC\"}" \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config testnet "${NEAR_SIGN:-sign-with-legacy-keychain}" send
echo "Deployed. Point the web app at it: VITE_NETWORK=testnet VITE_VEIL_CONTRACT=$CONTRACT"
