# VEIL

A fog-of-war strategy game where **even the developer cannot see the map**. Hidden game state lives inside an Intel TDX enclave (OutLayer), every turn's dice come with a verifiable random proof that the NEAR contract checks, and when a match ends the whole hidden history is published so anyone can re-run it with the same Rust code.

Tracks: **games** (primary), **privacy**, **open**. Built at NEAR HACKATHON.

**Live on NEAR testnet:** contract [`veil-clouds.testnet`](https://testnet.nearblocks.io/address/veil-clouds.testnet), engine on OutLayer as project `veil-clouds.testnet/veil-engine`. Full matches have been played through the real enclave there and verified in the browser by The Reveal.

## Try it in 60 seconds (local Practice)

Prerequisites: Rust (with targets `wasm32-unknown-unknown`, `wasm32-wasip2`), Node 20+.

```bash
make dev        # builds the engine + verifier, starts the devnet on :8787 and the web app on :5173
```

1. Open http://localhost:5173 → **PLAY** → a 2-minute playable tutorial (march, recruit, seal real ciphertext, verify a real signature, lift the veil) → **Play vs 3 warlords**. Or “Skip the tutorial — quick match”.
2. Click your capital, then a neighbouring island → an arc appears. Drag **Recruit** → **Seal & send orders**.
3. The turn resolves (the devnet resolves as soon as every human has sealed) → clouds burn off where your troops can now see; battles you fought show in the feed.
4. Click a **⛨** shield in the top right → the sheet re-checks that turn's VRF signature, `output = sha256(signature)` and that the proof names this exact turn, in your browser.
5. Play to the end → **Open The Reveal** → the fog is gone; scrub through every turn and every order. The panel says *✔ Verified: all N turns re-run*: your browser ran the Rust verifier (compiled to wasm) over the published history.
6. `make simulate` → a scripted player plays a full match headlessly, then `veil-verify` re-runs it natively and checks every on-chain order ciphertext.

`make test` runs every test: rules (incl. 1000 bot matches and the fog-leak property suite), crypto, engine end-to-end, verifier, contract, client and relayer.

## What is hidden, from whom

| Party | Sees |
|---|---|
| Other players | Public facts (battle coordinates, eliminations, tile counts) + their own view |
| Chain observers | Order and view ciphertexts, public facts, VRF proofs |
| The developer | Same as a chain observer. No game key (derived in the TEE per match), no state key (bound to the contract as caller and to the exact engine build), no re-rolls (VRF) |
| OutLayer operator | Cannot read TDX memory. Can refuse to run (liveness, see `cancel_stale`) |
| Everyone, after the match | Everything (The Reveal) |

## How it works

```
browser ──seal(orders, GAME_PK)──▶ veil.near ──request_execution──▶ OutLayer TEE (veil-engine)
   ▲                                  │  ◀── views (each sealed to its player), public facts, VRF proof
   └──── open(my view, my key) ◀──────┘       contract verifies the VRF before accepting a turn
```

- **Orders**: JSON, padded to 1024 B, sealed in the browser with X25519 + HKDF-SHA256 + XChaCha20-Poly1305 to the match's game key, bound to `match | turn | seat`.
- **Engine** (`engine/`): decrypts orders, runs AI seats, takes one VRF value per turn, resolves the turn with `veil-rules`, compare-and-swaps the sealed state, seals each player's 1024-byte view to their key.
- **Contract** (`contracts/veil`): seats, buy-ins, turn clock, ciphertexts until the turn resolves (and in event logs forever), verifies `ed25519(signature, alpha, OutLayer VRF key)`, `sha256(signature) = output` and that `alpha` names this turn, stores views and public facts, pays out.
- **The Reveal**: the engine publishes the full plaintext history (all orders, VRF proofs, the per-match game key, the commitment salt) to OutLayer public storage; the contract records its hash. `veil-verify` or the browser re-runs every turn and checks it against what was posted on chain while the match was hidden.

Details: [docs/protocol.md](docs/protocol.md) · [docs/threat-model.md](docs/threat-model.md)

## Why NEAR (and where it is in the code)

| Feature | NEAR / partner tool | Code |
|---|---|---|
| Hidden state, sealed storage, compare-and-swap | OutLayer TEE, `encryption_keys` (predecessor-bound, build-bound), `storage_account: predecessor` | `engine/outlayer/build.rs` (manifest), `engine/outlayer/src/main.rs`, `engine/src/lib.rs` |
| Only the game contract can drive the engine | OutLayer manifest `callers: {contract: {only: [veil]}}` | `engine/outlayer/build.rs` |
| Verifiable dice | OutLayer VRF, verified on chain with `env::ed25519_verify` | `engine/src/lib.rs`, `contracts/veil/src/lib.rs` (`verify_vrf`) |
| AI warlords that see only their own fog | NEAR AI Cloud (Confidential-TEE models), called from inside the enclave | `engine/src/ai.rs` |
| No gas, no popups | NEP-366 meta-transactions, implicit accounts | `relayer/`, `web/src/chain/near.ts` |
| Buy-ins / payouts | USDC on NEAR via `ft_transfer_call`, pull-based `claim` | `contracts/veil/src/lib.rs` (`ft_on_transfer`, `claim`) |
| Warlords with their own wallets | Per-warlord USDC treasuries in the contract; intel and truces sold in-game, priced by each warlord's AI | `contracts/veil/src/lib.rs`, `crates/veil-rules` (market) |
| Your NEAR account controls a Base address | **Chain Signatures** (`v1.signer-prod.testnet`, path `veil-base-1`); the relayer pays for `sign`, so no second wallet and no gas | `web/src/privacy/chainSig.ts`, `chainSigSigner.ts`, `relayer/policy.mjs` |
| Winnings NEAR → Base | **NEAR Intents** (1Click): NEAR USDC → Base USDC, plus a $0.30 leg → Base ETH for gas when needed | `web/src/privacy/bridge.ts` |
| Private cash-out | **Gloam** (`@gloamtrade/sdk`, an existing library): shield into the pool, unshield through Gloam's relay | `web/src/privacy/` |

## Cash out privately

Winnings are paid in USDC on NEAR. From the end screen, **Cash out privately** takes them into a private balance on Base and out to any address, without a second wallet:

```
claim (NEAR) ──1Click──▶ your Base address ──shield──▶ Gloam pool ──unshield via Gloam's relay──▶ any address
                         (derived from your NEAR       (deposit is      (zero-knowledge proof; the relay
                          account, Chain Signatures)    public)          submits it, the proof fixes the recipient)
```

What is private, stated plainly (the same text is in the app under *What stays private?*):

- **Public:** the NEAR → Base transfer; the Base address (anyone can derive it from your NEAR account); that it deposited into Gloam, and how much.
- **Private after the deposit:** which deposit a cash-out came from, and where the money went. Gloam's relay sends the cash-out, so your address is not on it.
- **Your part:** cash out to a fresh address and wait a while; an identical amount moments later is easy to match.

Safety rails: each note is saved (AES-GCM, key derived from a NEP-413 signature by your NEAR account) **before** its deposit is broadcast; the first deposit forces a backup download; every Chain Signatures answer is recovered and must match your derived address before anything is broadcast; the vault's live per-deposit limits split large amounts.

On testnet, 1Click does not exist, so the Base Sepolia address is funded from faucets (the app says so and shows a live mainnet quote instead).

**Run on Base Sepolia (2026-11-06), in the app, signed by a NEAR testnet account through Chain Signatures:**

| Step | Sent by | Tx |
|---|---|---|
| Approve USDC | the player's derived Base address `0x0488…D140` | [`0x4b8649b0…b6de`](https://sepolia.basescan.org/tx/0x4b8649b047b35df3c130a9a6de38149c9fec42c1b4497950cc88c84ec729b6de) |
| Shield 2 USDC into Gloam | the same address | [`0xf37c14a4…4482`](https://sepolia.basescan.org/tx/0xf37c14a4e8487e7763f1e4bbbfec3a865e18bbed478c87e0aa750114d10f4482) |
| Cash out to a fresh address (1.995 USDC arrived) | **Gloam's relay** `0xb1e9…512e`, not the player | [`0xad620269…835f`](https://sepolia.basescan.org/tx/0xad6202695ccbe00e47695feaa362a6351ecc38529038a4c6d81eb037abe3835f) |
| A second cash-out, same path | Gloam's relay | [`0xe5eee301…21c3`](https://sepolia.basescan.org/tx/0xe5eee3012a8501b9f3cf0e57d2c82d4922fb075b17b194d4900778825eac21c3) |

## Controls

Mouse, touch, keyboard, or a gamepad (DualSense, DualShock 4, Xbox) for the whole game, menus and vault included. One radial order menu for every input: right-click, long-press, or Square/X on the cursor tile. Glyphs follow the pad you hold; `?lite` turns on performance mode.

## Repository

```
crates/veil-rules    pure deterministic game rules (map gen, resolution, vision, views, bot)
crates/veil-crypto   ECIES shared by engine and verifier (the browser has the same in TS)
crates/veil-verify   re-run a revealed match, check VRF + commitments + on-chain ciphertexts
crates/veil-wasm     the verifier for the browser (plain C ABI)
engine/              the engine; engine/outlayer = the wasm32-wasip2 OutLayer project
contracts/veil       veil.near (near-sdk 5)
devnet/              local stand-in for veil.near + OutLayer, drives the real engine
relayer/             meta-tx relayer + turn cranker
web/                 Vite + React + react-three-fiber client
scripts/             build / upload / deploy / simulate
```

## Deploying to testnet

1. `VEIL_CONTRACT=<your-contract>.testnet PROJECT=veil-engine NEARAI_API_KEY=… scripts/upload-engine.sh` (needs `outlayer login testnet`). Prints the engine version hash.
2. `CONTRACT=… OWNER=… ENGINE_PROJECT=<you>.testnet/veil-engine ENGINE_VERSION=<hash> USDC=… scripts/deploy-testnet.sh`
3. Relayer: copy `relayer/.env.example` → `.env`, fill it, `npm start`.
4. Web: `VITE_NETWORK=testnet VITE_VEIL_CONTRACT=… VITE_RELAYER_URL=… npm run dev`.

## Trust model (stated plainly)

1. Intel TDX is not broken (the same assumption as OutLayer and NEAR AI Cloud).
2. OutLayer runs only the published build named by its sha256 (checkable against the 5-measurement worker registration).
3. OutLayer can stall (liveness) but not cheat (safety); `cancel_stale` refunds after 5 failed runs.
4. Capital positions are public by rule (evenly spaced on the outer ring); the fog hides armies, forts, economy and terrain.

## Limitations and next steps

- 1Click buy-in from other chains is not built; Stakes takes USDC on NEAR directly. The cash-out leg (NEAR → Base) is built; it runs on mainnet only, and has been checked with live dry quotes, not with real money.
- The OutLayer secrets row holds only the model name, so warlords play with the heuristic bot until a NEAR AI key is added.
- Social login (Privy) is not built; players get a browser-held implicit account created by the relayer.
- A retried resolve gets a new VRF value (its alpha contains the request id). We never see a result before it lands, so this is not exploitable by us, but it is a property, not a guarantee.
- Bot balance: the heuristic warlords fight a lot but rarely take capitals; the aether economy needs tuning with real players.
