// Viewer identity helpers. The owner flag gates override actions (e.g.
// re-including an excluded company). Cached across the session so the many
// surfaces that need it share a single profile fetch. Degrades to non-owner on
// any failure so restricted controls stay disabled by default.
import { api } from "./api";

let ownerCache: Promise<boolean> | null = null;

export function isOwner(): Promise<boolean> {
  if (!ownerCache) {
    ownerCache = api
      .profile()
      .then((p) => p?.role === "owner")
      .catch(() => false);
  }
  return ownerCache;
}
