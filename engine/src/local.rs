//! A local stand-in for the OutLayer host, with the same semantics where they matter:
//! records are sealed under a key bound to the predecessor account, stored under a MAC of
//! their name, compared byte-for-byte on CAS; VRF alphas look like OutLayer's
//! (`vrf:{request_id}:{sender}:{seed}`) and verify with ed25519. It is NOT a TEE: the master
//! key sits in a file. Use it for development and tests only.

use crate::host::{Host, Vrf};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use ed25519_dalek::{Signer, SigningKey};
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::Instant;

type HmacSha256 = Hmac<Sha256>;

pub struct LocalHost {
    dir: PathBuf,
    master: [u8; 32],
    predecessor: String,
    sender: String,
    request_id: String,
    vrf_calls: u32,
    started: Instant,
}

fn hmac(key: &[u8], parts: &[&[u8]]) -> [u8; 32] {
    let mut m = <HmacSha256 as Mac>::new_from_slice(key).expect("any key length");
    for p in parts {
        m.update(p);
    }
    m.finalize().into_bytes().into()
}

impl LocalHost {
    /// Open (or create) a local host rooted at `dir`. Caller identity comes from the usual
    /// OutLayer environment variables.
    pub fn open(dir: &Path) -> Result<LocalHost, String> {
        let env = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
        let predecessor = env("NEAR_PREDECESSOR_ID").ok_or("NEAR_PREDECESSOR_ID is required")?;
        let sender = env("NEAR_SENDER_ID").unwrap_or_else(|| predecessor.clone());
        let request_id = env("NEAR_REQUEST_ID").unwrap_or_else(|| "0".into());
        Self::new(dir, &predecessor, &sender, &request_id)
    }

    /// Explicit caller identity (tests, embedding).
    pub fn new(dir: &Path, predecessor: &str, sender: &str, request_id: &str) -> Result<LocalHost, String> {
        std::fs::create_dir_all(dir.join("public")).map_err(|e| e.to_string())?;
        let key_path = dir.join("master.key");
        let master = match std::fs::read(&key_path) {
            Ok(b) if b.len() == 32 => b.try_into().unwrap(),
            _ => {
                let mut k = [0u8; 32];
                getrandom::fill(&mut k).map_err(|e| e.to_string())?;
                std::fs::write(&key_path, k).map_err(|e| e.to_string())?;
                k
            }
        };
        Ok(LocalHost {
            dir: dir.to_path_buf(),
            master,
            sender: sender.to_string(),
            request_id: request_id.to_string(),
            predecessor: predecessor.to_string(),
            vrf_calls: 0,
            started: Instant::now(),
        })
    }

    pub fn vrf_public_key(dir: &Path) -> Result<String, String> {
        let master: [u8; 32] = std::fs::read(dir.join("master.key"))
            .map_err(|e| e.to_string())?
            .try_into()
            .map_err(|_| "bad master key")?;
        Ok(hex::encode(Self::vrf_key(&master).verifying_key().to_bytes()))
    }

    fn vrf_key(master: &[u8; 32]) -> SigningKey {
        SigningKey::from_bytes(&hmac(master, &[b"vrf-key"]))
    }

    /// The encryption key at `path`, bound to the predecessor (`caller: "predecessor"`).
    fn enc_key(&self, path: &str) -> [u8; 32] {
        hmac(&self.master, &[b"encryption-key:v1:predecessor:", self.predecessor.as_bytes(), b":", path.as_bytes()])
    }

    fn cell(&self) -> PathBuf {
        self.dir.join("storage").join(hex::encode(Sha256::digest(self.predecessor.as_bytes())))
    }

    fn record_path(&self, name: &str) -> PathBuf {
        let key = hmac(&self.enc_key("state"), &[b"mac:", name.as_bytes()]);
        self.cell().join(hex::encode(key))
    }

    fn seal(&self, name: &str, value: &[u8]) -> Vec<u8> {
        let mut nonce = [0u8; 24];
        getrandom::fill(&mut nonce).expect("os randomness");
        let key = self.enc_key("state");
        let ct = XChaCha20Poly1305::new((&key).into())
            .encrypt(XNonce::from_slice(&nonce), Payload { msg: value, aad: name.as_bytes() })
            .expect("encrypt");
        let mut out = vec![0x01];
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&ct);
        out
    }

    fn unseal(&self, name: &str, stored: &[u8]) -> Result<Vec<u8>, String> {
        if stored.len() < 41 || stored[0] != 0x01 {
            return Err("decryption failed".into());
        }
        let key = self.enc_key("state");
        XChaCha20Poly1305::new((&key).into())
            .decrypt(XNonce::from_slice(&stored[1..25]), Payload { msg: &stored[25..], aad: name.as_bytes() })
            .map_err(|_| "decryption failed".to_string())
    }

    fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
        std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
        let tmp = path.with_extension("tmp");
        std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, path).map_err(|e| e.to_string())
    }
}

impl Host for LocalHost {
    fn vrf(&mut self, seed: &str) -> Result<Vrf, String> {
        if seed.contains(':') {
            return Err("vrf seed must not contain ':'".into());
        }
        self.vrf_calls += 1;
        if self.vrf_calls > 10 {
            return Err("at most 10 VRF calls per execution".into());
        }
        let alpha = format!("vrf:{}:{}:{}", self.request_id, self.sender, seed);
        let sig = Self::vrf_key(&self.master).sign(alpha.as_bytes()).to_bytes();
        Ok(Vrf { output_hex: hex::encode(Sha256::digest(sig)), signature_hex: hex::encode(sig), alpha })
    }

    fn mac(&mut self, path: &str, data: &[u8]) -> Result<Vec<u8>, String> {
        Ok(hmac(&hmac(&self.enc_key(path), &[b"mac-subkey"]), &[data]).to_vec())
    }

    fn sealed_get(&mut self, name: &str) -> Result<Option<(Vec<u8>, Vec<u8>)>, String> {
        match std::fs::read(self.record_path(name)) {
            Ok(stored) => Ok(Some((self.unseal(name, &stored)?, stored))),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    fn sealed_insert(&mut self, name: &str, value: &[u8]) -> Result<bool, String> {
        let path = self.record_path(name);
        if path.exists() {
            return Ok(false);
        }
        Self::write_atomic(&path, &self.seal(name, value))?;
        Ok(true)
    }

    fn sealed_replace(&mut self, name: &str, expected: &[u8], value: &[u8]) -> Result<bool, String> {
        let path = self.record_path(name);
        match std::fs::read(&path) {
            Ok(cur) if cur == expected => {
                Self::write_atomic(&path, &self.seal(name, value))?;
                Ok(true)
            }
            _ => Ok(false),
        }
    }

    fn public_set(&mut self, key: &str, value: &[u8]) -> Result<(), String> {
        if key.contains('/') || key.contains("..") {
            return Err("bad public key".into());
        }
        Self::write_atomic(&self.dir.join("public").join(key), value)
    }

    fn entropy(&mut self) -> [u8; 56] {
        let mut b = [0u8; 56];
        getrandom::fill(&mut b).expect("os randomness");
        b
    }

    fn env(&self, key: &str) -> Option<String> {
        std::env::var(key).ok()
    }

    fn http_post(&mut self, url: &str, headers: &[(&str, &str)], body: &str, timeout_ms: u64) -> Result<String, String> {
        use std::io::Write;
        use std::process::{Command, Stdio};
        let mut cmd = Command::new("curl");
        cmd.args(["-sS", "--fail", "-X", "POST", "--data-binary", "@-", "-m"])
            .arg(format!("{:.1}", timeout_ms as f64 / 1000.0))
            .arg(url);
        for (k, v) in headers {
            cmd.arg("-H").arg(format!("{k}: {v}"));
        }
        let mut child = cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;
        child.stdin.take().unwrap().write_all(body.as_bytes()).map_err(|e| e.to_string())?;
        let out = child.wait_with_output().map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).into_owned());
        }
        String::from_utf8(out.stdout).map_err(|e| e.to_string())
    }

    fn now_ms(&self) -> u64 {
        self.started.elapsed().as_millis() as u64
    }
}
