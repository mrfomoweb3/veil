# VEIL: the narrated walkthrough

GOAL:    a judge who has never seen VEIL understands, in about three minutes, what each piece of
         technology does and why the game needs it, and leaves with one line: hidden while you
         play, provable when it ends.
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps.
TIME:    ~170–185 s (set by the voice; ~400 words at ~2.2 words/s). No music under the voice
         except a low wind bed at -28 dB; the game's own sound cues on their actions.
VOICE:   Kokoro (local, free), `am_michael`, speed 1.0. First person: the builder playing his game.
LOOK:    the game's own world, not a template. Ground: the game's dusk sky (#17122b → #2c2352
         radial, as in the title screen) and its painted islands and clouds; ink #efe6d6; gold
         #ffd98a only for the word or number being explained and for the verdict; Cinzel 800 for
         titles at 96 px, Inter 600 at 40 px for labels. Real screens from the live site
         (veil.mrfomolabs.xyz) at 1.6–2x, never a mockup. Diagrams are drawn in the game's
         language: islands are the nodes, a cloud is what hides, a gold seal is what proves.
OBJECTS: the browser (the live site), the NEAR contract (a stone tablet with the turn clock),
         the OutLayer enclave (a sealed vault inside a cloud bank: you see it, never into it),
         the VRF die (a die with its proof as a gold ribbon), the Base address (a second island
         across the sea, tied by a rope to the player's island: Chain Signatures), the Gloam pool
         (a deep fog lake).
MOTION:  camera pushes 0.5 s, ease power3.inOut; reveals land on the word that names them;
         clouds are the transition between scenes (part to enter, close to leave); nothing
         drifts after it lands.
BANNED:  the default list in the HyperFrames spec guide, plus: bullet slides, icons in circles,
         a narrator line repeated as on-screen text, crypto clip-art (coins with logos, chains,
         padlocks floating in space), the logo docked in a corner.

## Script and shots

Each line is one scene; the visual is what is on screen while it is said.

| # | Narration | On screen |
|---|---|---|
| 1 | In an online strategy game, the server sees the whole map. On a public blockchain, everyone does. | A live board with the fog, then the fog drawn off it: a whole map in plain view, a crowd of eyes on it (cursor marks). |
| 2 | So you either trust whoever runs the game, or you keep no secrets. | The map splits: one side a single watcher, the other everything exposed. |
| 3 | VEIL is a third way: a war in the clouds where nobody can see the map. Not the players. Not even me. | Clouds roll back in; the VEIL title rises out of them (the real title art). |
| 4 | The game is the demonstration. Anything that needs a secret on a public chain works the same way: cards, auctions, sealed bids. | Three secrets in the game's style appear and fold into the board. |
| 5 | I open the link. No wallet, no sign-up. A relayer creates my NEAR account and pays every fee. | The live title screen: "You fight as Storm Crane". A small line traces from the browser to the relayer to NEAR. |
| 6 | I open a lobby and send a friend one link. When every seat is taken, the war starts by itself. | Real lobby panel, the invite link copied; the friend's invite screen; "Join the war". |
| 7 | I see my capital and nothing else. The real map lives where nobody can look. | The match board at 1.6x, clouds everywhere but one island. |
| 8 | Inside an OutLayer enclave: Intel TDX hardware running the game engine in memory even its operator can't read. | Diagram: the cloud bank opens onto a sealed vault; the engine inside is never shown, only its outline. |
| 9 | I march, recruit, and seal my orders. My browser encrypts them to a key that exists only inside that enclave. | Real orders panel: the arc, the recruit slider, "Seal & send orders"; the orders fold into a gold seal and fly into the vault. |
| 10 | The NEAR contract holds the ciphertext and keeps the clock. Everyone sees that I sealed, never what. | The top bar's 🔒 marks at 2x; the stone tablet with the timer. |
| 11 | Once everyone has sealed, the enclave opens the orders, fights the battles, and sends each player only their own view. | The real resolving card; then one view leaves the vault per player, each the same size. |
| 12 | The dice come from a verifiable random function. The contract checks every roll's proof before it accepts the turn. | The real ⛨ attestation sheet for a turn: signature, output, "this turn" ticks landing. |
| 13 | Empty seats go to AI warlords. They decide inside the enclave too, from their own fog only. | The warlords' names in the top bar; their own small fogged views inside the vault. |
| 14 | Each has its own wallet and trades what it knows. I buy intel on an island under my cloud. | Real market panel; the intel cursor walks into the fog; "Intel bought: the island is in your view". |
| 15 | Or a truce, so it holds back. Prices change every turn, and every trade is part of the rules. | "Truce bought" in the feed; Kael's price changing 3 → 7 on the real market. |
| 16 | When the war ends, the enclave publishes everything it hid: every order, every roll, and the match key. | "The war is over" panel; the vault opens; papers stream out. |
| 17 | My browser re-runs the whole match with the same Rust code and checks it against the chain. | The real Reveal: the fog gone, the turn scrubber running, orders drawn as arcs. |
| 18 | Verified. | "✔ Verified: all 6 turns re-run from the revealed orders" stamps in gold. |
| 19 | Hidden while you play. Provable when it ends. That's what VEIL is here to show. | The board half fogged, half revealed, the line between them sweeping across. |
| 20 | Winnings get the same care. Through Chain Signatures, my NEAR account controls an address on Base: no second wallet. | Real vault: "From 0x0488… (from your NEAR account)"; the rope between the two islands. |
| 21 | On mainnet, NEAR Intents carries the winnings across. Here on testnet, a faucet stands in. | Real "Bring winnings from NEAR" panel with its live mainnet quote. |
| 22 | I seal them into Gloam's private pool. Later, a zero-knowledge proof cashes them out to any address I choose. | The real shield tracker reaching "Private"; the balance dissolving into fog; the cash-out sheet. |
| 23 | Gloam's relay sends that transaction, so my address never appears next to it. | Basescan for 0xad620269…: "from 0xb1e9…" (the relay), not the player. |
| 24 | Mouse, touch, keyboard or gamepad: one radial menu gives every order. | The real radial menu on a tile; pad glyphs. |
| 25 | VEIL. A strategy game where even the developer can't see the map. Play it at veil dot mrfomolabs dot xyz. | End card: the title art carried in by the clouds; the URL. |

QA: frame 0 (scene 1 board, never black); the title rise (3); the seal flying into the vault (9);
the verdict stamp (18); the Basescan sender (23); the end card held 2.5 s.
