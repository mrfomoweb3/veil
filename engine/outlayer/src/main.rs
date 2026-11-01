//! The VEIL engine inside OutLayer: the real host functions behind `veil_engine::host::Host`.

use outlayer::{encryption_keys, storage, vrf};
use std::io::{Read, Write};
use std::time::{Duration, Instant};
use veil_engine::host::{Host, Vrf};

/// The manifest, embedded in a custom section so the wasm hash covers it.
#[used]
#[link_section = "outlayer.manifest"]
static OUTLAYER_MANIFEST: [u8; include_bytes!(concat!(env!("OUT_DIR"), "/manifest.json")).len()] =
    *include_bytes!(concat!(env!("OUT_DIR"), "/manifest.json"));

/// Every sealed record uses this encryption key (declared in the manifest).
const STATE: &str = "state";

struct OutLayerHost {
    started: Instant,
}

impl Host for OutLayerHost {
    fn vrf(&mut self, seed: &str) -> Result<Vrf, String> {
        let v = vrf::random(seed)?;
        Ok(Vrf { output_hex: v.output_hex, signature_hex: v.signature_hex, alpha: v.alpha })
    }

    fn mac(&mut self, path: &str, data: &[u8]) -> Result<Vec<u8>, String> {
        encryption_keys::mac(path, None, data).map_err(|e| e.to_string())
    }

    fn sealed_get(&mut self, name: &str) -> Result<Option<(Vec<u8>, Vec<u8>)>, String> {
        let rec = storage::sealed::get(STATE, None, name).map_err(|e| e.to_string())?;
        Ok(rec.map(|s| {
            let stored = s.stored_bytes().to_vec();
            (s.into_plaintext(), stored)
        }))
    }

    fn sealed_insert(&mut self, name: &str, value: &[u8]) -> Result<bool, String> {
        storage::sealed::set_if_absent(STATE, None, name, value).map_err(|e| e.to_string())
    }

    fn sealed_replace(&mut self, name: &str, expected: &[u8], value: &[u8]) -> Result<bool, String> {
        // The sealed recipe by hand, so the compare is on the exact bytes we read:
        // key = mac(name), value = encrypt(value, aad = name), compared raw.
        let key = storage::sealed::storage_key(STATE, None, name).map_err(|e| e.to_string())?;
        let sealed = encryption_keys::encrypt(STATE, None, value, name.as_bytes()).map_err(|e| e.to_string())?;
        let (ok, _) = storage::set_if_equals_raw(&key, expected, &sealed).map_err(|e| e.to_string())?;
        Ok(ok)
    }

    fn public_set(&mut self, key: &str, value: &[u8]) -> Result<(), String> {
        storage::set_worker_with_options(key, value, Some(false)).map_err(|e| e.to_string())
    }

    fn entropy(&mut self) -> [u8; 56] {
        let mut b = [0u8; 56];
        getrandom::fill(&mut b).expect("wasi random");
        b
    }

    fn env(&self, key: &str) -> Option<String> {
        std::env::var(key).ok()
    }

    fn http_post(&mut self, url: &str, headers: &[(&str, &str)], body: &str, timeout_ms: u64) -> Result<String, String> {
        let mut req = wasi_http_client::Client::new()
            .post(url)
            .connect_timeout(Duration::from_millis(timeout_ms))
            .body(body.as_bytes());
        for (k, v) in headers {
            req = req.header(*k, *v);
        }
        let resp = req.send().map_err(|e| e.to_string())?;
        if resp.status() >= 300 {
            return Err(format!("http {}", resp.status()));
        }
        String::from_utf8(resp.body().map_err(|e| e.to_string())?).map_err(|e| e.to_string())
    }

    fn now_ms(&self) -> u64 {
        self.started.elapsed().as_millis() as u64
    }
}

fn main() {
    let mut input = Vec::new();
    std::io::stdin().read_to_end(&mut input).expect("stdin");
    let mut host = OutLayerHost { started: Instant::now() };
    let out = veil_engine::run(&mut host, &input);
    std::io::stdout().write_all(out.to_string().as_bytes()).expect("stdout");
}
