import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

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
export function LinkCard({ url, onCopy, title }) {
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    setQr(''); setCopied(false);
    if (url) QRCode.toDataURL(url, { width: 240, margin: 4, errorCorrectionLevel: 'M' }).then(value => { if (active) setQr(value); }).catch(() => {});
    return () => { active = false; };
  }, [url]);
  if (!url) return null;
  return <section className="identity-link"><h3>{title}</h3>
    {qr && <img src={qr} width="240" height="240" alt={`QR: ${title}`} />}
    <input className="invite-url" aria-label={title} value={url} readOnly onFocus={e => e.target.select()} />
    <button className="primary-button" onClick={async () => { if (await onCopy(url)) setCopied(true); }}>{copied ? "Kopirano" : "Kopiraj povezavo"}</button>
  </section>;
}
export function IdentityHome({ user, name, setName, tables, link, busy, online, onCreate, onJoin, onRedeem, onDismiss, onResume, onDevices, legacy, onClaim }) {
  const special = link && link.kind !== 'invite';
  return <main className="identity-home">
    <span className="eyebrow">TAROK V DVOJE</span>
    <h1>{special ? 'Poveži svojega igralca.' : user ? 'Moje mize' : 'Dobra družba. Dobre karte.'}</h1>
    {special ? <section className="identity-panel">
      <h2>{link.kind === 'device' ? 'Dodaj ta brskalnik' : 'Obnovi dostop'}</h2>
      <p>Ta povezava omogoči dostop do vseh miz istega igralca. {user && `Ta brskalnik že uporablja igralec ${user.name}. Če povezava pripada drugemu igralcu, uporabi drug profil brskalnika.`}</p>
      <button className="primary-button" disabled={busy || !online} onClick={onRedeem}>Poveži brskalnik</button>
      <button className="text-button" onClick={onDismiss}>Prekliči</button>
    </section> : <>
      {user ? <div className="identity-toolbar"><p>Igraš kot <strong>{user.name}</strong>.</p><button className="secondary-button" onClick={onDevices}>Naprave in obnovitev</button></div> : <p>Le prikazno ime. Brez uporabniškega imena in gesla.</p>}
      <form className="identity-panel" onSubmit={e => { e.preventDefault(); link ? onJoin() : onCreate(); }}>
        <h2>{link ? 'Povabilo za mizo' : 'Nova miza'}</h2>
        {!user && <label>Kako ti je ime?<input data-testid="player-name" autoComplete="nickname" maxLength={24} value={name} onChange={e => setName(e.target.value)} required /></label>}
        {link && <p>Pridruži se prijatelju s svojim igralcem. Povabilo ne omogoča dostopa do prijateljevih drugih miz.</p>}
        <button data-testid={link ? 'join-room' : 'create-room'} className="primary-button" disabled={busy || !online || (!user && !name.trim())}>{link ? 'Pridruži se' : 'Ustvari mizo'}</button>
        {link && <button type="button" className="text-button" onClick={onDismiss}>Nazaj na moje mize</button>}
      </form>
      {user && <section className="identity-panel"><h2>Tvoje mize</h2>{tables.length ? tables.map(table => <div className="identity-table" key={table.roomId}>
        <div><strong>{table.opponent || 'Čakamo prijatelja'}</strong><small>{table.roomId} · {table.status === 'waiting' ? 'Povabi prijatelja' : table.status === 'roundEnd' ? 'Rezultati kroga' : 'Igra v teku'}</small></div>
        <button className="secondary-button" onClick={() => onResume(table.roomId)} disabled={busy || !online}>Nadaljuj</button>
      </div>) : <p>Še nimaš miz. Ustvari prvo ali odpri prijateljevo povabilo.</p>}</section>}
      {legacy.length > 0 && <section className="identity-panel"><h2>Obnovi stare mize</h2><p>Izberi svoje mesto. Če imaš shranjeni obe mesti iste mize, lahko povežeš samo eno. Neuspešno obnovljeni ključi ostanejo shranjeni.</p>{legacy.map((seat, index) => <button className="secondary-button" key={`${seat.roomId}:${index}`} disabled={busy || !online} onClick={() => onClaim(seat)}>Miza {seat.roomId} · {seat.name || `mesto ${index + 1}`}</button>)}</section>}
    </>}
  </main>;
}
export function DeviceSettings({ devices, onRename, onRevoke, onLink, onRecovery, url, kind, expiresAt, onCopy, busy }) {
  return <div className="identity-settings">
    <p>Vsak brskalnik ima svoj dostop do vseh tvojih miz.</p>
    {devices.map(device => <div className="identity-table" key={device.id}>
      <label>Ime naprave {device.current && '(ta brskalnik)'}<input aria-label={`Ime naprave ${device.name}`} defaultValue={device.name} maxLength={24} onBlur={e => { if (e.target.value.trim() && e.target.value.trim() !== device.name) onRename(device.id, e.target.value); }} /></label>
      <small>Povezana {new Date(device.createdAt).toLocaleString('sl-SI')}</small>
      {!device.current && <button className="text-button" disabled={busy} onClick={() => onRevoke(device.id)}>Odstrani</button>}
    </div>)}
    <button className="primary-button" disabled={busy} onClick={onLink}>Dodaj novo napravo</button>
    <p>Povezava velja 15 minut in poveže en brskalnik. Novo povabilo nadomesti prejšnje.</p>
    <h3>Obnovitev dostopa</h3><p>Shrani zasebno povezavo na varno mesto. Kdor jo ima, lahko dostopa do vseh tvojih miz. Brez nje ali povezane naprave dostopa ni mogoče obnoviti.</p>
    <button className="secondary-button" disabled={busy} onClick={onRecovery}>Ustvari novo obnovitveno povezavo</button>
    <p>Nova obnovitvena povezava razveljavi prejšnjo.</p>
    <LinkCard url={url} title={kind === 'device' ? 'Povezava za novo napravo' : 'Zasebna obnovitvena povezava'} onCopy={onCopy} />
    {url && kind === 'device' && <p>Velja do {new Date(expiresAt).toLocaleTimeString('sl-SI')}.</p>}
  </div>;
}
