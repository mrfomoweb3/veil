# VEIL threat model

Assumptions: Intel TDX holds; OutLayer runs only the published build named by its sha256; OutLayer may stall but not cheat.

| Threat | Mitigation | Where |
|---|---|---|
| A player reads others' orders on chain | Orders are sealed to the per-match game key, which exists only inside the enclave until The Reveal. | `web/src/game/actions.ts`, `engine/src/lib.rs` |
| The developer reads state or orders | Game key derived in the TEE per match, never stored. State key bound to the calling contract and to the exact engine build; the contract pins the build per match. | `engine/outlayer/build.rs`, `contracts/veil` (`engine_version`) |
| Someone calls the engine directly with crafted input | Manifest `callers` admits only the game contract; storage cell and keys are predecessor-bound, so a different caller finds no match (`no such match`, tested). | `engine/outlayer/build.rs`, `crates/veil-verify/tests/end_to_end.rs` |
| The developer publishes a malicious engine version | Each match runs the exact version (sha256) pinned when it was created. Keys are project-bound (OutLayer gives storage only to project runs, and refuses `wasm` keys there), so every version this contract runs derives the same keys; `set_engine` is therefore refused while any match holds hidden state (starting, running, resolving, finished or revealing). A new version only ever sees state that is already public or not yet made. New matches show the new hash, which anyone can rebuild and compare. | `contracts/veil/src/lib.rs` (`set_engine`), `scripts/build-engine.sh` |
| The contract owner upgrades the contract code | Not prevented: the owner holds the account's full-access key, so new code could pin any engine. For a production deploy, remove the full-access keys (or put upgrades behind a DAO/timelock) after deploying. | — |
| Replaying last turn's orders, swapping seats | AAD = match ‖ turn ‖ seat. | `crates/veil-crypto` |
| Double resolution | Contract status lock + compare-and-swap on the sealed state (second run refused, tested). | `engine/src/lib.rs` |
| Re-rolling dice | One VRF value per turn; the contract checks the signature, the output and that the alpha names the turn. Retried runs do get a new value (alpha contains the request id); nobody sees a result before it lands. | `contracts/veil/src/lib.rs` |
| Info leak through errors | Bad orders are clamped silently; reasons go only into that player's sealed view. | `crates/veil-rules/src/orders.rs` |
| Info leak through sizes | Orders and views are padded to 1024 B (property-tested). | `crates/veil-rules/tests/properties.rs` |
| Info leak through views | Fog-leak property test: scrambling every hidden tile leaves each view byte-identical. | `crates/veil-rules/tests/properties.rs` |
| Info leak through public facts | Only battle coordinates, eliminations, tile counts. Intentional. | `crates/veil-rules/src/public.rs` |
| AI cheating | AI orders are computed inside the enclave from that seat's own view only; the LLM receives exactly that view. | `engine/src/ai.rs` |
| Engine bug changes the rules | Shared rules crate + The Reveal + `veil-verify`. | `crates/` |
| Relayer abuse | Relays only zero-deposit calls to the contract on an allowlist, one action, gas cap, per-account rate limit. | `relayer/policy.mjs` |
| Funds stuck | Pull payments (`claim`) re-credit on failed transfers; `leave_lobby` and `cancel_stale` refund; exact buy-in, excess refunded. | `contracts/veil/src/lib.rs` |
| Lost view key | `rotate_view_pk`; the client offers “Re-key”. | `web/src/ui/MatchScreen.tsx` |
| OutLayer stalls | Turn reopens after a failed run; `cancel_stale` refunds after 5 failures. | `contracts/veil/src/lib.rs` |
