// Free market data that the repo's GitHub Action publishes next to the app:
//   data/prices.json   { asOf, dates:[...], tickers:{ T:{ last, prior, date, closes:[...one per date, null if missing] } } }
//   data/holdings.json { alias:{ T: T2 }, funds:{ T:{ asOf, source, note, holdings:[{ticker,name,weight}] } } }
// Same-origin fetch, so the service worker serves the last copy when offline.
import * as S from './store.js';

let prices = null, holdings = null, loading = null;
export const loaded = () => !!(prices || holdings);
export const pricesData = () => prices;
export const holdingsData = () => holdings;

async function json(url) {
  try { const r = await fetch(url, { cache: 'no-cache' }); return r.ok ? await r.json() : null; } catch { return null; }
}

// Copy newer closing prices into the stored securities (only for tickers already in the app).
async function applyPrices() {
  const t = prices?.tickers; if (!t) return 0;
  const fresh = S.all('securities').filter((s) => { const p = t[s.id]; return p && p.last != null && (!s.priceDate || s.last == null || p.date > s.priceDate || (p.date === s.priceDate && (p.last !== s.last || (p.prior != null && p.prior !== s.prior)))); })
    .map((s) => { const p = t[s.id]; return { ...s, last: p.last, prior: p.prior ?? s.prior, priceDate: p.date, priceSource: 'auto' }; });
  if (fresh.length) await S.putMany('securities', fresh);
  return fresh.length;
}

export function load(retry) {
  if (retry && !loaded()) loading = null;
  return (loading ||= Promise.all([json('data/prices.json'), json('data/holdings.json')]).then(async ([p, hd]) => {
    prices = p?.tickers ? p : null; holdings = hd?.funds ? hd : null;
    const n = await applyPrices();
    // Screens drawn before the data arrived: redraw once (a price write already triggers a redraw).
    if (!n && loaded() && location.hash.startsWith('#invest')) window.dispatchEvent(new HashChangeEvent('hashchange'));
  }));
}

// Daily closes for one ticker: [{date, close}] oldest first.
export function history(ticker) {
  const p = prices?.tickers?.[ticker]; if (!p) return [];
  return prices.dates.map((date, i) => ({ date, close: p.closes[i] })).filter((x) => x.close != null);
}

// Fund portfolio for a ticker, following aliases (e.g. a mutual fund that shares an ETF's portfolio).
export function fund(ticker) {
  if (!holdings) return null;
  const f = holdings.funds[ticker]; if (f) return { ...f, via: null };
  const a = holdings.alias?.[ticker]; return a && holdings.funds[a] ? { ...holdings.funds[a], via: a } : null;
}
