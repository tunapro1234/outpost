import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { BUSY, IDLE, UNKNOWN, createBusyProbe } from "../agent-busy.mjs";

const execFileAsync = promisify(execFile);

const LIB = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(LIB, "..", "..");

function execReturning(stdout) {
  return async () => ({ stdout });
}

// ⚠️ Alan adları sezgiye ters: meşguliyet `tmux` alanında, `status` yaşam
// döngüsüdür. İlk yazımda yanlış alan okundu ve sonda herkese "boşta" dedi;
// bu fikstür o hatayı tekrarlamasın diye gerçek şemaya göre yazıldı — ve
// aşağıdaki entegrasyon vakası fikstürün gerçekten doğru olduğunu denetler.
test("sonda meşguliyeti tmux alanından okur, status alanından DEĞİL", async () => {
  const stdout = JSON.stringify({
    agents: [
      { name: "calisan", tmux: "working", status: "opening" },
      { name: "bosta", tmux: "idle", status: "open" },
      { name: "kapali", tmux: "closed", status: "closed" },
      { name: "ekran-mesgul", tmux: "idle", status: "open", busy_screen: true },
      { name: "tur-acik", tmux: "idle", status: "open", busy_turnopen: true },
    ],
  });
  const probe = createBusyProbe({ exec: execReturning(stdout) });

  assert.equal((await probe("calisan")).state, BUSY);
  assert.equal((await probe("bosta")).state, IDLE);
  assert.equal((await probe("kapali")).state, IDLE);
  // Meşgul sinyalleri birleşimle okunur: hangisi yanarsa meşgul.
  assert.equal((await probe("ekran-mesgul")).state, BUSY);
  assert.equal((await probe("tur-acik")).state, BUSY);
});

// ⭐⭐ DIŞ DÜNYA VAKASI — fikstürün doğruluğunu fikstürle değil, bp'nin KENDİSİYLE sınar.
// Varlık sebebi: yukarıdaki fikstür bir zamanlar yanlıştı (status/tmux karışmıştı) ve
// birim testler yeşil kalırken üretim fail-open çalışıyordu. Bir varsayımı yalnız
// kendi kopyasıyla sınarsan asla yanlışlayamazsın (op-main teşhisi, 23 Ağu 2026).
// bp yoksa (CI) vaka atlanır — "ölçemedim" ile "geçti" karıştırılmaz.
test("gerçek bp çıktısı sondanın beklediği şemayı taşıyor", async (t) => {
  let gercek;
  try {
    ({ stdout: gercek } = await execFileAsync("bp", ["status", "--json"]));
  } catch {
    t.skip("bp bu ortamda yok — şema dış dünyaya karşı doğrulanamadı");
    return;
  }

  const data = JSON.parse(gercek);
  assert.ok(Array.isArray(data.agents) && data.agents.length > 0, "agents listesi dolu gelmeli");

  // Meşguliyet hangi alanda? Sondanın okuduğu alan, bp'nin gerçekten doldurduğu alan olmalı.
  const tmuxDegerleri = new Set(data.agents.map((a) => a.tmux));
  const statusDegerleri = new Set(data.agents.map((a) => a.status));
  for (const deger of tmuxDegerleri) {
    assert.ok(
      ["working", "idle", "closed"].includes(deger),
      `bp tmux alanında beklenmeyen değer: ${deger} — sonda güncellenmeli`,
    );
  }
  assert.ok(
    !statusDegerleri.has("working"),
    "status alanı meşguliyet taşımıyor olmalı; taşıyorsa sondanın okuduğu alan yeniden gözden geçirilmeli",
  );

  const probe = createBusyProbe({ exec: execFileAsync });
  const ornek = data.agents[0].name;
  const sonuc = await probe(ornek);
  assert.notEqual(sonuc.state, UNKNOWN, `gerçek bp çıktısında '${ornek}' çözülemedi: ${sonuc.reason}`);

  // ⭐ Asıl keskin kontrol: bp'nin MEŞGUL dediğine sonda da meşgul demeli.
  // Yanlış alanı okuyan sürüm yukarıdaki şema kontrollerinden geçebiliyordu ama
  // buradan geçemez — çünkü meşgulü hiç göremiyordu.
  const bpMesgul = data.agents.find((a) => a.tmux === "working");
  if (bpMesgul) {
    const mesgulSonuc = await probe(bpMesgul.name);
    assert.equal(
      mesgulSonuc.state,
      BUSY,
      `bp '${bpMesgul.name}' için working diyor ama sonda '${mesgulSonuc.state}' dedi`
        + " — sonda yanlış alanı okuyor olabilir",
    );
  } else {
    t.diagnostic("şu an meşgul agent yok; meşgul yolu bu koşuda sınanmadı");
  }

  const bpBosta = data.agents.find((a) => a.tmux === "idle" && !a.busy_screen && !a.busy_turnopen);
  if (bpBosta) {
    assert.equal((await probe(bpBosta.name)).state, IDLE);
  }
});

test("sonda bp'ye doğru komutu sorar", async () => {
  const seen = [];
  const probe = createBusyProbe({
    exec: async (command, args) => {
      seen.push([command, args]);
      return { stdout: JSON.stringify({ agents: [] }) };
    },
    command: "bp",
  });
  await probe("herhangi");
  assert.deepEqual(seen, [["bp", ["status", "--json"]]]);
});

// Ölçememe halleri: hepsi UNKNOWN olmalı, "boşta" DEĞİL.
// Bu testlerin varlık sebebi 23 Ağu 2026 vakası: ölçüm başarısızlığı sessizce
// "boşta" sayılınca köprü çalışan agent'ın üstüne yazıyordu.
test("sonda ölçemediği her durumu UNKNOWN döndürür, asla boşta demez", async () => {
  const bpYok = createBusyProbe({
    exec: async () => { throw new Error("spawn bp ENOENT"); },
  });
  const bozukJson = createBusyProbe({ exec: execReturning("bu json değil") });
  const bosCikti = createBusyProbe({ exec: execReturning("") });
  const listeYok = createBusyProbe({ exec: execReturning(JSON.stringify({ hata: "yok" })) });
  const tanimiyor = createBusyProbe({
    exec: execReturning(JSON.stringify({ agents: [{ name: "baskasi", status: "idle" }] })),
  });

  for (const [ad, probe] of [
    ["bp yok", bpYok],
    ["bozuk json", bozukJson],
    ["boş çıktı", bosCikti],
    ["agents listesi yok", listeYok],
    ["oturumu tanımıyor", tanimiyor],
  ]) {
    const sonuc = await probe("hedef");
    assert.equal(sonuc.state, UNKNOWN, `${ad}: UNKNOWN bekleniyordu`);
    assert.ok(sonuc.reason, `${ad}: gerekçe yazılmalı`);
    assert.notEqual(sonuc.state, IDLE, `${ad}: ölçülemeyen durum boşta sayılamaz`);
  }
});

// ⭐ REGRESYON BEKÇİSİ — asıl ders bu.
// Sabit üretim kodunda TUTULMAZ; testin işi de o sabiti tekrar etmek değil,
// üretimde HİÇ olmadığını doğrulamak. Fikstürde taklit edilen bir varsayım
// asla yanlışlanamaz (op-main teşhisi, 23 Ağu 2026).
test("üretim kodunda TUI metnine dayalı meşguliyet tespiti kalmadı", async () => {
  const yasakli = "esc to interrupt";
  // Tek istisna: sondanın kendisi. O dosya ifadeyi KULLANMIYOR, neden
  // kullanılmadığını ANLATIYOR — kaydın kendisi silinmesin diye muaf.
  const muaf = new Set(["lib/agent-busy.mjs"]);
  const bulunanlar = [];

  async function tara(dizin) {
    const girisler = await fs.readdir(dizin, { withFileTypes: true });
    for (const giris of girisler) {
      const tam = path.join(dizin, giris.name);
      if (giris.isDirectory()) {
        if (["node_modules", "test", "test-support", ".git"].includes(giris.name)) continue;
        await tara(tam);
        continue;
      }
      if (!/\.(mjs|js|ts)$/.test(giris.name)) continue;
      const goreli = path.relative(SERVER, tam);
      if (muaf.has(goreli)) continue;
      const icerik = await fs.readFile(tam, "utf8");
      if (icerik.includes(yasakli)) bulunanlar.push(goreli);
    }
  }

  await tara(SERVER);
  assert.deepEqual(
    bulunanlar,
    [],
    `TUI metnine dayalı tespit geri gelmiş: ${bulunanlar.join(", ")}. `
      + "Meşguliyet için server/lib/agent-busy.mjs sondasını kullan.",
  );
});
