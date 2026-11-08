# Deploying the testnet preview

Two pieces: the **web app** on Vercel (static) and the **relayer** on Fly.io (one always-on Node
process). The contract and the engine are already on NEAR testnet / OutLayer.

```
browser (Vercel) ──▶ relayer (Fly.io) ──▶ veil-clouds.testnet ──▶ OutLayer enclave
        └────────────── reads ──────────▶ NEAR RPC
```

## 1. Relayer on Fly.io

```bash
brew install flyctl          # once
fly auth login               # once, in your browser
cd relayer
fly apps create veil-relayer # once; pick another name if taken, and change `app` in fly.toml
# The relayer's key, read straight from near-cli's credentials file (never printed, never committed):
fly secrets set RELAYER_PRIVATE_KEY="$(jq -r .private_key ~/.near-credentials/testnet/veil-clouds-relay.testnet.json)"
fly deploy
curl https://veil-relayer.fly.dev/health   # {"ok":true,"network":"testnet",...}
```

**Then stop the local relayer** (`kill $(lsof -ti tcp:8790)`). Two relayers with the same key race
each other's nonces and both crank turns.

Run exactly one machine (`fly scale count 1`): nonces, crank de-duplication and rate limits live
in memory.

### A keyed RPC (strongly recommended before inviting people)

Free testnet RPCs rate-limit per IP; the relayer rotates between them on 429, which softens it,
but a public preview needs a keyed endpoint. Put it first in the list, as a secret:

```bash
fly secrets set NEAR_RPC="https://<keyed-endpoint>,https://near-testnet.drpc.org,https://rpc.testnet.near.org"
```

## 2. Web app on Vercel

```bash
cd web
vercel link                  # create or pick the project; root is this folder
for kv in \
  VITE_NETWORK=testnet \
  VITE_VEIL_CONTRACT=veil-clouds.testnet \
  VITE_RELAYER_URL=https://veil-relayer.fly.dev \
  VITE_OUTLAYER_API=https://testnet-api.outlayer.ai \
  VITE_GLOAM_ENV=testnet \
  VITE_GLOAM_RELAY_URL=https://veil-relayer.fly.dev/gloam-relay ; do
  printf '%s' "${kv#*=}" | vercel env add "${kv%%=*}" production
done
vercel deploy --prod
```

Every `VITE_*` value is compiled into the public JavaScript. Never put a secret there: no relayer
key, and no RPC key unless the provider lets you restrict it to your domain. Without
`VITE_NEAR_RPC` the browser uses free endpoints and rotates on 429; each player has their own
per-IP allowance, so that is fine.

## 3. Connect the two

The relayer only answers the origins it is told about. Set the Vercel URL it printed:

```bash
cd relayer
fly secrets set ALLOWED_ORIGINS="https://<your-project>.vercel.app"
```

## 4. Check

1. Open the Vercel URL: the title screen shows "You fight as …" (the relayer created your account).
2. Lobbies → Open a lobby → copy the invite link → open it in a private window → Join. The match
   starts by itself when the lobby is full.
3. `fly logs` shows `/onboard`, `/relay`, `cranked start`, `cranked resolve_turn`.
4. Private vault → Unlock: a Base Sepolia address appears (Chain Signatures through the relayer).

## Costs to watch

- The relayer account pays gas and 0.01 NEAR per new player (testnet NEAR from the faucet). Check
  its balance before sharing the link widely; refill from the faucet.
- Each enclave run is paid by the relayer's 0.05 NEAR deposit (unused part refunded).
