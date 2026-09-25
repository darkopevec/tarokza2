import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { io } from "socket.io-client";
import { cardFor, createDeck } from "../shared/cards.mjs";
import { prepareCardImages, registerCardCache } from './card-images.mjs';
import { CARD_DECKS, cardBackImage, cardImage, getDeck, setDeck, subscribeDeck } from './decks.mjs';
import { explainScoreRow } from "./score-explanation.mjs";
import {
  ArrowRight,
  ArrowUpRight,
  ArrowDownToLine,
  Check,
  ChevronLeft,
  CircleHelp,
  Copy,
  Diamond,
  Flag,
  Layers3,
  Link,
  LoaderCircle,
  LogOut,
  Plus,
  Share2,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { DEVICE, PENDING_DEVICE, newSecret, captureLink, sharedLink, LinkCard, IdentityHome, DeviceSettings } from './identity-ui.jsx';
import './identity.css';
import "./styles.css";
import "./responsive.css";
import "./language.css";
import "./deck.css";
import { t, translateMessage, cardName, getLocale, setLocale, subscribeLocale, languages, trickCountLabel } from "./i18n.mjs";

const incomingLink = captureLink();
const STORAGE = "tarokza2.session";
const SESSIONS = "tarokza2.sessions";
const NAME = "tarokza2.name";
const suits = {
  tarok: "Taroki",
  spades: "Pik",
  hearts: "Srce",
  clubs: "Križ",
  diamonds: "Karo",
};
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const bonusNames = { kings: "Kralji", trula: "Trula", valat: "Valat" };
const scoreNames = { game: "Igra", ...bonusNames, mondfang: "Mondfang" };
const readSaved = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
};
function legacySeats() {
  const saved = [...Object.values(readSaved(SESSIONS) || {}), readSaved(STORAGE)].filter(s => s?.roomId && s?.token);
  return saved.filter((s, i) => saved.findIndex(x => x.roomId === s.roomId && x.token === s.token) === i);
}

function Card({
  card,
  back = false,
  small = false,
  onPlay,
  legal = false,
  disabled = false,
  decorative = false,
}) {
  const selectedDeck = useSyncExternalStore(subscribeDeck, getDeck, getDeck);
  const Tag = onPlay ? "button" : "div";
  if (back)
    return (
      <div
        className={`playing-card card-back ${small ? "small" : ""}`}
        aria-label={t("Zaprta karta")}
      >
        <img className="card-back-image" src={cardBackImage(selectedDeck)} decoding="sync" loading="eager" fetchPriority="high" alt="" draggable="false" />
      </div>
    );
  card = cardFor(card.id) || card;
  return (
    <Tag
      className={`playing-card ${small ? "small" : ""} ${card.suit} ${legal ? "legal" : ""} ${onPlay && !legal ? "unplayable" : ""} ${decorative ? "decorative" : ""}`}
      data-card-id={card.id}
      title={cardName(card)}
      {...(onPlay
        ? {
            onClick: () => onPlay(card.id),
            disabled: disabled || !legal,
            "data-testid": "play-card",
            "data-card-id": card.id,
            type: "button",
            "aria-label": t("Igraj {card}", { card: cardName(card) }),
          }
        : { "aria-label": cardName(card) })}
    >
      <img className="card-face-image" src={cardImage(card, selectedDeck) || card.image} decoding="sync" loading="eager" fetchPriority="high" alt={cardName(card)} draggable="false" />
    </Tag>
  );
}

function Logo({ onClick }) {
  return (
    <button
      type="button"
      className="logo"
      onClick={onClick}
      aria-label={t("TarokZa2 — domov")}
    >
      <span className="logo-mark">
        <Diamond size={24} strokeWidth={1.4} />
        <span />
      </span>
      <span>
        tarok<span className="logo-za">za</span>
        <b>2</b>
        <span className="logo-dot">.</span>
      </span>
    </button>
  );
}
function Avatar({ name, you = false, connected = true }) {
  return (
    <span className={`avatar ${you ? "you" : ""}`}>
      {name?.slice(0, 1).toLocaleUpperCase(getLocale()) || "?"}
      <i className={connected ? "online" : "offline"} />
    </span>
  );
}

function Modal({ title, children, onClose, wide = false, className = "" }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.querySelector("button")?.focus();
    const handler = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const all = [...(ref.current?.querySelectorAll(
          'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex]:not([tabindex="-1"])',
        ) || [])].filter(element => element.getClientRects().length > 0 && element.tabIndex >= 0);
        if (!all?.length) return;
        const first = all[0],
          last = all[all.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className={`modal ${wide ? "wide" : ""} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button className="icon-button" aria-label={t("Zapri")} onClick={onClose}>
            <X size={21} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function DeckGallery({ onClose, selectedDeck }) {
  const deck = createDeck();
  return <Modal title={t("Prave tarok karte")} onClose={onClose} className="deck-modal">
    <div className="deck-intro">
      <label className="deck-picker">
        <span>{t("Komplet kart")}</span>
        <select value={selectedDeck} onChange={event => setDeck(event.target.value)} data-testid="deck-select">
          {CARD_DECKS.map(deck => <option key={deck.id} value={deck.id}>{t(deck.name)}</option>)}
        </select>
      </label>
      <p className="deck-preference-note">{t("Izbrani komplet velja samo v tem brskalniku.")}</p>
      <span className="eyebrow">{t("CELOTEN KOMPLET · 54 KART")}</span>
      <p>{t("22 tarokov in po 8 kart vsake barve. Prikazane so od najmočnejše do najšibkejše.")}</p>
      <p>{t("Figure so kralj, dama, kaval in fant. V srcu in karu so še karte z enim, dvema, tremi in štirimi znaki; v piku in križu so 10, 9, 8 in 7.")}</p>
    </div>
    {Object.entries(suits).map(([suit, label]) => <section className="deck-section" key={suit}>
      <h3>{t(label)}<span>{t("{count} kart", { count: suit === "tarok" ? 22 : 8 })}</span></h3>
      <div className="deck-cards">{deck.filter(card => card.suit === suit).sort((a, b) => b.rank - a.rank).map(card => <div className="deck-card" key={card.id}>
        <Card card={card}/><span>{cardName(card)}</span>
      </div>)}</div>
    </section>)}
    {selectedDeck === 'smrekar'
      ? <p className="deck-credit">Hinko Smrekar (1910–1912). {t("41 izvirnih kart in hrbet; 13 platlcev je rekonstruiranih iz znakov barv na izvirnih kartah.")} <a href="https://commons.wikimedia.org/wiki/Category:Smrekar%27s_Tarot" target="_blank" rel="noreferrer">Wikimedia Commons</a>. <a href="/cards/smrekar/sources.json" target="_blank" rel="noreferrer">{t("Viri kart")}</a>.</p>
      : selectedDeck === 'slovenian'
      ? <p className="deck-credit">{t("Slovenski tarok · Piatnik")}. {t("Taroki in figure: slovenski-tarok.si. Preostale karte so sestavljene iz znakov barv na izvirnih kartah.")} <a href="https://slovenski-tarok.si" target="_blank" rel="noreferrer">slovenski-tarok.si</a>. <a href="/cards/slovenian/sources.json" target="_blank" rel="noreferrer">{t("Viri kart")}</a>.</p>
      : <p className="deck-credit">{t("S. Modiano · Tarok Študentski servis Maribor (1995). Fotografije: Martin Okrslar,")} <a href="https://commons.wikimedia.org/wiki/Category:Industrie_und_Gl%C3%BCck" target="_blank" rel="noreferrer">Wikimedia Commons</a>. <a href="/cards/deck/sources.json" target="_blank" rel="noreferrer">{t("Viri fotografij")}</a>.</p>}
  </Modal>;
}

function Rules({ onClose }) {
  return (
    <Modal title={t("Za dobro igro")} onClose={onClose}>
      <div className="rules-content">
        <span className="eyebrow">{t("SLOVENSKI TAROK V DVEH · NAPOLEON")}</span>
        <p>{t("Dva igralca, 54 kart in 27 štihov. Cilj je zbrati vsaj 36 od skupno 70 točk v kartah.")} </p>
        <ol>
          <li>{t("Najprej karte. Vsak dobi 15 kart v roko in tri zaprte kupčke po štiri karte. Prvi govori igralec, ki ne deli.")} </li>
          <li>{t("Igram ali naprej? Z »Igram« napoveš zmago. Če oba izbereta »Naprej«, igrata navadno igro.")} </li>
          <li>{t("Odpri kupčke. Po napovedi se vrhnje karte razkrijejo. Taroka ali kralja lahko vzameš v roko ali ga pustiš na kupčku. Ob kupčku izberi »Vzemi v roko« za posamezno karto. Prevzem je dovoljen tudi med nasprotnikovo potezo in ga lahko opraviš pozneje. Razkrije se naslednja karta; tudi zanjo se odločiš posebej. Prevzem ne porabi poteze.")} </li>
          <li>{t("Začni igro. Po izbiri »Igram« ali dveh »Naprej« lahko takoj odigraš prvo karto. Začne igralec, ki ni delil.")} </li>
          <li>{t("Sledi barvi. Upoštevajo se tudi odprte karte na kupčkih. Če nimaš barve, moraš igrati taroka; če nimaš niti taroka, lahko odvržeš poljubno karto. Ni treba igrati višje karte.")} </li>
          <li>{t("Začni iz roke. Karto s kupčka lahko priložiš nasprotnikovi karti. Z njo lahko začneš štih šele, ko je roka prazna. Višji tarok ali višja karta začetne barve pobere štih.")} </li>
        </ol>
        <div className="rule-score">
          <Trophy size={22} />
          <div>
            <strong>{t("Kako se piše rezultat?")}</strong>
            <p>{t("Šteje razlika od 35 točk. Napovedana zmaga: razlika × 2. Napovedan poraz: manjkajoče točke × −3. V navadni igri dobi zmagovalec razliko × 1. Pri 35 : 35 se zapiše 0.")} </p>
            <p>{t("Vsi štirje kralji ali cela trula v tvojih štihih: +10. Ni dovolj, da so karte v roki. Valat pomeni vseh 27 štihov: +250. Valat nadomesti osnovno igro, kralje in trulo. Mondfang: če škis pobere tvojega monda, dobiš −21, tudi ob valatu.")} </p>
          </div>
        </div>
        <p className="rules-small">{t("Štetje: od vsote vrednosti vsake trojice odštejemo 2; pri eni ali dveh preostalih kartah odštejemo 1. Trula in kralji so vredni po 5, dama 4, kaval 3, fant 2, ostale karte 1. Ni konter, radelcev ali napovedi ultimo. Napovedi so dokončne. Če oba napovesta valat, vsak zase piše +500 ali −500 glede na uspeh. Dodatki so dogovorjena pravila TarokZa2.")} </p>
        <p className="rules-small">{t("Osnova:")}{" "}
          <a
            href="https://www.tarok.net/pravila108.pdf"
            target="_blank"
            rel="noreferrer"
          >{t("Tarok.net, poglavji 2.1 in 2.2")} <ArrowUpRight size={12} />
          </a>{t(". Delitev in kupčki sledijo opisu")}{" "}
          <a
            href="https://slovenski-tarok.si/pravila.html"
            target="_blank"
            rel="noreferrer"
          >{t("Slovenski tarok")} <ArrowUpRight size={12} />
          </a>
          .
        </p>
      </div>
    </Modal>
  );
}

function ScoreTable({ game }) {
  return (
    <div className="score-table-wrap">
      <table className="score-table">
        <thead>
          <tr>
            <th>{t("RUNDA")}</th>
            {game.players.map((p) => (
              <th key={p.id}>{p.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {game.scoreboard.map((row) => {
            const explanation = explainScoreRow(row, game.players, getLocale());
            return <React.Fragment key={row.round}>
            <tr data-testid="scoreboard-row">
              <td>
                <strong>{String(row.round).padStart(2, "0")}</strong>
                <small>
                  {row.breakdown?.some(entry => entry.kind === "valat")
                    ? row.breakdown.some(entry => entry.kind === "valat" && entry.announced) ? t("Napovedan valat") : t("Tihi valat")
                    : row.contract.kind === "announced" ? t("Napovedana igra") : t("Navadna igra")}
                </small>
                {explanation.bidder && <small className="score-bidder" data-testid="score-bidder">{t("Napoved igre: {player}", { player: explanation.bidder })}</small>}
                {row.scoringVersion !== 2 && <small>{t("Prejšnja pravila")}</small>}
              </td>
              {row.deltas.map((n, i) => (
                <td key={i}>
                  <strong
                    className={n > 0 ? "positive" : n < 0 ? "negative" : ""}
                  >
                    {signed(n)}
                  </strong>
                  <small>{t("{points} točk v kartah", { points: row.points[i] })}</small>
                  {!!row.breakdown && <div className="score-breakdown" data-testid="score-breakdown" data-player={i}>
                    {row.breakdown.filter(entry => entry.player === i).map((entry, index) => (
                      <span key={`${entry.kind}-${index}`} data-testid="score-breakdown-entry"
                        data-player={i} data-kind={entry.kind} data-points={entry.points}>
                        <span>{entry.announced ? t("Nap. ") : ""}{t(scoreNames[entry.kind] || entry.kind)}</span>
                        <b className={entry.points > 0 ? "positive" : entry.points < 0 ? "negative" : ""}>{signed(entry.points)}</b>
                      </span>
                    ))}
                  </div>}
                </td>
              ))}
            </tr>
            <tr className="score-details-row">
              <td colSpan={game.players.length + 1}>
                <details className="score-details" data-testid="score-details" data-round={row.round}>
                  <summary aria-label={t("Izračun za rundo {round}", { round: row.round })}>
                    <CircleHelp size={16} aria-hidden="true" /> {t("Izračun runde {round}", { round: row.round })}
                  </summary>
                  <div className="score-calculation" aria-label={t("Izračun za rundo {round}", { round: row.round })}>
                    {explanation.notes.map((note, index) => <p className="score-calculation-note" key={index}>{note}</p>)}
                    <div className="score-calculation-players">
                      {explanation.players.map((player, index) => <section className="score-calculation-player" key={index}>
                        <h3>{player.name}</h3>
                        <ul>
                          {player.lines.map((line, lineIndex) => <li key={lineIndex}>
                            <span>{line.label}</span>
                            {line.calculation && <span className="score-formula">{line.calculation}</span>}
                          </li>)}
                        </ul>
                        <p className="score-calculation-total"><span>{t("Rezultat runde")}</span><strong>{player.total}</strong></p>
                      </section>)}
                    </div>
                  </div>
                </details>
              </td>
            </tr>
            </React.Fragment>;
          })}
        </tbody>
        <tfoot>
          <tr>
            <th>{t("Skupaj")}</th>
            {game.players.map((p) => (
              <td key={p.id}>{signed(p.score)}</td>
            ))}
          </tr>
        </tfoot>
      </table>
      {!game.scoreboard.length && (
        <p className="empty-score">{t("Prva runda še poteka. Rezultat te počaka tukaj.")} </p>
      )}
    </div>
  );
}

function Waiting({ state, onCopy, onLeave, invitation, onInvite, onDevices }) {
  const url = invitation ? sharedLink("invite", invitation, state.roomId) : "";
  return (
    <main className="waiting-page">
      <button className="text-button" onClick={onLeave}>
        <ChevronLeft size={16} /> {t("Nazaj")} </button>
      <div className="waiting-layout">
        <div className="waiting-copy">
          <span className="eyebrow">{t("DOBRODOŠEL ZA MIZO")}</span>
          <h1>{t("Še prijatelj.")} <br />
            <em>{t("Pa začnemo.")}</em>
          </h1>
          <p>{t("Vse je pripravljeno za vajino partijo.")} <br />{t("Pošlji povabilo in počakaj, da prisedeta oba.")} </p>
          <div className="invite-box">
            <span className="field-label">{t("TVOJA MIZA")}</span>
            <strong data-testid="room-code">{state.roomId}</strong>
            <LinkCard url={url} title={t("Povabilo za prijatelja")} onCopy={onCopy} />
            <button className="secondary-button" onClick={onInvite}>{url ? t("Zamenjaj povabilo") : t("Ustvari povabilo")}</button>
            <p>{t("Novo povabilo razveljavi prejšnje.")}</p>
          </div>
          <p className="private-note">
            <ShieldCheck size={15} /> {t("Samo oseba s povabilom se lahko pridruži.")} </p>
          <button className="text-button" onClick={onDevices}>{t("Shrani obnovitveno povezavo za svoje mize")}</button>
        </div>
        <div className="waiting-table felt">
          <div className="felt-border" />
          <div className="waiting-seat vacant">
            <span className="avatar empty">
              <Plus size={24} />
            </span>
            <span>{t("Prosto mesto")}</span>
            <small>{t("Čakamo prijatelja")} <span className="loading-dots" />
            </small>
          </div>
          <div className="waiting-deck">
            <Card back />
            <Card back />
            <Card back />
          </div>
          <div className="table-wordmark">
            tarokza2<span>.</span>
          </div>
          <div className="waiting-seat">
            <Avatar name={state.players[0].name} you />
            <strong>{state.players[0].name}</strong>
            <small>
              <span className="status-dot" /> {t("Za mizo")} </small>
          </div>
        </div>
      </div>
    </main>
  );
}

function Stacks({ player, mine, legalMoves, legalPickups = [], onPlay, onPickup, disabled }) {
  return (
    <div className={`stacks ${mine ? "my-stacks" : ""}`} tabIndex={mine ? -1 : undefined}
      data-testid={mine ? "pickup-options" : undefined} aria-label={mine ? t("Tvoji kupčki in neobvezni prevzemi") : undefined}>
      <span className="stacks-label">{mine ? t("TVOJI KUPČKI") : t("{player} · KUPČKI", { player: player.name })}</span>
      <div className="stack-cards">
        {player.stacks.map((stack, i) => (
          <div className="stack-slot" key={i}>
            <div className={`stack ${!stack.count ? "empty-stack" : ""}`}
              data-stack-index={i} data-stack-count={stack.count} data-top-card-id={stack.top?.id || ""}>
              {stack.count ? (
                <>
                  <span className="stack-under" />
                  {stack.top ? (
                    <Card
                      card={stack.top}
                      small
                      onPlay={mine ? onPlay : undefined}
                      legal={legalMoves.includes(stack.top.id)}
                      disabled={disabled}
                    />
                  ) : (
                    <Card back small />
                  )}
                  <span className="stack-count" aria-label={t("{count} kart na kupčku", { count: stack.count })}>{stack.count}</span>
                </>
              ) : (
                <span className="empty-stack-mark">·</span>
              )}
            </div>
            {mine && <div className="stack-pickup-space">
              {stack.top && legalPickups.includes(stack.top.id) && <button type="button" className="stack-pickup"
                data-testid="pickup-card" data-card-id={stack.top.id} data-stack-index={i}
                aria-label={t("Vzemi {card} v roko", { card: cardName(stack.top) })} disabled={disabled}
                onClick={() => onPickup(stack.top.id)}>
                <span>{t("Vzemi v roko")}</span>
              </button>}
            </div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// Viewport coordinates keep the flight aligned even when the table is scaled.
function PickupFlight({ pickup, playerName }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const source = document.querySelector(`.opponent-stacks [data-stack-index="${pickup.stack}"]`);
    const target = document.querySelector('.pickup-hand-target');
    if (!source || !target || !ref.current) return;
    const from = source.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const element = ref.current;
    Object.assign(element.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` });
    element.style.setProperty('--card-height', `${from.height}px`);
    const dx = to.left + to.width / 2 - from.left - from.width / 2;
    const dy = to.top + to.height / 2 - from.top - from.height / 2;
    const scale = Math.min(1.35, (innerWidth - 16) / from.width);
    const liftX = Math.max(8 + from.width * scale / 2, Math.min(innerWidth - 8 - from.width * scale / 2, from.left + from.width / 2 + dx * .2)) - from.left - from.width / 2;
    const liftY = Math.max(8 + from.height * scale / 2, from.top + from.height / 2 + dy * .25) - from.top - from.height / 2;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animation = element.animate(reduced ? [{ opacity: 1 }, { opacity: 0 }] : [
      { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 0 },
      { transform: `translate(${liftX}px, ${liftY}px) scale(${scale})`, opacity: 1, offset: .3 },
      { transform: `translate(${liftX}px, ${liftY}px) scale(${scale})`, opacity: 1, offset: .6 },
      { transform: `translate(${dx}px, ${dy}px) scale(${to.height / from.height})`, opacity: 0, offset: 1 },
    ], { duration: reduced ? 200 : 1400, easing: 'ease-in-out', fill: 'forwards' });
    return () => animation.cancel();
  }, [pickup]);
  return createPortal(<>
    <div ref={ref} className="pickup-flight" data-testid="pickup-flight" aria-hidden="true"><Card card={pickup.card} /></div>
    <span className="pickup-announcement" role="status">{t("{player} vzame v roko: {card}.", { player: playerName, card: cardName(pickup.card) })}</span>
  </>, document.body);
}

// Completed tricks own their animation, independently of the next live trick.
const TRICK_HOLD_MS = 1750;
const TRICK_FLIGHT_MS = 1400;
function TrickCollection({ trick, you, players, collectNow, onComplete }) {
  const ref = useRef(null);
  const animationRef = useRef(null);
  useLayoutEffect(() => {
    const element = ref.current;
    const source = document.querySelector('.game-table .trick-cards');
    const target = document.querySelector(trick.winner === you ? '.game-table .trick-stat' : '.game-table .player-seat');
    const card = document.querySelector('.game-table .stack');
    if (!element || !source || !target || !card) { onComplete(trick.key); return; }
    element.style.setProperty('--card-height', `${card.getBoundingClientRect().height}px`);
    const from = source.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const own = element.getBoundingClientRect();
    const x = from.left + from.width / 2;
    const y = from.top + from.height / 2;
    Object.assign(element.style, { left: `${x - own.width / 2}px`, top: `${y - own.height / 2}px` });
    const dx = to.left + to.width / 2 - x;
    const dy = to.top + to.height / 2 - y;
    const scale = Math.max(1, Math.min(1.25, (innerWidth - 32) / own.width, (innerHeight - 32) / own.height));
    const clampCenter = (value, size, limit) => Math.max(16 + size / 2, Math.min(limit - 16 - size / 2, value));
    const liftX = clampCenter(x + dx * .2, own.width * scale, innerWidth) - x;
    const liftY = clampCenter(y + dy * .25, own.height * scale, innerHeight) - y;
    const lifted = `translate(${liftX}px, ${liftY}px) scale(${scale})`;
    const duration = TRICK_HOLD_MS + TRICK_FLIGHT_MS;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animation = element.animate(reduced ? [{ opacity: 1 }, { opacity: 0 }] : [
      { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 0 },
      { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: TRICK_HOLD_MS / duration, easing: 'ease-in-out' },
      { transform: lifted, opacity: 1, offset: (TRICK_HOLD_MS + TRICK_FLIGHT_MS * .3) / duration },
      { transform: lifted, opacity: 1, offset: (TRICK_HOLD_MS + TRICK_FLIGHT_MS * .6) / duration, easing: 'ease-in-out' },
      { transform: `translate(${dx}px, ${dy}px) scale(.15)`, opacity: 0, offset: 1 },
    ], { duration: reduced ? 200 : duration, fill: 'forwards' });
    animationRef.current = { animation, reduced };
    animation.finished.then(() => onComplete(trick.key)).catch(() => {});
    return () => { animation.cancel(); animationRef.current = null; };
  }, [trick, you, onComplete]);
  useLayoutEffect(() => {
    const current = animationRef.current;
    if (collectNow && current && !current.reduced && current.animation.currentTime < TRICK_HOLD_MS) {
      current.animation.currentTime = TRICK_HOLD_MS;
    }
  }, [collectNow]);
  return createPortal(<div ref={ref} className="trick-collection" style={{ animation: 'none' }}
    aria-hidden="true" data-testid="trick-collection" data-winner={trick.winner}>
    {trick.cards.map(t => <div className={`played-card ${t.player === you ? 'my-played' : ''}`} key={t.card.id}>
      <Card card={t.card} /><span>{players[t.player].name}</span>
    </div>)}
  </div>, document.body);
}

function Game({ state, busy, action, onScore, onRules }) {
  const g = state.game;
  const you = g.you;
  const opponent = 1 - you;
  const me = g.players[you];
  const other = g.players[opponent];
  const myTurn = g.turn === you;
  const conn = state.players.find((p) => p.id === other.id)?.connected;
  const opponentIsPlaying = g.contract.kind === "announced" && g.contract.player === opponent;
  const [bidReveal, setBidReveal] = useState(false);
  useEffect(() => {
    setBidReveal(opponentIsPlaying);
    if (!opponentIsPlaying) return;
    const timer = setTimeout(() => setBidReveal(false), 4500);
    return () => clearTimeout(timer);
  }, [g.round, opponentIsPlaying]);
  const [completedTricks, setCompletedTricks] = useState([]);
  const finishCollection = useCallback(key => setCompletedTricks(tricks => tricks.filter(trick => trick.key !== key)), []);
  const settling = completedTricks.length > 0;
  const [pickupReveals, setPickupReveals] = useState([]);
  const seenPickups = useRef({ round: g.round, count: g.pickups?.length || 0 });
  const pickupReveal = pickupReveals[0];
  useEffect(() => {
    const pickups = g.pickups || [];
    const previous = seenPickups.current;
    if (previous.round !== g.round || pickups.length < previous.count) {
      setPickupReveals([]);
    } else {
      const incoming = pickups.slice(previous.count).filter(pickup => pickup.player !== you);
      if (incoming.length) setPickupReveals(queue => [...queue, ...incoming]);
    }
    seenPickups.current = { round: g.round, count: pickups.length };
  }, [g.round, g.pickups, you]);
  useEffect(() => {
    if (!pickupReveal || bidReveal) return;
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 250 : 1450;
    const timer = setTimeout(() => setPickupReveals(queue => queue.slice(1)), duration);
    return () => clearTimeout(timer);
  }, [pickupReveal, bidReveal]);
  const handRef = useRef(null);
  const [handOverflows, setHandOverflows] = useState(false);
  const handSignature = g.hand.map(card => card.id).join(",");
  useEffect(() => {
    const hand = handRef.current;
    if (!hand) return;
    const update = () => setHandOverflows(hand.scrollWidth > hand.clientWidth + 2);
    const observer = new ResizeObserver(update);
    observer.observe(hand);
    update();
    return () => observer.disconnect();
  }, [handSignature, g.phase]);
  const lastTrickKey = g.lastTrick ? `${g.round}:${g.lastTrick.number}` : null;
  const seenTrick = useRef(lastTrickKey);
  const newTrickPending = !!g.lastTrick && lastTrickKey !== seenTrick.current;
  useLayoutEffect(() => {
    const isNewTrick = lastTrickKey !== seenTrick.current;
    seenTrick.current = lastTrickKey;
    if (!g.lastTrick) { setCompletedTricks([]); return; }
    // Restoring a saved result must not replay its last trick.
    if (isNewTrick && ["playing", "roundEnd"].includes(g.phase)) {
      setCompletedTricks(tricks => [...tricks, { ...g.lastTrick, key: lastTrickKey }]);
    }
  }, [lastTrickKey]);
  const cardsOnTable = g.trick;
  // Keep the fitted table mounted until the final trick has been captured for
  // animation; briefly rendering results here discards its fitted card size.
  const showRoundEnd = g.phase === "roundEnd" && !settling && !newTrickPending;
  const resultsRef = useRef(null);
  useLayoutEffect(() => {
    if (showRoundEnd && resultsRef.current) {
      resultsRef.current.scrollTop = resultsRef.current.scrollHeight;
    }
  }, [showRoundEnd, g.scoreboard.at(-1)?.round]);
  // Bind the intent to the table the player actually saw, not a newer socket
  // snapshot: a reply from another tab must never become the next trick's lead.
  const play = (cardId) => action({
    type: "play", cardId,
    expectedPlay: { round: g.round, trickNumber: g.trickNumber, trickSize: g.trick.length },
  });
  const last = g.scoreboard.at(-1);
  const valats = last?.breakdown?.filter(entry => entry.kind === "valat") || [];
  const myValat = valats.find(entry => entry.player === you);
  const scoreWinner = !last || last.deltas[0] === last.deltas[1]
    ? null : last.deltas[0] > last.deltas[1] ? 0 : 1;
  const resultHeading = valats.length
    ? (myValat ? myValat.success : valats.some(entry => entry.success)) ? t("Valat!") : t("Valat ni uspel.")
    : scoreWinner === you ? t("Lepa igra!") : scoreWinner === null ? t("Izenačeno!") : t("Dobra partija.");
  const resultDescription = valats.length
    ? `${valats.map(entry => `${g.players[entry.player].name}: ${entry.announced
      ? entry.success ? t("uspešno napovedan valat") : t("neuspešno napovedan valat")
      : t("tihi valat")} (${signed(entry.points)})`).join(". ")}.`
    : !last ? "" : last.winner === null
      ? t("Oba sta zbrala {points} točk v kartah.", { points: last.points[0] })
      : t("{player}: {points} točk v kartah.", { player: g.players[last.winner].name, points: last.points[last.winner] });
  const groups = Object.keys(suits)
    .map((suit) => ({ suit, cards: g.hand.filter((c) => c.suit === suit) }));
  const latestPickup = g.pickups?.at(-1);
  const pickup = (cardId) => action({ type: "pickup", cardId });
  const showSuit = (suit) => {
    const hand = handRef.current;
    const group = hand?.querySelector(`[data-suit="${suit}"]`);
    if (!group) return;
    hand.scrollTo({
      left: hand.scrollLeft + group.getBoundingClientRect().left - hand.getBoundingClientRect().left - 4,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  };
  const tricksButton = (
    <button className="trick-stat" type="button" data-testid="my-tricks"
      aria-label={t("Tvoji štihi ({count})", { count: me.trickCount })} aria-haspopup="dialog"
      onClick={() => action({ type: "showMyTricks" })}>
      <strong>{me.trickCount}<ArrowUpRight size={12} aria-hidden="true" /></strong>
      <span>{t("TVOJI ŠTIHI")}</span>
    </button>
  );
  const liveStatus = g.phase === "bidding"
    ? t("Runda {round}. {status}", { round: g.round, status: myTurn ? t("Izberi Igram ali Naprej.") : t("{player} izbira igro.", { player: other.name }) })
      : g.phase === "playing"
        ? t("Štih {trick} od 27. {status}", { trick: g.trickNumber, status: myTurn ? t("Na potezi si.") : t("Na potezi je {player}.", { player: other.name }) })
        : t("Runda {round} je končana. Za novo rundo morata potrditi oba.", { round: g.round });
  return (
    <main className="game-page" data-phase={g.phase === "roundEnd" && !showRoundEnd ? "playing" : g.phase} data-round={g.round}
      data-turn={g.turn ?? ""} data-you={you} data-trick-number={g.trickNumber}
      data-trick-card-ids={g.trick.map(({ card }) => card.id).join(",")}
      data-pickup-count={g.pickups?.length || 0}
      data-preparation-turn={g.preparationTurn ?? ""}
      data-announcement-ready={(g.announcementReady || [false, false]).join(",")}
      data-announcements={JSON.stringify(g.announcements || [])}>
      <span className="sr-only" data-testid="game-status" role="status" aria-live="polite" aria-atomic="true">{liveStatus}</span>
      {completedTricks.map(trick => <TrickCollection key={trick.key} trick={trick} you={you}
        players={g.players} onComplete={finishCollection}
        collectNow={g.trick.length > 0 || (g.lastTrick?.number || 0) > trick.number} />)}
      {bidReveal && createPortal(
        <div className="bid-reveal" role="status" aria-live="polite" data-testid="bid-reveal">
          <Flag size={32} aria-hidden="true" />
          <strong>{t("{player} igra!", { player: other.name })}</strong>
          <span>{t("Nasprotnik je izbral »Igram«.")}</span>
        </div>, document.body)}
      {pickupReveal && !bidReveal && <PickupFlight key={`${g.round}-${pickupReveal.card.id}`}
        pickup={pickupReveal} playerName={g.players[pickupReveal.player].name} />}
      <div className="game-toolbar">
        <div className="table-title">
          <span className="eyebrow">{t("VAJINA MIZA")}</span>
          <span className="table-code">{state.roomId}</span>
          <span className="toolbar-divider" />
          <strong>{t("Runda {round}", { round: g.round })}</strong>
          {g.phase === "playing" && <span className="compact-trick-progress">{t("Štih {trick}/27", { trick: Math.min(g.trickNumber, 27) })}</span>}
        </div>
        <button className="score-button" onClick={onScore}
          aria-label={t("Rezultati: {player} {score} točk, {opponent} {opponentScore} točk.", { player: me.name, score: signed(me.score), opponent: other.name, opponentScore: signed(other.score) })}>
          <Trophy size={17} />
          <span>{t("Rezultati")}</span>
          <b>
            {me.score} : {other.score}
          </b>
        </button>
      </div>
      {!conn && createPortal(
        <div className="connection-notice" role="status" aria-live="polite">
          <WifiOff size={16} /> <span>{t("{player} je brez povezave. Mesto je shranjeno; igra se nadaljuje ob vrnitvi.", { player: other.name })}</span>
        </div>, document.body
      )}
      {showRoundEnd ? (
        <section className="round-end">
          <div className="round-end-top">
            <span className="trophy-circle">
              <Trophy size={30} strokeWidth={1.4} />
            </span>
            <div>
              <span className="eyebrow">{t("RUNDA {round} JE POD STREHO", { round: g.round })}</span>
              <h1 data-testid="round-result-heading">{resultHeading}</h1>
              <p data-testid="round-result-description">{resultDescription}</p>
            </div>
          </div>
          <div className="round-end-player-heading" aria-label={t("Igralca")}>
            <span>{t("Runda")}</span>{g.players.map(player => <strong key={player.id}>{player.name}</strong>)}
          </div>
          <div className="round-end-body" ref={resultsRef} role="region" aria-label={t("Rezultati rund")} tabIndex={0}>
            <div className="score-heading">
              <h2>{t("Vajina zgodba v točkah")}</h2>
              <span>
                {t("Število rund: {count}", { count: g.scoreboard.length })}
              </span>
            </div>
            <ScoreTable game={g} />
            <div className="score-explanation">
              <CircleHelp size={16} />
              <span>
                {last.breakdown?.some(entry => entry.kind === "valat")
                  ? t("Valat nadomesti igro, kralje in trulo. Mondfang se obračuna posebej.")
                  : last.contract.kind === "announced"
                  ? t("{player}: {result}.", { player: g.players[last.contract.player].name, result: last.contractWon ? t("uspešna napoved, razlika × 2") : t("neuspešna napoved, trojna izguba") })
                  : t("Navadna igra: zmagovalcu se prišteje razlika nad 35.")}
              </span>
            </div>
            {tricksButton}
            <div className="next-round">
              <div>
                <h3>{t("Še eno?")}</h3>
                <p>{t("V naslednji rundi deli {player}.", { player: g.players[1 - g.dealer].name })}</p>
              </div>
              <button
                className="primary-button"
                data-testid="new-round"
                disabled={busy || g.ready[you]}
                onClick={() => action({ type: "ready" })}
              >
                {g.ready[you] ? (
                  <>
                    <Check size={18} /> {t("Pripravljeno")} </>
                ) : (
                  <>{t("Nova runda")} <ArrowRight size={18} />
                  </>
                )}
              </button>
            </div>
            <div className="ready-status" data-testid="ready-count">
              {t("{count}/2 pripravljena", { count: g.ready.filter(Boolean).length })} <span>·</span>{" "}
              {g.ready[you]
                ? t("Čakamo še {player}.", { player: other.name })
                : t("Naslednja runda se začne, ko sta pripravljena oba.")}
            </div>
          </div>
        </section>
      ) : (
        <div className="play-layout">
          <section className="game-table felt">
            <div className="felt-border" />
            <div className="table-topline">
              <span>
                <span className="live-dot" /> {t("IGRA V DVOJE")} </span>
              <span>
                {g.phase === "bidding"
                  ? t("NAPOVED IGRE")
                  : t("ŠTIH {trick} / 27", { trick: Math.min(g.trickNumber, 27) })}
              </span>
            </div>
            <div className="opponent-zone">
            <div
              className={`player-seat opponent ${!myTurn ? "active-seat" : ""}`}
            >
              <Avatar name={other.name} connected={conn} />
              <div>
                <div className="opponent-name">
                  <strong>{other.name}</strong>
                  <span className="pickup-hand-target" aria-label={t("{count} kart v roki", { count: other.handCount })}>
                    <Card back small /><Card back small /><Card back small />
                  </span>
                  {opponentIsPlaying && <span className="bidder-badge" data-testid="opponent-bidder"><Flag size={11} /> {t("IGRA")}</span>}
                </div>
                <span>
                  {t("{count} kart v roki", { count: other.handCount })} <i>·</i> {trickCountLabel(other.trickCount)}
                </span>
                <button className="opponent-pickups" type="button" data-testid="opponent-pickups"
                  aria-label={t("Prevzete karte: {player} ({count})", { player: other.name, count: (g.pickups || []).filter(pickup => pickup.player === opponent).length })}
                  aria-haspopup="dialog" onClick={() => action({ type: "showPickups" })}>
                  <Layers3 size={14} /><span>{t("Prevzemi ({count})", { count: (g.pickups || []).filter(pickup => pickup.player === opponent).length })}</span>
                </button>
              </div>
              {g.dealer === opponent && (
                <span className="dealer-badge" title={t("Delilec")}>{t("D")} </span>
              )}
              <div
                className="opponent-hand"
                aria-label={t("{count} skritih kart", { count: other.handCount })}
              >
                {Array.from(
                  { length: Math.min(5, other.handCount) },
                  (_, i) => (
                    <Card key={i} back small />
                  ),
                )}
              </div>
            </div>
            <div className="opponent-stacks">
              <Stacks player={other} legalMoves={[]} />
            </div>
            </div>
            <div className="center-play">
              {g.phase === "bidding" ? (
                <div className="bidding-panel">
                  <span className="bid-diamond">
                    <Diamond size={24} strokeWidth={1.2} />
                  </span>
                  <span className="eyebrow">{t("POGLEJ KARTE. ZAUPAJ OBČUTKU.")}</span>
                  <h2>
                    {myTurn
                      ? t("Igraš?")
                      : t("{player} izbira igro.", { player: other.name })}
                  </h2>
                  <p>
                    {myTurn
                      ? t("Zbereš vsaj 36 točk? Napovej igro.")
                      : t("Kmalu bo čas za prvo karto.")}
                  </p>
                  {myTurn ? (
                    <div className="bid-actions">
                      <button
                        className="bid-pass"
                        data-testid="bid-pass"
                        disabled={busy}
                        onClick={() => action({ type: "bid", bid: "pass" })}
                      >{t("Naprej")} </button>
                      <button
                        className="bid-play"
                        data-testid="bid-play"
                        disabled={busy}
                        onClick={() => action({ type: "bid", bid: "play" })}
                      >{t("Igram")} <ArrowRight size={16} />
                      </button>
                    </div>
                  ) : (
                    <span className="waiting-pill">
                      <LoaderCircle size={14} className="spin" /> {t("Čakamo napoved")} </span>
                  )}
                </div>
              ) : (
                <>
                  <div className="trick-cards">
                    {cardsOnTable.length ? (
                      cardsOnTable.map((t) => (
                        <div
                          className={`played-card ${t.player === you ? "my-played" : ""}`}
                          key={t.card.id}
                        >
                          <Card card={t.card} />
                          <span>{g.players[t.player].name}</span>
                        </div>
                      ))
                    ) : (
                      <div className="empty-trick" style={settling ? { visibility: 'hidden' } : undefined}>
                        <Diamond size={29} strokeWidth={1} />
                        <span className={myTurn ? "turn-prompt" : undefined}
                          style={bidReveal || settling ? { animation: 'none' } : undefined}>
                          {myTurn
                            ? g.trickNumber === 1 ? t("Začneš!") : t("Tvoja poteza")
                            : t("Na vrsti je {player}", { player: other.name })}
                        </span>
                        <small>
                          {myTurn
                            ? t("Izberi označeno karto.")
                            : t("Počakaj na nasprotnikovo karto.")}
                        </small>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            {g.phase === "playing" && g.contract.kind === "announced" && (
              <span className="contract-tag">
                <Flag size={11} /> {t("Igram: {player}", { player: g.players[g.contract.player].name })}
              </span>
            )}
            <div className="bottom-table">
              <div className="last-trick">
                {g.lastTrick ? (
                  <>
                    <span>{t("ZADNJI ŠTIH")}</span>
                    <button aria-label={t("Zadnji štih: {player}", { player: g.players[g.lastTrick.winner].name })}
                      onClick={() => action({ type: "showLastTrick" })}>
                      <Layers3 size={16} />
                      {g.players[g.lastTrick.winner].name}
                      <ArrowUpRight size={12} />
                    </button>
                  </>
                ) : (
                  <>
                    <span>{t("PO SLOVENSKO")}</span>
                    <small>{t("54 kart. Dva igralca.")}</small>
                  </>
                )}
              </div>
              <Stacks
                player={me}
                mine
                legalMoves={g.legalMoves}
                legalPickups={g.legalPickups}
                onPickup={pickup}
                onPlay={play}
                disabled={busy}
              />
              {tricksButton}
            </div>
          </section>
          <section className="hand-panel">
            <div className="hand-heading">
              <div className="hand-identity">
                <Avatar name={me.name} you />
                <div>
                  <strong>
                    {me.name}
                    <span> {t("(ti)")}</span>
                  </strong>
                  <small>
                    {t("{count} kart", { count: g.hand.length })} · {trickCountLabel(me.trickCount)}
                    {g.dealer === you && <span className="hand-dealer"> {t("· Deliš")}</span>}
                  </small>
                </div>
              </div>
              <span className={`turn-indicator ${myTurn ? "your-turn" : ""}`}>
                <i />
                {g.phase === "bidding"
                  ? myTurn
                    ? t("Izberi igro")
                    : t("Čakamo napoved")
                  : myTurn
                    ? t("Na potezi si")
                    : t("Na potezi je {player}", { player: other.name })}
              </span>
            </div>
            <nav className="hand-navigation" aria-label={t("Poišči barvo v roki")}>
              {groups.map(group => <button key={group.suit} type="button"
                data-testid="hand-suit" data-suit={group.suit}
                aria-label={t("Pokaži {suit} v roki ({count} kart)", { suit: t(suits[group.suit]), count: group.cards.length })}
                disabled={!group.cards.length} onClick={() => showSuit(group.suit)}>
                {t(suits[group.suit])} <small>{group.cards.length}</small>
              </button>)}
              {handOverflows && <span className="hand-swipe" title={t("Podrsaj po kartah")} aria-label={t("Za več kart podrsaj levo ali desno")}>↔</span>}
            </nav>
            <div className="hand-scroll" role="region" aria-label={t("Tvoje karte. Podrsaj ali izberi barvo.")}
              ref={handRef} tabIndex={0} onKeyDown={event => {
                if (event.target !== event.currentTarget || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
                event.preventDefault();
                event.currentTarget.scrollBy({ left: (event.key === "ArrowRight" ? 1 : -1) * event.currentTarget.clientWidth * .75 });
              }}>
              {groups.filter(group => group.cards.length).map((group) => (
                <div className="suit-group" key={group.suit} data-suit={group.suit}>
                  <span className="suit-group-label">
                    {t(suits[group.suit])} <small>{group.cards.length}</small>
                  </span>
                  <div className="hand-cards">
                    {group.cards.map((card) => (
                      <Card
                        key={card.id}
                        card={card}
                        onPlay={play}
                        legal={g.legalMoves.includes(card.id)}
                        disabled={busy}
                      />
                    ))}
                  </div>
                </div>
              ))}
              {g.hand.length === 0 && <div className="suit-group empty-hand" data-testid="empty-hand">
                <span className="suit-group-label" aria-hidden="true">{t("Roka")}</span>
                <div className="hand-cards">
                  <div className="playing-card empty-hand-spacer" aria-hidden="true" />
                </div>
                <span className="empty-hand-message">{t("Roka je prazna.")}</span>
              </div>}
            </div>
            <div className="hand-hint">
              <span>
                <Sparkles size={13} />
                {g.phase === "bidding"
                  ? t("Najprej izberi »Igram« ali »Naprej«.")
                  : myTurn
                    ? g.hand.length > 0 && g.trick.length === 0
                      ? t("Štih začneš s karto iz roke; s kupčka šele, ko je roka prazna.")
                      : t("Sledi barvi tudi s kupčka; če je nimaš, igraj tarok.")
                    : t("Karte so razvrščene po barvi in moči.")}
              </span>
              <button onClick={onRules}>
                <CircleHelp size={14} /> {t("Pravila")} </button>
            </div>
            {(!!g.announcements?.length || !!g.mondfangs?.length) && createPortal(
              <div className="public-announcements game-events-overlay" aria-label={t("Dodatki v igri")} role="status">
                {(g.announcements || []).map(call => <span key={`${call.player}-${call.bonus}`}
                  data-testid="public-announcement" data-player={call.player} data-bonus={call.bonus}>
                  <Flag size={11} /> {g.players[call.player].name}: {t(bonusNames[call.bonus])}
                </span>)}
                {(g.mondfangs || []).map(event => <span key={`mond-${event.trickNumber}`}
                  className="mondfang-warning" data-testid="mondfang-event" data-player={event.player}>
                  {t("Ujet Mond · {player} −21", { player: g.players[event.player].name })}
                </span>)}
              </div>, document.body
            )}
            <p className="pickup-feedback" role="status" aria-live="polite" aria-atomic="true">
              {latestPickup?.player === you && g.hand.some(card => card.id === latestPickup.card.id) ? t("{card} je zdaj v roki.", { card: cardName(latestPickup.card) }) : ""}
            </p>
            {!!g.pickups?.length && (
              <button
                className="pickup-note"
                onClick={() => action({ type: "showPickups" })}
              >
                <Layers3 size={12} />{t("Prevzete karte s kupčkov")} <span>{g.pickups.length}</span>
                <ArrowUpRight size={12} />
              </button>
            )}
          </section>
        </div>
      )}
      <div className="game-footer">
        <span>
          <ShieldCheck size={13} /> {t("Zasebna miza · Slovenski tarok v dveh")} </span>
        <span>{t("Čas za dobro partijo.")}</span>
      </div>
    </main>
  );
}

function App() {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale);
  const selectedDeck = useSyncExternalStore(subscribeDeck, getDeck, getDeck);
  const [state, setState] = useState(null);
  useEffect(() => { registerCardCache(); }, []);
  const [name, setName] = useState(() => readSaved(NAME) || "");
  const [user, setUser] = useState(null);
  const [tables, setTables] = useState([]);
  const [link, setLink] = useState(incomingLink);
  const [invitation, setInvitation] = useState('');
  const [devices, setDevices] = useState([]);
  const [deviceLink, setDeviceLink] = useState(null);
  const [legacy, setLegacy] = useState(legacySeats);
  const userRef = useRef(null);
  const credentialRef = useRef(localStorage.getItem(DEVICE));
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null);
  useEffect(() => {
    if (!state && modal !== 'deck') return;
    const visible = [...document.querySelectorAll('.playing-card img')].map(image => image.getAttribute('src'));
    void prepareCardImages(visible, selectedDeck);
  }, [state, selectedDeck, modal]);
  const [resuming, setResuming] = useState(!!localStorage.getItem(DEVICE));
  const socketRef = useRef(null);
  const stateRef = useRef(null);
  const cardFitRef = useRef({ page: null, viewport: '', size: null });
  // Fit phone piles to the available table area; other pages retain their
  // natural layout and the existing viewport scale.
  useLayoutEffect(() => {
    const root = document.getElementById("root");
    const page = root.querySelector(":scope > main");
    const header = root.querySelector(":scope > .site-header");
    if (!page || !header) return;
    const fit = () => {
      if (page.matches('.game-page:not([data-phase="roundEnd"])') &&
          matchMedia('(max-width: 560px), (max-width: 960px) and (max-height: 600px)').matches) {
        const viewport = `${innerWidth}:${innerHeight}:${page.offsetWidth}:${page.offsetHeight}`;
        if (cardFitRef.current.page !== page || cardFitRef.current.viewport !== viewport) {
          cardFitRef.current = { page, viewport, size: null };
        }
        const applySize = height => {
          if (page.style.getPropertyValue('--fitted-pile-height') !== `${height}px`) {
            page.style.setProperty('--fitted-pile-height', `${height}px`);
          }
        };
        // Hand contents and socket updates must not change the chosen size.
        // Retain it across bidding, play and subsequent rounds as well.
        if (cardFitRef.current.size !== null) {
          applySize(cardFitRef.current.size);
          return;
        }
        // Probe sizes on an inert copy. Resizing the visible hand during the
        // search can disturb Firefox's asynchronous scrolling on game updates.
        const measurement = page.cloneNode(true);
        measurement.inert = true;
        measurement.setAttribute('aria-hidden', 'true');
        Object.assign(measurement.style, {
          position: 'fixed', left: '0', top: '0', visibility: 'hidden',
          pointerEvents: 'none', width: `${page.offsetWidth}px`,
          height: `${page.offsetHeight}px`, margin: '0',
        });
        root.appendChild(measurement);
        try {
          // Keep full viewport width. Spend surplus table height on the piles,
          // reserving the natural height of every central action and instruction.
          measurement.style.removeProperty('--fitted-pile-height');
          const table = measurement.querySelector('.game-table');
          const center = measurement.querySelector('.center-play');
          const opponent = measurement.querySelector('.opponent-zone');
          const bottom = measurement.querySelector('.bottom-table');
          const pile = measurement.querySelector('.my-stacks .stack');
          if (!table || !center || !opponent || !bottom || !pile) return;
          const px = value => parseFloat(value) || 0;
          const style = getComputedStyle(table);
          const landscape = matchMedia('(min-width: 561px) and (max-width: 960px) and (max-height: 600px)').matches;
          const playing = page.dataset.phase === 'playing';
          // Fit one shared card size across both piles, the trick and the hand.
          // Measuring the resulting layout also accounts for the reserved empty hand.
          let low = 32;
          let high = Math.floor(pile.offsetHeight);
          const fits = height => {
            measurement.style.setProperty('--fitted-pile-height', `${height}px`);
            let contentHeight = [...center.children].reduce((total, child) => {
              const css = getComputedStyle(child);
              return total + Math.max(child.offsetHeight, child.scrollHeight) + px(css.marginTop) + px(css.marginBottom);
            }, 0);
            if (playing) {
              const css = getComputedStyle(center.querySelector('.trick-cards'));
              contentHeight = height + 32 + px(css.marginTop) + px(css.marginBottom);
            } else {
              // Reserve played-card space before bidding finishes, too.
              contentHeight = Math.max(contentHeight, height + 32);
            }
            const used = opponent.offsetHeight + bottom.offsetHeight
              + px(style.paddingTop) + px(style.paddingBottom) + 2 * px(style.rowGap) + 4
              + (landscape ? 0 : contentHeight);
            return used <= table.clientHeight && (!landscape || contentHeight + 4 <= center.clientHeight);
          };
          while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            if (fits(middle)) low = middle;
            else high = middle - 1;
          }
          cardFitRef.current.size = low;
          applySize(low);
        } finally {
          measurement.remove();
        }
        return;
      }
      page.style.removeProperty('--fitted-pile-height');
      const available = Math.max(1, root.clientHeight - header.offsetHeight);
      const height = Math.max(page.offsetHeight, page.scrollHeight);
      const width = Math.max(page.offsetWidth, page.scrollWidth);
      const scale = Math.min(1, available / Math.max(1, height), root.clientWidth / Math.max(1, width));
      page.style.setProperty("--page-scale", String(scale));
    };
    const observer = new ResizeObserver(fit);
    [root, header, page, ...page.querySelectorAll(".game-table, .center-play > *")].forEach(element => observer.observe(element));
    fit();
    return () => observer.disconnect();
  });
  useEffect(() => {
    const socket = io({ autoConnect: false, reconnection: true });
    socketRef.current = socket;
    socket.on("connect", async () => {
      setOnline(true);
      setResuming(true);
      const hasPendingLink = !!sessionStorage.getItem('tarokza2.link');
      try {
        const credential = credentialRef.current || localStorage.getItem(PENDING_DEVICE);
        if (credential) {
          try {
            const result = await request('identity:resume', { credential });
            acceptIdentity(result, credential);
          } catch (error) {
            if (error.code !== 'AUTH_REQUIRED') throw error;
            if (credentialRef.current) { localStorage.removeItem(DEVICE); localStorage.removeItem(PENDING_DEVICE); credentialRef.current = null; userRef.current = null; setUser(null); setTables([]); setState(null); stateRef.current = null; setError(error.message); }
          }
        }
        if (!userRef.current && legacySeats().length && !hasPendingLink) await ensureIdentity();
        if (!userRef.current && new URLSearchParams(location.search).has('room') && !hasPendingLink) setError('Za pridružitev prosi prijatelja za novo povezavo s povabilom. Koda mize ne omogoča več vstopa.');
        if (userRef.current) {
          await migrate();
          const roomId = new URLSearchParams(location.search).get('room');
          if (roomId && !hasPendingLink) await request('room:resume', { roomId });
        }
      } catch (error) { setError(error.message); }
      finally { setResuming(false); }
    });
    socket.on('tables', setTables);
    socket.on('identity:revoked', () => {
      localStorage.removeItem(DEVICE); localStorage.removeItem(PENDING_DEVICE); credentialRef.current = null; userRef.current = null;
      setUser(null); setTables([]); setState(null); stateRef.current = null;
      setError('Dostop te naprave je bil odstranjen. Odpri novo povezavo za napravo ali obnovitev.');
    });
    socket.on("disconnect", (reason) => {
      setOnline(false);
      setBusy(false);
      if (reason === "io server disconnect") socket.connect();
    });
    socket.on("connect_error", () => {
      setOnline(false);
      setResuming(false);
    });
    socket.on("state", (next) => {
      setState(next);
      stateRef.current = next;
      setResuming(false);
    });
    socket.connect();
    return () => {
      socket.disconnect();
    };
  }, []);
  useEffect(() => {
    const changed = () => {
      const incoming = captureLink();
      if (!incoming) return;
      setLink(incoming); setState(null); stateRef.current = null;
      socketRef.current?.emit('room:leave', {});
    };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(""), 8000);
    return () => clearTimeout(t);
  }, [error]);
  function emit(event, payload, onSuccess) {
    if (!online) {
      setError("Povezava s strežnikom je prekinjena. Poskušamo znova …");
      return;
    }
    setBusy(true);
    setError("");
    socketRef.current.timeout(8000).emit(event, payload, (err, result) => {
      setBusy(false);
      if (err || !result?.ok) {
        setError(
          err
            ? "Strežnik se ni odzval. Poskusi znova."
            : result?.error || "Poteza ni uspela.",
        );
        return;
      }
      onSuccess?.(result);
    });
  }
  async function request(event, payload = {}) {
    const result = await socketRef.current.timeout(8000).emitWithAck(event, payload).catch(cause => {
      throw new Error('Strežnik se ni odzval. Poskusi znova.', { cause });
    });
    if (!result?.ok) throw Object.assign(new Error(result?.error || 'Zahteva ni uspela.'), { code: result?.code });
    return result;
  }
  function acceptIdentity(result, credential) {
    localStorage.setItem(DEVICE, credential);
    localStorage.removeItem(PENDING_DEVICE);
    credentialRef.current = credential; userRef.current = result.user;
    setUser(result.user); setName(result.user.name); setTables(result.tables);
  }
  async function ensureIdentity() {
    const ensure = async () => {
      if (userRef.current) return;
      const saved = localStorage.getItem(DEVICE);
      if (saved) { acceptIdentity(await request('identity:resume', { credential: saved }), saved); return; }
      if (credentialRef.current) throw new Error('Obnovi povezavo z igralcem pred nadaljevanjem.');
      const credential = localStorage.getItem(PENDING_DEVICE) || newSecret();
      localStorage.setItem(PENDING_DEVICE, credential);
      const result = await request('identity:create', { name: name.trim() || readSaved(NAME) || t("Igralec"), credential });
      acceptIdentity(result, credential);
      localStorage.setItem(NAME, JSON.stringify(result.user.name));
    };
    if (navigator.locks) await navigator.locks.request('tarokza2.identity', ensure);
    else await ensure();
  }
  function removeLegacy(seat) {
    const saved = readSaved(SESSIONS) || {};
    if (saved[seat.roomId]?.token === seat.token) delete saved[seat.roomId];
    localStorage.setItem(SESSIONS, JSON.stringify(saved));
    if (readSaved(STORAGE)?.token === seat.token) localStorage.removeItem(STORAGE);
    setLegacy(legacySeats());
  }
  async function migrate() {
    const seats = legacySeats();
    for (const seat of seats) {
      if (seats.filter(s => s.roomId === seat.roomId).length > 1) {
        try {
          const result = await request('identity:legacy', seat);
          setLegacy(current => current.map(s => s.roomId === seat.roomId && s.token === seat.token ? { ...s, name: result.name } : s));
        } catch (error) { setError(error.message); }
        continue;
      }
      try { await request('identity:claim', seat); removeLegacy(seat); }
      catch (error) { setError(error.message); }
    }
  }
  async function run(operation) {
    setBusy(true); setError('');
    try { await operation(); } catch (error) { setError(error.message || 'Povezava ni uspela. Poskusi znova.'); }
    finally { setBusy(false); }
  }
  function dismissLink() { sessionStorage.removeItem('tarokza2.link'); setLink(null); }
  function joined(result) {
    dismissLink();
    setInvitation(result.invitation || '');
    history.replaceState({}, '', `/?room=${result.roomId}`);
  }
  function createTable() { run(async () => { await ensureIdentity(); await migrate(); joined(await request('room:create')); }); }
  function joinTable() { run(async () => { await ensureIdentity(); await migrate(); joined(await request('room:join', { roomId: link.roomId, invitation: link.token })); }); }
  function resumeTable(roomId) { run(async () => { joined(await request('room:resume', { roomId })); }); }
  function redeemLink() { run(async () => {
    const credential = credentialRef.current || localStorage.getItem(PENDING_DEVICE) || newSecret();
    if (!credentialRef.current) localStorage.setItem(PENDING_DEVICE, credential);
    const result = await request('identity:redeem', { kind: link.kind, token: link.token, credential, existingCredential: credentialRef.current });
    acceptIdentity(result, credential); dismissLink(); await migrate();
    if (result.alreadyConnected) setError('Ta brskalnik je že povezan s tem igralcem.');
  }); }
  function openDevices() { run(async () => { setDevices((await request('devices:list')).devices); setDeviceLink(null); setModal('devices'); }); }
  function changeDevice(event, payload) { run(async () => { await request(event, payload); setDevices((await request('devices:list')).devices); }); }
  function makeDeviceLink(kind) { run(async () => {
    const result = await request(kind === 'device' ? 'devices:link' : 'recovery:create');
    setDeviceLink({ kind, url: sharedLink(kind, result.token), expiresAt: result.expiresAt });
  }); }
  function action(action) {
    if (action.type === "showPickups") {
      setModal("pickups");
      return;
    }
    if (action.type === "showMyTricks") {
      setModal("my-tricks");
      return;
    }
    if (action.type === "showLastTrick") {
      setModal("last");
      return;
    }
    emit("game:action", { ...action, expectedRevision: state?.revision });
  }
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      setError("Povezavo lahko kopiraš iz polja pod gumbom.");
      return false;
    }
  }
  function leave() {
    emit("room:leave", {}, () => {
      setState(null);
      stateRef.current = null;
      setModal(null);
      history.replaceState({}, "", "/");
      dismissLink();
      setInvitation("");
    });
  }
  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <Logo onClick={() => (state ? setModal("leave") : null)} />
          <div className="header-right">
            <label className="language-picker">
              <span className="sr-only">{t("Jezik")}</span>
              <select aria-label={t("Jezik")} value={locale} onChange={event => setLocale(event.target.value)} data-testid="language-select">
                {languages.map(language => <option key={language.code} value={language.code} lang={language.code}>{language.name}</option>)}
              </select>
            </label>
            <span
              className={`connection-status ${online ? "" : "disconnected"}`}
            >
              {online ? (
                <>
                  <span className="status-dot" /> {t("Pripravljeno na igro")} </>
              ) : (
                <>
                  <WifiOff size={14} /> {t("Povezovanje …")} </>
              )}
            </span>
            <button className="header-cards" data-testid="deck-gallery" aria-label={t("Karte")} onClick={() => setModal("deck")}>
              <Layers3 size={17}/><span>{t("Karte")}</span>
            </button>
            <button className="header-rules" aria-label={t("Kako igrati")} onClick={() => setModal("rules")}>
              <CircleHelp size={17} />
              <span>{t("Kako igrati")}</span>
            </button>
            {state && (
              <button
                className="icon-button"
                onClick={() => setModal("leave")}
                aria-label={t("Zapusti mizo")}
              >
                <LogOut size={18} />
              </button>
            )}
          </div>
        </div>
      </header>
      {resuming ? (
        <main className="resume-screen">
          <LoaderCircle className="spin" />
          <p>{t("Vračamo te za mizo …")}</p>
        </main>
      ) : state?.game ? (
        <Game
          state={state}
          busy={busy || !online}
          action={action}
          onScore={() => setModal("score")}
          onRules={() => setModal("rules")}
        />
      ) : state ? (
        <Waiting
          state={state}
          onCopy={copy}
          invitation={invitation}
          onDevices={openDevices}
          onInvite={() => run(async () => { const result = await request("room:invite", { roomId: state.roomId }); setInvitation(result.invitation); })}
          onLeave={() => setModal("leave")}
        />
      ) : (
        <IdentityHome user={user} name={name} setName={setName} tables={tables} link={link}
          busy={busy} online={online} onCreate={createTable} onJoin={joinTable} onRedeem={redeemLink}
          onDismiss={dismissLink} onResume={resumeTable} onDevices={openDevices} legacy={legacy}
          onClaim={seat => run(async () => { await ensureIdentity(); await request('identity:claim', seat); removeLegacy(seat); })} />
      )}
      {error && (
        <div className="toast" role="alert">
          <CircleHelp size={18} />
          <span>{translateMessage(error)}</span>
          <button aria-label={t("Zapri obvestilo")} onClick={() => setError("")}>
            <X size={17} />
          </button>
        </div>
      )}
      {modal === 'devices' && <Modal title={t("Naprave in obnovitev")} onClose={() => { setModal(null); setDeviceLink(null); }}>
        <DeviceSettings devices={devices} busy={busy} onRename={(id, name) => changeDevice('devices:rename', { id, name })}
          onRevoke={id => changeDevice('devices:revoke', { id })} onLink={() => makeDeviceLink('device')}
          onRecovery={() => makeDeviceLink('recovery')} onCopy={copy} {...(deviceLink || {})} />
      </Modal>}
      {modal === "rules" && <Rules onClose={() => setModal(null)} />}
      {modal === "deck" && <DeckGallery onClose={() => setModal(null)} selectedDeck={selectedDeck} />}
      {modal === "score" && state?.game && (
        <Modal title={t("Vajini rezultati")} onClose={() => setModal(null)} wide>
          <ScoreTable game={state.game} />
        </Modal>
      )}
      {modal === "leave" && (
        <Modal title={t("Zapustiš mizo?")} onClose={() => setModal(null)}>
          <p className="leave-copy">
            {t("Tvoje mesto in rezultati ostanejo shranjeni v Mojih mizah na vseh povezanih napravah. Miza: {room}.", { room: state?.roomId })}
          </p>
          <div className="modal-actions">
            <button className="secondary-button" onClick={() => setModal(null)}>{t("Ostani za mizo")} </button>
            <button className="primary-button" onClick={leave} disabled={busy}>{t("Zapusti mizo")} </button>
          </div>
        </Modal>
      )}
      {modal === "pickups" && state?.game && (
        <Modal title={t("Prevzete karte s kupčkov")} onClose={() => setModal(null)}>
          <p className="last-trick-description">{t("Ti taroki in kralji so bili javno razkriti in prestavljeni v roko. Nekatere karte so lahko že odigrane.")} </p>
          <div className="pickup-list">
            {state.game.players.map((player, index) => (
              <section key={player.id}>
                <h3>{player.name}</h3>
                {!(state.game.pickups || []).some(pickup => pickup.player === index) && (
                  <p>{t("Še ni prevzetih kart.")}</p>
                )}
                <div>
                  {(state.game.pickups || [])
                    .filter((pickup) => pickup.player === index)
                    .map((pickup) => (
                      <div key={pickup.card.id}>
                        <Card card={pickup.card} small />
                        <span>{t("Štih {trick}", { trick: pickup.trickNumber })}</span>
                      </div>
                    ))}
                </div>
              </section>
            ))}
          </div>
        </Modal>
      )}
      {modal === "my-tricks" && state?.game && (
        <Modal title={t("Tvoji štihi")} className="won-tricks-modal" onClose={() => setModal(null)}>
          <p className="last-trick-description">{t("Runda {round} · {tricks}.", { round: state.game.round, tricks: trickCountLabel(state.game.wonTricks?.length || 0) })}
            {state.game.wonTricks?.length > 0 && t(" Po vrsti, kot si jih osvojil.")}</p>
          {state.game.wonTricks?.length ? <div className="won-tricks-list">
            {state.game.wonTricks.map((cards, index) => <section key={index} data-testid="won-trick">
              <h3>{t("{number}. osvojeni štih", { number: index + 1 })}</h3>
              <div className="won-trick-cards">{cards.map(card => <Card key={card.id} card={card} />)}</div>
            </section>)}
          </div> : <p data-testid="won-tricks-empty">{t("V tej rundi še nisi osvojil nobenega štiha.")}</p>}
        </Modal>
      )}
      {modal === "last" && state?.game?.lastTrick && (
        <Modal title={t("Zadnji štih")} onClose={() => setModal(null)}>
          <p className="last-trick-description">{t("Štih:")} {" "}
            <strong>
              {state.game.players[state.game.lastTrick.winner].name}
            </strong>
            .
          </p>
          <div className="last-trick-modal-cards">
            {state.game.lastTrick.cards.map((t) => (
              <div key={t.card.id}>
                <Card card={t.card} />
                <span>{state.game.players[t.player].name}</span>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
