#!/usr/bin/env python3
"""Fetch free market data for Finance Hub (Python 3 standard library only, no API keys).

  python3 tools/market_data.py prices     -> data/prices.json   (daily: last close + ~1 year of daily closes)
  python3 tools/market_data.py holdings   -> data/holdings.json (monthly: what each fund holds)

Runs on GitHub Actions (see .github/workflows/market-data.yml). It only ever fetches the fixed, broad
list in tools/universe.json, so nothing here says what anyone actually owns. Any source can fail: the
script keeps the previous data for whatever it could not refresh and never writes an empty file.

Sources (all public and keyless; checked Nov 2026):
  prices   api.nasdaq.com historical quotes (stocks, ETFs, mutual funds); Yahoo chart API as a fallback
  holdings Vanguard's fund-holdings API (Vanguard ETFs and mutual funds),
           Nasdaq-100 list with market caps (QQQ/QQQM, weights approximated from market cap),
           stockanalysis.com holdings page (top 25 for other ETFs; the rest shows as "Other")
"""
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'
TOP_N = 300  # holdings kept per fund


def get(url, accept='application/json, text/plain, */*', tries=2):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': accept, 'Accept-Language': 'en-US,en;q=0.9'})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode('utf-8', 'replace')
        except Exception as e:  # noqa: BLE001 - any failure just means "no data from this source"
            err = e
            time.sleep(1.5 * (i + 1))
    raise err


def load(name):
    try:
        with open(os.path.join(DATA, name)) as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return None


def save(name, obj):
    os.makedirs(DATA, exist_ok=True)
    tmp = os.path.join(DATA, name + '.tmp')
    with open(tmp, 'w') as f:
        json.dump(obj, f, separators=(',', ':'))
    os.replace(tmp, os.path.join(DATA, name))


def num(s):
    try:
        return float(str(s).replace('$', '').replace(',', '').strip())
    except ValueError:
        return None


def norm(t):
    """One spelling per ticker: 'BRK B', 'BRK/B', 'BRK-B' -> 'BRK.B'."""
    return re.sub(r'[\s/\-]+', '.', (t or '').strip().upper())


# ---------------- prices ----------------
def nasdaq_history(ticker, cls, start, end):
    q = urllib.parse.urlencode({'assetclass': cls, 'fromdate': start, 'todate': end, 'limit': 400})
    d = json.loads(get(f'https://api.nasdaq.com/api/quote/{urllib.parse.quote(ticker.replace(".", "/"), safe="")}/historical?{q}'))
    rows = (((d or {}).get('data') or {}).get('tradesTable') or {}).get('rows') or []
    out = []
    for r in rows:
        m, dd, y = r['date'].split('/')
        c = num(r.get('close'))
        if c:
            out.append((f'{y}-{m}-{dd}', c))
    return sorted(out)


def yahoo_history(ticker):
    d = json.loads(get(f'https://query1.finance.yahoo.com/v8/finance/chart/{ticker.replace(".", "-")}?range=1y&interval=1d'))
    res = d['chart']['result'][0]
    closes = res['indicators']['quote'][0]['close']
    return sorted((dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime('%Y-%m-%d'), round(c, 4)) for t, c in zip(res['timestamp'], closes) if c)


def prices(universe):
    end = dt.date.today()
    start = end - dt.timedelta(days=372)
    old = load('prices.json') or {}
    old_t = old.get('tickers', {})
    old_dates = old.get('dates', [])
    want = [(t, 'stocks') for t in universe['stocks']] + [(t, 'etf') for t in universe['etfs']] + [(t, 'mutualfunds') for t in universe['mutualfunds']]
    series, failed = {}, []
    for t, cls in want:
        hist = []
        for src in ('nasdaq', 'nasdaq2', 'yahoo'):
            try:
                if src == 'nasdaq':
                    hist = nasdaq_history(t, cls, start.isoformat(), end.isoformat())
                elif src == 'nasdaq2':  # wrong asset class guess (e.g. an ETF listed as a stock)
                    for other in ('etf', 'stocks', 'mutualfunds'):
                        if other != cls and not hist:
                            hist = nasdaq_history(t, other, start.isoformat(), end.isoformat())
                else:
                    hist = yahoo_history(t)
            except Exception:  # noqa: BLE001
                hist = []
            if len(hist) >= 2:
                break
            time.sleep(0.3)
        if len(hist) >= 2:
            series[t] = dict(hist)
        else:
            failed.append(t)
        time.sleep(0.35)
    # Rebuild old series for tickers that failed this time so a bad day never wipes data.
    for t in failed:
        if t in old_t and old_dates:
            series[t] = {d: c for d, c in zip(old_dates, old_t[t].get('closes', [])) if c is not None}
    if not series:
        print('No prices fetched; keeping the previous file.')
        return
    dates = sorted({d for s in series.values() for d in s})
    cutoff = (end - dt.timedelta(days=372)).isoformat()
    dates = [d for d in dates if d >= cutoff]
    out = {'asOf': dates[-1], 'updated': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%MZ'), 'dates': dates, 'tickers': {}}
    for t, s in sorted(series.items()):
        ds = sorted(d for d in s if d >= cutoff)
        if len(ds) < 2:
            continue
        out['tickers'][t] = {'last': s[ds[-1]], 'prior': s[ds[-2]], 'date': ds[-1], 'closes': [s.get(d) for d in dates]}
    save('prices.json', out)
    print(f'prices: {len(out["tickers"])} tickers, {len(dates)} days; failed: {" ".join(failed) or "none"}')


# ---------------- holdings ----------------
def vanguard(fund):
    d = json.loads(get(f'https://investor.vanguard.com/vmf/api/{fund}/portfolio-holding/stock?start=1&count=500'))
    ents = (d.get('fund') or {}).get('entity') or []
    rows = [{'ticker': norm(e.get('ticker')), 'name': e.get('longName') or e.get('shortName') or '', 'weight': (num(e.get('percentWeight')) or 0) / 100} for e in ents]
    return (d.get('asOfDate') or '')[:10], rows


def nasdaq100():
    d = json.loads(get('https://api.nasdaq.com/api/quote/list-type/nasdaq100'))
    rows = d['data']['data']['rows']
    caps = [(norm(r['symbol']), re.sub(r'\s+(Common Stock|Class [A-C].*|Ordinary Shares.*|American Depositary Shares.*)$', '', r['companyName']), num(r.get('marketCap')) or 0) for r in rows]
    total = sum(c for _, _, c in caps) or 1
    asof = dt.datetime.strptime(d['data']['date'], '%b %d, %Y').date().isoformat() if d['data'].get('date') else dt.date.today().isoformat()
    return asof, [{'ticker': t, 'name': n, 'weight': c / total} for t, n, c in caps], 'Approximated from Nasdaq-100 market caps'


def stockanalysis(fund):
    html = get(f'https://stockanalysis.com/etf/{fund.lower()}/holdings/', accept='text/html')
    rows = []
    for m in re.finditer(r'\{no:\d+,s:"([^"]*)",n:"((?:[^"\\]|\\.)*)",holdingWeight:([0-9.]+)', html):
        rows.append({'ticker': norm(m.group(1).lstrip('$').split('/')[-1]) if m.group(1) else '', 'name': m.group(2).replace('\\"', '"'), 'weight': float(m.group(3)) / 100})
    m = re.search(r'[Aa]s of ([A-Z][a-z]{2} \d{1,2}, \d{4})', html)
    asof = dt.datetime.strptime(m.group(1), '%b %d, %Y').date().isoformat() if m else dt.date.today().isoformat()
    return asof, rows, 'Top holdings only'


def holdings(universe):
    spec = universe['holdings']
    old = (load('holdings.json') or {}).get('funds', {})
    out, failed = {}, []
    jobs = [(f, 'vanguard') for f in spec['vanguard']] + [(f, 'nasdaq100') for f in spec['nasdaq100']] + [(f, 'stockanalysis') for f in spec['stockanalysis']]
    n100 = None
    for fund, src in jobs:
        try:
            note = ''
            if src == 'vanguard':
                asof, rows = vanguard(fund)
            elif src == 'nasdaq100':
                n100 = n100 or nasdaq100()
                asof, rows, note = n100
            else:
                asof, rows, note = stockanalysis(fund)
            rows = sorted((r for r in rows if r['weight'] > 0), key=lambda r: -r['weight'])[:TOP_N]
            if not rows:
                raise ValueError('empty')
            for r in rows:
                r['weight'] = round(r['weight'], 6)
            out[fund] = {'asOf': asof, 'source': src, 'note': note, 'holdings': rows}
        except Exception as e:  # noqa: BLE001
            failed.append(f'{fund}({type(e).__name__})')
            if fund in old:
                out[fund] = old[fund]
        time.sleep(0.6)
    if not out:
        print('No holdings fetched; keeping the previous file.')
        return
    save('holdings.json', {'updated': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%MZ'), 'alias': spec.get('alias', {}), 'funds': out})
    print(f'holdings: {len(out)} funds; failed: {" ".join(failed) or "none"}')


if __name__ == '__main__':
    with open(os.path.join(ROOT, 'tools', 'universe.json')) as f:
        uni = json.load(f)
    what = sys.argv[1:] or ['prices', 'holdings']
    if 'prices' in what:
        prices(uni)
    if 'holdings' in what:
        holdings(uni)
