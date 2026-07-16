export interface Physics {
  charge: number; // repulsion magnitude (applied as -charge)
  linkDistance: number;
  gravity: number; // centering strength (x/y force)
  collide: number; // collision radius multiplier
  velocityDecay: number;
  frozen: boolean;
}

export const DEFAULT_PHYSICS: Physics = {
  charge: 300,
  linkDistance: 96,
  gravity: 0.05,
  collide: 1,
  velocityDecay: 0.28,
  frozen: false,
};

const LS = "outpost.physics.v2";

export function loadPhysics(): Physics {
  try {
    const raw = localStorage.getItem(LS);
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
