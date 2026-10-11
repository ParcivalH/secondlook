// The user's setup (Figma section 1): which Safe to protect and who the guardian is.
// Saved in this browser only (localStorage). Browser-only module.
export type Profile = {
  safeAddress: string;
  ownerAddress: string; // the owner's software wallet (MetaMask)
  ownerName: string;
  guardianAddress: string; // the other owner of the 2-of-2 Safe (Ledger)
  guardianName: string;
};

const KEY = "secondlook.profile";

export function loadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}

export function saveProfile(p: Profile) {
  localStorage.setItem(KEY, JSON.stringify(p));
}

export function clearProfile() {
  localStorage.removeItem(KEY);
}
