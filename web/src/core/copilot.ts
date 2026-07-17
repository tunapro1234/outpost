// Copilot gating — the owner-only workspace assistant. Streaming and
// persistence now live in the shared chat engine (@/core/chat); this module
// keeps only the per-viewer gate and the suggestion chips.
import { workspaceBase } from "./api";
const MOCK = import.meta.env.VITE_MOCK === "1";

// Returns true only when the server says this viewer is allowed. Any failure
// (offline, 404, mock) degrades to "hidden" so non-owners never see the entry.
export async function copilotEnabled(): Promise<boolean> {
  if (MOCK) return false;
  try {
    const res = await fetch(`${workspaceBase()}/copilot/enabled`);
    if (!res.ok) return false;
    const body = (await res.json()) as { enabled?: boolean };
    return !!body?.enabled;
  } catch {
    return false;
  }
}

export const COPILOT_SUGGESTIONS: string[] = [
  "How many companies have no email?",
  "Summarize this workspace",
  "Who replied recently?",
];
