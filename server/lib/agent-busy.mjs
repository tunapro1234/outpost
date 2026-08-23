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

    // ⚠️ ALAN ADLARI SEZGİYE TERS, dikkat:
    //   agent.tmux   → etkinlik: working | idle | closed   ← meşguliyet BURADA
    //   agent.status → yaşam döngüsü: open | opening | closed | unregistered | on-demand
    // İlk yazımda `status === "working"` okunuyordu; o karşılaştırma HİÇBİR ZAMAN
    // doğru olmadığı için sonda herkese "boşta" diyordu — düzeltmeye çalıştığımız
    // fail-open'ın aynısı, yeni kılıkta. Birim testi yakalayamadı çünkü fikstür
    // bp'nin gerçek çıktısını değil varsayımı taklit ediyordu (23 Ağu 2026).
    // Bu yüzden bu dosyanın testinde GERÇEK bp çıktısına bakan bir vaka var.
    const etkin = agent.tmux;
    if (etkin !== "working" && etkin !== "idle" && etkin !== "closed") {
      return { state: UNKNOWN, reason: `${command}: tanınmayan tmux durumu '${etkin}'` };
    }

    // Meşgul sinyallerinin BİRLEŞİMİ alınır: hangisi yanarsa yansın meşgul sayılır.
    const mesgul = etkin === "working" || agent.busy_screen === true || agent.busy_turnopen === true;
    return {
      state: mesgul ? BUSY : IDLE,
      reason: `${command}: tmux=${etkin}`
        + (agent.busy_screen ? " busy_screen" : "")
        + (agent.busy_turnopen ? " busy_turnopen" : ""),
    };
  };
}

/**
 * Pane hazır mı (TUI açıldı ve kullanılabilir durumda mı).
 * "meşgul mü" ile AYNI SORU DEĞİL: bir pane meşgul olmayabilir ama henüz
 * hazır da olmayabilir (TUI açılıyor). bp bunu ayırt ediyor → ekranda '❯'
 * aramaya gerek yok. İki soru da fail-closed aynı yöne çıkar: bilmiyorsan yazma.
 */
export const READY = "ready";
export const NOT_READY = "not-ready";

export function createReadyProbe({
  exec,
  command = DEFAULT_COMMAND,
  args = ["status", "--json"],
} = {}) {
  if (typeof exec !== "function") throw new Error("Hazırlık sondası için exec zorunlu");

  return async function probeReady(session) {
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

    if (agent.status === "opening") {
      return { state: NOT_READY, reason: `${command}: status=opening (TUI açılıyor)` };
    }
    if (agent.status === "open") return { state: READY, reason: `${command}: status=open` };
    return { state: NOT_READY, reason: `${command}: status=${agent.status}` };
  };
}
