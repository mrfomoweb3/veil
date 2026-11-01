//! Sealing to an X25519 public key: the same construction OutLayer uses for secrets.
//!
//! ```text
//! shared  = X25519(eph_sk, recipient_pk)
//! key     = HKDF-SHA256(ikm = shared, salt = eph_pk || recipient_pk, info)
//! payload = 0x01 || eph_pk (32) || nonce (24) || XChaCha20-Poly1305(key, nonce, plaintext, aad)
//! ```
//!
//! Randomness is passed in, so the same code runs in the enclave, natively and in tests.
//! The browser implements the identical scheme with `@noble/*` (`web/src/protocol/crypto.ts`).

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use hkdf::Hkdf;
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};

pub const FORMAT: u8 = 0x01;
pub const OVERHEAD: usize = 1 + 32 + 24 + 16;
pub const INFO_ORDERS: &[u8] = b"veil-orders-v1";
pub const INFO_VIEW: &[u8] = b"veil-view-v1";

/// 32 bytes for the ephemeral key, 24 for the nonce.
pub type Entropy = [u8; 56];

#[derive(Debug, PartialEq, Eq)]
pub enum Error {
    Malformed,
    Decrypt,
}

pub fn public_key(sk: &[u8; 32]) -> [u8; 32] {
    PublicKey::from(&StaticSecret::from(*sk)).to_bytes()
}

/// The per-match game key. `mac` is the enclave's `mac("orders", "game-sk:v1:{match}")`:
/// derived inside the TEE, never stored, never seen. X25519 clamps it.
pub fn game_secret(mac: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"veil-game-sk-v1");
    h.update(mac);
    h.finalize().into()
}

fn derive_key(shared: &[u8; 32], eph_pk: &[u8; 32], recipient_pk: &[u8; 32], info: &[u8]) -> [u8; 32] {
    let mut salt = [0u8; 64];
    salt[..32].copy_from_slice(eph_pk);
    salt[32..].copy_from_slice(recipient_pk);
    let hk = Hkdf::<Sha256>::new(Some(&salt), shared);
    let mut key = [0u8; 32];
    hk.expand(info, &mut key).expect("32 bytes is a valid HKDF length");
    key
}

pub fn seal(recipient_pk: &[u8; 32], plaintext: &[u8], aad: &[u8], info: &[u8], entropy: &Entropy) -> Vec<u8> {
    let mut eph = [0u8; 32];
    eph.copy_from_slice(&entropy[..32]);
    let eph_sk = StaticSecret::from(eph);
    let eph_pk = PublicKey::from(&eph_sk).to_bytes();
    let shared = eph_sk.diffie_hellman(&PublicKey::from(*recipient_pk)).to_bytes();
    let key = derive_key(&shared, &eph_pk, recipient_pk, info);
    let nonce = &entropy[32..56];
    let ct = XChaCha20Poly1305::new((&key).into())
        .encrypt(XNonce::from_slice(nonce), Payload { msg: plaintext, aad })
        .expect("encryption cannot fail");
    let mut out = Vec::with_capacity(OVERHEAD + plaintext.len());
    out.push(FORMAT);
    out.extend_from_slice(&eph_pk);
    out.extend_from_slice(nonce);
    out.extend_from_slice(&ct);
    out
}

pub fn open(sk: &[u8; 32], payload: &[u8], aad: &[u8], info: &[u8]) -> Result<Vec<u8>, Error> {
    if payload.len() < OVERHEAD || payload[0] != FORMAT {
        return Err(Error::Malformed);
    }
    let mut eph_pk = [0u8; 32];
    eph_pk.copy_from_slice(&payload[1..33]);
    let nonce = &payload[33..57];
    let secret = StaticSecret::from(*sk);
    let my_pk = PublicKey::from(&secret).to_bytes();
    let shared = secret.diffie_hellman(&PublicKey::from(eph_pk)).to_bytes();
    let key = derive_key(&shared, &eph_pk, &my_pk, info);
    XChaCha20Poly1305::new((&key).into())
        .decrypt(XNonce::from_slice(nonce), Payload { msg: &payload[57..], aad })
        .map_err(|_| Error::Decrypt)
}

/// Binds an order ciphertext to its match, turn and seat: no replay, no swapping seats.
pub fn orders_aad(match_id: u64, turn: u32, account: &str) -> Vec<u8> {
    format!("veil|{match_id}|{turn}|{account}").into_bytes()
}

pub fn view_aad(match_id: u64, turn: u32, account: &str) -> Vec<u8> {
    format!("veil-view|{match_id}|{turn}|{account}").into_bytes()
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ent(b: u8) -> Entropy {
        [b; 56]
    }

    #[test]
    fn roundtrip_and_binding() {
        let sk = [7u8; 32];
        let pk = public_key(&sk);
        let aad = orders_aad(1, 2, "a.near");
        let ct = seal(&pk, b"hello", &aad, INFO_ORDERS, &ent(9));
        assert_eq!(ct.len(), OVERHEAD + 5);
        assert_eq!(open(&sk, &ct, &aad, INFO_ORDERS).unwrap(), b"hello");
        // Wrong seat, wrong turn, wrong purpose, wrong key: all refused.
        assert_eq!(open(&sk, &ct, &orders_aad(1, 2, "b.near"), INFO_ORDERS), Err(Error::Decrypt));
        assert_eq!(open(&sk, &ct, &orders_aad(1, 3, "a.near"), INFO_ORDERS), Err(Error::Decrypt));
        assert_eq!(open(&sk, &ct, &aad, INFO_VIEW), Err(Error::Decrypt));
        assert_eq!(open(&[8u8; 32], &ct, &aad, INFO_ORDERS), Err(Error::Decrypt));
        let mut bad = ct.clone();
        bad[60] ^= 1;
        assert_eq!(open(&sk, &bad, &aad, INFO_ORDERS), Err(Error::Decrypt));
        assert_eq!(open(&sk, &ct[..20], &aad, INFO_ORDERS), Err(Error::Malformed));
    }

    /// Fixed vector shared with the TypeScript implementation (web/src/protocol/crypto.test.ts).
    #[test]
    fn cross_language_vector() {
        let sk = [0x11u8; 32];
        let pk = public_key(&sk);
        let ct = seal(&pk, b"veil", b"veil|1|1|a.near", INFO_ORDERS, &ent(0x22));
        assert_eq!(
            hex::encode(&ct),
            include_str!("../vector.hex").trim(),
            "update vector.hex if the scheme changed on purpose"
        );
    }
}
