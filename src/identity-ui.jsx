import React, { useEffect, useId, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Archive, Check, ChevronDown, ChevronRight, Copy, Layers3, Link, MonitorSmartphone, Plus, QrCode, Share2, Trash2, Trophy, Users } from 'lucide-react';
import { getLocale, t } from './i18n.mjs';

export const DEVICE = 'tarokza2.device';
export const PENDING_DEVICE = 'tarokza2.pending-device';
export function newSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function captureLink() {
  const params = new URLSearchParams(location.hash.slice(1));
  const kind = ['invite', 'device', 'recovery'].find(key => params.has(key));
  if (kind) {
    const link = { kind, token: params.get(kind), roomId: params.get('room') };
    sessionStorage.setItem('tarokza2.link', JSON.stringify(link));
    history.replaceState({}, '', location.pathname);
    return link;
  }
  try { return JSON.parse(sessionStorage.getItem('tarokza2.link')); } catch { return null; }
}
export function sharedLink(kind, token, roomId) {
  const params = new URLSearchParams({ [kind]: token });
  if (roomId) params.set('room', roomId);
  return `${location.origin}/#${params}`;
}
export function LinkCard({ url, onCopy, title, invitation = false }) {
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const inputRef = useRef(null);
  const inputId = useId();
  useEffect(() => {
    let active = true;
    setQr(''); setCopied(false);
    if (url) QRCode.toDataURL(url, { width: 240, margin: 4, errorCorrectionLevel: 'M' }).then(value => { if (active) setQr(value); }).catch(() => {});
    return () => { active = false; };
  }, [url]);
  async function copyLink() {
    if (await onCopy(url)) setCopied(true);
    else { inputRef.current?.focus(); inputRef.current?.select(); }
  }
  async function shareLink() {
    setSharing(true);
    try { await navigator.share({ title, url }); }
    catch (error) { if (error.name !== 'AbortError') await copyLink(); }
    finally { setSharing(false); }
  }
  if (!url) return null;
  if (invitation) {
    const canShare = typeof navigator.share === 'function';
    return <div className="invitation-link">
      <p className="invitation-feedback" role="status" aria-live="polite" data-testid="invite-feedback">
        <Check size={16} aria-hidden="true" />{copied ? t('Povezava je kopirana.') : t('Povabilo je pripravljeno.')}
      </p>
      <div className="invitation-actions">
        {canShare && <button className="primary-button" data-testid="invite-share" onClick={shareLink} disabled={sharing} aria-busy={sharing}>
          <Share2 size={18} aria-hidden="true" />{t('Deli povabilo')}
        </button>}
        <button className={canShare ? 'secondary-button' : 'primary-button'} data-testid="invite-copy" aria-label={t('Kopiraj povezavo')} onClick={copyLink}>
          {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}{t(copied ? 'Kopirano' : canShare ? 'Kopiraj' : 'Kopiraj povezavo')}
        </button>
      </div>
      <label className="sr-only" htmlFor={inputId}>{t('Povezava s povabilom')}</label>
      <div className="invitation-url-row"><Link size={16} aria-hidden="true" />
        <input ref={inputRef} id={inputId} className="invite-url" aria-label={title} value={url} readOnly onFocus={event => event.target.select()} />
      </div>
      <details className="invitation-qr" data-testid="invite-details">
        <summary><QrCode size={18} aria-hidden="true" />{t('Pokaži kodo QR')}<ChevronDown size={16} aria-hidden="true" /></summary>
        {qr && <img src={qr} width="240" height="240" alt={t('QR: {title}', { title })} />}
      </details>
    </div>;
  }
  return <section className="identity-link"><h3>{title}</h3>
    {qr && <img src={qr} width="240" height="240" alt={t('QR: {title}', { title })} />}
    <input className="invite-url" aria-label={title} value={url} readOnly onFocus={e => e.target.select()} />
    <button className="primary-button" onClick={async () => { if (await onCopy(url)) setCopied(true); }}>{copied ? t('Kopirano') : t('Kopiraj povezavo')}</button>
  </section>;
}
export function IdentityHome({ user, name, setName, tables, link, busy, online, onCreate, onJoin, onRedeem, onDismiss, onResume, onAbandon, onDisposition, onDeleteArchive, onDevices, legacy, onClaim }) {
  const special = link && link.kind !== 'invite';
  const showTables = user && !link;
  const activeTables = tables.filter(table => table.status !== 'abandoned');
  const archivedTables = tables.filter(table => table.status === 'abandoned');
  return <main className="identity-home">
    <div className="identity-heading">
      <div>
        <span className="eyebrow">{t('TAROK V DVOJE')}</span>
        <h1>{special ? t('Poveži svojega igralca.') : user ? t('Moje mize') : t('Dobra družba. Dobre karte.')}</h1>
      </div>
      {showTables && <button type="button" data-testid="create-room" className="primary-button identity-create" disabled={busy || !online} onClick={onCreate}>
        <Plus size={18} aria-hidden="true" />{t('Nova miza')}
      </button>}
    </div>
    {special ? <section className="identity-panel">
      <h2>{link.kind === 'device' ? t('Dodaj ta brskalnik') : t('Obnovi dostop')}</h2>
      <p>{t('Ta povezava omogoči dostop do vseh miz istega igralca.')} {user && t('Ta brskalnik že uporablja igralec {name}. Če povezava pripada drugemu igralcu, uporabi drug profil brskalnika.', { name: user.name })}</p>
      <button className="primary-button" disabled={busy || !online} onClick={onRedeem}>{t('Poveži brskalnik')}</button>
      <button className="text-button" onClick={onDismiss}>{t('Prekliči')}</button>
    </section> : <>
      {user ? <div className="identity-toolbar"><p>{t('Igraš kot {name}.', { name: user.name })}</p><button className="text-button identity-devices" onClick={onDevices}><MonitorSmartphone size={17} aria-hidden="true" /><span>{t('Naprave in obnovitev')}</span></button></div> : <p className="identity-intro">{t('Le prikazno ime. Brez uporabniškega imena in gesla.')}</p>}
      {!showTables && <form className="identity-panel" onSubmit={e => { e.preventDefault(); link ? onJoin() : onCreate(); }}>
        <h2>{link ? t('Povabilo za mizo') : t('Nova miza')}</h2>
        {!user && <label>{t('Kako ti je ime?')}<input data-testid="player-name" autoComplete="nickname" maxLength={24} value={name} onChange={e => setName(e.target.value)} required /></label>}
        {link && <p>{t('Pridruži se prijatelju s svojim igralcem. Povabilo ne omogoča dostopa do prijateljevih drugih miz.')}</p>}
        <button data-testid={link ? 'join-room' : 'create-room'} className="primary-button" disabled={busy || !online || (!user && !name.trim())}>{link ? t('Pridruži se') : t('Ustvari mizo')}</button>
        {link && <button type="button" className="text-button" onClick={onDismiss}>{t('Nazaj na moje mize')}</button>}
      </form>}
      {user && <section className="identity-tables" aria-label={t('Tvoje mize')}>
        <h2 className="sr-only">{t('Tvoje mize')}</h2>
        {activeTables.length ? <ul className="identity-table-list">{activeTables.map(table => {
          const status = table.status === 'waiting' ? 'waiting' : table.status === 'roundEnd' ? 'finished' : 'playing';
          const StatusIcon = status === 'waiting' ? Users : status === 'finished' ? Trophy : Layers3;
          return <li key={table.roomId} className="identity-table-row">
            <button type="button" className="identity-table-card" data-status={status} onClick={() => onResume(table.roomId)} disabled={busy || !online}>
              <span className="identity-table-mark" aria-hidden="true"><StatusIcon size={21} strokeWidth={1.6} /></span>
              <span className="identity-table-info">
                <strong>{table.opponent || t('Čakamo prijatelja')}</strong>
                <small><span className="identity-room-code">{table.roomId}</span>{' · '}<span className="identity-table-status">{status === 'waiting' ? t('Povabi prijatelja') : status === 'finished' ? t('Rezultati kroga') : t('Igra v teku')}</span></small>
              </span>
              <span className="identity-table-action"><span>{t('Nadaljuj')}</span><ChevronRight size={18} aria-hidden="true" /></span>
            </button>
            <button type="button" className="icon-button identity-table-abandon" data-testid="abandon-table" aria-label={t('Opusti mizo {room}', { room: table.roomId })} title={t('Opusti mizo')} disabled={busy || !online} onClick={() => onAbandon(table)}>
              <Trash2 size={17} aria-hidden="true" />
            </button>
          </li>;
        })}</ul> : <div className="identity-empty"><span className="identity-empty-mark" aria-hidden="true"><Layers3 size={28} strokeWidth={1.4} /></span><p>{archivedTables.length ? t('Ni aktivnih miz.') : t('Še nimaš miz. Ustvari prvo ali odpri prijateljevo povabilo.')}</p></div>}
      </section>}
      {legacy.length > 0 && <section className="identity-panel"><h2>{t('Obnovi stare mize')}</h2><p>{t('Izberi svoje mesto. Če imaš shranjeni obe mesti iste mize, lahko povežeš samo eno. Neuspešno obnovljeni ključi ostanejo shranjeni.')}</p>{legacy.map((seat, index) => <button className="secondary-button" key={`${seat.roomId}:${index}`} disabled={busy || !online} onClick={() => onClaim(seat)}>{t('Miza {room} · {name}', { room: seat.roomId, name: seat.name || t('mesto {number}', { number: index + 1 }) })}</button>)}</section>}
      {user && !link && archivedTables.length > 0 && <section className="identity-archive" aria-label={t('Arhiv')}>
        <div className="identity-archive-heading"><h2>{t('Arhiv')}</h2><span>{archivedTables.length}</span></div>
        <ul className="identity-table-list">{archivedTables.map(table => <li className="identity-table-row identity-archive-row" key={table.roomId} data-testid={table.disposition === 'archived' ? 'archived-table' : 'pending-table'}>
          <span className="identity-table-mark" aria-hidden="true"><Archive size={20} strokeWidth={1.6} /></span>
          <div className="identity-table-info">
            <strong>{table.opponent || t('Opuščena miza')}</strong>
            <small><span className="identity-room-code">{table.roomId}</span> · {new Date(table.abandonedAt).toLocaleDateString(getLocale())}</small>
          </div>
          {table.disposition === 'pending' ? <button type="button" className="secondary-button identity-disposition-button" data-testid="choose-table-disposition" disabled={busy || !online} onClick={() => onDisposition(table)}>{t('Odloči se')}</button>
            : <button type="button" className="icon-button identity-table-abandon" data-testid="delete-archived-table" aria-label={t('Izbriši mizo {room}', { room: table.roomId })} title={t('Izbriši')} disabled={busy || !online} onClick={() => onDeleteArchive(table)}><Trash2 size={17} aria-hidden="true" /></button>}
        </li>)}</ul>
      </section>}
    </>}
  </main>;
}
export function DeviceSettings({ devices, onRename, onRevoke, onLink, onRecovery, url, kind, expiresAt, onCopy, busy }) {
  return <div className="identity-settings">
    <p>{t('Vsak brskalnik ima svoj dostop do vseh tvojih miz.')}</p>
    {devices.map(device => <div className="identity-table" key={device.id}>
      <label>{device.current ? t('Ime naprave (ta brskalnik)') : t('Ime naprave')}<input aria-label={t('Ime naprave {name}', { name: device.name })} defaultValue={device.name} maxLength={24} onBlur={e => { if (e.target.value.trim() && e.target.value.trim() !== device.name) onRename(device.id, e.target.value); }} /></label>
      <small>{t('Povezana {date}', { date: new Date(device.createdAt).toLocaleString(getLocale()) })}</small>
      {!device.current && <button className="text-button" disabled={busy} onClick={() => onRevoke(device.id)}>{t('Odstrani')}</button>}
    </div>)}
    <button className="primary-button" disabled={busy} onClick={onLink}>{t('Dodaj novo napravo')}</button>
    <p>{t('Povezava velja 15 minut in poveže en brskalnik. Novo povabilo nadomesti prejšnje.')}</p>
    <h3>{t('Obnovitev dostopa')}</h3><p>{t('Shrani zasebno povezavo na varno mesto. Kdor jo ima, lahko dostopa do vseh tvojih miz. Brez nje ali povezane naprave dostopa ni mogoče obnoviti.')}</p>
    <button className="secondary-button" disabled={busy} onClick={onRecovery}>{t('Ustvari novo obnovitveno povezavo')}</button>
    <p>{t('Nova obnovitvena povezava razveljavi prejšnjo.')}</p>
    <LinkCard url={url} title={kind === 'device' ? t('Povezava za novo napravo') : t('Zasebna obnovitvena povezava')} onCopy={onCopy} />
    {url && kind === 'device' && <p>{t('Velja do {time}.', { time: new Date(expiresAt).toLocaleTimeString(getLocale()) })}</p>}
  </div>;
}
