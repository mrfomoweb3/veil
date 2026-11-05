# VEIL — plan, research notes and status

## Status (2026-10-24)

Built and tested locally (the spec's days 1–7 and 12, plus most of 9):

- `veil-rules`: map gen, resolution, combat, vision, fixed-size views, heuristic bot. Property tests: determinism, invariants, fog-leak, 1000 bot matches.
- `veil-crypto` + TS twin, pinned by a shared vector. `engine` (init / resolve / reveal) with a local OutLayer emulator and the real `wasm32-wasip2` OutLayer build (manifest embedded, `callers` gate). End-to-end test: match → reveal → `veil-verify`, including tamper cases.
- `contracts/veil`: full lifecycle, VRF verification, stakes, payouts, autopilot, refunds; 6 unit tests; cargo-near build OK.
- `devnet` + `scripts/simulate.mjs`: full matches against the real engine, verified by `veil-verify`.
- `web`: 3D client (islands, cloud fog, drafting, sealing, attestation sheet, The Reveal with in-browser wasm verification). A full 15-turn match was played by clicking in headless Chrome and verified.
- `relayer`: meta-tx relay + onboarding + cranker; policy and delegate round-trip tests.

Since then: the diorama visual pass, the title screen, and the playable 11-step tutorial.

---

# Roadmap v2 (2026-11-01 → 2026-11-14 23:59 UTC)

Scope = the core already built + four additions:

| # | Addition | Spec | Tracks it serves |
|---|---|---|---|
| A | Testnet deploy, real OutLayer enclave | `VEIL-BUILD.md` | all (judges need a live link) |
| B | AI warlords on NEAR AI Cloud, **with their own wallets**, selling intel and truces to players | this file (proposal) | games (NPCs with wallets that trade), privacy |
| C | **Gloam private cash-out**: winnings NEAR → Base (1Click) → Gloam private balance, via Chain Signatures | `docs/ADDON-gloam-gamepad.md` Part 1 | privacy, games |
| D | **Gamepad support** (PS4/PS5/Xbox), whole game incl. menus and cash-out | `docs/ADDON-gloam-gamepad.md` Part 2 | games |
| E | 1Click buy-in from any chain (Stakes) | `VEIL-BUILD.md` §9 | games (NEAR Intents tag) |

## How the add-on maps onto this repo

- `apps/client/...` in the add-on = `web/src/...` here: `web/src/privacy/`, `web/src/ui/vault/`, `web/src/input/`.
- Payouts are pull-based (`claim`): winnings land as USDC on the player's NEAR account, then `bridge.ts` takes it from there. No contract change needed for cash-out.
- Players' NEAR accounts are browser-held implicit accounts (`web/src/chain/near.ts`). Chain Signatures can sign with that key, so cash-out needs **no wallet popups at all**. Two consequences:
  1. The MPC `sign` call carries a deposit, which the relayer's policy refuses (zero-deposit only). The player's account pays it from its own NEAR (onboarding gives 0.01 NEAR; may need more — measure on testnet).
  2. **Real money behind a localStorage key is fragile.** The vault backup is encrypted with a key derived from that same NEAR key, so losing the browser key loses the backup too. Fix before mainnet: for Stakes/cash-out, connect a real NEAR wallet (NEAR Connect), or export the NEAR key inside the backup behind a passphrase. **Decision needed from you.**
- "Selected unit" in the gamepad spec = selected tile here. Triangle's "threat view" overlay does not exist yet: build a simple one (visible enemy strength per tile) or map Triangle to the fog-memory toggle.

## Progress

- **Days 1–2 done (gamepad groundwork, ahead of plan):** input action layer (`web/src/input/`), gamepad polling with radial deadzone / repeat / edge detection / hold-to-seal / hot-plug, keyboard controls, spatial focus manager for every menu, camera-relative tile cursor, pad camera, threat view, PS/Xbox glyphs, rumble, pause menu, performance mode (`?lite`). Verified with a virtual DualSense driving the real input code: intro → tutorial, and a real match (select, march, hold-to-seal resolved by the engine, unplug → pause). 17 client unit tests.
- **Warlord economy (B, ahead of plan, on devnet):** warlords sell intel (only islands they can see) and truces (enforced by the engine, broken if you attack) for aether, at prices their own AI sets each turn; trades are inside the rules, so The Reveal verifies them. Each warlord has a USDC wallet in the contract: anyone can stake it, it pays its own Stakes buy-ins, keeps its prizes, and has no withdraw. Rules +4 tests, contract +2, end-to-end test trades every turn.
- **Gloam vault core (day 6 work, ahead of plan):** `@gloamtrade/sdk` 0.5.0 (every export the add-on names exists; `depositLimit` is `{perDeposit,total}`, read live), `web/src/privacy/` (network, BaseSigner + injected signer, NEP-413 vault key, AES-GCM note vault with forced backup and restore, shield with note-saved-before-broadcast, cash-out, worker prover, incremental tree cache checked against `currentRoot()`), and a Private vault screen with step tracker and fog dissolve. Checked against live Base Sepolia, read only: live limits ($500/deposit → $1,200 splits 500/500/200), live 0.25% fee, address guard, a real shield proof on the ceremony keys (1.3 s in Node; in a browser worker too), full tree sync 24 s then incremental. 7 new unit tests.
  - **Design change, privacy:** cash-outs go through Gloam's relay (`relayIntent`), so the derived Base address (public, linkable to the NEAR account) never sends them. The relay sends no CORS headers, so the browser reaches it through `/gloam-relay` (Vite proxy in dev, VEIL relayer passthrough when deployed; only proven unshield/transfer on the allowed chain id pass).
  - Not run yet: a broadcast deposit and cash-out. Needs a Base Sepolia wallet with faucet ETH + test USDC (faucet.circle.com).
- **Radial order menu (day 7 Part 2 item, done):** one menu for every input. Square/X (keyboard O) opens it on the cursor tile, right-click on mouse, long-press on touch, on islands and on fog. Fixed slots: March ↑, Scout →, Fortify ↓, Attack / Move here ←, close in the hub; disabled options say why. Stick/arrows point, select confirms, back closes, Square/X again opens the full orders panel. It goes through the same code as clicking, so the rules are not duplicated. 5 unit tests; headless run in a real match: march → move drafted, mouse scout charged 2 aether, Esc closes.
- **Testnet accounts (2026-11-03):** `veil-clouds.testnet` (contract) and `veil-clouds-relay.testnet` (relayer), 10 test NEAR each from the faucet. Keys live in `~/.near-credentials/testnet/` (outside the repo, mode 600); the relayer and `deploy-testnet.sh` read them from there. OutLayer login done (as `veil-clouds.testnet`).
- **Day 3, testnet (2026-11-03):** engine built with the callers gate for `veil-clouds.testnet` (sha256 `79fe2d79…0d6c`), uploaded to FastFS and registered as OutLayer project `veil-clouds.testnet/veil-engine`; contract deployed and initialised on `veil-clouds.testnet` (OutLayer testnet VRF key, Circle testnet USDC `3e2210e1…`); relayer running as `veil-clouds-relay.testnet`; web app on testnet via `vite --mode testnet` (port 5174). Verified in a browser on real testnet: the implicit account is onboarded by the relayer, then create_match and join_practice go through as gasless meta-transactions.
  - Fixed on the way: Node `global` shim for near-api-js in the browser; delegate nonces (near-api-js reuses a cached nonce); the relayer now returns the contract's answer from a meta-transaction and surfaces inner failures (it returned null and hid panics).
  - test.fastfs.io was down for ~3 h (Cloudflare 502); back since 20:03 WAT.
  - **OutLayer constraints found on real runs** (none were in the docs we read before):
    1. `bind: "wasm"` keys are served only to direct wasm-URL runs; persistent storage only to project runs. The engine needs storage, so its keys are now `bind: "project"`. To keep a new engine version from reading live matches (project keys are shared by every version the contract runs), `set_engine` is refused while any match holds hidden state. Threat model and protocol docs updated.
    2. `author_secrets` must exist under `Project(<id>)` with an access condition the run passes (the reader is the account that calls the contract; the contract is a `--via`). Set by you on 2026-11-05; the row holds only `NEARAI_MODEL`, so warlords use the bot until a NEAR AI key is added.
  - **✔ Day 3 goal met (2026-11-05):** match #10 on testnet, played in a browser: onboarding → gasless create/join → enclave init → 6 turns with sealed orders, each resolved in the TEE → reveal published to OutLayer storage → the browser re-ran all 6 turns: "✔ Verified" (history hash matches chain, map regenerated from the opening VRF, every turn's VRF proof, signature and state commitment check out). Match #9 also ran to Revealed on autopilot after its browser profile was lost.
  - Small follow-up: when every human has sealed, the client and the relayer both crank `resolve_turn`; the contract takes one, the other wastes a little gas.
  - Free testnet RPCs rate-limit (rpc.testnet.near.org 429s most requests) and this network drops connections in bursts. The relayer now reads through a failover list and sends on one RPC; polling slowed (cranker 5 s, match sync 3 s off devnet); the client retries onboarding and waits for the account to be final.
  - Engine on testnet: project `veil-clouds.testnet/veil-engine`, version `b36e3be6…2b04`.
- Still open from Part 2: testing on physical controllers (needs your pads: DualSense USB/BT, DS4, Xbox).

## Locked decisions (2026-11-01)

1. **Accounts.** Practice: browser-held key, no wallet, no popups. Stakes and Gloam cash-out: a real NEAR wallet via **NEAR Connect**. The Gloam vault key is derived from a NEP-413 signature by that wallet, so it is recoverable on any device.
2. **Networks.** Everything is built and judged on **testnet** (NEAR testnet, OutLayer testnet, Chain Signatures `v1.signer-prod.testnet`, Gloam on Base Sepolia with the mainnet pool keys). 1Click has no testnet, so on testnet the NEAR → Base leg is replaced by funding the derived Base Sepolia address from a faucet, and the UI says so.
   **Optional mainnet showcase** (decide on day 10, not before): one tiny real run of Stakes → 1Click → Gloam → unshield, for tx hashes in the README. Budget ≈ 10 NEAR (≈ half is locked storage) + $25 USDC + $5 NEAR AI credits. Never without an explicit go-ahead.
3. **Spec mappings.** `apps/client` = `web`; "selected unit" = selected tile; Triangle/Y = a new threat-view overlay (visible enemy strength per tile), useful for mouse players too.
4. **Priorities by judge value:** (1) live testnet + tutorial + The Reveal, (2) warlord wallets and the intel/truce market, (3) Gloam cash-out, (4) gamepad — built lean; glyphs and rumble are early cuts.

## Day plan

Nov 1–2 are partly taken by your other deadline; they hold work that needs no accounts.

| Day | Date | Work | Done when |
|---|---|---|---|
| 1–2 | Sat–Sun Nov 1–2 | **D:** input action layer (`web/src/input/`), mouse/touch refactored to emit actions; gamepad reading, deadzone + repeat as tested pure functions; mapping table. **You:** testnet accounts, OutLayer login, NEAR AI key, 1Click JWT. | Pad moves the cursor and selects tiles in a match |
| 3 | Mon Nov 3 | **A:** upload engine, deploy contract, run relayer; fix what breaks against real OutLayer; Reveal/verify against OutLayer public storage. | One full match through the real enclave on testnet, verified |
| 4 | Tue Nov 4 | **B:** NEAR AI warlords inside the enclave, model measured and chosen; warlord wallets (keys derived in the TEE). | Warlord match < 25 s/turn; warlord account visible on testnet |
| 5 | Wed Nov 5 | **B:** intel + truce market (engine + contract + UI). | A player buys intel from a warlord on testnet |
| 6 | Thu Nov 6 | **C:** Gloam SDK in, `gloamNetwork`, `BaseSigner` + injected signer, `noteVault` (AES-GCM, NEP-413-derived key, backup/restore), shield on **Base Sepolia**, proving in a Web Worker. | approve → shield → `syncTree` finds the commitment |
| 7 | Fri Nov 7 | **C:** cash-out to public (`unshield`, fee shown, `cashOutTargetProblem`), VaultPanel, failure drills (tab closed mid-proof). **D:** radial order menu. | Base Sepolia e2e incl. unshield to a 2nd address |
| 8 | Sat Nov 8 | **C:** Chain Signatures signer (NEAR testnet + Base Sepolia). **E:** `bridge.ts` (1Click quotes, Leg A USDC + Leg B ETH, status polling); buy-in uses the same module. | Derived address sends a tx; shield flow via Chain Signatures |
| 9 | Sun Nov 9 | **D:** focus manager across every screen (lobby, match, tutorial, vault, cash-out), glyphs, rumble. Results-screen “Cash out privately” + step tracker + fog “sealing” animation. | Full match + cash-out screens with a pad only |
| 10 | Mon Nov 10 | **Public preview** on testnet (X post, NEAR + OutLayer devs, Gloam builders chat). **Mainnet deploy** (with your go-ahead). | 3 outside people played |
| 11 | Tue Nov 11 | **Only if the mainnet showcase is approved on day 10** (otherwise: Base Sepolia e2e hashes + extra polish): Stakes buy-in via 1Click → match → payout → cash out privately → unshield to a fresh address. Record tx hashes. | Hashes in README |
| 12 | Wed Nov 12 | Fix-up day: preview feedback, bot balance, mobile perf, controller matrix (DualSense USB/BT, DS4, Xbox; Safari spot check). | Pad-only 4-player match, main menu → results |
| 13 | Thu Nov 13 | Polish (battle cinematic, sound), README (honest privacy model §1.2, Gloam as an existing library, tx hashes), docs. | README reviewed |
| 14 | Fri Nov 14 | Demo video (Gloam “dissolves into fog” moment), X post tagging @gloamtrade, repo public, submit (payload confirmed by you). | 201 from the submission API |

## Cut order (cut from the top when behind)

1. Social login (Privy) — dropped from v2 unless time appears
2. Gloam partial cash-out (private send to split notes)
3. Battle cinematic, rumble
4. Warlord truces (keep intel)
5. Chain Signatures signer (ship cash-out with the injected signer only)
6. 1Click buy-in from other chains (keep USDC-on-NEAR buy-in)
7. Gamepad glyph switching

**Never cut:** testnet live link; hidden state, attestation, The Reveal, Practice; Gloam note-saved-before-broadcast, forced backup, honest privacy wording, one full Gloam run with tx hashes (Base Sepolia, or mainnet if approved).

## New costs (beyond the testnet faucet)

- Mainnet contract storage ~5 NEAR (locked, refundable); relayer gas + OutLayer runs (a few NEAR).
- Real test money: USDC for buy-ins + cash-out runs. **Check 1Click minimums NEAR→Base first** — a $1 route may be below the minimum, in which case the mainnet run needs ~$5–10.
- Base ETH for gas, bought by Leg B (~$0.30 per cash-out), and MPC `sign` deposits in NEAR.
- Gloam: deposits free, cash-out 0.25%.

## Risks

- 1Click minimums / route availability NEAR USDC → Base USDC + Base ETH.
- Chain Signatures latency from a browser-held implicit account (fallback: injected signer).
- Gloam SDK exports: use only what the installed version's reference lists; stop and check otherwise.
- Browser-held keys holding real money (see decision above).
- 14 days, one developer + me: the cut order is real.

---

# Pre-build research notes and revised plan

Written 2026-10-23, before the build window (2026-11-01 → 2026-11-14 23:59 UTC).
No project code exists yet, on purpose. This file records what the docs actually say,
where `VEIL-BUILD.md` (the spec) has to change, and the plan for Nov 1.

Sources read: OutLayer repo (`out-layer/outlayer`, `main`): `wasi-examples/CONNECTOR_MANIFEST.md`,
`contract/README.md`, `VRF.md`, `sdk/outlayer` 0.2.1 sources, `wasi-examples/signing-key-probe/README.md`,
`dashboard/public/llms-full.txt`; NEAR AI Cloud quickstart + models page; live `HACKATHON.md`.
**Not reached** (DNS blocked from this machine's sandbox): `app.outlayer.ai` pages, 1Click API
(`1click.chaindefuser.com`), `docs.near-intents.org`. Those items stay open below.

---

## 1. Rules check (HACKATHON.md, live copy)

- No clause about prior work or code written before Nov 1. The "no code before Nov 1" rule is
  our own (spec §17). Keeping it anyway: it's the clean story for judges.
- Submissions only accepted Nov 1–14; one per team; payload confirmed by the human before sending.
- `games` track text: "NPCs with wallets, player-owned markets… bonus if players never notice
  the chain". Tags: AGENT NPCS, SOCIAL LOGIN, NEAR INTENTS, NEP-245. → AI warlords and social
  login matter for scoring; consider whether NEP-245 (multi-token) fits anywhere cheaply
  (e.g., match receipts / trophies). Not core.
- `privacy` track tags: PRIVATE AI, TEE, NEAR AI CLOUD — VEIL hits all three.

## 2. OutLayer: what's confirmed, and what changes in the spec

### 2.1 Confirmed as the spec assumed
| Spec assumption | Doc says |
|---|---|
| `encryption_keys` with `caller: "predecessor"` | Yes. Manifest entry `{ "path": "...", "caller": "predecessor", "bind": "project"\|"wasm" }`. Max 5 keys. Path `[a-z0-9][a-z0-9_-]{0,31}`. |
| `storage_account: "predecessor"` | Yes. Cell = the contract that called OutLayer (i.e. `veil.near`). Docs explicitly say pair it with predecessor keys. |
| Sealed storage + CAS | SDK `outlayer::storage::sealed::{set, get, set_if_absent, set_if_equals, delete}` — record key = `mac(name)`, value = `encrypt(value, aad = name)`, CAS compares ciphertext bytes. Exactly spec §7.3. |
| Ciphertext format | `0x01 ‖ nonce(24) ‖ ct ‖ tag(16)`, XChaCha20-Poly1305, +41 B. Plaintext/aad/mac cap 256 KiB. |
| VRF | `vrf::random(seed) -> {output_hex, signature_hex, alpha}`; alpha = `vrf:{request_id}:{sender_id}:{seed}`; output = SHA256(sig); verify on chain with `env::ed25519_verify(sig, alpha, vrf_pubkey)` (~1 Tgas). Max 10 calls/run. Seed must not contain `:`. Pubkey: `GET {api}/vrf/pubkey`. |
| Outbound HTTPS | Yes on `wasm32-wasip2` via `wasi-http-client = "0.2"` (not reqwest). |
| Limits | max 500 B instructions, 180 s, 4096 MB memory. Yield window 200 blocks; stale cancel after 10 min. |
| Public storage | `storage::set_worker_with_options(key, bytes, Some(false))`; read via `GET /public/storage/get` and `/public/storage/batch`. Per-value size limit still unknown → chunk the Reveal. |
| Env | `NEAR_PREDECESSOR_ID`, `NEAR_SENDER_ID`, `NEAR_REQUEST_ID`, `NEAR_BLOCK_TIMESTAMP`, etc. |

### 2.2 Changes to the spec (do these on Nov 1)

**A. Use the manifest `callers` block — stronger than the spec's isolation story.**
```json
"callers": { "contract": { "only": ["veil.near"] } }
```
The worker refuses any run not made by `veil.near` calling `outlayer.near` — before decrypting
secrets, deriving keys or running code. Combined with predecessor keys + predecessor storage this is
three independent locks. Replaces the spec's §18 HMAC `run_token` fallback entirely.
Caveat from the docs: **every published version stays callable by `version_key`**, and a version
without the block admits every door. So: keep two projects — `veil-engine-dev` (open, testnet
only, for scripts) and `veil-engine` (gated, never publish an ungated version to it).

**B. "Even the dev can't see" needs code pinning, not just key binding.**
A `bind: "project"` key opens in *every* version of the project. The project owner (us) could
publish a version that dumps state, and `veil.near` calling it would open everything. Fix:
- state key `bind: "wasm"` → only the exact build that sealed it can open it; and
- `veil.near` pins the engine `version_key` (wasm sha256) into each `Match` at `create_match`,
  immutable for that match; `veil.near` itself deployed without a full-access key after launch
  (or document clearly that it isn't, if we keep upgradeability during the hackathon).
- README states: "a match's engine hash is fixed at creation; you can check it on chain and
  rebuild it reproducibly."
Cost: an engine upgrade can't open in-flight matches. Fine — they finish on the old version.

**C. Drop the `PROTECTED_GAME_SK` secret; derive per-match game keys instead.**
OutLayer encryption keys are symmetric only (no X25519). Instead of an author secret:
```
GAME_SK(match) = X25519 clamp( mac("orders", None, "game-sk:v1:{match_id}") )
GAME_PK(match) = X25519 base-point mult(GAME_SK)
```
with `orders` declared `{ "path": "orders", "caller": "predecessor", "bind": "wasm" }`.
Deterministic, never stored, never seen by anyone, per-match (a leaked key only burns one match),
and it removes the author-secret access-condition setup from the critical path.
`author_secrets` is then only needed for `NEARAI_API_KEY`.
(Doc warning to honour: with author secrets, "store every name your code reads", else a
caller-supplied row could inject that variable.)

**D. Declare the network allowlist.** `"capabilities": { "network": ["cloud-api.near.ai"] }` —
enforced for ordinary projects when present. Makes "the engine can talk to nothing but the AI
endpoint" a checkable claim.

**E. Re-rolls via retries.** VRF alpha includes `request_id`, so a *retried* resolve (after an
engine failure) gets different dice. Not exploitable by us (we never see a result before it
lands), but say so in the threat model. The contract should check `alpha` starts with
`vrf:` and its `sender_id` segment is `veil.near`, and ends with `:turn-{n}`.

**F. Sizes are fine.** `input_data` up to 32 KB costs nothing extra (6 seats × ~1.4 KB of
padded order ciphertext ≈ 9 KB). The 10 KB cap only applies to *priced* (connector) projects.
Outputs >1 KB go through the worker's 2-call flow automatically.

### 2.3 Engine manifest, revised
```json
{
  "storage_account": "predecessor",
  "encryption_keys": [
    { "path": "state",  "caller": "predecessor", "bind": "wasm" },
    { "path": "orders", "caller": "predecessor", "bind": "wasm" }
  ],
  "callers": { "contract": { "only": ["veil.near"] } },
  "capabilities": { "network": ["cloud-api.near.ai"] },
  "author_secrets": { "profile": "prod" }
}
```
Embed with `#[used] #[link_section = "outlayer.manifest"]`; verify with
`wasm-tools print … | grep -c outlayer.manifest`. Dev project uses the same manifest minus
`callers` (and with `veil-dev.testnet` as predecessor).

### 2.4 Still to confirm with the OutLayer team (post in their GitHub/X before Nov 1)
1. `bind: "wasm"` + `caller: "predecessor"` + `storage_account: "predecessor"` together on a
   `Project` source pinned by `version_key` — any gotcha?
2. Per-value size limit for `set_worker` public storage (for The Reveal).
3. Is `GET /public/storage/get` CORS-enabled (for in-browser verify)?
4. Live pricing: `estimate_execution_cost` for {60 s, 10 B instr, 256 MB} on mainnet.
5. Does the yield window (200 blocks) bound the whole run incl. a ~15 s NEAR AI call? (Should, at ~0.6 s blocks ≈ 2 min.)

## 3. NEAR AI Cloud
- OpenAI-compatible: `POST https://cloud-api.near.ai/v1/chat/completions`, Bearer key.
- Default model `zai-org/GLM-5.1-FP8` is a reasoning model (returns `reasoning_content`).
- Privacy tiers matter for the pitch: only **Confidential TEE** models give the "AI sees your fog
  privately" claim. *Incognito* models (OpenAI/Anthropic/Gemini via gateway) run outside a TEE —
  don't use those for warlords. Pick from `GET /v1/models` (lists features + pricing).
- Day 11: measure latency on one Confidential-TEE reasoning model with reasoning effort low vs one
  non-reasoning model; budget 12 s hard timeout → heuristic bot.

## 4. Not verified yet (do from a normal network)
- 1Click: `/v0/tokens` → USDC-on-NEAR `assetId`, per-chain minimums (is $1 viable?),
  `EXACT_OUTPUT` support, `confidentiality: "basic"` field, JWT signup.
- Privy NEAR support (or Web3Auth fallback); NEAR Connect package name/version.
- NEP-366 delegate action signed by a function-call access key (spec §10 fallback stands).

## 5. Revised day plan (changes from spec §16 in bold)

| Day | Date | Goal |
|---|---|---|
| 1 | Sat Nov 1 | Workspace; `veil-rules`: hex/axial, tiles, map gen + invariants (fixed-point, no floats) |
| 2 | Sun Nov 2 | Resolution, vision, heuristic bot; proptest: determinism, conservation, **fog-leak**, fixed view size |
| 3 | Mon Nov 3 | Engine on `veil-engine-dev` (testnet): manifest, sealed state, VRF, **mac-derived GAME_PK**, `init` |
| 4 | Tue Nov 4 | `resolve` + ECIES orders/views + CAS; contract skeleton with **pinned `version_key` per match** |
| 5 | Wed Nov 5 | Contract lifecycle + VRF/alpha checks + workspaces tests; publish gated `veil-engine`; `simulate.ts` 20 turns |
| 6–7 | Nov 6–7 | R3F client: islands, cloud fog, drafting, submit, decrypt view, animate |
| 8 | Sat Nov 8 | 1Click buy-in + `ft_on_transfer` + payout + confidential withdraw (mainnet only with go-ahead) |
| 9 | Sun Nov 9 | Login (Privy/NEAR Connect), FC key, relayer |
| 10 | Mon Nov 10 | Public preview + feedback |
| 11 | Tue Nov 11 | NEAR AI warlords (Confidential-TEE model only) + fallback |
| 12 | Wed Nov 12 | Reveal (chunked public storage) + `veil-verify` + in-browser verify + attestation sheet |
| 13 | Thu Nov 13 | Polish, perf, README, threat model incl. §2.2 B/E |
| 14 | Fri Nov 14 | Video, X post, repo public, submit (payload confirmed by you) |

Cut order unchanged: taunts → battle cinematic → async mode → extra buy-in chains.
Never cut: hidden state, attestation, Reveal, Practice.

## 6. Pre-Nov-1 checklist (remaining)
- [ ] Ask OutLayer the §2.4 questions.
- [ ] Pull 1Click `/v0/tokens`, get JWT, note USDC assetId + minimums.
- [ ] NEAR AI Cloud account + credits + key; list Confidential-TEE models.
- [ ] Privy app with NEAR (or Web3Auth).
- [ ] Reserve `veil.near` + `veil-dev.testnet`; fund testnet; OutLayer account; install `near` CLI,
      `cargo-near`, `wasm-tools`, `rustup target add wasm32-wasip2` (currently not installed).
- [ ] Read the OutLayer Playground VRF coin flip end to end.
