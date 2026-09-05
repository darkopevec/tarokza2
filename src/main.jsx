import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { io } from "socket.io-client";
import { cardFor, createDeck } from "../shared/cards.mjs";
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
import "./styles.css";
import "./responsive.css";

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
const trickCountLabel = (n) => `${n} ${n % 100 === 1 ? "štih" : n % 100 === 2 ? "štiha" : [3, 4].includes(n % 100) ? "štihi" : "štihov"}`;
const bonusNames = { kings: "Kralji", trula: "Trula", valat: "Valat" };
const scoreNames = { game: "Igra", ...bonusNames, mondfang: "Mondfang" };
const readSaved = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
};
function sessionForPage() {
  const invitation = new URLSearchParams(location.search)
    .get("room")
    ?.toUpperCase();
  const active = readSaved(STORAGE);
  if (invitation)
    return (
      (readSaved(SESSIONS) || {})[invitation] ||
      (active?.roomId === invitation ? active : null)
    );
  return active;
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
  const Tag = onPlay ? "button" : "div";
  if (back)
    return (
      <div
        className={`playing-card card-back ${small ? "small" : ""}`}
        aria-label="Zaprta karta"
      >
        <img className="card-back-image" src="/cards/back-ornament.png" alt="" draggable="false" />
      </div>
    );
  card = cardFor(card.id) || card;
  return (
    <Tag
      className={`playing-card ${small ? "small" : ""} ${card.suit} ${legal ? "legal" : ""} ${onPlay && !legal ? "unplayable" : ""} ${decorative ? "decorative" : ""}`}
      data-card-id={card.id}
      title={card.name}
      {...(onPlay
        ? {
            onClick: () => onPlay(card.id),
            disabled: disabled || !legal,
            "data-testid": "play-card",
            "data-card-id": card.id,
            type: "button",
            "aria-label": `Igraj ${card.name || card.label + " " + suits[card.suit]}`,
          }
        : { "aria-label": card.name || `${card.label} ${suits[card.suit]}` })}
    >
      <img className="card-face-image" src={card.image} alt={card.name} draggable="false" />
    </Tag>
  );
}

function Logo({ onClick }) {
  return (
    <button
      type="button"
      className="logo"
      onClick={onClick}
      aria-label="TarokZa2 — domov"
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
      {name?.slice(0, 1).toLocaleUpperCase("sl") || "?"}
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
        const all = ref.current?.querySelectorAll(
          "button:not(:disabled),a,input",
        );
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
          <button className="icon-button" aria-label="Zapri" onClick={onClose}>
            <X size={21} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function DeckGallery({ onClose }) {
  const deck = createDeck();
  return <Modal title="Prave tarok karte" onClose={onClose} className="deck-modal">
    <div className="deck-intro">
      <span className="eyebrow">CELOTEN KOMPLET · 54 KART</span>
      <p>22 tarokov in po 8 kart vsake barve. Prikazane so od najmočnejše do najšibkejše.</p>
      <p>Figure so <strong>kralj, dama, kaval in fant</strong>. V srcu in karu so še karte z enim, dvema, tremi in štirimi znaki; v piku in križu so 10, 9, 8 in 7.</p>
    </div>
    {Object.entries(suits).map(([suit, label]) => <section className="deck-section" key={suit}>
      <h3>{label}<span>{suit === "tarok" ? "22 kart" : "8 kart"}</span></h3>
      <div className="deck-cards">{deck.filter(card => card.suit === suit).sort((a, b) => b.rank - a.rank).map(card => <div className="deck-card" key={card.id}>
        <Card card={card}/><span>{card.name}</span>
      </div>)}</div>
    </section>)}
    <p className="deck-credit">S. Modiano · Tarok Študentski servis Maribor (1995). Fotografije: Martin Okrslar, <a href="https://commons.wikimedia.org/wiki/Category:Industrie_und_Gl%C3%BCck" target="_blank" rel="noreferrer">Wikimedia Commons</a>. <a href="/cards/deck/sources.json" target="_blank" rel="noreferrer">Viri fotografij</a>.</p>
  </Modal>;
}

function Rules({ onClose }) {
  return (
    <Modal title="Za dobro igro" onClose={onClose}>
      <div className="rules-content">
        <span className="eyebrow">SLOVENSKI TAROK V DVEH · NAPOLEON</span>
        <p>
          Dva igralca, 54 kart in 27 štihov. Cilj je zbrati vsaj 36 od skupno
          70 točk v kartah.
        </p>
        <ol>
          <li>
            <strong>Najprej karte.</strong> Vsak dobi 15 kart v roko in tri
            zaprte kupčke po štiri karte. Prvi govori igralec, ki ne deli.
          </li>
          <li>
            <strong>Igram ali naprej?</strong> Z »Igram« napoveš zmago. Če oba
            izbereta »Naprej«, igrata navadno igro.
          </li>
          <li>
            <strong>Odpri kupčke.</strong> Po napovedi se vrhnje karte
            razkrijejo. Taroka ali kralja lahko vzameš v roko ali ga pustiš
            na kupčku. Pod roko izberi »Vzemi v roko« za posamezno karto.
            Prevzem je dovoljen tudi med nasprotnikovo potezo in ga lahko
            opraviš pozneje. Razkrije se naslednja karta; tudi zanjo se
            odločiš posebej. Prevzem ne porabi poteze.
          </li>
          <li>
            <strong>Napovedi pred prvo karto.</strong> Kralje lahko napoveš,
            ko imaš vse štiri v roki; trulo, ko imaš pagata, monda in škisa.
            Štejejo tudi karte, ki jih pred tem vzameš s kupčkov. Valat lahko
            napoveš, ko na nobenem tvojem kupčku ni več skrite karte: vsak
            je prazen ali ima le eno odprto karto. Oba izbereta »Pripravljen«,
            preden lahko kdorkoli odigra prvo karto. Po svoji potrditvi
            priprave ne moreš več spreminjati; med igro je prevzem spet dovoljen.
          </li>
          <li>
            <strong>Sledi barvi.</strong> Upoštevajo se tudi odprte karte na
            kupčkih. Če nimaš barve, moraš igrati taroka; če nimaš niti taroka,
            lahko odvržeš poljubno karto. Ni treba igrati višje karte.
          </li>
          <li>
            <strong>Začni iz roke.</strong> Karto s kupčka lahko priložiš
            nasprotnikovi karti. Z njo lahko začneš štih šele, ko je roka
            prazna. Višji tarok ali višja karta začetne barve pobere štih.
          </li>
        </ol>
        <div className="rule-score">
          <Trophy size={22} />
          <div>
            <strong>Kako se piše rezultat?</strong>
            <p>
              Šteje razlika od 35 točk. Napovedana zmaga: razlika × 2. Napovedan
              poraz: manjkajoče točke × −3. V navadni igri dobi zmagovalec
              razliko × 1. Pri 35 : 35 se zapiše 0.
            </p>
            <p>
              Vsi štirje kralji ali cela trula v tvojih štihih: +10 brez
              napovedi, +20 ob uspešni napovedi, −20 ob neuspešni. Ni dovolj,
              da so karte v roki. Valat pomeni vseh 27 štihov: +250 brez
              napovedi, +500 ob uspešni ali −500 ob neuspešni napovedi.
              Valat nadomesti osnovno igro, kralje in trulo. Mondfang:
              če škis pobere tvojega monda, dobiš −21, tudi ob valatu.
            </p>
          </div>
        </div>
        <p className="rules-small">
          Štetje: od vsote vrednosti vsake trojice odštejemo 2; pri eni ali dveh
          preostalih kartah odštejemo 1. Trula in kralji so vredni po 5, dama 4,
          kaval 3, fant 2, ostale karte 1. Ni konter, radelcev ali napovedi ultimo.
          Napovedi so dokončne. Če oba napovesta valat, vsak zase piše
          +500 ali −500 glede na uspeh. Dodatki so dogovorjena pravila TarokZa2.
        </p>
        <p className="rules-small">
          Osnova:{" "}
          <a
            href="https://www.tarok.net/pravila108.pdf"
            target="_blank"
            rel="noreferrer"
          >
            Tarok.net, poglavji 2.1 in 2.2 <ArrowUpRight size={12} />
          </a>
          . Delitev in kupčki sledijo opisu{" "}
          <a
            href="https://slovenski-tarok.si/pravila.html"
            target="_blank"
            rel="noreferrer"
          >
            Slovenski tarok <ArrowUpRight size={12} />
          </a>
          .
        </p>
      </div>
    </Modal>
  );
}

function AnnouncementPanel({ game, busy, action }) {
  const [showInfo, setShowInfo] = useState(false);
  const ready = game.announcementReady || [false, false];
  const mine = (game.announcements || []).filter(call => call.player === game.you);
  const pickupCount = (game.legalPickups || []).length;
  const requirements = {
    kings: "V roki potrebuješ vse štiri kralje.",
    trula: "V roki potrebuješ pagata, monda in škisa.",
    valat: "Na vsakem tvojem kupčku sme ostati največ ena odprta karta.",
  };
  const outcomes = {
    kings: "V svojih štihih zberi vse štiri kralje. Uspešna napoved prinese +20, neuspešna −20. Brez napovedi je cel komplet v štihih vreden +10.",
    trula: "V svojih štihih zberi pagata, monda in škisa. Uspešna napoved prinese +20, neuspešna −20. Brez napovedi je cel komplet v štihih vreden +10.",
    valat: "Osvoji vseh 27 štihov. Uspešna napoved prinese +500, neuspešna −500. Valat nadomesti igro, kralje in trulo; mondfang se obračuna posebej.",
  };
  const showPickups = () => {
    const options = document.querySelector('.pickup-options');
    options?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    options?.focus({ preventScroll: true });
  };
  return <div className="announcement-panel" data-testid="announcement-panel">
    <div className="announcement-heading">
      <h2>Napovedi</h2>
      <span data-testid="announcement-ready-count">{ready.filter(Boolean).length}/2 pripravljena</span>
    </div>
    <p className="announcement-warning" id="announcement-warning">Napoved je javna in dokončna.</p>
    <div className="announcement-actions">
      {Object.entries(bonusNames).map(([bonus, name]) => {
        const called = mine.some(call => call.bonus === bonus);
        return <button key={bonus} type="button" data-testid={`announce-${bonus}`}
          aria-label={`Napovej ${{ kings: "kralje", trula: "trulo", valat: "valat" }[bonus]}`} aria-pressed={called}
          aria-describedby="announcement-warning"
          disabled={busy || ready[game.you] || !(game.legalAnnouncements || []).includes(bonus)}
          title={called ? `${name}: napovedano` : requirements[bonus]}
          onClick={() => action({ type: "announce", bonus })}>
          <span>{called && <Check size={11} />}{name}</span>
          <small>{called ? "Napovedano" : bonus === "valat" ? "+500 / −500" : "+20 / −20"}</small>
        </button>;
      })}
      <button className="announcement-info-button" type="button" data-testid="announcement-info"
        aria-label="Pogoji in točke napovedi" aria-haspopup="dialog" onClick={() => setShowInfo(true)}>
        <CircleHelp size={18} />
      </button>
    </div>
    <div className="announcement-footer">
      {!ready[game.you] && pickupCount > 0 && <button className="prep-pickup-reminder" type="button"
        data-testid="prep-pickup-reminder" aria-label={`Pred potrditvijo preveri neobvezne prevzeme: ${pickupCount}. Pokaži možnosti.`}
        onClick={showPickups}>
        <ArrowDownToLine size={15} /><span>Preveri prevzeme <strong>({pickupCount})</strong></span>
      </button>}
      <button className="announcement-confirm" type="button" data-testid="confirm-announcements"
        disabled={busy || ready[game.you]} onClick={() => action({ type: "confirmAnnouncements" })}>
        {ready[game.you] ? <><Check size={15} /> Čakam soigralca</> : <>Pripravljen <ArrowRight size={15} /></>}
      </button>
    </div>
    {showInfo && createPortal(<Modal title="Napovedi: pogoji in točke" className="announcement-info-modal" onClose={() => setShowInfo(false)}>
      <p className="announcement-info-intro">Napoved ni obvezna. Je javna in dokončna obljuba, da boš cilj dosegel v svojih štihih, ne nagrada za karte v roki.</p>
      {Object.entries(bonusNames).map(([bonus, name]) => <section className="announcement-info-section" key={bonus}>
        <h3>{name}</h3>
        <p>{requirements[bonus]}</p>
        <p>{outcomes[bonus]}</p>
        <p className="announcement-eligibility">{mine.some(call => call.bonus === bonus)
          ? "Že napovedano. Napovedi ni mogoče umakniti."
          : ready[game.you] ? "Priprava je potrjena; novih napovedi ne moreš dodati."
            : (game.legalAnnouncements || []).includes(bonus) ? "To napoved lahko zdaj oddaš."
              : "Pogoj za to napoved še ni izpolnjen."}</p>
      </section>)}
      <p className="announcement-info-note">Odprte taroke in kralje lahko pred potrditvijo po želji vzameš v roko. Prevzem ne odigra karte in ne porabi poteze. S »Pripravljen« zakleneš svoje izbire do začetka igranja; oba morata potrditi.</p>
    </Modal>, document.body)}
  </div>;
}

function ScoreTable({ game }) {
  return (
    <div className="score-table-wrap">
      <table className="score-table">
        <thead>
          <tr>
            <th>RUNDA</th>
            {game.players.map((p) => (
              <th key={p.id}>{p.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {game.scoreboard.map((row) => (
            <tr key={row.round} data-testid="scoreboard-row">
              <td>
                <strong>{String(row.round).padStart(2, "0")}</strong>
                <small>
                  {row.breakdown?.some(entry => entry.kind === "valat")
                    ? row.announcements?.some(call => call.bonus === "valat") ? "Napovedan valat" : "Tihi valat"
                    : `${row.contract.kind === "announced" ? "Napovedana" : "Navadna"} igra`}
                </small>
                {row.scoringVersion !== 2 && <small>Prejšnja pravila</small>}
              </td>
              {row.deltas.map((n, i) => (
                <td key={i}>
                  <strong
                    className={n > 0 ? "positive" : n < 0 ? "negative" : ""}
                  >
                    {signed(n)}
                  </strong>
                  <small>{row.points[i]} točk v kartah</small>
                  {!!row.breakdown && <div className="score-breakdown" data-testid="score-breakdown" data-player={i}>
                    {row.breakdown.filter(entry => entry.player === i).map((entry, index) => (
                      <span key={`${entry.kind}-${index}`} data-testid="score-breakdown-entry"
                        data-player={i} data-kind={entry.kind} data-points={entry.points}>
                        <span>{entry.announced ? "Nap. " : ""}{scoreNames[entry.kind] || entry.kind}</span>
                        <b className={entry.points > 0 ? "positive" : entry.points < 0 ? "negative" : ""}>{signed(entry.points)}</b>
                      </span>
                    ))}
                  </div>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th>Skupaj</th>
            {game.players.map((p) => (
              <td key={p.id}>{signed(p.score)}</td>
            ))}
          </tr>
        </tfoot>
      </table>
      {!game.scoreboard.length && (
        <p className="empty-score">
          Prva runda še poteka. Rezultat te počaka tukaj.
        </p>
      )}
    </div>
  );
}

function Landing({
  name,
  setName,
  code,
  setCode,
  create,
  join,
  busy,
  online,
  onRules,
}) {
  const invitation = Boolean(new URLSearchParams(window.location.search).get("room"));
  const [joinAttempted, setJoinAttempted] = useState(false);
  const joinNameRef = useRef(null);
  const joinCodeRef = useRef(null);
  const validName = Boolean(name.trim());
  const validCode = /^[A-HJ-NP-Z2-9]{6}$/.test(code);
  const joinForm = <form className={`join-panel ${invitation ? "join-panel-first" : ""}`}
    onSubmit={event => {
      event.preventDefault();
      if (busy || !online) return;
      setJoinAttempted(true);
      if (!validName) { joinNameRef.current?.focus(); return; }
      if (!validCode) { joinCodeRef.current?.focus(); return; }
      join();
    }}>
    <div className="panel-heading">
      <span className="section-icon light"><Users size={20} /></span>
      <div><h2>{invitation ? "Pridruži se mizi" : "Že imaš povabilo?"}</h2><p>Vpiši svoje ime in kodo povabila.</p></div>
    </div>
    <div className="join-name-field">
      <label htmlFor="join-name">Tvoje ime pri tej mizi</label>
      <input id="join-name" data-testid="join-name" ref={joinNameRef}
        placeholder="Tvoje ime" maxLength={24} autoComplete="nickname"
        value={name} onChange={event => setName(event.target.value)}
        aria-describedby="join-name-help" aria-invalid={joinAttempted && !validName} />
      <p id="join-name-help" data-testid="join-name-error"
        className={`join-validation ${joinAttempted && !validName ? "is-invalid" : ""}`}
        role={joinAttempted && !validName ? "alert" : undefined}>{!validName ? "Vpiši ime za to mizo." : ""}</p>
    </div>
    <label htmlFor="join-code">Koda mize</label>
    <div className="join-fields">
      <input id="join-code" data-testid="join-code" ref={joinCodeRef}
        placeholder="NPR. ABC234" maxLength={6} autoComplete="off" autoCapitalize="characters"
        value={code} onChange={event => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
        aria-describedby="join-code-help" aria-invalid={joinAttempted && !validCode} />
      <button className="join-button" data-testid="join-room" disabled={busy || !online}
        aria-label="Pridruži se mizi"><span>Pridruži se</span><ArrowRight size={19} /></button>
    </div>
    <p id="join-code-help" data-testid="join-code-error"
      className={`join-validation ${joinAttempted && !validCode ? "is-invalid" : ""}`}
      role={joinAttempted && !validCode ? "alert" : undefined}>{!validCode ? "Vpiši 6 znakov iz povabila: črke brez I in O ter številke 2–9." : ""}</p>
  </form>;
  return (
    <main className={`landing ${invitation ? "invitation-focused" : ""}`}>
      {invitation ? <header className="invitation-heading">
        <span className="eyebrow">POVABILO ZA MIZO</span>
        <h1>Prisedi k prijatelju.</h1>
        <p>Za pridružitev potrebuješ le svoje ime in kodo povabila.</p>
      </header> : <section className="landing-top">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="tiny-diamond" /> MALA MIZA. VELIKA IGRA.
          </div>
          <h1>
            Dobra družba.
            <br />
            <em>Dobre karte.</em>
          </h1>
          <p className="hero-description">
            Za dobro partijo sta dovolj dva.
            <br />
            Povabi prijatelja in zaigrajta slovenski tarok,
            <br className="desktop-break" /> kjerkoli sta.
          </p>
          <div className="hero-proof">
            <span>
              <Users size={16} /> Samo vidva
            </span>
            <span>
              <ShieldCheck size={16} /> Brez registracije
            </span>
          </div>
        </div>
        <div className="hero-visual" role="img" aria-label="Trula: pagat, mond in škis iz slovenskega kompleta tarok kart">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <span className="visual-star one">✧</span>
          <span className="visual-star two">✦</span>
          <div className="hero-card card-left">
            <Card card={cardFor("tarok-1")} decorative />
          </div>
          <div className="hero-card card-right">
            <Card card={cardFor("tarok-22")} decorative />
          </div>
          <div className="hero-card card-center">
            <Card card={cardFor("tarok-21")} decorative />
          </div>
          <span className="visual-caption">PAGAT · MOND · ŠKIS</span>
          <div className="round-stamp">
            <span>PO SLOVENSKO</span>
            <Diamond size={19} />
            <span>ŽE OD NEKDAJ</span>
          </div>
        </div>
      </section>}
      <section className="lobby-layout">
        {invitation && joinForm}
        <form
          className={`new-table-panel ${invitation ? "invitation-secondary" : ""}`}
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <div className="panel-heading">
            <span className="section-icon">
              <Plus size={21} />
            </span>
            <div>
              <h2>{invitation ? "Raje ustvariš svojo mizo?" : "Tvoja miza čaka."}</h2>
              <p>Vpiši ime in povabi prijatelja.</p>
            </div>
            <span className="step-number">01</span>
          </div>
          <label htmlFor="player-name">Kako ti je ime?</label>
          <div className="create-fields">
            <input
              id="player-name"
              data-testid="player-name"
              placeholder="Tvoje ime"
              maxLength={24}
              autoComplete="nickname"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              data-testid="create-room"
              className="primary-button"
              disabled={busy || !online || !name.trim()}
            >
              {busy ? (
                <LoaderCircle className="spin" size={19} />
              ) : (
                <>
                  Ustvari mizo <ArrowRight size={19} />
                </>
              )}
            </button>
          </div>
          <p className="private-note">
            <Link size={13} /> Zasebna miza. Prijatelj se pridruži s povezavo.
          </p>
        </form>
        {!invitation && joinForm}
      </section>
      {!invitation && <section className="how-it-works">
        <div>
          <span className="mini-number">1</span>
          <p>
            <strong>Ustvari mizo</strong>
            <span>Le ime in en klik.</span>
          </p>
        </div>
        <span className="step-line" />
        <div>
          <span className="mini-number">2</span>
          <p>
            <strong>Povabi prijatelja</strong>
            <span>Pošlji mu svojo povezavo.</span>
          </p>
        </div>
        <span className="step-line" />
        <div>
          <span className="mini-number">3</span>
          <p>
            <strong>Karte na mizo</strong>
            <span>Naj zmaga boljši list.</span>
          </p>
        </div>
      </section>}
      <div className="landing-bottom">
        <span>
          <Diamond size={14} /> Tradicija, ki gre s tabo.
        </span>
        <button onClick={onRules}>
          Prvič igraš v dvoje? Spoznaj pravila <ArrowUpRight size={14} />
        </button>
      </div>
    </main>
  );
}

function Waiting({ state, onCopy, copied, onLeave }) {
  const url = `${window.location.origin}/?room=${state.roomId}`;
  return (
    <main className="waiting-page">
      <button className="text-button" onClick={onLeave}>
        <ChevronLeft size={16} /> Nazaj
      </button>
      <div className="waiting-layout">
        <div className="waiting-copy">
          <span className="eyebrow">DOBRODOŠEL ZA MIZO</span>
          <h1>
            Še prijatelj.
            <br />
            <em>Pa začnemo.</em>
          </h1>
          <p>
            Vse je pripravljeno za vajino partijo.
            <br />
            Pošlji povabilo in počakaj, da prisedeta oba.
          </p>
          <div className="invite-box">
            <span className="field-label">KODA TVOJE MIZE</span>
            <div className="room-code-row">
              <strong data-testid="room-code">{state.roomId}</strong>
              <button
                className="icon-button"
                aria-label="Kopiraj kodo"
                onClick={() => onCopy(state.roomId)}
              >
                <Copy size={21} />
              </button>
            </div>
            <button className="primary-button" onClick={() => onCopy(url)}>
              {copied ? (
                <>
                  <Check size={18} /> Kopirano
                </>
              ) : (
                <>
                  <Share2 size={18} /> Kopiraj povabilo
                </>
              )}
            </button>
            <input
              className="invite-url"
              aria-label="Povezava za povabilo"
              readOnly
              value={url}
              onFocus={(e) => e.target.select()}
            />
          </div>
          <p className="private-note">
            <ShieldCheck size={15} /> Samo oseba s povabilom se lahko pridruži.
          </p>
        </div>
        <div className="waiting-table felt">
          <div className="felt-border" />
          <div className="waiting-seat vacant">
            <span className="avatar empty">
              <Plus size={24} />
            </span>
            <span>Prosto mesto</span>
            <small>
              Čakamo prijatelja
              <span className="loading-dots" />
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
              <span className="status-dot" /> Za mizo
            </small>
          </div>
        </div>
      </div>
    </main>
  );
}

function Stacks({ player, mine, legalMoves, onPlay, disabled }) {
  return (
    <div className={`stacks ${mine ? "my-stacks" : ""}`}>
      <span className="stacks-label">{mine ? "TVOJI KUPČKI" : "SOIGRALČEVI KUPČKI"}</span>
      <div className="stack-cards">
        {player.stacks.map((stack, i) => (
          <div className={`stack ${!stack.count ? "empty-stack" : ""}`} key={i}
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
                <span className="stack-count">{stack.count}</span>
              </>
            ) : (
              <span className="empty-stack-mark">·</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Game({ state, busy, action, onScore, onRules }) {
  const g = state.game;
  const you = g.you;
  const opponent = 1 - you;
  const me = g.players[you];
  const other = g.players[opponent];
  const myTurn = g.turn === you;
  const conn = state.players.find((p) => p.id === other.id)?.connected;
  const [settling, setSettling] = useState(false);
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
  useEffect(() => {
    if (!g.lastTrick || g.phase !== "playing") {
      setSettling(false);
      return;
    }
    setSettling(true);
    const timer = setTimeout(() => setSettling(false), 850);
    return () => clearTimeout(timer);
  }, [g.lastTrick?.number, g.round]);
  const cardsOnTable = settling && g.lastTrick ? g.lastTrick.cards : g.trick;
  busy = busy || settling;
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
    ? (myValat ? myValat.success : valats.some(entry => entry.success)) ? "Valat!" : "Valat ni uspel."
    : scoreWinner === you ? "Lepa igra!" : scoreWinner === null ? "Izenačeno!" : "Dobra partija.";
  const resultDescription = valats.length
    ? `${valats.map(entry => `${g.players[entry.player].name}: ${entry.announced
      ? entry.success ? "uspešno napovedan valat" : "neuspešno napovedan valat"
      : "tihi valat"} (${signed(entry.points)})`).join(". ")}.`
    : !last ? "" : last.winner === null
      ? `Oba sta zbrala ${last.points[0]} točk v kartah.`
      : `${g.players[last.winner].name}: ${last.points[last.winner]} točk v kartah.`;
  const groups = Object.keys(suits)
    .map((suit) => ({ suit, cards: g.hand.filter((c) => c.suit === suit) }))
    .filter((x) => x.cards.length);
  const pickupChoices = me.stacks
    .map((stack, index) => ({ card: stack.top, index }))
    .filter(({ card }) => card && g.legalPickups?.includes(card.id));
  const showSuit = (suit) => {
    const hand = handRef.current;
    const group = hand?.querySelector(`[data-suit="${suit}"]`);
    if (!group) return;
    hand.scrollTo({
      left: hand.scrollLeft + group.getBoundingClientRect().left - hand.getBoundingClientRect().left - 4,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  };
  const liveStatus = g.phase === "bidding"
    ? `Runda ${g.round}. ${myTurn ? "Izberi Igram ali Naprej." : `${other.name} izbira igro.`}`
    : g.phase === "announcements"
      ? `Priprava. ${(g.announcementReady || []).filter(Boolean).length}/2 pripravljena. ${g.announcementReady?.[you] ? `Čakamo ${other.name}.` : "Prevzemi in napovedi so po želji. Nato potrdi."}`
      : g.phase === "playing"
        ? `Štih ${g.trickNumber} od 27. ${myTurn ? "Na potezi si." : `Na potezi je ${other.name}.`}`
        : `Runda ${g.round} je končana. Za novo rundo morata potrditi oba.`;
  return (
    <main className="game-page" data-phase={g.phase} data-round={g.round}
      data-turn={g.turn ?? ""} data-you={you} data-trick-number={g.trickNumber}
      data-trick-card-ids={g.trick.map(({ card }) => card.id).join(",")}
      data-pickup-count={g.pickups?.length || 0}
      data-announcement-ready={(g.announcementReady || [false, false]).join(",")}
      data-announcements={JSON.stringify(g.announcements || [])}>
      <span className="sr-only" data-testid="game-status" role="status" aria-live="polite" aria-atomic="true">{liveStatus}</span>
      <div className="game-toolbar">
        <div className="table-title">
          <span className="eyebrow">VAJINA MIZA</span>
          <span className="table-code">{state.roomId}</span>
          <span className="toolbar-divider" />
          <strong>Runda {g.round}</strong>
          {g.phase === "playing" && <span className="compact-trick-progress">Štih {Math.min(g.trickNumber, 27)}/27</span>}
        </div>
        <button className="score-button" onClick={onScore}
          aria-label={`Rezultati: ${me.name} ${signed(me.score)} točk, ${other.name} ${signed(other.score)} točk.`}>
          <Trophy size={17} />
          <span>Rezultati</span>
          <b>
            {me.score} : {other.score}
          </b>
        </button>
      </div>
      {!conn && (
        <div className="connection-notice">
          <WifiOff size={16} /> {other.name} je brez povezave. Mesto je
          shranjeno; igra se nadaljuje ob vrnitvi.
        </div>
      )}
      {g.phase === "roundEnd" ? (
        <section className="round-end">
          <div className="round-end-top">
            <span className="trophy-circle">
              <Trophy size={30} strokeWidth={1.4} />
            </span>
            <div>
              <span className="eyebrow">RUNDA {g.round} JE POD STREHO</span>
              <h1 data-testid="round-result-heading">{resultHeading}</h1>
              <p data-testid="round-result-description">{resultDescription}</p>
            </div>
          </div>
          <div className="round-end-body">
            <div className="score-heading">
              <h2>Vajina zgodba v točkah</h2>
              <span>
                {g.scoreboard.length}{" "}
                {g.scoreboard.length % 100 === 1 ? "runda" : g.scoreboard.length % 100 === 2 ? "rundi" : [3, 4].includes(g.scoreboard.length % 100) ? "runde" : "rund"}
              </span>
            </div>
            <ScoreTable game={g} />
            <div className="score-explanation">
              <CircleHelp size={16} />
              <span>
                {last.breakdown?.some(entry => entry.kind === "valat")
                  ? "Valat nadomesti igro, kralje in trulo. Mondfang se obračuna posebej."
                  : last.contract.kind === "announced"
                  ? `${g.players[last.contract.player].name}: ${last.contractWon ? "uspešna napoved, razlika × 2" : "neuspešna napoved, trojna izguba"}.`
                  : "Navadna igra: zmagovalcu se prišteje razlika nad 35."}
              </span>
            </div>
            <div className="next-round">
              <div>
                <h3>Še eno?</h3>
                <p>V naslednji rundi deli {g.players[1 - g.dealer].name}.</p>
              </div>
              <button
                className="primary-button"
                data-testid="new-round"
                disabled={busy || g.ready[you]}
                onClick={() => action({ type: "ready" })}
              >
                {g.ready[you] ? (
                  <>
                    <Check size={18} /> Pripravljeno
                  </>
                ) : (
                  <>
                    Nova runda <ArrowRight size={18} />
                  </>
                )}
              </button>
            </div>
            <div className="ready-status" data-testid="ready-count">
              {g.ready.filter(Boolean).length}/2 pripravljena <span>·</span>{" "}
              {g.ready[you]
                ? `Čakamo še ${other.name}.`
                : "Naslednja runda se začne, ko sta pripravljena oba."}
            </div>
          </div>
        </section>
      ) : (
        <div className="play-layout">
          <section className="game-table felt">
            <div className="felt-border" />
            <div className="table-topline">
              <span>
                <span className="live-dot" /> IGRA V DVOJE
              </span>
              <span>
                {g.phase === "bidding"
                  ? "NAPOVED IGRE"
                  : g.phase === "announcements"
                    ? "PRIPRAVA IN NAPOVEDI"
                  : `ŠTIH ${Math.min(g.trickNumber, 27)} / 27`}
              </span>
            </div>
            <div
              className={`player-seat opponent ${!myTurn ? "active-seat" : ""}`}
            >
              <Avatar name={other.name} connected={conn} />
              <div>
                <strong>{other.name}</strong>
                <span>
                  {other.handCount} kart v roki <i>·</i> {trickCountLabel(other.trickCount)}
                </span>
              </div>
              {g.dealer === opponent && (
                <span className="dealer-badge" title="Delilec">
                  D
                </span>
              )}
              <div
                className="opponent-hand"
                aria-label={`${other.handCount} skritih kart`}
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
            <div className="center-play">
              {g.phase === "bidding" ? (
                <div className="bidding-panel">
                  <span className="bid-diamond">
                    <Diamond size={24} strokeWidth={1.2} />
                  </span>
                  <span className="eyebrow">POGLEJ KARTE. ZAUPAJ OBČUTKU.</span>
                  <h2>
                    {myTurn
                      ? "Igraš?"
                      : `${other.name} izbira igro.`}
                  </h2>
                  <p>
                    {myTurn
                      ? "Zbereš vsaj 36 točk? Napovej igro."
                      : "Kmalu bo čas za prvo karto."}
                  </p>
                  {myTurn ? (
                    <div className="bid-actions">
                      <button
                        className="bid-pass"
                        data-testid="bid-pass"
                        disabled={busy}
                        onClick={() => action({ type: "bid", bid: "pass" })}
                      >
                        Naprej
                      </button>
                      <button
                        className="bid-play"
                        data-testid="bid-play"
                        disabled={busy}
                        onClick={() => action({ type: "bid", bid: "play" })}
                      >
                        Igram <ArrowRight size={16} />
                      </button>
                    </div>
                  ) : (
                    <span className="waiting-pill">
                      <LoaderCircle size={14} className="spin" /> Čakamo napoved
                    </span>
                  )}
                </div>
              ) : g.phase === "announcements" ? (
                <AnnouncementPanel game={g} busy={busy} action={action} />
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
                      <div className="empty-trick">
                        <Diamond size={29} strokeWidth={1} />
                        <span>
                          {myTurn
                            ? "Tvoja poteza"
                            : "Na vrsti je " + other.name}
                        </span>
                        <small>
                          {myTurn
                            ? "Izberi označeno karto."
                            : "Počakaj na nasprotnikovo karto."}
                        </small>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            {g.phase === "playing" && g.contract.kind === "announced" && (
              <span className="contract-tag">
                <Flag size={11} /> Igram: {g.players[g.contract.player].name}
              </span>
            )}
            <div className="bottom-table">
              <div className="last-trick">
                {g.lastTrick ? (
                  <>
                    <span>ZADNJI ŠTIH</span>
                    <button aria-label={`Zadnji štih: ${g.players[g.lastTrick.winner].name}`}
                      onClick={() => action({ type: "showLastTrick" })}>
                      <Layers3 size={16} />
                      {g.players[g.lastTrick.winner].name}
                      <ArrowUpRight size={12} />
                    </button>
                  </>
                ) : (
                  <>
                    <span>PO SLOVENSKO</span>
                    <small>54 kart. Dva igralca.</small>
                  </>
                )}
              </div>
              <Stacks
                player={me}
                mine
                legalMoves={g.legalMoves}
                onPlay={play}
                disabled={busy}
              />
              <div className="trick-stat">
                <strong>{me.trickCount}</strong>
                <span>TVOJI ŠTIHI</span>
              </div>
            </div>
          </section>
          <section className="hand-panel">
            <div className="hand-heading">
              <div className="hand-identity">
                <Avatar name={me.name} you />
                <div>
                  <strong>
                    {me.name}
                    <span> (ti)</span>
                  </strong>
                  <small>
                    {g.hand.length} kart · {trickCountLabel(me.trickCount)}
                    {g.dealer === you && <span className="hand-dealer"> · Deliš</span>}
                  </small>
                </div>
              </div>
              <span className={`turn-indicator ${myTurn ? "your-turn" : ""}`}>
                <i />
                {g.phase === "bidding"
                  ? myTurn
                    ? "Izberi igro"
                    : "Čakamo napoved"
                  : g.phase === "announcements"
                    ? g.announcementReady?.[you] ? "Pripravljen si" : "Prevzemi, napovej, potrdi"
                  : myTurn
                    ? "Na potezi si"
                    : "Na potezi je " + other.name}
              </span>
            </div>
            <nav className="hand-navigation" aria-label="Poišči barvo v roki">
              {groups.map(group => <button key={group.suit} type="button"
                data-testid="hand-suit" data-suit={group.suit}
                aria-label={`Pokaži ${suits[group.suit]} v roki (${group.cards.length} kart)`}
                onClick={() => showSuit(group.suit)}>
                {suits[group.suit]} <small>{group.cards.length}</small>
              </button>)}
              {handOverflows && <span className="hand-swipe" title="Podrsaj po kartah" aria-label="Za več kart podrsaj levo ali desno">↔</span>}
            </nav>
            <div className="hand-scroll" role="region" aria-label="Tvoje karte. Podrsaj ali izberi barvo."
              ref={handRef} tabIndex={0} onKeyDown={event => {
                if (event.target !== event.currentTarget || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
                event.preventDefault();
                event.currentTarget.scrollBy({ left: (event.key === "ArrowRight" ? 1 : -1) * event.currentTarget.clientWidth * .75 });
              }}>
              {groups.map((group) => (
                <div className="suit-group" key={group.suit} data-suit={group.suit}>
                  <span className="suit-group-label">
                    {suits[group.suit]} <small>{group.cards.length}</small>
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
            </div>
            <div className="hand-hint">
              <span>
                <Sparkles size={13} />
                {g.phase === "bidding"
                  ? "Najprej izberi »Igram« ali »Naprej«."
                  : g.phase === "announcements"
                    ? g.announcementReady?.[you]
                      ? "Priprava je potrjena. Ko potrdita oba, se začne igra."
                      : "Prevzemi in napovedi so po želji. S potrditvijo jih zakleneš do začetka igre."
                  : myTurn
                    ? g.hand.length > 0 && g.trick.length === 0
                      ? "Štih začneš s karto iz roke; s kupčka šele, ko je roka prazna."
                      : "Sledi barvi tudi s kupčka; če je nimaš, igraj tarok."
                    : "Karte so razvrščene po barvi in moči."}
              </span>
              <button onClick={onRules}>
                <CircleHelp size={14} /> Pravila
              </button>
            </div>
            {(!!g.announcements?.length || !!g.mondfangs?.length) && (
              <div className="public-announcements" aria-label="Napovedani dodatki">
                {(g.announcements || []).map(call => <span key={`${call.player}-${call.bonus}`}
                  data-testid="public-announcement" data-player={call.player} data-bonus={call.bonus}>
                  <Flag size={11} /> {g.players[call.player].name}: {bonusNames[call.bonus]}
                </span>)}
                {(g.mondfangs || []).map(event => <span key={`mond-${event.trickNumber}`}
                  className="mondfang-warning" data-testid="mondfang-event" data-player={event.player}>
                  Ujet Mond · {g.players[event.player].name} −21
                </span>)}
              </div>
            )}
            {!!pickupChoices.length && (
              <div className="pickup-options" data-testid="pickup-options" tabIndex={-1} aria-label="Neobvezni prevzemi s kupčkov">
                <div className="pickup-options-heading">
                  <span><ArrowDownToLine size={13} /> Vzemi v roko</span>
                  <small>Po želji · ne porabi poteze</small>
                </div>
                <div className="pickup-actions">
                  {pickupChoices.map(({ card, index }) => (
                    <button key={card.id} type="button" data-testid="pickup-card"
                      data-card-id={card.id} data-stack-index={index}
                      aria-label={`Vzemi ${card.name} v roko`}
                      disabled={busy}
                      onClick={() => action({ type: "pickup", cardId: card.id })}>
                      <span><small>{index + 1}. kupček</small><strong>{card.name}</strong></span>
                      <ArrowDownToLine size={15} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!!g.pickups?.length && (
              <button
                className="pickup-note"
                onClick={() => action({ type: "showPickups" })}
              >
                <Layers3 size={12} />
                Prevzete karte s kupčkov <span>{g.pickups.length}</span>
                <ArrowUpRight size={12} />
              </button>
            )}
          </section>
        </div>
      )}
      <div className="game-footer">
        <span>
          <ShieldCheck size={13} /> Zasebna miza · Slovenski tarok v dveh
        </span>
        <span>Čas za dobro partijo.</span>
      </div>
    </main>
  );
}

function App() {
  const [name, setName] = useState(() => readSaved(NAME) || "");
  const [code, setCode] = useState(
    () => new URLSearchParams(location.search).get("room")?.toUpperCase() || "",
  );
  const [state, setState] = useState(null);
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null);
  const [copied, setCopied] = useState(false);
  const [resuming, setResuming] = useState(!!sessionForPage());
  const socketRef = useRef(null);
  const stateRef = useRef(null);
  useEffect(() => {
    const socket = io({ autoConnect: false, reconnection: true });
    socketRef.current = socket;
    socket.on("connect", () => {
      setOnline(true);
      const saved = sessionForPage();
      if (saved) {
        setResuming(true);
        socket.timeout(8000).emit("room:resume", saved, (err, res) => {
          setResuming(false);
          if (err || !res?.ok) {
            // A temporary shutdown or rate limit must never erase a reserved seat.
            setError(
              err
                ? "Obnova povezave ni uspela. Poskusi osvežiti stran."
                : res?.error || "Miza ni več na voljo.",
            );
          } else rememberSession(res);
        });
      } else setResuming(false);
    });
    socket.on("disconnect", () => {
      setOnline(false);
      setBusy(false);
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
  function rememberSession(result) {
    const session = { roomId: result.roomId, token: result.token };
    localStorage.setItem(STORAGE, JSON.stringify(session));
    localStorage.setItem(
      SESSIONS,
      JSON.stringify({ ...readSaved(SESSIONS), [result.roomId]: session }),
    );
  }
  function joined(result) {
    rememberSession(result);
    localStorage.setItem(NAME, JSON.stringify(name.trim()));
    history.replaceState({}, "", `/?room=${result.roomId}`);
  }
  function action(action) {
    if (action.type === "showPickups") {
      setModal("pickups");
      return;
    }
    if (action.type === "showLastTrick") {
      setModal("last");
      return;
    }
    emit("game:action", action);
  }
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Povezavo lahko kopiraš iz polja pod gumbom.");
    }
  }
  function leave() {
    emit("room:leave", {}, () => {
      localStorage.removeItem(STORAGE);
      setState(null);
      stateRef.current = null;
      setModal(null);
      history.replaceState({}, "", "/");
      setCode("");
    });
  }
  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <Logo onClick={() => (state ? setModal("leave") : null)} />
          <div className="header-right">
            <span
              className={`connection-status ${online ? "" : "disconnected"}`}
            >
              {online ? (
                <>
                  <span className="status-dot" /> Pripravljeno na igro
                </>
              ) : (
                <>
                  <WifiOff size={14} /> Povezovanje …
                </>
              )}
            </span>
            <button className="header-cards" data-testid="deck-gallery" aria-label="Karte" onClick={() => setModal("deck")}>
              <Layers3 size={17}/><span>Karte</span>
            </button>
            <button className="header-rules" aria-label="Kako igrati" onClick={() => setModal("rules")}>
              <CircleHelp size={17} />
              <span>Kako igrati</span>
            </button>
            {state && (
              <button
                className="icon-button"
                onClick={() => setModal("leave")}
                aria-label="Zapusti mizo"
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
          <p>Vračamo te za mizo …</p>
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
          copied={copied}
          onLeave={() => setModal("leave")}
        />
      ) : (
        <Landing
          name={name}
          setName={setName}
          code={code}
          setCode={setCode}
          create={() => emit("room:create", { name: name.trim() }, joined)}
          join={() => {
            const saved = (readSaved(SESSIONS) || {})[code];
            if (saved) emit("room:resume", saved, joined);
            else emit("room:join", { name: name.trim(), roomId: code }, joined);
          }}
          busy={busy}
          online={online}
          onRules={() => setModal("rules")}
        />
      )}
      {error && (
        <div className="toast" role="alert">
          <CircleHelp size={18} />
          <span>{error}</span>
          <button aria-label="Zapri obvestilo" onClick={() => setError("")}>
            <X size={17} />
          </button>
        </div>
      )}
      {modal === "rules" && <Rules onClose={() => setModal(null)} />}
      {modal === "deck" && <DeckGallery onClose={() => setModal(null)} />}
      {modal === "score" && state?.game && (
        <Modal title="Vajini rezultati" onClose={() => setModal(null)} wide>
          <ScoreTable game={state.game} />
        </Modal>
      )}
      {modal === "leave" && (
        <Modal title="Zapustiš mizo?" onClose={() => setModal(null)}>
          <p className="leave-copy">
            Tvoje mesto in rezultati ostanejo shranjeni. Z isto kodo ali
            povezavo se lahko vrneš v tem brskalniku. Koda mize:{" "}
            <strong>{state?.roomId}</strong>.
          </p>
          <div className="modal-actions">
            <button className="secondary-button" onClick={() => setModal(null)}>
              Ostani za mizo
            </button>
            <button className="primary-button" onClick={leave} disabled={busy}>
              Zapusti mizo
            </button>
          </div>
        </Modal>
      )}
      {modal === "pickups" && state?.game && (
        <Modal title="Prevzete karte s kupčkov" onClose={() => setModal(null)}>
          <p className="last-trick-description">
            Ti taroki in kralji so bili javno razkriti in prestavljeni v roko.
            Nekatere karte so lahko že odigrane.
          </p>
          <div className="pickup-list">
            {state.game.players.map((player, index) => (
              <section key={player.id}>
                <h3>{player.name}</h3>
                <div>
                  {(state.game.pickups || [])
                    .filter((pickup) => pickup.player === index)
                    .map((pickup) => (
                      <div key={pickup.card.id}>
                        <Card card={pickup.card} small />
                        <span>Štih {pickup.trickNumber}</span>
                      </div>
                    ))}
                </div>
              </section>
            ))}
          </div>
        </Modal>
      )}
      {modal === "last" && state?.game?.lastTrick && (
        <Modal title="Zadnji štih" onClose={() => setModal(null)}>
          <p className="last-trick-description">
            Štih: {" "}
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
