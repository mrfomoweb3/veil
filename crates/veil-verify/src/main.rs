//! `veil-verify` — check a finished VEIL match yourself.
//!
//! ```text
//! veil-verify --file reveal.json [--vrf-pubkey HEX] [--chain chain.json]
//! veil-verify --local-dir devnet/data/engine --match 3 [--vrf-pubkey HEX]
//! veil-verify --api https://api.outlayer.ai --project you.near/veil-engine --match 3 --vrf-pubkey HEX
//! ```
//! `chain.json` is `{"turns": [ChainTurn…], "orders": [ChainOrders…]}` as read from the contract
//! (`get_history`, `get_orders`); `scripts/fetch-chain.mjs` writes it.

use serde::Deserialize;
use std::process::ExitCode;
use veil_engine::records::RevealDoc;
use veil_verify::{verify, ChainOrders, ChainTurn};

#[derive(Deserialize, Default)]
struct Chain {
    #[serde(default)]
    turns: Option<Vec<ChainTurn>>,
    #[serde(default)]
    orders: Vec<ChainOrders>,
}

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
}

fn curl(url: &str) -> Result<Vec<u8>, String> {
    let out = std::process::Command::new("curl").args(["-sSL", "--fail", url]).output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("GET {url}: {}", String::from_utf8_lossy(&out.stderr)));
    }
    Ok(out.stdout)
}

/// Public storage values may come back wrapped (`{"value": base64}`) or raw.
fn unwrap_public(bytes: Vec<u8>) -> Vec<u8> {
    use base64::Engine;
    if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&bytes) {
        if let Some(s) = v.get("value").and_then(|x| x.as_str()) {
            if let Ok(b) = base64::engine::general_purpose::STANDARD.decode(s) {
                return b;
            }
            return s.as_bytes().to_vec();
        }
    }
    bytes
}

fn load(args: &[String]) -> Result<Vec<u8>, String> {
    if let Some(f) = arg(args, "--file") {
        return std::fs::read(&f).map_err(|e| format!("{f}: {e}"));
    }
    let id = arg(args, "--match").ok_or("--match is required")?;
    let get: Box<dyn Fn(&str) -> Result<Vec<u8>, String>> = if let Some(dir) = arg(args, "--local-dir") {
        Box::new(move |k: &str| std::fs::read(format!("{dir}/public/{k}")).map_err(|e| format!("{k}: {e}")))
    } else {
        let api = arg(args, "--api").ok_or("give --file, --local-dir or --api")?;
        let project = arg(args, "--project").ok_or("--project is required with --api")?;
        Box::new(move |k: &str| curl(&format!("{api}/public/storage/get?project={project}&key={k}")).map(unwrap_public))
    };
    let index: serde_json::Value =
        serde_json::from_slice(&get(&format!("reveal:{id}"))?).map_err(|e| format!("reveal index: {e}"))?;
    let chunks = index["chunks"].as_u64().ok_or("reveal index has no chunk count")?;
    let mut bytes = Vec::new();
    for k in 0..chunks {
        bytes.extend(get(&format!("reveal:{id}:{k}"))?);
    }
    let hash = veil_crypto::sha256_hex(&bytes);
    if Some(hash.as_str()) != index["hash"].as_str() {
        return Err("reveal chunks do not hash to the published hash".into());
    }
    if let Some(expected) = arg(args, "--hash") {
        if expected != hash {
            return Err(format!("reveal hash {hash} differs from the on-chain hash {expected}"));
        }
    }
    Ok(bytes)
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let bytes = match load(&args) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("error: {e}");
            return ExitCode::from(2);
        }
    };
    let doc: RevealDoc = match serde_json::from_slice(&bytes) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("error: not a reveal document: {e}");
            return ExitCode::from(2);
        }
    };
    let pk: Option<[u8; 32]> = arg(&args, "--vrf-pubkey").and_then(|h| hex::decode(h).ok()).and_then(|b| b.try_into().ok());
    let chain: Chain = arg(&args, "--chain")
        .map(|f| serde_json::from_slice(&std::fs::read(f).expect("chain file")).expect("chain json"))
        .unwrap_or_default();
    let report = verify(&doc, pk.as_ref(), chain.turns.as_deref(), &chain.orders);
    println!("match {}: {} turns re-run, {} on-chain order ciphertexts checked", report.match_id, report.turns_checked, report.ciphertexts_checked);
    if pk.is_none() {
        println!("note: no --vrf-pubkey given; VRF signatures were not checked");
    }
    if report.ok() {
        println!("all {} turns verified", report.turns_checked);
        ExitCode::SUCCESS
    } else {
        for e in &report.errors {
            println!("FAIL: {e}");
        }
        ExitCode::FAILURE
    }
}
