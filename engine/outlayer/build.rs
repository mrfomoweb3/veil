//! Writes the OutLayer manifest into OUT_DIR. It is embedded in the wasm's
//! `outlayer.manifest` custom section, so it is covered by the version's sha256.
//!
//! VEIL_CONTRACT set   → production build: only that contract may run this engine.
//! VEIL_CONTRACT unset → development build: open doors, for scripts and testing.
fn main() {
    println!("cargo:rerun-if-env-changed=VEIL_CONTRACT");
    let callers = match std::env::var("VEIL_CONTRACT").ok().filter(|c| !c.is_empty()) {
        Some(c) => {
            assert!(
                c.chars().all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || "-_.".contains(ch)),
                "VEIL_CONTRACT must be a NEAR account id"
            );
            format!(",\n  \"callers\": {{ \"contract\": {{ \"only\": [\"{c}\"] }} }}")
        }
        None => String::new(),
    };
    let manifest = format!(
        r#"{{
  "storage_account": "predecessor",
  "encryption_keys": [
    {{ "path": "state", "caller": "predecessor", "bind": "wasm" }},
    {{ "path": "orders", "caller": "predecessor", "bind": "wasm" }}
  ],
  "capabilities": {{ "network": ["cloud-api.near.ai"] }},
  "author_secrets": {{ "profile": "prod" }}{callers}
}}
"#
    );
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("manifest.json");
    std::fs::write(out, manifest).unwrap();
}
