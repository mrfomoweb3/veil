// War names for players. Browser accounts are 64-hex implicit accounts, which read as noise in
// a scoreboard. Each gets a name derived from its account id, so every player sees the same name
// for the same account, with nothing to register or store. Named accounts (alice.near) keep
// their own name.
const ADJ = ['Ashen', 'Brass', 'Cinder', 'Dusk', 'Ember', 'Frost', 'Gilded', 'Hollow', 'Iron', 'Jade', 'Keen', 'Lunar', 'Mist', 'Night', 'Onyx', 'Pale',
  'Quiet', 'Rust', 'Silver', 'Storm', 'Thorn', 'Umber', 'Veiled', 'Wild', 'Amber', 'Bleak', 'Cobalt', 'Drift', 'Echo', 'Feral', 'Grey', 'High'];
const NOUN = ['Falcon', 'Wolf', 'Raven', 'Lance', 'Warden', 'Fox', 'Banner', 'Oak', 'Hawk', 'Tide', 'Bear', 'Crown', 'Viper', 'Stag', 'Owl', 'Gale',
  'Lynx', 'Spear', 'Heron', 'Ward', 'Moth', 'Bastion', 'Kite', 'Rook', 'Drake', 'Crane', 'Sparrow', 'Helm', 'Wyrm', 'Marten', 'Pike', 'Shrike'];

const IMPLICIT = /^[0-9a-f]{64}$/;

function hash(s: string) {
  // FNV-1a: stable, tiny, good enough to spread names.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export function callsign(account: string): string {
  if (!IMPLICIT.test(account)) {
    const base = account.replace(/\.(testnet|near)$/, '');
    return base.length > 22 ? `${base.slice(0, 20)}…` : base;
  }
  const h = hash(account);
  return `${ADJ[h % ADJ.length]} ${NOUN[(h >>> 8) % NOUN.length]}`;
}
