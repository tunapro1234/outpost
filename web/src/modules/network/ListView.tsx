import { useEffect, useMemo, useRef, useState } from "react";
import type {
  EntityListItem,
  EntityType,
  Status,
} from "@/core/types";
import {
  OUTREACH_STATE_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
  TYPE_COLORS,
  TYPE_LABELS,
} from "@/core/theme";
import { api } from "@/core/api";

type ColKey =
  | "type"
  | "subtype"
  | "status"
  | "score"
  | "city"
  | "degree"
  | "mail"
  | "mail_status"
  | "mail_count"
  | "last_mail_date"
  | "last_mail_direction"
  | "role"
  | "guven"
  | "katman"
  | "sira"
  | "connected_org"
  | "closeness";

type SortKey = "name" | ColKey;
// "hierarchy" bir gruplama değil, ayrı bir GÖRÜNÜM KİPİ; yine de kullanıcı için
// tek bir seçici olsun diye Group selector'ın içinde yaşıyor (paralel bir kip
// düğmesi eklemedik). Kipin verisi `hierarchy` memo'sunda, satırları
// hierarchyRows()'ta üretilir; sütun/sıralama makinesi bu kipte devre dışıdır.
type GroupKey = "none" | "city" | "subtype" | "status" | "hierarchy";
export type ListPresetId =
  | "all"
  | "competitor"
  | "teacher"
  | "company"
  | "person"
  | "institution"
  | "school"
  | "channel"
  | "team"
  | "ftc2027"
  | "ftcSezonu"
  | "sogukHat"
  | "tumKayitlar"
  | "atolyeler";

interface SortSpec {
  key: SortKey;
  order: "asc" | "desc";
}

interface Props {
  items: EntityListItem[];
  /**
   * Ağın SÜZÜLMEMİŞ tam kayıt listesi (App'teki `entityList`). Takım hiyerarşisi
   * kipi bunu kullanır: hiyerarşinin kökü tip süzgecinden ve arama kutusundan
   * bağımsız olmalı (kişiyi arayan kullanıcı takımı görmeli, takım da kurumunu
   * ve diğer kişilerini getirmeli). Ayrıca `org` / `phone` alanları yalnız bu
   * listede var — grafik düğümlerine taşınmıyorlar.
   */
  allItems?: EntityListItem[];
  network: string | null;
  requestedPreset?: ListPresetId | null;
  /**
   * Kenar çubuğundan açılan /lists/* rotalarında dolu gelir. Doluysa liste
   * "rota kipi"ndedir: preset pil şeridi çizilmez (rotanın kendisi zaten
   * preset'i seçmiştir), başlık liste adını gösterir ve tip/metin süzgeçleri
   * tek satırda selector olarak sunulur.
   */
  routeTitle?: string | null;
  /** filters.q ile bağlı — liste kendi arama motorunu KURMAZ. */
  query?: string;
  onQueryChange?: (value: string) => void;
  /** filters.types ile bağlı (tek tip ya da null = tümü). */
  typeFilter?: EntityType | null;
  onTypeFilterChange?: (value: EntityType | null) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenFull: (id: string) => void;
  onChanged: () => void;
}

const TYPES: EntityType[] = [
  "person",
  "company",
  "institution",
  "school",
  "channel",
  "team",
];

// canonical column registry (order used for header + popover)
const COLUMNS: { key: ColKey; label: string; num?: boolean }[] = [
  { key: "type", label: "Type" },
  { key: "subtype", label: "Subtype" },
  { key: "role", label: "Role" },
  { key: "guven", label: "Güven" },
  { key: "katman", label: "Katman" },
  { key: "sira", label: "Sıra", num: true },
  { key: "connected_org", label: "Connected org" },
  { key: "status", label: "Status" },
  { key: "score", label: "Score", num: true },
  { key: "closeness", label: "Closeness", num: true },
  { key: "city", label: "City" },
  { key: "degree", label: "Connections", num: true },
  { key: "mail_status", label: "Mail" },
  { key: "mail", label: "Mail address" },
  { key: "mail_count", label: "Mails", num: true },
  { key: "last_mail_date", label: "Last mail" },
  { key: "last_mail_direction", label: "Dir" },
];
const PRESETS: {
  id: ListPresetId;
  label: string;
  type: EntityType | null;
  tag?: string;
  matches?: (item: EntityListItem) => boolean;
  cols: ColKey[];
}[] = [
  {
    id: "all",
    label: "All",
    type: null,
    cols: ["type", "subtype", "status", "score", "city", "degree", "mail_count", "last_mail_date"],
  },
  {
    id: "competitor",
    label: "Rakipler",
    type: "company",
    tag: "rakip",
    cols: ["subtype", "city", "score", "degree"],
  },
  {
    // 2027 FTC kampanyası — Tuna WhatsApp'tan doğrudan yazıyor; kişiler, okullar
    // ve takımlar research vault'una `2027-ftc` etiketiyle giriyor.
    //
    // ⚠️ TİP FİLTRESİ YOK (type: null) ve bu KASITLI. İlk sürümde `type: "person"`
    // vardı; Tuna listeyi "FTC okulları + takımları + insanları" olarak istiyor ve
    // takımlar `company` tipinde tutuluyor (örn. lavender-robotics-frc-9583-ftc-24140).
    // Tip filtresi kalsaydı 54 takım + 51 kurum listede HİÇ görünmeyecekti — üstelik
    // sessizce: liste dolu görünür, eksiği yalnız sayan fark ederdi.
    // ⭐ Ders: bir listenin üyelik kuralı İKİ şarta bağlanınca, ikincisi birincinin
    //    içinde saklanır. Burada üyelik TEK şart: etiket. Etiketi kim koyduysa
    //    kararı o vermiştir; tip ayrımı görünüm meselesidir, üyelik ölçütü değil.
    id: "ftc2027",
    label: "2027 FTC",
    type: null,
    tag: "2027-ftc",
    // Karışık tipli liste olduğu için `type` sütunu ilk sırada: okul mu takım mı
    // kişi mi, bakan kişi ilk bakışta görsün.
    cols: ["type", "subtype", "city", "score", "degree", "mail_count", "last_mail_date"],
  },
  {
    // FTC Sezonu — kendi ağı var (`ftc`, vault: workspaces/probot/ftc-vault).
    // Üyelik ölçütü AĞIN KENDİSİ: bu ağa giren her şey listeye girer.
    //
    // ⚠️ Ne tip ne de etiket filtresi var, ikisi de KASITLI. 2027 FTC'de tip
    // filtresi 105 kaydı sessizce gizlemişti; burada ayrıştırma zaten ağ
    // seviyesinde yapıldığı için ikinci bir şart eklemek aynı hatayı geri
    // getirirdi. Ağda ne varsa görünür.
    id: "ftcSezonu",
    label: "FTC Sezonu",
    type: null,
    // Karışık tipli liste: `type` sütunu ilk sırada, okul/takım/kişi ayrımı
    // ilk bakışta okunsun.
    cols: ["type", "subtype", "city", "score", "degree", "mail_count", "last_mail_date"],
  },
  {
    // Tüm Kayıtlar — hiçbir filtre yok; research ağının komple dökümü.
    id: "tumKayitlar",
    label: "Tüm Kayıtlar",
    type: null,
    cols: ["type", "subtype", "status", "score", "city", "degree", "mail_count", "last_mail_date"],
  },
  {
    // Atölyeler — research vault'ta ayırt edici alan `subtype: atolye`
    // (tag DEĞİL: research kayıtları neredeyse etiketsiz, 21 Ağu sayımı 128).
    id: "atolyeler",
    label: "Atölyeler",
    type: null,
    matches: (item) => item.subtype === "atolye",
    cols: ["type", "city", "mail", "score", "mail_count", "last_mail_date"],
  },
  {
    // Soğuk Hat — research ağının "aranabilir" kesiti: araştırması bitmiş,
    // elde bir iletişim kanalı var, ama HENÜZ temas edilmemiş kayıtlar.
    //
    // ⚠️ TİP FİLTRESİ YOK ve bu kasıtlı (2027 FTC'de tip filtresi 151 kaydın
    // 102'sini sessizce gizlemişti). Üyelik ölçütü tip değil DURUM.
    // Üç şart da temas durumuna bakıyor, hiçbiri "ne olduğuna" bakmıyor:
    //   1) iletişim var (mail ya da telefon) — yoksa aranamaz,
    //   2) temas edilmemiş (durum yazılmadı/boş, giden-gelen mail yok),
    //   3) temas yasağı yok (no_contact / internal / politika).
    id: "sogukHat",
    label: "Soğuk Hat",
    type: null,
    matches: (item) => {
      const hasChannel = Boolean(item.mail || item.phone);
      if (!hasChannel) return false;
      if (item.flags?.internal || item.flags?.no_contact) return false;
      if (item.politika_durumu === "no_contact") return false;
      const durum = normalizePresetText(item.durum);
      const untouched = durum === "" || durum === "yazilmadi";
      const noMail = !item.mail_count && !item.last_mail_date;
      return untouched && noMail;
    },
    cols: ["type", "city", "mail", "score", "last_mail_date"],
  },
  {
    id: "teacher",
    label: "Öğretmenler",
    type: "person",
    matches: (item) => {
      const role = normalizePresetText(item.role);
      const tags = (item.tags ?? []).map(normalizePresetText);
      return (
        ["mentor", "ogretmen", "egitmen"].some((word) =>
          role.includes(word)
        ) ||
        tags.some(
          (tag) =>
            tag.includes("mentor") ||
            tag.includes("ogretmen") ||
            tag.includes("egitmen")
        )
      );
    },
    cols: ["role", "connected_org", "closeness", "mail_status", "degree"],
  },
  {
    id: "company",
    label: "Companies",
    type: "company",
    cols: ["subtype", "city", "score", "mail_status", "mail_count", "last_mail_date", "degree"],
  },
  {
    id: "person",
    label: "Kişiler",
    type: "person",
    cols: ["role", "connected_org", "closeness", "mail_status", "degree"],
  },
  {
    id: "institution",
    label: "Institutions",
    type: "institution",
    cols: ["subtype", "city", "score", "mail_status", "mail_count", "last_mail_date", "degree"],
  },
  {
    id: "school",
    label: "Okullar",
    type: "school",
    cols: ["subtype", "city", "score", "mail_status", "mail_count", "last_mail_date", "degree"],
  },
  {
    id: "channel",
    label: "Channels",
    type: "channel",
    cols: ["subtype", "degree"],
  },
  {
    id: "team",
    label: "Takımlar",
    type: "team",
    cols: ["subtype", "city", "degree"],
  },
];

const GROUPS: { key: GroupKey; label: string }[] = [
  { key: "none", label: "No grouping" },
  { key: "city", label: "City" },
  { key: "subtype", label: "Subtype" },
  { key: "status", label: "Status" },
  // Yalnız listede `team` kaydı varsa gösterilir (aşağıda `teamsExist`):
  // takımsız bir ağda bu seçenek boş bir ekran vaat ederdi.
  { key: "hierarchy", label: "Team hierarchy" },
];

// Rota kipindeki sade etiketler (jargonsuz). GROUPS'un İngilizce etiketleri
// network-içi liste kipinde olduğu gibi kalıyor.
const GROUP_LABELS_TR: Record<GroupKey, string> = {
  none: "Gruplama yok",
  city: "Şehre göre",
  subtype: "Alt tipe göre",
  status: "Duruma göre",
  hierarchy: "Takım hiyerarşisi",
};

const TYPE_LABELS_TR: Record<EntityType, string> = {
  team: "Takım",
  person: "Kişi",
  school: "Okul",
  institution: "Kurum",
  company: "Şirket",
  channel: "Kanal",
};

// Selector sırası Tuna'nın istediği sıra.
const TYPE_FILTER_ORDER: EntityType[] = [
  "team",
  "person",
  "school",
  "institution",
  "company",
  "channel",
];

interface SavedView {
  name: string;
  preset: ListPresetId;
  grouping: GroupKey;
  cols: ColKey[];
  sorts: SortSpec[];
}

const LS_STATE = "outpost.list.state.v2";
const LS_VIEWS = "outpost.list.views.v2";

function loadState(): {
  preset: ListPresetId;
  grouping: GroupKey;
  cols: ColKey[];
  sorts: SortSpec[];
} | null {
  try {
    const raw = localStorage.getItem(LS_STATE);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return null;
}

function normalizePresetText(value: string | null | undefined): string {
  return (value ?? "")
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("ı", "i");
}

function loadViews(): SavedView[] {
  try {
    const raw = localStorage.getItem(LS_VIEWS);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch {
    /* ignore */
  }
  return [];
}

function cmpFor(key: SortKey, a: EntityListItem, b: EntityListItem): number {
  switch (key) {
    case "name":
      return a.name.localeCompare(b.name, "tr");
    case "type":
      return TYPE_LABELS[a.type].localeCompare(TYPE_LABELS[b.type], "tr");
    case "subtype":
      return (a.subtype ?? "").localeCompare(b.subtype ?? "", "tr");
    case "role":
      return (a.role ?? "").localeCompare(b.role ?? "", "tr");
    case "guven":
      return (a.guven ?? "").localeCompare(b.guven ?? "", "tr");
    case "katman":
      return String(a.katman ?? "").localeCompare(String(b.katman ?? ""), "tr", { numeric: true });
    case "sira": {
      const left = a.sira;
      const right = b.sira;
      if (left == null && right == null) return 0;
      if (left == null) return 1;
      if (right == null) return -1;
      return left - right;
    }
    case "connected_org":
      return (a.connected_org ?? "").localeCompare(b.connected_org ?? "", "tr");
    case "status":
      return (a.status ?? "").localeCompare(b.status ?? "");
    case "city":
      return (a.city ?? "").localeCompare(b.city ?? "", "tr");
    case "degree":
      return a.degree - b.degree;
    case "score":
      return (a.score ?? -Infinity) - (b.score ?? -Infinity);
    case "closeness":
      return (a.closeness ?? -Infinity) - (b.closeness ?? -Infinity);
    case "mail":
    case "mail_status":
      return (a.mail ? 1 : 0) - (b.mail ? 1 : 0);
    case "mail_count":
      return (a.mail_count ?? 0) - (b.mail_count ?? 0);
    case "last_mail_date":
      return (a.last_mail_date ?? "").localeCompare(b.last_mail_date ?? "");
    case "last_mail_direction":
      return (a.last_mail_direction ?? "").localeCompare(
        b.last_mail_direction ?? ""
      );
    default:
      return 0;
  }
}

// ---- takım hiyerarşisi -------------------------------------------------
// Bağ alanı `org`: takım kartında ve kişi kartında kurumun ADI birebir yazılı,
// kurum kartının `name`'i ile eşleşir. Yani hiyerarşi istemcide kurulur:
//   team.org === kurum.name === person.org
// Kenar (edge) kullanılmıyor; kartlardaki şerh de bu yönde.
// Aynı kuruma bağlı birden çok takım olabilir (ALKEV 2, PARS 3): kurum ve
// kişiler HER takımın altında tekrarlanır — kişi takıma değil kuruma bağlı.
const ORG_TYPES: EntityType[] = ["school", "institution", "company", "channel"];

interface HierRoot {
  key: string;
  kind: "team" | "org" | "eco";
  /** Kök satırın kendi kaydı — "eco" kökünde kayıt yok. */
  record: EntityListItem | null;
  label: string;
  org: EntityListItem | null;
  /** Kurum kartı bulunamadıysa takımın yazdığı ham kurum adı. */
  orgName: string | null;
  people: EntityListItem[];
}

function isBlocked(it: EntityListItem): boolean {
  return it.politika_durumu === "no_contact" || Boolean(it.flags?.no_contact);
}

function hasTag(it: EntityListItem, tag: string): boolean {
  return (it.tags ?? []).some((t) => normalizePresetText(t) === tag);
}

function buildHierarchy(source: EntityListItem[]): HierRoot[] {
  const orgByName = new Map<string, EntityListItem>();
  const peopleByOrg = new Map<string, EntityListItem[]>();
  const loose: EntityListItem[] = [];

  for (const it of source) {
    if (ORG_TYPES.includes(it.type)) {
      const key = normalizePresetText(it.name);
      if (key && !orgByName.has(key)) orgByName.set(key, it);
      continue;
    }
    if (it.type !== "person") continue;
    const key = normalizePresetText(it.org);
    // Ekosistem kişileri hiçbir kuruma bağlı değil; org'suz kalan herkes de
    // buraya düşer — aksi halde hiyerarşi onları SESSİZCE yutardı.
    if (!key || hasTag(it, "ekosistem")) {
      loose.push(it);
      continue;
    }
    const bucket = peopleByOrg.get(key);
    if (bucket) bucket.push(it);
    else peopleByOrg.set(key, [it]);
  }

  const byName = (a: EntityListItem, b: EntityListItem) =>
    a.name.localeCompare(b.name, "tr");

  const roots: HierRoot[] = [];
  const usedOrgKeys = new Set<string>();

  for (const team of source.filter((it) => it.type === "team").sort(byName)) {
    const key = normalizePresetText(team.org);
    if (key) usedOrgKeys.add(key);
    roots.push({
      key: `team:${team.id}`,
      kind: "team",
      record: team,
      label: team.name,
      org: key ? orgByName.get(key) ?? null : null,
      orgName: team.org ?? null,
      people: [...(peopleByOrg.get(key) ?? [])].sort(byName),
    });
  }

  // Takımı olmayan kurumlar da kök olur: kişileri listede kaybolmasın.
  for (const [key, org] of orgByName) {
    if (usedOrgKeys.has(key)) continue;
    roots.push({
      key: `org:${org.id}`,
      kind: "org",
      record: org,
      label: org.name,
      org,
      orgName: org.name,
      people: [...(peopleByOrg.get(key) ?? [])].sort(byName),
    });
  }

  if (loose.length) {
    roots.push({
      key: "eco",
      kind: "eco",
      record: null,
      label: "Ekosistem",
      org: null,
      orgName: null,
      people: [...loose].sort(byName),
    });
  }

  return roots;
}

function rootMatches(root: HierRoot, needle: string): boolean {
  if (!needle) return true;
  const hay = [
    root.label,
    root.record?.city ?? "",
    root.orgName ?? "",
    root.org?.name ?? "",
    root.org?.city ?? "",
    ...root.people.map((p) => p.name),
  ];
  return hay.some((value) => normalizePresetText(value).includes(needle));
}

function groupValue(it: EntityListItem, g: GroupKey): string {
  switch (g) {
    case "city":
      return it.city || "No city";
    case "subtype":
      return it.subtype || "No subtype";
    case "status":
      return it.status ? STATUS_LABELS[it.status as Status] : "No status";
    default:
      return "";
  }
}

export default function ListView({
  items,
  allItems,
  network,
  requestedPreset,
  routeTitle,
  query,
  onQueryChange,
  typeFilter,
  onTypeFilterChange,
  selectedId,
  onSelect,
  onOpenFull,
  onChanged,
}: Props) {
  const routeMode = !!routeTitle;
  const saved = loadState();
  const [preset, setPreset] = useState<ListPresetId>(
    requestedPreset ?? saved?.preset ?? "all"
  );
  const [grouping, setGrouping] = useState<GroupKey>(saved?.grouping ?? "none");
  const [cols, setCols] = useState<ColKey[]>(
    saved?.cols ?? PRESETS[0].cols
  );
  const [sorts, setSorts] = useState<SortSpec[]>(
    saved?.sorts ?? [{ key: "score", order: "desc" }]
  );
  const [views, setViews] = useState<SavedView[]>(loadViews);

  const [colsOpen, setColsOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Hiyerarşide varsayılan KAPALI ("tıklayınca görünsün"), gruplamada varsayılan
  // AÇIK. Aynı Set'e iki zıt anlam yüklemek yerine ayrı bir açık-kümesi.
  const [hierOpen, setHierOpen] = useState<Set<string>>(new Set());
  const [showNew, setShowNew] = useState(false);
  const [newType, setNewType] = useState<EntityType>("person");
  const [newName, setNewName] = useState("");
  const [showAllWarm, setShowAllWarm] = useState(false);
  // Arama kutusu: FilterBar'daki kalıbın aynısı (250ms debounce, dışarıdan
  // gelen değer kazanır). Filtreleme yine core/filters.ts'te, burada değil.
  const [queryInput, setQueryInput] = useState(query ?? "");
  useEffect(() => {
    setQueryInput(query ?? "");
  }, [query]);
  useEffect(() => {
    if (!onQueryChange) return;
    if (queryInput === (query ?? "")) return;
    const timer = window.setTimeout(() => onQueryChange(queryInput), 250);
    return () => window.clearTimeout(timer);
  }, [queryInput, query, onQueryChange]);

  const colsRef = useRef<HTMLDivElement>(null);
  const viewsRef = useRef<HTMLDivElement>(null);
  const previousNetworkRef = useRef(network);

  // persist current working state
  useEffect(() => {
    localStorage.setItem(
      LS_STATE,
      JSON.stringify({
        preset,
        // "hierarchy" KASITLI olarak yazılmıyor. Bu kip preset'e bağlı bir
        // varsayılan (ftcSezonu) ve yalnız takımlı listelerde anlamlı; kalıcı
        // hale gelseydi takımsız bir listeye taşınıp orada boş bir ekran
        // gösterirdi. Preset her mount'ta kipi zaten geri kuruyor.
        grouping: grouping === "hierarchy" ? "none" : grouping,
        cols,
        sorts,
      })
    );
  }, [preset, grouping, cols, sorts]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (colsRef.current && !colsRef.current.contains(e.target as Node))
        setColsOpen(false);
      if (viewsRef.current && !viewsRef.current.contains(e.target as Node))
        setViewsOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const applyPreset = (id: ListPresetId) => {
    const p = PRESETS.find((x) => x.id === id)!;
    setPreset(id);
    setCols(p.cols);
    setCollapsed(new Set());
    setHierOpen(new Set());
    // FTC Sezonu listesi (/lists/2027-ftc rotası) takım hiyerarşisiyle AÇILIR;
    // kullanıcı Group selector'dan "Gruplama yok"a dönebilir — burası yalnız
    // preset uygulanırken çalışır, her render'da değil. Başka bir preset'e
    // geçilirken hiyerarşi kipi bırakılır (o listelerde anlamsız), diğer
    // gruplama tercihleri korunur.
    if (id === "ftcSezonu") setGrouping("hierarchy");
    else setGrouping((g) => (g === "hierarchy" ? "none" : g));
  };

  useEffect(() => {
    if (requestedPreset) applyPreset(requestedPreset);
  }, [requestedPreset]);

  useEffect(() => {
    setShowAllWarm(false);
    if (network === "hedef") {
      setPreset("all");
      setGrouping("none");
      setCols(["sira", "role", "type", "guven", "connected_org", "katman", "score"]);
      setSorts([{ key: "sira", order: "asc" }, { key: "name", order: "asc" }]);
    } else if (previousNetworkRef.current === "hedef") {
      const active = PRESETS.find((item) => item.id === preset) ?? PRESETS[0];
      setCols(active.cols);
      setSorts([{ key: "score", order: "desc" }]);
    }
    previousNetworkRef.current = network;
  }, [network]);

  const visible = (k: ColKey) => cols.includes(k);
  const toggleCol = (k: ColKey) => {
    setCols((prev) => {
      const next = prev.includes(k)
        ? prev.filter((x) => x !== k)
        : [...prev, k];
      return COLUMNS.map((c) => c.key).filter((c) => next.includes(c));
    });
  };

  // preset type filter (list is its own surface; graph filter stays shared)
  const activePreset = PRESETS.find((p) => p.id === preset) ?? PRESETS[0];
  const presetFiltered = useMemo(
    () =>
      items.filter(
        (it) =>
          (!activePreset.type || it.type === activePreset.type) &&
          (!activePreset.tag || it.tags?.includes(activePreset.tag)) &&
          (!activePreset.matches || activePreset.matches(it))
      ),
    [items, activePreset]
  );
  const filtered = useMemo(
    () =>
      network !== "warm" || showAllWarm
        ? presetFiltered
        : presetFiltered.filter(
            (item) =>
              item.state != null &&
              item.state >= 1 &&
              !item.flags?.internal &&
              !item.flags?.no_contact
          ),
    [network, presetFiltered, showAllWarm]
  );
  const warmHiddenCount = presetFiltered.length - filtered.length;

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      for (const s of sorts) {
        const cmp = cmpFor(s.key, a, b);
        if (cmp !== 0) return s.order === "asc" ? cmp : -cmp;
      }
      return 0;
    });
    return arr;
  }, [filtered, sorts]);

  // ---- takım hiyerarşisi ----
  // Kaynak SÜZÜLMEMİŞ liste: kökler tip süzgecinden ve arama kutusundan bağımsız.
  const hierSource = allItems && allItems.length ? allItems : items;
  const teamsExist = useMemo(
    () => hierSource.some((it) => it.type === "team"),
    [hierSource]
  );
  const hierarchyOn = grouping === "hierarchy" && teamsExist;
  const hierRoots = useMemo(
    () => (hierarchyOn ? buildHierarchy(hierSource) : null),
    [hierarchyOn, hierSource]
  );
  // ---- "yazdım" işaretleri ----
  // Kalıcılık SQLite'taki `temas_durumu` tablosunda (server/modules/temas):
  // workspace DB'si vault'un DIŞINDA yaşar, bu yüzden türetilmiş FTC vault'u
  // her yeniden üretimde sıfırlansa da işaret kalır. Burada 6 durumlu makinenin
  // yalnız iki ucu kullanılıyor: yazildi ↔ yazilmadi. Diğer durumlar (Today
  // panelinden gelen cevap_bekleniyor vb.) de "yazılmış" sayılır — geri
  // gitmiş bir kaydı bu ekran işaretsiz gösterip yeniden yazdırmasın.
  const [yazildi, setYazildi] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!hierarchyOn || !network) return;
    let alive = true;
    api
      .temasListesi(network)
      .then((kayitlar) => {
        if (!alive) return;
        setYazildi(
          new Set(
            kayitlar
              .filter((k) => k.durum !== "yazilmadi")
              .map((k) => k.entity_id)
          )
        );
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [hierarchyOn, network]);

  // İyimser yazım: önce yerel küme, PATCH hata verirse geri alınır.
  const toggleYazildi = (id: string) => {
    if (!network) return;
    const next = !yazildi.has(id);
    setYazildi((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(id);
      else copy.delete(id);
      return copy;
    });
    api.patchTemas(id, next ? "yazildi" : "yazilmadi", network).catch(() => {
      setYazildi((prev) => {
        const copy = new Set(prev);
        if (next) copy.delete(id);
        else copy.add(id);
        return copy;
      });
    });
  };

  const hierarchy = useMemo(() => {
    if (!hierRoots) return null;
    const needle = normalizePresetText(queryInput);
    const visible = hierRoots.filter((root) => rootMatches(root, needle));
    // Yazılan takımlar dibe iner, kendi aralarında ESKİ SIRA korunur (kararlı
    // bölme). Kişi satırları takımın altında kalır — yalnız soluklaşırlar.
    const kalan = visible.filter(
      (root) => !(root.record && yazildi.has(root.record.id))
    );
    const bitmis = visible.filter(
      (root) => root.record && yazildi.has(root.record.id)
    );
    return [...kalan, ...bitmis];
  }, [hierRoots, queryInput, yazildi]);

  // grouped structure
  const groups = useMemo(() => {
    if (grouping === "none" || grouping === "hierarchy") return null;
    const map = new Map<string, EntityListItem[]>();
    for (const it of sorted) {
      const g = groupValue(it, grouping);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(it);
    }
    const arr = [...map.entries()].map(([label, its]) => ({ label, items: its }));
    arr.sort((a, b) => {
      const emptyA = a.label.startsWith("No ");
      const emptyB = b.label.startsWith("No ");
      if (emptyA !== emptyB) return emptyA ? 1 : -1;
      return b.items.length - a.items.length;
    });
    return arr;
  }, [sorted, grouping]);

  const onHeader = (key: SortKey, num: boolean, shift: boolean) => {
    setSorts((prev) => {
      const idx = prev.findIndex((s) => s.key === key);
      if (shift) {
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = { key, order: copy[idx].order === "asc" ? "desc" : "asc" };
          return copy;
        }
        return [...prev, { key, order: num ? "desc" : "asc" }];
      }
      if (idx === 0 && prev.length === 1) {
        return [{ key, order: prev[0].order === "asc" ? "desc" : "asc" }];
      }
      return [{ key, order: num ? "desc" : "asc" }];
    });
  };

  const th = (key: SortKey, label: string, num = false) => {
    const idx = sorts.findIndex((s) => s.key === key);
    const s = idx >= 0 ? sorts[idx] : null;
    return (
      <th
        onClick={(e) => onHeader(key, num, e.shiftKey)}
        style={num ? { textAlign: "right" } : undefined}
        title="Click to sort · Shift-click to add a tiebreaker"
      >
        {label}
        {s && (
          <span className="arrow">
            {s.order === "asc" ? "▲" : "▼"}
            {sorts.length > 1 && <sup className="sort-rank">{idx + 1}</sup>}
          </span>
        )}
      </th>
    );
  };

  const create = async () => {
    if (!newName.trim()) return;
    const ent = await api.createEntity({ type: newType, name: newName.trim() });
    setNewName("");
    setShowNew(false);
    onChanged();
    onSelect(ent.id);
  };

  const saveView = () => {
    const name = viewName.trim();
    if (!name) return;
    const next = [
      ...views.filter((v) => v.name !== name),
      { name, preset, grouping, cols, sorts },
    ];
    setViews(next);
    localStorage.setItem(LS_VIEWS, JSON.stringify(next));
    setViewName("");
  };
  const applyView = (v: SavedView) => {
    setPreset(v.preset);
    setGrouping(v.grouping);
    setCols(v.cols);
    setSorts(v.sorts);
    setCollapsed(new Set());
    setViewsOpen(false);
  };
  const deleteView = (name: string) => {
    const next = views.filter((v) => v.name !== name);
    setViews(next);
    localStorage.setItem(LS_VIEWS, JSON.stringify(next));
  };

  const dirText = (d?: "out" | "in" | null) =>
    d === "out" ? "→ out" : d === "in" ? "← in" : "—";

  const stateChip = (item: EntityListItem) => {
    if (item.politika_durumu === "no_contact") {
      return <span className="state-chip blocked">Temas yasak</span>;
    }
    if (item.politika_durumu === "defer") {
      return <span className="state-chip policy-defer">⏸ Ertelendi</span>;
    }
    if (item.flags?.internal) {
      return <span className="state-chip internal">İç kayıt</span>;
    }
    if (item.state == null) return null;
    return (
      <span className={`state-chip state-${item.state}`}>
        {OUTREACH_STATE_LABELS[item.state]}
      </span>
    );
  };

  // ---- cell render ----
  const cell = (it: EntityListItem, k: ColKey) => {
    switch (k) {
      case "type":
        return (
          <td key={k}>
            <span className="type-tag">
              <span className="swatch" style={{ background: TYPE_COLORS[it.type] }} />
              {TYPE_LABELS[it.type]}
            </span>
          </td>
        );
      case "subtype":
        return (
          <td key={k} className="muted">
            {it.subtype ?? "—"}
          </td>
        );
      case "role":
        return (
          <td key={k} className="muted">
            {it.role ?? "—"}
          </td>
        );
      case "guven": {
        const level = normalizePresetText(it.guven);
        const tone = level.startsWith("kesin")
          ? "certain"
          : level.startsWith("muhtemel")
            ? "probable"
            : level.startsWith("tahmin")
              ? "estimated"
              : "belirsiz"; // bileşik metin tahmine düşürülmez, nötr görünür
        return (
          <td key={k}>
            {it.guven ? <span className={`confidence-badge ${tone}`}>{it.guven}</span> : <span className="muted">—</span>}
          </td>
        );
      }
      case "katman":
        return (
          <td key={k} className="muted">
            {it.katman ?? "—"}
          </td>
        );
      case "sira":
        return (
          <td key={k} className="num">
            {it.sira ?? "—"}
          </td>
        );
      case "connected_org":
        return (
          <td key={k}>
            {it.connected_org ? (
              <button
                className="cell-link"
                onClick={(e) => {
                  e.stopPropagation();
                  if (it.connected_org_id) onSelect(it.connected_org_id);
                }}
              >
                {it.connected_org}
              </button>
            ) : (
              <span className="muted">—</span>
            )}
          </td>
        );
      case "status":
        return (
          <td key={k}>
            {it.status ? (
              <span className="status-tag">
                <span
                  className="ring"
                  style={{ background: STATUS_COLORS[it.status as Status] }}
                />
                {STATUS_LABELS[it.status as Status]}
              </span>
            ) : (
              <span className="muted">—</span>
            )}
          </td>
        );
      case "score":
        return (
          <td key={k} className="num">
            {it.score != null ? it.score : "—"}
          </td>
        );
      case "closeness":
        return (
          <td key={k} className="num">
            {it.closeness != null ? it.closeness : "—"}
          </td>
        );
      case "city":
        return (
          <td key={k} className="muted">
            {it.city ?? "—"}
          </td>
        );
      case "degree":
        return (
          <td key={k} className="num">
            {it.degree}
          </td>
        );
      case "mail_status":
        return (
          <td key={k}>
            {it.mail ? (
              <span className="mail-yes">✓ has mail</span>
            ) : (
              <span className="mail-no">none</span>
            )}
          </td>
        );
      case "mail":
        return (
          <td key={k} className="muted">
            {it.mail || "—"}
          </td>
        );
      case "mail_count":
        return (
          <td key={k} className="num">
            {it.mail_count ?? 0}
          </td>
        );
      case "last_mail_date":
        return (
          <td key={k} className="mono muted">
            {it.last_mail_date ?? "—"}
          </td>
        );
      case "last_mail_direction":
        return (
          <td key={k}>
            {it.last_mail_direction ? (
              <span className={`dir-tag ${it.last_mail_direction}`}>
                {dirText(it.last_mail_direction)}
              </span>
            ) : (
              <span className="muted">—</span>
            )}
          </td>
        );
      default:
        return <td key={k} />;
    }
  };

  const activeCols = COLUMNS.filter((c) => visible(c.key));
  const colSpan = activeCols.length + 2; // name + open

  const row = (it: EntityListItem) => (
    <tr
      key={it.id}
      className={it.id === selectedId ? "sel" : ""}
      onClick={() => onSelect(it.id)}
    >
      <td className="c-name">
        <span className="list-name-text">{it.name}</span>
        {stateChip(it)}
      </td>
      {activeCols.map((c) => cell(it, c.key))}
      <td className="col-open">
        <button
          className="row-open"
          title="Open full page"
          onClick={(e) => {
            e.stopPropagation();
            onOpenFull(it.id);
          }}
        >
          →
        </button>
      </td>
    </tr>
  );

  // ---- hiyerarşi satırları ----
  // Hiyerarşi kipinde SAĞ PANEL (EntityPanel) hiç açılmaz: bu kipteki hiçbir
  // satır onSelect çağırmaz (Tuna, 21 Ağu — "sağ yan paneli kaldıralım ftc
  // görünümünden"). Panel App'te `selectedId && isNetwork` ile çizildiği için
  // seçimi hiç kurmamak paneli de kapatıyor; ayrı bir "paneli gizle" bayrağı
  // eklemeye gerek yok. Kayda gitmek artık ÇİFT TIK (tek yol; "→" düğmeleri
  // kaldırıldı). Düz liste satırları (`row`) ve graf görünümü etkilenmedi.
  const HIER_HINT = "çift tık: sayfasını aç";

  // Satırın "yazdım" düğmesi. stopPropagation ŞART: takım satırında tek tık
  // açar/kapatır, çift tık kaydın sayfasına gider — işaret ikisini de
  // tetiklememeli.
  const yazdimButton = (id: string) => {
    const on = yazildi.has(id);
    return (
      <button
        className={`hier-yazdim${on ? " on" : ""}`}
        title={on ? "Yazıldı (kaldır)" : "Yazdım olarak işaretle"}
        aria-pressed={on}
        onClick={(e) => {
          e.stopPropagation();
          toggleYazildi(id);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        ✓
      </button>
    );
  };

  const childRow = (
    root: HierRoot,
    it: EntityListItem,
    kind: "org" | "person"
  ) => {
    const blocked = isBlocked(it);
    const done = yazildi.has(it.id);
    return (
      <tr
        key={`${root.key}-${kind}-${it.id}`}
        className={`hier-row hier-child${blocked ? " blocked" : ""}${
          done ? " yazildi" : ""
        }${it.id === selectedId ? " sel" : ""}`}
        title={HIER_HINT}
        onDoubleClick={() => onOpenFull(it.id)}
      >
        <td colSpan={colSpan}>
          <div className="hier-line indent">
            {yazdimButton(it.id)}
            <span className="hier-kind">
              {kind === "org" ? TYPE_LABELS_TR[it.type] : "Kişi"}
            </span>
            <span className="hier-name">{it.name}</span>
            {blocked && <span className="hier-badge blocked">⛔</span>}
            {kind === "org" && it.city && (
              <span className="hier-meta">{it.city}</span>
            )}
            {kind === "person" && it.role && (
              <span className="hier-meta">{it.role}</span>
            )}
            {kind === "person" && it.phone && (
              <span className="hier-meta mono">{it.phone}</span>
            )}
          </div>
        </td>
      </tr>
    );
  };

  const hierarchyRows = (root: HierRoot) => {
    const open = hierOpen.has(root.key);
    const rec = root.record;
    const blocked = rec ? isBlocked(rec) : false;
    const phoneCount = root.people.filter((p) => p.phone).length;
    // Takım satırına tek tık = aşağı genişlet/kapat; ÇİFT TIK = takımın kendi
    // sayfası. Alt satırlarda tek tık hiçbir şey yapmaz, çift tık o kaydın
    // sayfasına gider. Hiçbiri sağ paneli açmaz.
    const toggleRoot = () =>
      setHierOpen((prev) => {
        const next = new Set(prev);
        if (next.has(root.key)) next.delete(root.key);
        else next.add(root.key);
        return next;
      });
    const done = Boolean(rec && yazildi.has(rec.id));
    const head = (
      <tr
        key={root.key}
        className={`hier-row hier-head${blocked ? " blocked" : ""}${
          done ? " yazildi" : ""
        }${rec && rec.id === selectedId ? " sel" : ""}`}
        title={rec ? HIER_HINT : undefined}
        onClick={toggleRoot}
        onDoubleClick={() => rec && onOpenFull(rec.id)}
      >
        <td colSpan={colSpan}>
          <div className="hier-line">
            {rec && yazdimButton(rec.id)}
            <button
              className="hier-caret"
              title={open ? "Kapat" : "Aç"}
              onClick={(e) => {
                e.stopPropagation();
                toggleRoot();
              }}
            >
              {open ? "▾" : "▸"}
            </button>
            <span className="hier-name strong">{root.label}</span>
            {rec?.city && <span className="hier-meta">{rec.city}</span>}
            {rec && hasTag(rec, "kayitli-2026-27") && (
              <span className="hier-badge star" title="2026-27 sezonuna kayıtlı">
                ⭐
              </span>
            )}
            {rec &&
              (typeof rec.odul_sayisi === "number" && rec.odul_sayisi > 0 ? (
                // Sunucu artık sayıyı taşıyor (7abce9e). 0 = "sayıldı, ödül yok"
                // → rozet çizilmez; alan hiç yoksa eski tag rozetine düşülür.
                <span className="hier-badge" title={`${rec.odul_sayisi} ödül (2024-25 + 2025-26)`}>
                  🏆 {rec.odul_sayisi}
                </span>
              ) : rec.odul_sayisi == null && hasTag(rec, "odullu") ? (
                <span className="hier-badge" title="Ödüllü takım">
                  🏆
                </span>
              ) : null)}
            {blocked && (
              <span className="hier-badge blocked" title="Temas yasak">
                ⛔
              </span>
            )}
            {/* "Geniş görünüm": ≥1400px'te chevron açmadan da özet görünsün. */}
            <span className="hier-wide">
              {root.orgName && <span className="hier-meta">{root.orgName}</span>}
              <span className="hier-meta">{root.people.length} kişi</span>
              {phoneCount > 0 && (
                <span className="hier-meta">{phoneCount} telefonlu</span>
              )}
            </span>
          </div>
        </td>
      </tr>
    );
    if (!open) return [head];
    const kids = [
      ...(root.org && root.kind === "team"
        ? [childRow(root, root.org, "org")]
        : []),
      ...(root.orgName && !root.org && root.kind === "team"
        ? [
            <tr key={`${root.key}-orgmiss`} className="hier-row hier-child">
              <td colSpan={colSpan}>
                <div className="hier-line indent">
                  <span className="hier-kind">Kurum</span>
                  <span className="hier-name muted">{root.orgName}</span>
                  <span className="hier-meta">kayıt yok</span>
                </div>
              </td>
            </tr>,
          ]
        : []),
      ...root.people.map((p) => childRow(root, p, "person")),
    ];
    if (!kids.length) {
      kids.push(
        <tr key={`${root.key}-empty`} className="hier-row hier-child">
          <td colSpan={colSpan}>
            <div className="hier-line indent">
              <span className="hier-meta">bağlı kayıt yok</span>
            </div>
          </td>
        </tr>
      );
    }
    return [head, ...kids];
  };

  return (
    <div className="listwrap">
      <div className={`list-head${routeMode ? " route" : ""}`}>
        <h2>{routeTitle ?? "List"}</h2>
        <span className="count">
          {hierarchy
            ? `${hierarchy.length} ${routeMode ? "grup" : "groups"}`
            : `${sorted.length} ${routeMode ? "kayıt" : "records"}`}
        </span>

        {network === "warm" && (
          <label className="warm-show-all">
            <input
              type="checkbox"
              checked={showAllWarm}
              onChange={(event) => setShowAllWarm(event.target.checked)}
            />
            <span>Tümünü göster</span>
            {!showAllWarm && warmHiddenCount > 0 && (
              <span className="warm-hidden-count">{warmHiddenCount} gizli</span>
            )}
          </label>
        )}

        {/* Preset pil şeridi yalnız network-içi liste kipinde. /lists/* rotasında
            preset'i rota seçtiği için ikinci bir seçim şeridi bloat olurdu. */}
        {!routeMode && (
          <div className="list-presets">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                className={`preset-btn ${preset === p.id ? "on" : ""}`}
                onClick={() => applyPreset(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        <div className="list-tools">
          {routeMode && (
            <>
              <label className="group-select">
                <span>Tip</span>
                <select
                  value={activePreset.type ?? typeFilter ?? "all"}
                  disabled={!!activePreset.type}
                  title={
                    activePreset.type
                      ? "Bu liste zaten tek tipten oluşuyor"
                      : undefined
                  }
                  onChange={(e) =>
                    onTypeFilterChange?.(
                      e.target.value === "all"
                        ? null
                        : (e.target.value as EntityType)
                    )
                  }
                >
                  <option value="all">Tümü</option>
                  {TYPE_FILTER_ORDER.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABELS_TR[t]}
                    </option>
                  ))}
                </select>
              </label>

              <input
                className="list-search"
                value={queryInput}
                placeholder="Ara…"
                onChange={(e) => setQueryInput(e.target.value)}
              />
            </>
          )}

          <label className="group-select">
            <span>{routeMode ? "Grup" : "Group"}</span>
            <select
              value={grouping}
              onChange={(e) => {
                setGrouping(e.target.value as GroupKey);
                setCollapsed(new Set());
              }}
            >
              {GROUPS.filter(
                // Takım hiyerarşisi yalnız takım kaydı olan listelerde anlamlı.
                (g) => g.key !== "hierarchy" || teamsExist || grouping === "hierarchy"
              ).map((g) => (
                <option key={g.key} value={g.key}>
                  {routeMode ? GROUP_LABELS_TR[g.key] : g.label}
                </option>
              ))}
            </select>
          </label>

          <div className="views-wrap" ref={viewsRef}>
            <button className="btn" onClick={() => setViewsOpen((o) => !o)}>
              Views ▾
            </button>
            {viewsOpen && (
              <div className="views-pop">
                {views.length === 0 ? (
                  <div className="views-empty">No saved views yet</div>
                ) : (
                  views.map((v) => (
                    <div key={v.name} className="views-row">
                      <button className="views-apply" onClick={() => applyView(v)}>
                        {v.name}
                        <span className="views-meta">
                          {PRESETS.find((p) => p.id === v.preset)?.label}
                          {v.grouping !== "none"
                            ? ` · by ${v.grouping}`
                            : ""}
                        </span>
                      </button>
                      <button
                        className="views-del"
                        title="Delete view"
                        onClick={() => deleteView(v.name)}
                      >
                        ✕
                      </button>
                    </div>
                  ))
                )}
                <div className="views-save">
                  <input
                    value={viewName}
                    placeholder="Save current as…"
                    onChange={(e) => setViewName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveView()}
                  />
                  <button
                    className="btn primary"
                    disabled={!viewName.trim()}
                    onClick={saveView}
                  >
                    Save
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="cols-wrap" ref={colsRef}>
            <button className="btn" onClick={() => setColsOpen((o) => !o)}>
              Columns ▾
            </button>
            {colsOpen && (
              <div className="cols-pop">
                {COLUMNS.map((c) => (
                  <label key={c.key} className="cols-row">
                    <input
                      type="checkbox"
                      checked={visible(c.key)}
                      onChange={() => toggleCol(c.key)}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>

          <button className="btn" onClick={() => setShowNew((s) => !s)}>
            + New
          </button>
        </div>
      </div>

      {showNew && (
        <div className="newform">
          <div className="field">
            <label>Type</label>
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as EntityType)}
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 200 }}>
            <label>Name</label>
            <input
              value={newName}
              autoFocus
              placeholder="Enter name…"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
          </div>
          <button className="btn primary" onClick={create}>
            Create
          </button>
        </div>
      )}

      <div className="list-table-frame">
        <table className="grid list-grid">
          <thead>
            {hierarchy ? (
              <tr>
                <th colSpan={colSpan}>Takım · kurum · kişiler</th>
              </tr>
            ) : (
              <tr>
                {th("name", "Name")}
                {activeCols.map((c) => th(c.key, c.label, c.num))}
                <th className="col-open" />
              </tr>
            )}
          </thead>
          <tbody>
            {hierarchy
              ? hierarchy.map(hierarchyRows)
              : groups === null
              ? sorted.map(row)
              : groups.map((g) => {
                  const isCollapsed = collapsed.has(g.label);
                  return [
                    <tr key={`h-${g.label}`} className="group-row">
                      <td colSpan={colSpan}>
                        <button
                          className="group-toggle"
                          onClick={() =>
                            setCollapsed((prev) => {
                              const n = new Set(prev);
                              n.has(g.label) ? n.delete(g.label) : n.add(g.label);
                              return n;
                            })
                          }
                        >
                          <span
                            className={`group-caret ${
                              isCollapsed ? "c" : ""
                            }`}
                          >
                            ▾
                          </span>
                          <span className="group-name">{g.label}</span>
                          <span className="group-count">{g.items.length}</span>
                        </button>
                      </td>
                    </tr>,
                    ...(isCollapsed ? [] : g.items.map(row)),
                  ];
                })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
