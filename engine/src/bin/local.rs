//! `veil-engine-local`: the engine with an emulated OutLayer host.
//!
//! ```text
//! NEAR_PREDECESSOR_ID=veil.local NEAR_REQUEST_ID=1 veil-engine-local run   < request.json
//! veil-engine-local vrf-pubkey
//! ```
//! `VEIL_LOCAL_DIR` (default `./.veil-local`) holds the master key and storage.

use std::io::Read;
use std::path::PathBuf;
use veil_engine::local::LocalHost;

fn main() {
    let dir = PathBuf::from(std::env::var("VEIL_LOCAL_DIR").unwrap_or_else(|_| ".veil-local".into()));
    let cmd = std::env::args().nth(1).unwrap_or_else(|| "run".into());
    match cmd.as_str() {
        "vrf-pubkey" => {
            if let Err(e) = std::fs::create_dir_all(&dir) {
                eprintln!("{e}");
                std::process::exit(1);
            }
            // Opening creates the master key on first use.
            std::env::set_var("NEAR_PREDECESSOR_ID", "pubkey");
            if let Err(e) = LocalHost::open(&dir) {
                eprintln!("{e}");
                std::process::exit(1);
            }
            println!("{}", LocalHost::vrf_public_key(&dir).unwrap());
        }
        "run" => {
            let mut input = Vec::new();
            std::io::stdin().read_to_end(&mut input).expect("stdin");
            let out = match LocalHost::open(&dir) {
                Ok(mut host) => veil_engine::run(&mut host, &input),
                Err(e) => serde_json::json!({ "ok": false, "error": e }),
            };
            println!("{out}");
        }
        other => {
            eprintln!("unknown command {other}; use `run` or `vrf-pubkey`");
            std::process::exit(2);
        }
    }
}
