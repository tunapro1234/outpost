import { promises as fs } from "node:fs";
import path from "node:path";
import { parseMarkdown, serializeMarkdown } from "../../lib/vault.mjs";

export const EMPTY_CALIBRATION = `# Mail kalibrasyonu

Bu dosyada tercih edilen ton, hitap, uzunluk, kaçınılacak kalıplar ve iyi örnekler tutulur.
Aşağıdaki taban bölümler varsayılandır. Kullanıcı geri bildirimleri bunların üstüne eklenir
ve çelişkide kullanıcı kuralı kazanır.

## Taban: karşındaki insan için yaz (Carnegie ilkesi)
- Her cümleyi alıcının dünyasından kur. Konu onun işi, onun öğrencisi, onun sorunu. Biz değil.
- Ona gerçekten yarayacak bir şey sun ya da onun işini merak et. Kendini anlatmak mail sebebi değildir.
- Kimlik cümlesi tek satırdır, gerisi alıcı hakkındadır. "Siz" dili "biz" dilinden fazla olsun.
- Samimi ilgi göster, pohpohlama. Onun yaptığı işe dair somut ve doğrulanmış bir gözlem,
  genel övgüden yüz kat değerlidir.
- Bir şey isteyeceksen önce onun ne kazanacağı belli olsun. Kazanımı olmayan istek yazılmaz.

## Taban: cold outreach disiplini (araştırma damıtımı)
- Kısa tut. Hedef 80 kelime, tavan 120. Mobilde kaydırmadan bitmeli.
- Tek konu, tek soru, tek CTA. Seçenek yağmuru yok.
- İlk temasta zaman isteme baskısı düşük olsun. Görüşme ricası kısa ve reddi kolay olmalı.
- Kişiselleştirme gerçek bir iş sinyalinden gelir. Hobi, okul, sosyal medya detayı kullanılmaz.
- Konu satırı kısa ve somut. Alıcının kurumuna veya işine dokunur, pazarlama kokmaz.
- Doğrulanmamış hiçbir iddia yazılmaz. Emin değilsen o cümleyi sil.

## Taban: noktalama
- Em dash ve en dash yasak. Noktalı virgül yasak. Ayırmak gerekiyorsa cümleyi böl ya da virgül kullan.
- Ünlem yok, emoji yok, üç nokta süsü yok. Sade noktalama: nokta, virgül, soru işareti,
  gerektiğinde iki nokta.
`;

function calibrationPath(workspace, user) {
  return path.join(workspace.directory, "mails", "calibration", `${user}.md`);
}

export async function readCalibration(workspace, user) {
  try {
    const parsed = parseMarkdown(
      await fs.readFile(calibrationPath(workspace, user), "utf8"),
      `${user}.md`,
    );
    return {
      content: parsed.body,
      calibrated_at: typeof parsed.meta.calibrated_at === "string"
        ? parsed.meta.calibrated_at
        : null,
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { content: EMPTY_CALIBRATION, calibrated_at: null };
    }
    throw error;
  }
}

export async function readCalibrationSource(workspace, user) {
  try {
    return await fs.readFile(calibrationPath(workspace, user), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return serializeMarkdown(EMPTY_CALIBRATION, { calibrated_at: null });
    throw error;
  }
}

export async function writeCalibration(workspace, user, content, {
  now = () => new Date(),
} = {}) {
  if (typeof content !== "string") {
    const error = new Error("content metin olmalı");
    error.statusCode = 400;
    throw error;
  }
  const parsed = parseMarkdown(content, `${user}.md`);
  const calibratedAt = now().toISOString();
  const filePath = calibrationPath(workspace, user);
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, serializeMarkdown(parsed.body, {
    ...parsed.meta,
    calibrated_at: calibratedAt,
  }), { encoding: "utf8", mode: 0o600 });
  return { content: parsed.body, calibrated_at: calibratedAt };
}

export async function stampCalibration(workspace, user, options = {}) {
  return writeCalibration(workspace, user, await readCalibrationSource(workspace, user), options);
}

export function isDraftStale(draft, calibratedAt) {
  if (!draft?.created_at || !draft?.author || !calibratedAt) return false;
  const created = Date.parse(draft.created_at);
  const calibrated = Date.parse(calibratedAt);
  return Number.isFinite(created) && Number.isFinite(calibrated) && created < calibrated;
}
