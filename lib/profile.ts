export type Profile = {
  safeAddress: string;
  ownerAddress: string; 
  ownerName: string;
  guardianAddress: string; 
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