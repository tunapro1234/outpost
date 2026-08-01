import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { api } from "@/core/api";
import type {
  EntityListItem,
  TemasDurumu,
  TemasDurumuResult,
} from "@/core/types";

interface Props {
  hasHedef: boolean;
  onOpenEntity: (id: string) => void;
}

interface TodayItem extends EntityListItem {
  temas: TemasDurumuResult;
}

const ACTIONS: Array<{ durum: TemasDurumu; label: string }> = [
  { durum: "yazildi", label: "Yazdım" },
  { durum: "cevaplanacak", label: "Cevap geldi" },
  { durum: "gorusuldu", label: "Görüştüm" },
  { durum: "kapandi", label: "Kapat" },
];

function byOrder(left: TodayItem, right: TodayItem): number {
  // Önce katman (katman-1 = sıcak, önce), sonra katman içi sıra. `sira`
  // katmanlar arasında paylaşılan bir sayaç değildir; tek başına sıralanmaz.
  const leftLayer = Number(left.katman ?? Number.POSITIVE_INFINITY) || Number.POSITIVE_INFINITY;
  const rightLayer = Number(right.katman ?? Number.POSITIVE_INFINITY) || Number.POSITIVE_INFINITY;
  const leftOrder = left.sira ?? Number.POSITIVE_INFINITY;
  const rightOrder = right.sira ?? Number.POSITIVE_INFINITY;
  return (
    leftLayer - rightLayer ||
    leftOrder - rightOrder ||
    left.name.localeCompare(right.name, "tr")
  );
}

function dayNumber(timestamp: string | null): string | null {
  if (!timestamp) return null;
  const then = new Date(timestamp);
  if (Number.isNaN(then.getTime())) return null;
  const now = new Date();
  const localDay = (date: Date) => Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const elapsed = Math.max(0, Math.floor((localDay(now) - localDay(then)) / 86_400_000));
  return `${elapsed + 1}. gün`;
}

function confidence(item: TodayItem): string {
  return item.kimlik_guveni ?? item.guven ?? "belirsiz";
}

function channel(item: TodayItem): string {
  return item.birincil_kanal ?? item.contact_channel ?? "kanal yok";
}

function Policy({ item }: { item: TodayItem }) {
  if (item.politika_durumu === "no_contact") {
    return <span className="today-policy no-contact" title={item.politika_metni ?? "Temas yok"}>🔴</span>;
  }
  if (item.politika_durumu === "defer") {
    return <span className="today-policy defer" title={item.politika_metni ?? "Ertelendi"}>⏸</span>;
  }
  return null;
}

function ContactRow({
  item,
  busy,
  waitingDay,
  onOpen,
  onPatch,
}: {
  item: TodayItem;
  busy: boolean;
  waitingDay?: boolean;
  onOpen: () => void;
  onPatch: (durum: TemasDurumu) => void;
}) {
  const openFromKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen();
    }
  };
  return (
    <article
      className={`today-row${busy ? " busy" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={openFromKey}
      aria-label={`${item.name} kişi kartını aç`}
    >
      <div className="today-row-copy">
        <div className="today-row-main">
          <strong>{item.name}</strong>
          <span className="today-org">{item.org ?? "Kurum yok"}</span>
          <Policy item={item} />
        </div>
        <div className="today-row-meta">
          <span className={`today-confidence confidence-${confidence(item)}`}>
            {confidence(item)}
          </span>
          <span className="today-channel">{channel(item)}</span>
          {waitingDay && <span className="today-day">{dayNumber(item.temas.guncelleme_ts)}</span>}
        </div>
      </div>
      <details
        className="today-actions"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <summary aria-label={`${item.name} durumunu değiştir`} title="Durumu değiştir">
          •••
        </summary>
        <div className="today-action-menu">
          {ACTIONS.map((action) => (
            <button
              key={action.durum}
              type="button"
              disabled={busy || item.temas.durum === action.durum}
              onClick={() => onPatch(action.durum)}
            >
              {action.label}
            </button>
          ))}
        </div>
      </details>
    </article>
  );
}

function Column({
  title,
  items,
  emphasis = false,
  waitingDay = false,
  busyId,
  onOpenEntity,
  onPatch,
}: {
  title: string;
  items: TodayItem[];
  emphasis?: boolean;
  waitingDay?: boolean;
  busyId: string | null;
  onOpenEntity: (id: string) => void;
  onPatch: (id: string, durum: TemasDurumu) => void;
}) {
  return (
    <section className={`today-column${emphasis ? " emphasis" : ""}`}>
      <header>
        <h2>{title}</h2>
        <span>{items.length}</span>
      </header>
      <div className="today-column-list">
        {items.length === 0 && <div className="today-column-empty">Şimdilik boş</div>}
        {items.map((item) => (
          <ContactRow
            key={item.id}
            item={item}
            busy={busyId === item.id}
            waitingDay={waitingDay}
            onOpen={() => onOpenEntity(item.id)}
            onPatch={(durum) => onPatch(item.id, durum)}
          />
        ))}
      </div>
    </section>
  );
}

export default function TodayView({ hasHedef, onOpenEntity }: Props) {
  const [items, setItems] = useState<TodayItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!hasHedef) {
      setItems([]);
      setLoading(false);
      setError(null);
      return () => { alive = false; };
    }
    setLoading(true);
    setError(null);
    api.todayEntities()
      .then(async (entities) => {
        const states = await Promise.all(entities.map((entity) => api.temas(entity.id)));
        if (!alive) return;
        const byId = new Map(states.map((state) => [state.entity_id, state]));
        setItems(entities.map((entity) => ({
          ...entity,
          temas: byId.get(entity.id)!,
        })));
      })
      .catch((reason) => {
        if (alive) setError(reason instanceof Error ? reason.message : "Panel yüklenemedi");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [hasHedef]);

  const groups = useMemo(() => ({
    next: items
      .filter((item) => item.temas.durum === "yazilmadi" && !item.politika_durumu)
      .sort(byOrder),
    deferred: items
      .filter((item) => item.temas.durum === "yazilmadi" && item.politika_durumu === "defer")
      .sort(byOrder),
    waiting: items
      .filter((item) => ["yazildi", "cevap_bekleniyor"].includes(item.temas.durum))
      .sort(byOrder),
    answer: items
      .filter((item) => item.temas.durum === "cevaplanacak")
      .sort(byOrder),
    met: items.filter((item) => item.temas.durum === "gorusuldu").length,
  }), [items]);

  const patch = async (id: string, durum: TemasDurumu) => {
    setBusyId(id);
    setError(null);
    try {
      const temas = await api.patchTemas(id, durum);
      setItems((current) => current.map((item) =>
        item.id === id ? { ...item, temas } : item
      ));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Durum değiştirilemedi");
    } finally {
      setBusyId(null);
    }
  };

  if (!hasHedef) {
    return (
      <div className="view-pad today-view today-empty-state">
        <h1>Bugün</h1>
        <p>Bu workspace’te <strong>hedef</strong> network’ü yok.</p>
      </div>
    );
  }

  return (
    <div className="view-pad today-view">
      <div className="today-heading">
        <div>
          <h1>Bugün ne yapacağım?</h1>
          <p>Durum düğmeleri yalnızca paneli günceller; mesaj göndermez.</p>
        </div>
        <span className="today-network-chip">hedef</span>
      </div>
      {error && <div className="today-error" role="alert">{error}</div>}
      {loading ? (
        <div className="today-loading">Temas listesi yükleniyor…</div>
      ) : (
        <>
          <div className="today-board">
            <div className="today-next-stack">
              <Column
                title="Sıradaki"
                items={groups.next}
                busyId={busyId}
                onOpenEntity={onOpenEntity}
                onPatch={patch}
              />
              {groups.deferred.length > 0 && (
                <details className="today-deferred">
                  <summary>⏸ ertelenmiş ({groups.deferred.length})</summary>
                  <div className="today-column-list">
                    {groups.deferred.map((item) => (
                      <ContactRow
                        key={item.id}
                        item={item}
                        busy={busyId === item.id}
                        onOpen={() => onOpenEntity(item.id)}
                        onPatch={(durum) => patch(item.id, durum)}
                      />
                    ))}
                  </div>
                </details>
              )}
            </div>
            <Column
              title="Cevap bekleyen"
              items={groups.waiting}
              waitingDay
              busyId={busyId}
              onOpenEntity={onOpenEntity}
              onPatch={patch}
            />
            <Column
              title="Cevaplanacak"
              items={groups.answer}
              emphasis
              busyId={busyId}
              onOpenEntity={onOpenEntity}
              onPatch={patch}
            />
          </div>
          <footer className="today-footer">görüşüldü: {groups.met}</footer>
        </>
      )}
    </div>
  );
}
