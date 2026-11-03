# VEIL hidden-state protocol

## Keys

| Key | Where | Purpose |
|---|---|---|
| `GAME_SK(match)` | Never stored. Derived in the enclave: `sha256("veil-game-sk-v1" ‖ mac("orders", "game-sk:v1:{match}"))`, where `mac` is OutLayer's HMAC under the encryption key `orders` (`caller: predecessor`, `bind: project`). | Players seal orders to `GAME_PK`. Published at The Reveal so anyone can open the on-chain order ciphertexts. |
| `GAME_PK(match)` | Returned by `init`, stored in `Match.game_pk`. | Public. |
| State key | OutLayer encryption key `state` (`caller: predecessor`, `bind: project`) + `storage_account: predecessor`. | Seals match state. Only runs made by `veil.near` through the engine project reach the cell and the key; each match runs the version pinned at its creation, and the engine can't be changed while any match holds hidden state. (OutLayer gives storage only to project runs, and `wasm`-bound keys only to direct runs, so the key must be project-bound.) |
| View key | X25519, generated in the browser (`web/src/session.ts`), public half registered at join (`view_pk`). | The enclave seals each view to it. |
| VRF key | OutLayer's (`GET /vrf/pubkey`), stored in the contract. | Verifies each turn's randomness. |

Three independent locks keep anyone but the game contract out of match state: the manifest's `callers` block (OutLayer refuses the run before anything is decrypted), the predecessor-bound storage cell, and the predecessor- and build-bound encryption keys. The engine version is pinned into each match at `create_match`, so an upgraded (or malicious) build cannot open a running match.

## Sealing (orders and views)

```
shared  = X25519(eph_sk, recipient_pk)
key     = HKDF-SHA256(ikm = shared, salt = eph_pk ‖ recipient_pk, info)
payload = 0x01 ‖ eph_pk (32) ‖ nonce (24) ‖ XChaCha20-Poly1305(key, nonce, plaintext, aad)
```

| | info | aad | plaintext |
|---|---|---|---|
| Orders | `veil-orders-v1` | `veil|{match}|{turn}|{account}` | u16 length ‖ JSON ‖ zeros → 1024 B |
| Views | `veil-view-v1` | `veil-view|{match}|{turn}|{account}` | u16 length ‖ binary view ‖ zeros → 1024 B |

Fixed sizes mean ciphertext length reveals nothing. The binary view format is defined in `crates/veil-rules/src/view.rs` and decoded in `web/src/protocol/view.ts`; `crates/veil-crypto/vector.hex` pins the scheme across Rust and TypeScript.

## Turn

1. Players call `submit_orders(match, turn, ct)` (relayed, gasless). Latest ciphertext wins until the deadline; each submission is also logged as `veil_orders_submitted` with the ciphertext.
2. Anyone calls `resolve_turn` once the deadline passed or every human sealed (the relayer cranks it). The contract locks the match (`Resolving`) and calls `outlayer.request_execution` with the engine pinned for this match.
3. The engine: loads the sealed state (fails closed if it can't), checks the turn number and the seat list, opens each order ciphertext (failures become empty orders, reported only in that player's view), computes AI orders from each AI seat's own view, takes **one** VRF value (`turn-{n}`), resolves with `veil-rules`, compare-and-swaps the sealed state (a concurrent resolution fails), stores a sealed turn record for The Reveal, and seals every view.
4. Callback: the contract accepts the turn only if `ed25519_verify(signature, alpha, vrf_pubkey)`, `sha256(signature) == output` and `alpha` ends with `:turn-{n}`. Otherwise the turn reopens for 30 s and the failure counter rises.

## The Reveal

`reveal(match)` (after the end) makes the engine publish `RevealDoc` — accounts, `GAME_SK`, the commitment salt, the opening state and VRF, every turn's orders and VRF, the final state — to OutLayer public storage under `reveal:{match}:{k}` chunks, with an index at `reveal:{match}`. The contract stores its sha256.

Checking it (`crates/veil-verify`, also in the browser via `crates/veil-wasm`):

1. Map = `generate(match, seats, config, init VRF output)`.
2. Each turn: VRF proof verifies; `resolve(state, revealed orders, seed)` reproduces the public facts and `state_commit = sha256(salt ‖ canonical state)` posted on chain at the time.
3. Every on-chain order ciphertext opens under `GAME_SK` to exactly the revealed orders.

The salt keeps the commitments from being brute-forced while the match is hidden.
