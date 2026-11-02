//! Checks a finished match end to end, trusting nothing but the rules crate and the VRF key:
//!
//! 1. the opening map is exactly what the `init` VRF output generates;
//! 2. every turn's VRF proof verifies, and its alpha names that turn;
//! 3. re-running every turn with the revealed orders reproduces each public result and each
//!    state commitment that was posted on chain while the match was hidden;
//! 4. optionally, the order ciphertexts that sat on chain decrypt (with the revealed game key)
//!    to exactly the revealed orders — so the enclave didn't swap anyone's orders.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use veil_engine::host::Vrf;
use veil_engine::records::{commit, RevealDoc};
use veil_rules::{generate, resolve, Orders, PublicTurn};

#[derive(Debug, Default, Serialize)]
pub struct Report {
    pub match_id: u64,
    pub turns_checked: u32,
    pub ciphertexts_checked: u32,
    pub errors: Vec<String>,
}

impl Report {
    pub fn ok(&self) -> bool {
        self.errors.is_empty()
    }
}

/// An order ciphertext as it was stored on chain.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ChainOrders {
    pub turn: u32,
    pub account: String,
    pub ciphertext_b64: String,
}

/// What was posted on chain each turn, to compare against the replay.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ChainTurn {
    pub public: PublicTurn,
    pub state_commit: String,
    pub vrf: Vrf,
}

pub fn check_vrf(vrf: &Vrf, pubkey: Option<&[u8; 32]>, seed_suffix: &str) -> Result<[u8; 32], String> {
    if !vrf.alpha.starts_with("vrf:") || !vrf.alpha.ends_with(&format!(":{seed_suffix}")) {
        return Err(format!("alpha {:?} does not name {seed_suffix}", vrf.alpha));
    }
    let sig: [u8; 64] = hex::decode(&vrf.signature_hex)
        .ok()
        .and_then(|b| b.try_into().ok())
        .ok_or("signature is not 64 bytes of hex")?;
    let out: [u8; 32] = Sha256::digest(sig).into();
    if hex::encode(out) != vrf.output_hex {
        return Err("output is not sha256(signature)".into());
    }
    if let Some(pk) = pubkey {
        let key = VerifyingKey::from_bytes(pk).map_err(|_| "bad VRF public key")?;
        key.verify_strict(vrf.alpha.as_bytes(), &Signature::from_bytes(&sig))
            .map_err(|_| "VRF signature does not verify".to_string())?;
    }
    Ok(out)
}

pub fn verify(
    doc: &RevealDoc,
    vrf_pubkey: Option<&[u8; 32]>,
    chain_turns: Option<&[ChainTurn]>,
    chain_orders: &[ChainOrders],
) -> Report {
    let mut r = Report { match_id: doc.match_id, ..Default::default() };
    let err = |r: &mut Report, m: String| r.errors.push(m);
    let salt = match hex::decode(&doc.commit_salt_hex) {
        Ok(s) => s,
        Err(_) => {
            err(&mut r, "commit salt is not hex".into());
            return r;
        }
    };

    // Game key.
    let game_sk: Option<[u8; 32]> = hex::decode(&doc.game_sk_hex).ok().and_then(|b| b.try_into().ok());
    match game_sk {
        Some(sk) if hex::encode(veil_crypto::public_key(&sk)) == doc.game_pk_hex => {}
        _ => err(&mut r, "game_sk does not match game_pk".into()),
    }

    // 1. Opening.
    let seats = doc.accounts.len();
    match check_vrf(&doc.init.vrf, vrf_pubkey, &format!("init-{}", doc.match_id)) {
        Ok(seed) => {
            let mut regenerated = generate(doc.match_id, seats, doc.init.state.config.clone(), seed);
            // AI seats are warlords from the start; they must be exactly the seats that
            // played as AI on turn 1.
            for (p, pl) in regenerated.players.iter_mut().enumerate() {
                pl.warlord = doc.init.state.players.get(p).is_some_and(|x| x.warlord);
            }
            if let Some(t1) = doc.turns.first() {
                if regenerated.players.iter().zip(&t1.ai).any(|(pl, ai)| pl.warlord != *ai) {
                    err(&mut r, "warlord seats do not match the AI seats of turn 1".into());
                }
            }
            if regenerated != doc.init.state {
                err(&mut r, "opening map does not match the init VRF output".into());
            }
        }
        Err(e) => err(&mut r, format!("init: {e}")),
    }
    if commit(&salt, &doc.init.state) != doc.init.state_commit {
        err(&mut r, "opening state commitment mismatch".into());
    }

    // 2–3. Every turn.
    let mut state = doc.init.state.clone();
    for (k, t) in doc.turns.iter().enumerate() {
        let n = k as u32 + 1;
        if t.turn != n {
            err(&mut r, format!("turn {n}: record says turn {}", t.turn));
            break;
        }
        if t.orders.len() != seats {
            err(&mut r, format!("turn {n}: wrong number of order sets"));
            break;
        }
        let seed = match check_vrf(&t.vrf, vrf_pubkey, &format!("turn-{n}")) {
            Ok(s) => s,
            Err(e) => {
                err(&mut r, format!("turn {n}: {e}"));
                break;
            }
        };
        let outcome = resolve(&mut state, &t.orders, seed);
        let public = PublicTurn::after(&state, &outcome);
        if public != t.public {
            err(&mut r, format!("turn {n}: replayed public result differs"));
        }
        let c = commit(&salt, &state);
        if c != t.state_commit {
            err(&mut r, format!("turn {n}: state commitment differs"));
        }
        if let Some(chain) = chain_turns {
            match chain.get(k + 1) {
                Some(ct) => {
                    if ct.public != public || ct.state_commit != c || ct.vrf != t.vrf {
                        err(&mut r, format!("turn {n}: differs from what was posted on chain"));
                    }
                }
                None => err(&mut r, format!("turn {n}: missing from chain history")),
            }
        }
        r.turns_checked += 1;
    }
    if let Some(chain) = chain_turns {
        if let Some(c0) = chain.first() {
            if c0.state_commit != doc.init.state_commit || c0.vrf != doc.init.vrf {
                err(&mut r, "opening differs from what was posted on chain".into());
            }
        }
    }
    if state != doc.final_state {
        err(&mut r, "replayed final state differs from the revealed one".into());
    }
    if !state.game_over {
        err(&mut r, "the revealed match is not over".into());
    }

    // 4. On-chain ciphertexts open to the revealed orders.
    if let Some(sk) = game_sk {
        for c in chain_orders {
            let Some(seat) = doc.accounts.iter().position(|a| a == &c.account) else {
                err(&mut r, format!("orders from unknown seat {}", c.account));
                continue;
            };
            let Some(rec) = doc.turns.get(c.turn.saturating_sub(1) as usize) else {
                err(&mut r, format!("orders for unknown turn {}", c.turn));
                continue;
            };
            let opened = B64
                .decode(&c.ciphertext_b64)
                .ok()
                .and_then(|b| {
                    veil_crypto::open(
                        &sk,
                        &b,
                        &veil_crypto::orders_aad(doc.match_id, c.turn, &c.account),
                        veil_crypto::INFO_ORDERS,
                    )
                    .ok()
                })
                .and_then(|pt| Orders::from_padded(&pt));
            // Unreadable ciphertexts ran as empty orders.
            let expected = opened.unwrap_or_default();
            if rec.orders[seat] != expected {
                err(&mut r, format!("turn {}: {}'s on-chain orders differ from the revealed ones", c.turn, c.account));
            }
            r.ciphertexts_checked += 1;
        }
    }
    r
}
