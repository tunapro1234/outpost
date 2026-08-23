import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BUSY, IDLE, UNKNOWN, createBusyProbe } from "../agent-busy.mjs";

const LIB = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(LIB, "..", "..");

function execReturning(stdout) {
  return async () => ({ stdout });
}

test("sonda bp çıktısındaki working durumunu meşgul, diğerlerini boşta sayar", async () => {
  const stdout = JSON.stringify({
    agents: [
      { name: "calisan", status: "working" },
      { name: "bosta", status: "idle" },
      { name: "kapali", status: "closed" },
    ],
  });
  const probe = createBusyProbe({ exec: execReturning(stdout) });

  assert.equal((await probe("calisan")).state, BUSY);
  assert.equal((await probe("bosta")).state, IDLE);
  assert.equal((await probe("kapali")).state, IDLE);
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
