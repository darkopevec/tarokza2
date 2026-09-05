const UNAVAILABLE = 'Podrobnosti izračuna niso na voljo; prikazan je shranjeni rezultat.';
const isNumber = value => Number.isFinite(value) && Number.isInteger(value);
const isSeat = value => value === 0 || value === 1;
const signed = value => value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '0';
const term = value => value < 0 ? `(−${Math.abs(value)})` : String(value === 0 ? 0 : value);

function baseLine(row, seat, points) {
  const contract = row.contract;
  if (contract?.kind === 'announced' && isSeat(contract.player)) {
    if (seat !== contract.player) {
      return points === 0 ? { label: 'Igra: rezultat piše samo napovedovalec.', calculation: '0' } : null;
    }
    const cards = row.points?.[seat];
    if (!isNumber(cards) || cards < 0 || cards > 70) return null;
    const success = cards >= 36;
    const factor = success ? 2 : 3;
    if ((cards - 35) * factor !== points ||
        (typeof row.contractWon === 'boolean' && row.contractWon !== success)) return null;
    return {
      label: `Napovedana igra: ${success ? 'uspešna' : 'neuspešna'} napoved.`,
      calculation: `(${cards} − 35) × ${factor} = ${signed(points)}`,
    };
  }
  if (contract?.kind !== 'normal' || !Array.isArray(row.points) || row.points.length !== 2 ||
      !row.points.every(value => isNumber(value) && value >= 0 && value <= 70)) return null;
  const winner = row.points[0] === row.points[1] ? null : row.points[0] > row.points[1] ? 0 : 1;
  if (winner !== seat) {
    return points === 0 ? {
      label: winner === null ? 'Navadna igra: izenačeno.' : 'Navadna igra: rezultat piše samo zmagovalec.',
      calculation: '0',
    } : null;
  }
  if (row.points[seat] - 35 !== points) return null;
  return { label: 'Navadna igra.', calculation: `${row.points[seat]} − 35 = ${signed(points)}` };
}

function bonusLine(entry) {
  if (entry.kind === 'mondfang') {
    if (entry.points !== -21 || (entry.trickNumber !== undefined &&
        (!isNumber(entry.trickNumber) || entry.trickNumber < 1 || entry.trickNumber > 27))) return null;
    return {
      label: `Mondfang: škis je pobral tvojega monda${entry.trickNumber === undefined ? '' : ` v ${entry.trickNumber}. štihu`}.`,
      calculation: '−21',
    };
  }
  if (!['kings', 'trula', 'valat'].includes(entry.kind) ||
      typeof entry.announced !== 'boolean' || typeof entry.success !== 'boolean') return null;
  if (!entry.announced && !entry.success) return null;
  const expected = entry.kind === 'valat'
    ? entry.announced ? (entry.success ? 500 : -500) : 250
    : entry.announced ? (entry.success ? 20 : -20) : 10;
  if (entry.points !== expected) return null;
  const names = { kings: 'Kralji', trula: 'Trula', valat: 'Valat' };
  return {
    label: `${names[entry.kind]}: ${entry.announced ? 'napovedano' : 'tiho'}, ${entry.success ? 'uspeh' : 'neuspeh'}.`,
    calculation: signed(entry.points),
  };
}

/** Explain the immutable saved score row; no current game state or engine is needed. */
export function explainScoreRow(row, players) {
  const saved = row && typeof row === 'object' ? row : {};
  const names = [0, 1].map(seat => {
    const player = players?.[seat];
    return typeof player === 'string' ? player : typeof player?.name === 'string' ? player.name : `Igralec ${seat + 1}`;
  });
  const bidderSeat = saved.contract?.kind === 'announced' && isSeat(saved.contract.player)
    ? saved.contract.player : null;
  const legacy = saved.scoringVersion !== 2;
  const notes = legacy ? ['Prejšnja pravila; shranjeni rezultat ostaja nespremenjen.'] : [];
  const breakdown = Array.isArray(saved.breakdown) ? saved.breakdown : null;
  const validEntries = breakdown && breakdown.every(entry => entry && isSeat(entry.player) && isNumber(entry.points));
  const valats = validEntries ? breakdown.filter(entry => entry.kind === 'valat') : [];
  const hasValat = !legacy && valats.length > 0;
  const invalidValatMix = hasValat && (
    breakdown.some(entry => ['game', 'kings', 'trula'].includes(entry.kind)) ||
    (valats.some(entry => entry.announced) && valats.some(entry => !entry.announced)) ||
    valats.filter(entry => entry.success).length > 1
  );
  if (hasValat && !invalidValatMix && valats.every(bonusLine)) {
    notes.push('Valat nadomesti igro, kralje in trulo; mondfang se obračuna posebej.');
  }
  if (!hasValat && bidderSeat !== null && saved.points?.[bidderSeat] === 35) {
    notes.push('Napoved pri 35 točkah ni uspešna: potrebnih je vsaj 36 točk, razlika pri 35 pa je 0.');
  } else if (!hasValat && saved.contract?.kind === 'normal' &&
      saved.points?.[0] === 35 && saved.points?.[1] === 35) {
    notes.push('Pri 35 : 35 je navadna igra izenačena in za igro oba prejmeta 0.');
  }
  const explained = [0, 1].map(seat => {
    const delta = saved.deltas?.[seat];
    const fallback = () => ({
      name: names[seat], lines: [{ label: UNAVAILABLE }], total: isNumber(delta) ? signed(delta) : 'Ni podatka',
    });
    if (!isNumber(delta)) return fallback();
    if (legacy) {
      const line = baseLine(saved, seat, delta);
      return line ? { name: names[seat], lines: [line], total: signed(delta) } : fallback();
    }
    if (!validEntries || invalidValatMix || (hasValat && !valats.every(bonusLine))) return fallback();
    const entries = breakdown.filter(entry => entry.player === seat);
    if (entries.reduce((sum, entry) => sum + entry.points, 0) !== delta) return fallback();
    const kinds = entries.filter(entry => entry.kind !== 'mondfang').map(entry => entry.kind);
    if (new Set(kinds).size !== kinds.length || (!hasValat && entries.filter(entry => entry.kind === 'game').length !== 1)) return fallback();
    const lines = entries.map(entry => entry.kind === 'game' ? baseLine(saved, seat, entry.points) : bonusLine(entry));
    if (lines.some(line => !line)) return fallback();
    if (!lines.length) lines.push({ label: 'Valat nadomesti osnovno igro; za tega igralca ni dodatnih postavk.', calculation: '0' });
    return {
      name: names[seat],
      lines,
      total: entries.length > 1
        ? `${entries.map(entry => term(entry.points)).join(' + ')} = ${signed(delta)}`
        : signed(delta),
    };
  });
  return { bidder: bidderSeat === null ? null : names[bidderSeat], notes, players: explained };
}
