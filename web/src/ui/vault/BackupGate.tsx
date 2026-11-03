// Forced backup after the first deposit: the note secrets live only in this browser until
// the player saves the (encrypted) backup file. The dialog won't close until they do, or
// explicitly accept that they can lose the money.
import { useState } from 'react';
import type { Backup, NoteVault } from '../../privacy/noteVault';

export function downloadBackup(b: Backup) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(b, null, 1)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'veil-vault-backup.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function BackupGate({ vault, onClose }: { vault: NoteVault; onClose: () => void }) {
  const [saved, setSaved] = useState(false);
  const [accept, setAccept] = useState(false);
  return (
    <div className="modal">
      <div className="panel sheet">
        <h2>Back up your vault now</h2>
        <p>Your private balance is unlocked by notes stored in this browser. If you clear it or lose this device without a backup, <b>the money is gone for good</b>. Nobody, including us and Gloam, can recover it.</p>
        <p className="muted small">The backup file is encrypted. Only your NEAR account can open it, on any device, by signing the same message again.</p>
        <div className="cta">
          <button className="primary" onClick={async () => { downloadBackup(await vault.exportBackup()); setSaved(true); }}>Download veil-vault-backup.json</button>
        </div>
        <label className="row small"><input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} /> I understand I can lose this money without a backup.</label>
        <div className="cta">
          <button className="ghost" disabled={!saved && !accept} onClick={onClose}>{saved ? 'Done' : 'Continue without a backup'}</button>
        </div>
      </div>
    </div>
  );
}
