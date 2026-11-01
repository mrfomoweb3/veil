//! Everything the engine needs from the outside world. On OutLayer these are TEE host
//! functions; locally they are emulated (`local.rs`) with the same semantics.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Vrf {
    pub output_hex: String,
    pub signature_hex: String,
    pub alpha: String,
}

impl Vrf {
    pub fn seed(&self) -> Result<[u8; 32], String> {
        let b = hex::decode(&self.output_hex).map_err(|_| "vrf output is not hex")?;
        b.try_into().map_err(|_| "vrf output is not 32 bytes".to_string())
    }
}

pub trait Host {
    /// One verifiable random value for `seed` (no `:` allowed). Alpha binds request and sender.
    fn vrf(&mut self, seed: &str) -> Result<Vrf, String>;
    /// HMAC-SHA256 under the encryption key at `path` (32 bytes).
    fn mac(&mut self, path: &str, data: &[u8]) -> Result<Vec<u8>, String>;

    /// Sealed records (encryption key `state`, stored raw under `mac(name)`).
    /// Returns (plaintext, stored ciphertext) so callers can compare-and-swap.
    fn sealed_get(&mut self, name: &str) -> Result<Option<(Vec<u8>, Vec<u8>)>, String>;
    /// Insert only if absent. `Ok(false)` when a record already exists.
    fn sealed_insert(&mut self, name: &str, value: &[u8]) -> Result<bool, String>;
    /// Replace only if the stored ciphertext is still `expected`. `Ok(false)` when it moved.
    fn sealed_replace(&mut self, name: &str, expected: &[u8], value: &[u8]) -> Result<bool, String>;

    /// Unencrypted, world-readable project storage (for The Reveal).
    fn public_set(&mut self, key: &str, value: &[u8]) -> Result<(), String>;

    /// Fresh randomness for ephemeral keys and nonces.
    fn entropy(&mut self) -> [u8; 56];
    fn env(&self, key: &str) -> Option<String>;
    /// HTTPS POST with a JSON body, returning the response body.
    fn http_post(&mut self, url: &str, headers: &[(&str, &str)], body: &str, timeout_ms: u64)
        -> Result<String, String>;
    /// Milliseconds since some fixed point, for time budgets only (never for game logic).
    fn now_ms(&self) -> u64;
}
