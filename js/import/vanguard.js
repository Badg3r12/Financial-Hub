// Vanguard "spreadsheet-compatible CSV": several sections, each with its own header row, separated by blank lines.
// Account/plan number columns are dropped as each row is read, so they never reach the app.
import { parseCSV, parseDate, SENSITIVE_HEADER } from '../util.js';

const SETTLEMENT = /VMFXX|CASH PLUS|SETTLEMENT|^CASH$/i;

export function parseVanguard(text) {
  const rows = parseCSV(text);
  const out = { holdings: [], txns: [], planHoldings: [], planTxns: [] };
  let header = null, kind = null, block = null;
  for (const raw of rows) {
    const cells = raw.map((c) => c.trim());
    if (cells.every((c) => !c)) { block = null; continue; }
    const joined = cells.join(',');
    if (/Trade Date/i.test(joined) && /Run Date/i.test(joined)) { header = cells; kind = 'planTxns'; continue; }
    if (/Trade Date/i.test(joined)) { header = cells; kind = 'txns'; continue; }
    if (/Plan Name/i.test(joined) && /Fund Name/i.test(joined)) { header = cells; kind = 'planHoldings'; block = null; continue; }
    if (/Investment Name|Fund Name/i.test(joined) && /Total Value/i.test(joined)) { header = cells; kind = 'holdings'; block = null; continue; }
    if (!header) continue;
    const o = {};
    header.forEach((hd, i) => { if (hd && !SENSITIVE_HEADER.test(hd)) o[hd] = cells[i]; });
    if (kind === 'holdings') {
      if (!block) { block = []; out.holdings.push(block); }
      block.push({ symbol: (o.Symbol && o.Symbol !== 'null') ? o.Symbol.toUpperCase() : '', name: o['Investment Name'] || o['Fund Name'], shares: +o.Shares || 0, price: +o['Share Price'] || +o.Price || 0, value: +o['Total Value'] || 0 });
    } else if (kind === 'planHoldings') {
      out.planHoldings.push({ name: o['Fund Name'], plan: o['Plan Name'], shares: +o.Shares || 0, price: +o.Price || 0, value: +o['Total Value'] || 0 });
    } else if (kind === 'planTxns') {
      out.planTxns.push({ date: parseDate(o['Trade Date']), desc: o['Transaction Description'], name: o['Investment Name'], price: +o['Share Price'] || 0, shares: +o['Transaction Shares'] || 0, amount: +o['Dollar Amount'] || 0 });
    } else {
      out.txns.push({ date: parseDate(o['Trade Date']), type: o['Transaction Type'] || '', desc: o['Transaction Description'] || '', name: o['Investment Name'] || '',
        symbol: (o.Symbol || '').toUpperCase(), shares: +o.Shares || 0, price: +o['Share Price'] || 0, net: +o['Net Amount'] || 0 });
    }
  }
  return out;
}

// Turn transaction rows into lots: Buy, Sell, and dividend Reinvestment (not settlement-fund sweeps).
export function vanguardLots(parsed) {
  const lots = [];
  for (const t of parsed.txns) {
    if (!t.symbol || SETTLEMENT.test(t.symbol) || SETTLEMENT.test(t.name)) continue;
    const type = t.type.toLowerCase();
    if (type === 'buy' || type === 'reinvestment' || type === 'sell') {
      const price = t.price || (t.shares ? Math.abs(t.net / t.shares) : 0);
      lots.push({ date: t.date, ticker: t.symbol, name: t.name, shares: type === 'sell' ? -Math.abs(t.shares) : Math.abs(t.shares), price, kind: type === 'reinvestment' ? 'reinvest' : type });
    }
  }
  for (const t of parsed.planTxns) {
    if (!t.shares || !t.name) continue;
    lots.push({ date: t.date, ticker: planTicker(t.name), name: t.name, shares: t.shares, price: t.price || Math.abs(t.amount / t.shares), kind: t.shares < 0 ? 'sell' : 'buy', plan: true, desc: t.desc });
  }
  return lots;
}
// 401k funds often have no ticker; use a stable short id from the fund name.
export const planTicker = (name) => 'PLAN-' + String(name).toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 4).map((w) => w.slice(0, 3)).join('');
export const isSettlement = (sym, name) => SETTLEMENT.test(sym || '') || SETTLEMENT.test(name || '');
