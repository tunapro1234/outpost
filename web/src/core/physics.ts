export interface Physics {
  charge: number; // Repel force — itme büyüklüğü (applied as -charge, derece-ölçekli)
  linkDistance: number; // Link distance — bağ hedef mesafesi (taban)
  linkForce: number; // Link force — bağ çekim çarpanı (0-1, Obsidian paritesi)
  gravity: number; // Center force — merkeze çekim (x/y kuvveti)
  collide: number; // collision radius multiplier
  velocityDecay: number;
  frozen: boolean;
}

export const DEFAULT_PHYSICS: Physics = {
  charge: 300,
  linkDistance: 96,
  linkForce: 1,
  gravity: 0.05,
  collide: 1,
  velocityDecay: 0.3,
  frozen: false,
};

// v3: linkForce eklendi (Obsidian Forces paritesi)
const LS = "outpost.physics.v3";
const LS_LEGACY = "outpost.physics.v2";

export function loadPhysics(): Physics {
  try {
    const raw = localStorage.getItem(LS) ?? localStorage.getItem(LS_LEGACY);
    if (raw) return { ...DEFAULT_PHYSICS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_PHYSICS };
}

export function savePhysics(p: Physics): void {
  try {
    localStorage.setItem(LS, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
