// "What stays private": the honest model, in plain words. Kept in step with the README.
export function PrivacyModel({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel sheet">
        <button className="ghost close" onClick={onClose}>×</button>
        <h2>What stays private</h2>
        <p><b>Your winnings arrive in public, then disappear. Where they go after that is yours alone.</b></p>
        <h3>Public</h3>
        <ul>
          <li>The transfer from NEAR to Base, and the Base address it lands in.</li>
          <li>That this Base address belongs to your NEAR account. It is derived from your account name with NEAR Chain Signatures, so anyone can work it out.</li>
          <li>That this address deposited into Gloam, and how much. The amount is a public input to the deposit.</li>
        </ul>
        <h3>Private after the deposit</h3>
        <ul>
          <li>Where the money goes next. A cash-out shows a zero-knowledge proof and a one-time tag, not which deposit it came from.</li>
          <li>Who sends the cash-out. Gloam's relay submits it, so your address isn't on it. The proof fixes the recipient, so the relay can't redirect it.</li>
        </ul>
        <h3>What you can do to help</h3>
        <ul>
          <li>Cash out to a fresh address, and wait a while after depositing. A $7.31 deposit followed a minute later by a $7.31 cash-out is easy to match up.</li>
          <li>Keep your backup file safe. It is encrypted to your NEAR account, but it is the only copy of your notes.</li>
        </ul>
        <p className="muted small">Built on the Gloam SDK (@gloamtrade/sdk): Groth16 proofs, Poseidon notes, keys from a 13-person ceremony.</p>
      </div>
    </div>
  );
}
