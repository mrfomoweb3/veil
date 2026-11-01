# VEIL add-on spec: Gloam private cash-out + gamepad support

This file extends the main `build.md`. Read `build.md` first. Where they conflict, `build.md` wins on game logic, this file wins on the two features below.

Fit all paths into the repo layout from `build.md`. Paths below assume `apps/client` (React Three Fiber) and `contracts/` (NEAR). Adjust if the layout differs. (In this repo: `apps/client` = `web`. See `PLAN.md`, "How the add-on maps onto this repo".)

Two features:

1. **Gloam private cash-out.** A winner moves their VEIL winnings from NEAR to a private Gloam balance on Base, for real, on mainnet. No mocks, no fake success states.
2. **Gamepad support.** PS4, PS5 and Xbox controllers play the full game, including menus and the cash-out screen.

---

## Part 1: Gloam private cash-out

### 1.1 What it does, in one paragraph

The match settles on NEAR, as in `build.md`. On the results screen the winner taps **Cash out privately**. NEAR Intents (1-Click) moves their USDC from NEAR to USDC on Base, plus a tiny amount of Base ETH for gas. The funds land in a Base address that the player's NEAR account controls through NEAR Chain Signatures. VEIL then deposits the USDC into Gloam's vault with a zero-knowledge proof. From then on the balance is private: the player can hold it, or cash it out later to any Base address, and nobody can link that cash-out back to them. NEAR stays the control layer for the whole flow: the player never installs or connects a second wallet.

### 1.2 Honest privacy model (put this in the README too)

Be exact about what is hidden. Judges will check.

- **Public:** the Intents transfer to Base, the derived Base address (anyone can compute it from the NEAR account id and path), and the deposit amount into Gloam (`shieldBound` takes the amount as a public input).
- **Private after deposit:** where the money goes next. A later cash-out (unshield) or private send cannot be linked to the deposit. The chain sees a proof and a nullifier, not which note was spent.
- **So the claim is:** "Your winnings arrive in public, then disappear. Where they go after that is yours alone." Do not claim the payout itself is hidden.
- UI tip shown on the cash-out-to-public screen: cash out to a fresh address, and not straight after depositing, for better privacy.

### 1.3 Facts about the SDK (verified Nov 1, 2026)

- Package: `@gloamtrade/sdk` (TypeScript source, consumed through the bundler). `npm install @gloamtrade/sdk viem snarkjs`. With Vite, add it to `optimizeDeps.include` if the dev server complains; with Next, `transpilePackages`.
- Base mainnet is chain `8453`, Base Sepolia `84532`. Base Sepolia runs the **mainnet pool and final ceremony keys** with test funds, so it is the right place to develop.
- `mainnetNetwork("base")` and `testnetNetwork("base")` return a `GloamNetwork` (`chainId`, `pool`, `deployBlock`, `rpcUrl`, `chain`, `assets`), or `null` if the pool is not published. Throw a clear error on `null`.
- Tokens: `BASE_USDC`, `BASE_SEPOLIA_USDC` (6 decimals).
- **Always pass `chainId`** to every builder. The vault has the same address on all mainnets, and builders throw without `chainId` when given a mainnet vault.
- Proving keys: `circuitArtifactUrls("shield" | "unshield" | "transfer", chainId)` returns the right `{ wasm, zkey }` URLs. Use `artifactProver(...)` on them. Never hardcode artifact paths.
- Beta limits: 500 per deposit per stablecoin. Read `net.assets[i].depositLimit` and clamp. If the winnings exceed it, split into several deposits.
- Fees: deposits and private payments are free. Mainnet cash-out keeps 0.25%: show `cashOutFee(amount)` before the player confirms.
- `approvalSteps(chainId, token, allowance, amount)` returns the exact `approve` calls needed before a deposit. Use it instead of writing approve logic by hand.
- `cashOutTargetProblem(to, net)` says why a cash-out address would lose funds (the vault, a token contract, zero address). Run it on the address field as the player types.
- Docs: https://www.gloam.trade/docs/sdk and https://www.gloam.trade/docs/sdk/reference. Help: Gloam builders chat on Telegram (https://t.me/gloamhq/23447). If an export named here does not exist in the installed version, stop and check the reference page, do not invent one.

### 1.4 Architecture

```
NEAR (VEIL contract)          NEAR Intents 1-Click            Base (8453)
───────────────────           ─────────────────────           ─────────────────────────
winner's USDC payout  ──────► quote + deposit  ─────────────► USDC + ~$0.30 ETH
                                                               to derived address
player NEAR account ── sign via Chain Signatures (v1.signer) ─► approve(pool)
                                                               shieldBound(proof)  ──► Gloam vault
                                                                                        (private note)
                                                               later: unshield(proof) ─► any address
```

New client modules:

```
apps/client/src/privacy/
  gloamNetwork.ts       // picks Base or Base Sepolia from VITE_GLOAM_ENV, throws on null pool
  baseSigner.ts         // BaseSigner interface + two implementations (below)
  chainSigSigner.ts     // NEAR Chain Signatures implementation (default)
  injectedSigner.ts     // fallback: player's own EVM wallet via window.ethereum
  bridge.ts             // NEAR Intents 1-Click: quote, deposit, poll status
  shield.ts             // approve + buildShieldBoundIntent + broadcast
  cashOut.ts            // syncTree + buildUnshieldIntent + broadcast
  noteVault.ts          // encrypted note storage + backup export/import
  useGloamBalance.ts    // React hook: private balance from stored notes
apps/client/src/ui/vault/
  CashOutPrivately.tsx  // results-screen flow with a step tracker
  VaultPanel.tsx        // private balance, cash out to public, backup
```

### 1.5 The signer (most important design choice)

Define one interface so the rest of the code does not care who signs:

```ts
export interface BaseSigner {
  address(): Promise<`0x${string}`>;
  sendTx(tx: { to: `0x${string}`; data: `0x${string}`; value?: bigint }): Promise<`0x${string}`>; // returns tx hash
}
```

**Default: `chainSigSigner.ts` (NEAR Chain Signatures).**

- Derive the player's Base address from their NEAR account id with a fixed path, `"veil-base-1"`, against the mainnet MPC contract `v1.signer` (testnet: `v1.signer-prod.testnet`).
- To send: build the EIP-1559 tx with viem (`nonce`, fees and gas from the Base RPC), hash it, call `sign` on the MPC contract from the player's NEAR account with the required deposit, reconstruct the signature, broadcast with viem.
- Use NEAR's maintained Chain Signatures JS library rather than hand-rolling the signature reconstruction. Check https://docs.near.org/chain-abstraction/chain-signatures for the current package name and EVM adapter before writing code.
- Each Base tx needs one NEAR wallet approval. That is acceptable here because it happens on the results screen, never mid-match. Batch the copy: "Approve 2 signatures to move your winnings into your private balance."

**Fallback: `injectedSigner.ts`.** If Chain Signatures fails on the day (MPC latency, library issue), the player can connect their own Base wallet through `window.ethereum`. Same interface, same flow after that. Ship both behind a toggle in settings; default to Chain Signatures.

### 1.6 The bridge (`bridge.ts`)

Use the NEAR Intents 1-Click API, the same one `build.md` uses for buy-ins.

1. Resolve asset ids by fetching the 1-Click tokens list at runtime. Do not hardcode asset id strings: find NEAR USDC, Base USDC and Base ETH from the list.
2. Request two quotes, both with `recipient` = the derived Base address and `refundTo` = the player's NEAR account:
   - **Leg A:** payout minus gas budget → Base USDC.
   - **Leg B:** gas budget (start at about $0.30) → Base ETH.
3. Deposit to the quote deposit addresses from the player's NEAR account, then poll status until `SUCCESS` (or `REFUNDED` / `FAILED`).
4. Show each state in the step tracker. Never show a step as done before the API says so.
5. If Leg B fails but Leg A lands, the player is stuck without gas. Offer a retry of Leg B only.

Confirm the confidential-mode parameter while here (open question from `build.md`): if 1-Click confidential mode works for a NEAR → Base route, use it on Leg A.

### 1.7 Shield (`shield.ts`)

```ts
import {
  buildShieldBoundIntent, artifactProver, circuitArtifactUrls, approvalSteps,
} from "@gloamtrade/sdk";

const usdc = net.assets.find(a => a.symbol === "USDC")!;
const amount = clamp(received, usdc.depositLimit);

for (const step of approvalSteps(net.chainId, usdc.address, allowance, amount)) {
  await signer.sendTx(encodeApprove(net.pool, step)); // wait for receipt each time
}

const intent = await buildShieldBoundIntent({
  chainId: net.chainId,
  poolAddress: net.pool,
  asset: usdc.address,
  amountWei: amount,
  prover: artifactProver(circuitArtifactUrls("shield", net.chainId)),
});

await noteVault.save({ ...intent.note, amountWei: amount.toString(), asset: usdc.address, chainId: net.chainId, status: "pending" });
const hash = await signer.sendTx(encodeCall(intent.exec)); // fn = intent.exec.fn ("shieldBound"), args = intent.exec.args
await waitForReceipt(hash);
await noteVault.markConfirmed(intent.note.commitment, hash);
```

Rules:

- **Save the note before broadcasting.** `intent.note.secret` is the only key to the money. If the tab closes after broadcast and before save, the funds are gone forever.
- Run proving in a Web Worker so the 3D scene does not freeze. Show "Sealing your balance…" with a progress spinner.
- Get the pool ABI from the SDK if it exports one; otherwise from the verified contract on Basescan.
- After confirmation, run `syncTree` and check `indexByCommitment` contains the new commitment before showing "Private balance: $X".

### 1.8 Note storage (`noteVault.ts`)

- Store notes in IndexedDB, encrypted with AES-GCM.
- Key: sign a fixed message with the player's NEAR key (NEP-413 sign message with a fixed nonce; ed25519 signatures are deterministic, so the same account always gets the same key), then run it through HKDF. The player recovers the key on any device by signing again.
- After the first successful deposit, force a backup: download `veil-vault-backup.json` (the encrypted blob). Block closing this dialog until they download it or explicitly tick "I understand I can lose this money."
- Import: VaultPanel accepts the backup file, decrypts with the re-derived key, and checks each note against the chain with `syncTree`.
- Never log, send to a server, or put a secret in a URL.

### 1.9 Cash out to public (`cashOut.ts`)

```ts
const synced = await syncTree(publicClient, { pool: net.pool, fromBlock: net.deployBlock });
const path = await synced.pathForCommitment(note.commitment);
const problem = cashOutTargetProblem(to, net);
if (problem) throw new Error(problem);

const intent = await buildUnshieldIntent({
  chainId: net.chainId, poolAddress: net.pool,
  secretHex: note.secret, amountWei: BigInt(note.amountWei), asset: note.asset,
  to, path,
  prove: artifactProver(circuitArtifactUrls("unshield", net.chainId)),
});
```

- Show the fee (`cashOutFee`) and the net amount before confirming.
- Mark the note `spent` only after the tx confirms.
- If you want a partial cash-out, first do a private send to yourself with `buildPrivateSendIntent` to split the note (`paymentNote` and `changeNote`), save both, then unshield one. Treat this as a stretch goal.

### 1.10 UI

- **Results screen:** two buttons for the winner. "Withdraw to NEAR" (from `build.md`) and "Cash out privately" (new). One line under the second: "Moves your winnings to a private balance on Base."
- **Step tracker:** Bridging to Base → Gas arrived → Approving → Sealing → Private. Each step reflects real chain or API state.
- **VaultPanel** (main menu): private balance, list of notes (amount, date), "Cash out to address", "Back up vault", "Restore vault", and a link to "What stays private" explaining 1.2 in plain words.
- Fog-themed visual: the balance "dissolves into fog" when sealed. This is the one moment Gloam shows in the demo video, so make it look good.

### 1.11 Testing

1. Unit: `noteVault` encrypt/decrypt round trip; key derivation gives the same key twice; clamp to deposit limit.
2. Base Sepolia end to end with `BASE_SEPOLIA_USDC` and the injected signer: approve → shield → syncTree finds the commitment → unshield to a second address. Same final keys as mainnet.
3. Chain Signatures on NEAR testnet + Base Sepolia: derive address, send a 0-value tx, then the full shield flow.
4. Mainnet with about $1: a real VEIL payout → Intents → Base → shield → unshield. Record the tx hashes for the README.
5. Failure drills: close the tab mid-proof (note must survive as `pending`), Leg B fails, an address that `cashOutTargetProblem` rejects.

### 1.12 Submission notes

- README: list `@gloamtrade/sdk` as an existing library (hackathon rules require it), link the docs, explain section 1.2 honestly, include the mainnet tx hashes.
- Tick the **privacy track** as well as Games With Real Economies.
- Tag @gloamtrade in the submission post.

---

## Part 2: Gamepad support

### 2.1 Input action layer (build this first, during the 3D client days)

All input sources produce the same actions. Game code only ever reads actions, never raw keys or buttons.

```ts
type Action =
  | { type: "cursorMove"; dx: number; dy: number }   // tile steps or analog
  | { type: "cameraPan"; x: number; y: number }
  | { type: "cameraZoom"; delta: number }
  | { type: "cameraRotate"; delta: number }
  | { type: "select" } | { type: "back" }
  | { type: "orderMenu" } | { type: "endTurn" }
  | { type: "cycleUnit"; dir: 1 | -1 }
  | { type: "uiNav"; dir: "up" | "down" | "left" | "right" }
  | { type: "pause" };
```

Files:

```
apps/client/src/input/
  actions.ts        // Action type + a tiny event bus
  mouseKeyboard.ts  // existing controls, refactored to emit actions
  touch.ts          // mobile controls, refactored to emit actions
  gamepad.ts        // new
  glyphs.ts         // PlayStation vs Xbox button icons
  useInputMode.ts   // last-used device: "mouse" | "touch" | "gamepad"
```

### 2.2 Gamepad reading (`gamepad.ts`)

- Listen for `gamepadconnected` / `gamepaddisconnected`. Browsers only expose a pad after a button press, so show "Press any button" when none is active.
- Poll `navigator.getGamepads()` once per frame inside the R3F `useFrame` loop. Only handle pads with `mapping === "standard"`.
- Deadzone 0.2 on sticks, with radial (not per-axis) deadzone so diagonals feel right.
- Cursor: left stick snaps tile to tile with repeat (first step immediate, then repeat after 250 ms, then every 90 ms). D-pad does single tile steps.
- Edge detection for buttons: fire on press, not while held, except for repeats above.

### 2.3 Mapping (standard layout indices)

| Button (PS / Xbox) | Index | Action |
|---|---|---|
| Cross / A | 0 | select |
| Circle / B | 1 | back |
| Square / X | 2 | orderMenu (radial) |
| Triangle / Y | 3 | cycle overlay (fog view / threat view) |
| L1 / LB, R1 / RB | 4, 5 | cycleUnit -1 / +1 |
| L2 / LT, R2 / RT | 6, 7 | cameraZoom (analog, use `.value`) |
| Options / Menu | 9 | pause |
| Touchpad or Share / View | 8 or 17 | endTurn (hold 0.6 s to confirm, with a fill ring) |
| D-pad | 12–15 | cursor step / uiNav |
| Left stick | axes 0, 1 | cursorMove |
| Right stick | axes 2, 3 | cameraRotate (x), cameraPan (y) |

End turn uses hold-to-confirm because it cannot be undone.

### 2.4 Radial order menu

Square/X opens a radial menu around the selected unit. Right stick or left stick points at an option (move, attack, scout, fortify), Cross/A confirms, Circle/B cancels. Mouse and touch open the same component, so there is one menu, not two.

### 2.5 UI navigation

Every menu, including the cash-out flow and VaultPanel, must be usable with a pad:

- Focus ring on the active control. D-pad and left stick move focus, Cross/A activates, Circle/B goes back.
- Use a small focus manager (spatial nearest-neighbour by element rects) rather than per-screen wiring.
- Text fields (cash-out address) open with a "Paste" button; do not build an on-screen keyboard.
- NEAR wallet approval popups are outside our control. Show "Confirm in your wallet" and wait.

### 2.6 Glyphs (`glyphs.ts`)

Detect from `gamepad.id`: contains `054c`, "DualSense" or "Wireless Controller" → PlayStation glyphs; contains `045e` or "xinput" / "Xbox" → Xbox glyphs; otherwise generic. Button hints across the UI switch automatically with `useInputMode`, and hide when the player goes back to mouse or touch.

### 2.7 Rumble

`gamepad.vibrationActuator?.playEffect("dual-rumble", { duration, strongMagnitude, weakMagnitude })`. Always optional-chain it: Safari and Firefox may not support it.

- Combat resolves: short strong pulse (120 ms, 0.6).
- Enemy revealed from fog: soft double pulse.
- Private balance sealed: one long gentle rumble (400 ms, 0.3).
- Settings toggle to turn rumble off.

### 2.8 Testing

- Manual matrix: PS5 DualSense (USB + Bluetooth), PS4 DualShock 4, Xbox Series pad, on Chrome desktop. Spot-check Safari on macOS.
- Hot-plug: disconnect mid-match pauses the game and shows "Controller disconnected"; reconnect resumes.
- Play one full 4-player match using only a pad, from main menu to results, including the cash-out flow.
- Unit test the deadzone and repeat timing as pure functions.

---

## Schedule

Superseded by `PLAN.md` → "Roadmap v2", which fits this add-on around what is already built.

**Cut order if behind** (cut from the top): partial cash-out → rumble → Chain Signatures (ship with injected signer only) → glyph switching. Never cut: note-before-broadcast, backup export, honest privacy wording, and a real mainnet run.

## Definition of done

- A real VEIL winner moves real USDC from NEAR into a Gloam private balance on Base mainnet, then cashes out to a fresh address, with tx hashes in the README.
- Closing the tab at any step never loses funds.
- A full match plus cash-out can be played end to end with a PS5 or Xbox controller only.
- Nothing in the UI or README claims more privacy than section 1.2 describes.
