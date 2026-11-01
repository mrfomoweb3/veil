.PHONY: test dev engine contract web-wasm simulate web

test:            ## every test: rules, crypto, engine e2e, verifier, contract, client, relayer
	cargo test --release
	cd contracts/veil && cargo test
	cd web && npx vitest run
	cd relayer && npm test

dev:             ## local Practice: devnet + web on http://localhost:5173
	scripts/dev.sh

engine:          ## OutLayer engine (VEIL_CONTRACT=… for a production build)
	scripts/build-engine.sh

contract:
	scripts/build-contract.sh

web-wasm:
	scripts/build-web-wasm.sh

simulate:        ## headless match against a running devnet, then veil-verify
	node scripts/simulate.mjs

web:
	cd web && npm run build
