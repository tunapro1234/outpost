// Agent meşguliyet tespiti — TEK KAPI.
//
// ⛔ Ekrandan desen arama YOK.
//
// Gerekçe (23 Ağu 2026): burası eskiden pane çıktısında "esc to interrupt"
// ifadesini arıyordu. O ifade Claude Code 2.1.233'te KALKTI ve Hermes'te hiç
// olmadı. Sonuç: kontrol her zaman "boşta" dedi, yani köprü çalışan agent'ın
// üstüne yazabilir hale geldi — hem de sessizce. Üç bağımsız ölçüm aynı yöne
// çıktı (blueprint 15 Ağu; op-main kendi meşgul pane'i; probot-outreach
// probot-studio'nun meşgul pane'i).
//
// Ders: TUI çıktısı bir SÜRÜM DETAYIDIR, sözleşme değil. Kendi desenini
// gömersen arayüz her değiştiğinde sessizce yanılırsın ve testin bunu
// yakalayamaz. bp üç TUI'yi birden bilir (Claude spinner, Codex, Hermes
// msg=interrupt) ve imza değişirse tek yerde güncellenir.
//
// Bedeli bilinçli kabul edildi: bu, köprüye bp bağımlılığı ekler. Ölçemediğimiz
// durumda MEŞGUL sayıyoruz (fail-closed) — yanlış beklemek ucuz, çalışan
// agent'ın üstüne yazmak pahalı. Ölçememe hali UNKNOWN olarak AYRI raporlanır;
// sessizce "meşgul" demek arızayı maskeler.

export const BUSY = "busy";
export const IDLE = "idle";
export const UNKNOWN = "unknown";

const DEFAULT_COMMAND = process.env.OUTPOST_BP_BIN || "bp";

/**
 * @returns {(session: string) => Promise<{state: string, reason: string}>}
 */
export function createBusyProbe({
  exec,
  command = DEFAULT_COMMAND,
  args = ["status", "--json"],
} = {}) {
  if (typeof exec !== "function") throw new Error("Meşguliyet sondası için exec zorunlu");

  return async function probeBusy(session) {
    let stdout;
    try {
      ({ stdout } = await exec(command, args));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { state: UNKNOWN, reason: `${command} çalıştırılamadı: ${detail}` };
    }

    let data;
    try {
      data = JSON.parse(String(stdout ?? ""));
    } catch {
      return { state: UNKNOWN, reason: `${command} çıktısı JSON olarak çözülemedi` };
    }

    const agents = Array.isArray(data?.agents) ? data.agents : null;
    if (!agents) return { state: UNKNOWN, reason: `${command} çıktısında agents listesi yok` };

    const agent = agents.find((entry) => entry?.name === session);
    if (!agent) return { state: UNKNOWN, reason: `${command} '${session}' oturumunu tanımıyor` };

    return {
      state: agent.status === "working" ? BUSY : IDLE,
      reason: `${command}: ${agent.status}`,
    };
  };
}
