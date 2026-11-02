// The five warlords. Each has a fixed name and personality tied to its wallet
// (`warlord-K.veil`), matching Personality::for_account in the rules.
export const WARLORDS: Record<string, { name: string; style: string }> = {
  'warlord-1.veil': { name: 'Kael the Raider', style: 'Throws everything forward; truces are dear' },
  'warlord-2.veil': { name: 'Vesk the Opportunist', style: 'Grabs shrines and weak islands; sells intel cheap' },
  'warlord-3.veil': { name: 'Admiral Orra', style: 'Fat garrisons and forts; sells peace cheaply' },
  'warlord-4.veil': { name: 'Brann the Raider', style: 'Throws everything forward; truces are dear' },
  'warlord-5.veil': { name: 'Lisk the Opportunist', style: 'Grabs shrines and weak islands; sells intel cheap' },
};

export const warlordName = (account: string) => WARLORDS[account]?.name ?? 'A warlord';
