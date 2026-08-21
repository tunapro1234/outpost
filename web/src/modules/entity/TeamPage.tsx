import { useEffect, useMemo, useState } from "react";
import type {
  AnketCevap,
  AnketKayit,
  AnketSoru,
  Entity,
  GorusmeKaydi,
  GraphNode,
  Relation,
} from "@/core/types";
import { api } from "@/core/api";
import { renderMarkdown } from "@/core/markdown";

// Telefonda konuşurken kullanılan takım ekranı (Tuna, 21 Ağu). Bilerek sade:
// ego graph yok, sekme yok, skor/mail kutusu yok. Tek sütun, belirgin
// başlıklar, hepsi aynı anda görünür — konuşma sırasında sekme aramak yok.

interface Props {
  entity: Entity;
  nodeById: Map<string, GraphNode>;
  onGoto: (id: string) => void;
}

const GORUSME_KANALLARI: Array<[string, string]> = [
  ["telefon", "Telefon"],
  ["yuzyuze", "Yüz yüze"],
  ["whatsapp", "WhatsApp"],
];

function textList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter((item) => item.trim());
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function textValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

function absolute(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function linkLabel(url: string): string {
  try {
    const parsed = new URL(absolute(url));
    const tail = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.hostname.replace(/^www\./, "")}${tail}`;
  } catch {
    return url;
  }
}

interface ResearchLink {
  url: string;
  /** nereden geldiği (site/instagram/kaynak) — okunur adres ayrıca basılır */
  label: string | null;
}

/**
 * "Daha fazla bilgi nereden çıkar" tek bakışta: frontmatter'daki kanal
 * alanları + not gövdesindeki her URL. Gövde linkleri build sırasında
 * `- site: https://…` biçiminde yazılıyor, o etiketi koruyoruz.
 */
function researchLinks(entity: Entity): ResearchLink[] {
  const found = new Map<string, string | null>();
  const add = (raw: unknown, label: string | null = null) => {
    const value = textValue(raw);
    if (!value) return;
    if (!/^(https?:\/\/|www\.|[\w-]+\.[a-z]{2,})/i.test(value)) return;
    if (value.includes("[object Object]")) return;
    const url = absolute(value.replace(/[.,;)]+$/, ""));
    if (!found.has(url)) found.set(url, label);
  };

  const meta = entity.meta;
  add(meta.website, "web sitesi");
  add(meta.site, "web sitesi");
  add(meta.sosyal, "sosyal");
  add(meta.instagram, "instagram");
  add(meta.linkedin, "linkedin");
  add(meta.source_url, "kaynak");

  for (const line of entity.body.split("\n")) {
    const labelled = line.match(/^-\s*([\p{L}_]+)\s*:\s*(https?:\/\/\S+)/u);
    if (labelled) {
      add(labelled[2], labelled[1].toLowerCase());
      continue;
    }
    for (const match of line.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) add(match[0]);
  }
  return [...found.entries()].map(([url, label]) => ({ url, label }));
}

function AnketFormu({
  takimNo,
  sorular,
  version,
  onSaved,
}: {
  takimNo: string;
  sorular: AnketSoru[];
  version: string | null;
  onSaved: () => void;
}) {
  // Açık soruların cevabı ve seçmeli soruların "diğer/not" alanı aynı sözlükte.
  const [metin, setMetin] = useState<Record<string, string>>({});
  const [secili, setSecili] = useState<Record<string, string[]>>({});
  const [cevaplayan, setCevaplayan] = useState("");
  const [not, setNot] = useState("");
  const [saving, setSaving] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  // Seçmeli cevap dosyaya METİN olarak düşer: cevap şeması düz {soru, cevap}
  // kalsın diye (anket ileride yine değişse de geçmiş okunur olur).
  const cevapMetni = (soru: AnketSoru): string => {
    const serbest = (metin[soru.id] ?? "").trim();
    if (soru.tip !== "secmeli") return serbest;
    const isaretli = secili[soru.id] ?? [];
    return [isaretli.join(", "), serbest].filter(Boolean).join(" — ");
  };

  const isaretle = (soru: AnketSoru, secenek: string) => {
    setSecili((prev) => {
      const mevcut = prev[soru.id] ?? [];
      if (!soru.coklu) {
        return { ...prev, [soru.id]: mevcut.includes(secenek) ? [] : [secenek] };
      }
      return {
        ...prev,
        [soru.id]: mevcut.includes(secenek)
          ? mevcut.filter((item) => item !== secenek)
          : [...mevcut, secenek],
      };
    });
  };

  const dolu = sorular.filter((soru) => cevapMetni(soru));

  const kaydet = async () => {
    if (!dolu.length) return;
    setSaving(true);
    setHata(null);
    try {
      const payload: { cevaplar: AnketCevap[]; cevaplayan?: string; not?: string } = {
        cevaplar: dolu.map((soru) => ({ soru: soru.soru, cevap: cevapMetni(soru) })),
      };
      if (cevaplayan.trim()) payload.cevaplayan = cevaplayan.trim();
      if (not.trim()) payload.not = not.trim();
      await api.anketKaydet(takimNo, payload);
      setMetin({});
      setSecili({});
      setNot("");
      onSaved();
    } catch (error) {
      setHata(error instanceof Error ? error.message : "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="tp-anket">
      <div className="tp-anket-head">
        <span className="tp-anket-version">{version ?? "sürüm yok"}</span>
        <span className="tp-anket-count">{dolu.length}/{sorular.length} dolu</span>
      </div>
      <ol className="tp-soru-list">
        {sorular.map((soru) => {
          const value = metin[soru.id] ?? "";
          const isaretli = secili[soru.id] ?? [];
          const cevap = cevapMetni(soru);
          const secmeli = soru.tip === "secmeli";
          // Tıkla-aç YOK: her soru ve her seçenek sayfa açılır açılmaz
          // doldurulabilir durumda. Telefonda konuşurken bir şeyi görmek için
          // önce tıklamak zorunda kalmak en pahalı hareket.
          return (
            <li className={`tp-soru${cevap ? " dolu" : ""}`} key={soru.id}>
              <div className="tp-soru-baslik">
                {soru.blok && <span className="tp-soru-blok">{soru.blok}</span>}
                <span className="tp-soru-metin">{soru.soru}</span>
                {secmeli && (
                  <span className="tp-soru-tip">
                    {soru.coklu ? "çoklu seçim" : "tek seçim"}
                  </span>
                )}
              </div>
              {secmeli && (
                <div className="tp-secenekler">
                  {soru.secenekler.map((secenek) => (
                    <button
                      key={secenek}
                      type="button"
                      className={isaretli.includes(secenek) ? "on" : ""}
                      onClick={() => isaretle(soru, secenek)}
                    >
                      {secenek}
                    </button>
                  ))}
                </div>
              )}
              {secmeli ? (
                /* v3 soruları "not kısmına yazın" diye buraya atıf yapıyor. */
                <input
                  className="tp-soru-not"
                  value={value}
                  placeholder="not"
                  onChange={(event) =>
                    setMetin((prev) => ({ ...prev, [soru.id]: event.target.value }))
                  }
                />
              ) : (
                <textarea
                  className="tp-soru-cevap"
                  value={value}
                  placeholder="Cevabı buraya yaz"
                  rows={3}
                  onChange={(event) =>
                    setMetin((prev) => ({ ...prev, [soru.id]: event.target.value }))
                  }
                />
              )}
            </li>
          );
        })}
      </ol>
      <div className="tp-anket-alt">
        <input
          className="tp-input"
          value={cevaplayan}
          placeholder="yetişkin mentör adı ya da 'takım adına'"
          onChange={(event) => setCevaplayan(event.target.value)}
        />
        <input
          className="tp-input"
          value={not}
          placeholder="not (opsiyonel)"
          onChange={(event) => setNot(event.target.value)}
        />
        <button
          className="btn primary"
          onClick={kaydet}
          disabled={saving || !dolu.length}
          type="button"
        >
          {saving ? "Kaydediliyor…" : "Anketi kaydet"}
        </button>
      </div>
      {hata && <div className="tp-hata">{hata}</div>}
    </div>
  );
}

function GorusmeFormu({
  takimNo,
  entityId,
  onSaved,
}: {
  takimNo: string;
  entityId: string;
  onSaved: () => void;
}) {
  const [ozet, setOzet] = useState("");
  const [kanal, setKanal] = useState("telefon");
  const [saving, setSaving] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  const kaydet = async () => {
    if (!ozet.trim()) return;
    setSaving(true);
    setHata(null);
    try {
      await api.gorusmeKaydet(takimNo, { entity_id: entityId, kanal, ozet });
      setOzet("");
      onSaved();
    } catch (error) {
      setHata(error instanceof Error ? error.message : "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="tp-gorusme-form">
      <textarea
        className="tp-gorusme-input"
        value={ozet}
        rows={14}
        placeholder="Görüşme sırasında/sonrasında aklında kalanı buraya yaz (markdown yapıştırabilirsin)"
        onChange={(event) => setOzet(event.target.value)}
      />
      <div className="tp-gorusme-alt">
        <div className="tp-kanal-secim">
          {GORUSME_KANALLARI.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={kanal === value ? "on" : ""}
              onClick={() => setKanal(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="btn primary"
          onClick={kaydet}
          disabled={saving || !ozet.trim()}
          type="button"
        >
          {saving ? "Kaydediliyor…" : "Notu kaydet"}
        </button>
      </div>
      {hata && <div className="tp-hata">{hata}</div>}
    </div>
  );
}

export default function TeamPage({ entity, nodeById, onGoto }: Props) {
  const meta = entity.meta;
  const takimNo = textValue(meta.takim_no);

  const [sorular, setSorular] = useState<AnketSoru[]>([]);
  const [anketVersion, setAnketVersion] = useState<string | null>(null);
  const [anketKayitlari, setAnketKayitlari] = useState<AnketKayit[]>([]);
  const [gorusmeler, setGorusmeler] = useState<GorusmeKaydi[]>([]);

  useEffect(() => {
    let alive = true;
    api.anketSorular()
      .then((data) => {
        if (!alive) return;
        setSorular(data.sorular);
        setAnketVersion(data.version);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const yenile = useMemo(() => {
    return () => {
      if (!takimNo) return;
      api.anketKayitlari(takimNo).then(setAnketKayitlari).catch(() => undefined);
      api.gorusmeler(takimNo).then(setGorusmeler).catch(() => undefined);
    };
  }, [takimNo]);

  useEffect(() => {
    setAnketKayitlari([]);
    setGorusmeler([]);
    yenile();
  }, [yenile]);

  const kisiler = useMemo(() => {
    const map = new Map<string, Relation>();
    for (const relation of entity.relations) {
      if (relation.type === "person") map.set(relation.id, relation);
    }
    return [...map.values()];
  }, [entity.relations]);

  const kurumlar = useMemo(() => {
    const map = new Map<string, Relation>();
    for (const relation of entity.relations) {
      if (["institution", "school", "company"].includes(relation.type)) {
        map.set(relation.id, relation);
      }
    }
    return [...map.values()];
  }, [entity.relations]);

  const basarilar = textList(meta.basarilar);
  const kaynaklar = useMemo(() => researchLinks(entity), [entity]);
  const odulSayisi = meta.odul_sayisi;
  const gecmisSatirlari: Array<[string, string]> = [];
  const push = (label: string, value: unknown) => {
    const text = textValue(value);
    if (text) gecmisSatirlari.push([label, text]);
  };
  push("2025-26 sezonu", meta.sezon_2025_26);
  push("2026-27 kaydı", meta.kayit_2026_27);
  push("Rookie yılı", meta.rookie_yili);
  push("Kıdem", meta.kidem);
  if (typeof odulSayisi === "number") {
    gecmisSatirlari.push(["Ödül sayısı", String(odulSayisi)]);
  }
  push("Dünya sırası (2025)", meta.dunya_sirasi_2025);

  const ustSatir = [textValue(meta.city), textValue(meta.kurum) ?? textValue(meta.org)]
    .filter(Boolean) as string[];

  return (
    <div className="team-page">
      <header className="tp-head">
        <h1 className="tp-name">{meta.name ?? entity.id}</h1>
        {ustSatir.length > 0 && (
          <div className="tp-subline">{ustSatir.join(" · ")}</div>
        )}
        {takimNo && <div className="tp-takim-no">Takım no {takimNo}</div>}
      </header>

      <section className="tp-sec">
        <h2 className="tp-sec-title">Kişiler</h2>
        {kisiler.length === 0 ? (
          <p className="tp-bos">Bağlı kişi kaydı yok.</p>
        ) : (
          <div className="tp-kisi-grid">
            {kisiler.map((kisi) => {
              const node = nodeById.get(kisi.id);
              const blocked =
                node?.politika_durumu === "no_contact" || Boolean(node?.flags?.no_contact);
              const deferred = node?.politika_durumu === "defer";
              return (
                <button
                  key={kisi.id}
                  className={`tp-kisi${blocked || deferred ? " dim" : ""}`}
                  onClick={() => onGoto(kisi.id)}
                  type="button"
                  title={node?.politika_metni ?? kisi.name}
                >
                  <span className="tp-kisi-ad">
                    {kisi.name}
                    {blocked && <span className="tp-flag" title="Temas yok">⛔</span>}
                    {deferred && <span className="tp-flag" title="Temas ertelendi">⏸️</span>}
                  </span>
                  {(node?.role || kisi.label) && (
                    <span className="tp-kisi-rol">{node?.role ?? kisi.label}</span>
                  )}
                  {node?.phone && <span className="tp-kisi-tel">{node.phone}</span>}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="tp-sec">
        <h2 className="tp-sec-title">Kurum</h2>
        {kurumlar.length === 0 ? (
          <p className="tp-bos">Bağlı kurum kaydı yok.</p>
        ) : (
          <div className="tp-kisi-grid">
            {kurumlar.map((kurum) => {
              const node = nodeById.get(kurum.id);
              return (
                <button
                  key={kurum.id}
                  className="tp-kisi"
                  onClick={() => onGoto(kurum.id)}
                  type="button"
                >
                  <span className="tp-kisi-ad">{kurum.name}</span>
                  {node?.city && <span className="tp-kisi-rol">{node.city}</span>}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="tp-sec">
        <h2 className="tp-sec-title">Ödüller &amp; geçmiş</h2>
        {gecmisSatirlari.length > 0 && (
          <dl className="tp-gecmis">
            {gecmisSatirlari.map(([label, value]) => (
              <div className="tp-gecmis-row" key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {basarilar.length > 0 ? (
          <ul className="tp-basari-list">
            {basarilar.map((basari) => <li key={basari}>{basari}</li>)}
          </ul>
        ) : (
          <p className="tp-bos">
            {odulSayisi === 0 ? "Sayıldı, ödül yok." : "Ödül kaydı yok."}
          </p>
        )}
      </section>

      <section className="tp-sec">
        <h2 className="tp-sec-title">Araştırma kaynakları</h2>
        {kaynaklar.length === 0 ? (
          <p className="tp-bos">Kayıtlı bağlantı yok.</p>
        ) : (
          <ul className="tp-kaynak-list">
            {kaynaklar.map((link) => (
              <li key={link.url}>
                {link.label && <span className="tp-kaynak-etiket">{link.label}</span>}
                <a href={link.url} target="_blank" rel="noreferrer">
                  {linkLabel(link.url)}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="tp-sec">
        <h2 className="tp-sec-title">Anket</h2>
        {!takimNo ? (
          <p className="tp-bos">
            Bu kayıtta <code>takim_no</code> yok — anket takım numarasına yazıldığı için
            form açılmıyor.
          </p>
        ) : (
          <>
            {sorular.length > 0 ? (
              <AnketFormu
                takimNo={takimNo}
                sorular={sorular}
                version={anketVersion}
                onSaved={yenile}
              />
            ) : (
              <p className="tp-bos">Soru listesi okunamadı.</p>
            )}
            {anketKayitlari.length > 0 && (
              <div className="tp-kayit-list">
                <div className="tp-kayit-baslik">
                  Kayıtlı cevaplar
                  <span className="tp-kayit-count">{anketKayitlari.length}</span>
                </div>
                {anketKayitlari.map((kayit, index) => (
                  <div className="tp-kayit" key={`${kayit.tarih}-${index}`}>
                    <div className="tp-kayit-meta">
                      <span>{kayit.tarih}</span>
                      {kayit.cevaplayan && <span>{kayit.cevaplayan}</span>}
                      <span>{kayit.kanal}</span>
                      {kayit.anket_versiyon && <span>{kayit.anket_versiyon}</span>}
                    </div>
                    <dl className="tp-kayit-cevaplar">
                      {kayit.cevaplar.map((cevap, i) => (
                        <div key={`${cevap.soru}-${i}`}>
                          <dt>{cevap.soru}</dt>
                          <dd>{cevap.cevap}</dd>
                        </div>
                      ))}
                    </dl>
                    {kayit.not && <div className="tp-kayit-not">{kayit.not}</div>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <section className="tp-sec">
        {/* Sayfanın en altındaki büyük not alanı. Ayrı bir mekanizma DEĞİL:
            görüşme özeti ile aynı uç, aynı md dosyası, aynı interaction satırı
            — iki ayrı "not" kutusu olsaydı hangisinin nereye gittiği
            belirsizleşirdi. */}
        <h2 className="tp-sec-title">Notlar</h2>
        {!takimNo ? (
          <p className="tp-bos">
            Bu kayıtta <code>takim_no</code> yok — not dosyası takım numarasıyla
            adlandırıldığı için kutu açılmıyor.
          </p>
        ) : (
          <>
            <GorusmeFormu takimNo={takimNo} entityId={entity.id} onSaved={yenile} />
            {gorusmeler.length > 0 && (
              <div className="tp-kayit-list">
                <div className="tp-kayit-baslik">
                  Geçmiş notlar
                  <span className="tp-kayit-count">{gorusmeler.length}</span>
                </div>
                {gorusmeler.map((kayit) => (
                  <div className="tp-kayit" key={kayit.dosya}>
                    <div className="tp-kayit-meta">
                      <span>{(kayit.tarih ?? "").replace("T", " ").slice(0, 16)}</span>
                      <span>{kayit.kanal}</span>
                    </div>
                    <div
                      className="md"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(kayit.ozet) }}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
