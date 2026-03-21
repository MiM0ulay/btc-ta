"""
btc_macro_fetch.py
Auto-fetches macro data without API keys:
  - DXY + change          → Yahoo Finance public
  - US 10Y yield + change → Yahoo Finance public
  - IBIT / FBTC ETF flows → farside.co.uk (scrape) + SoSoValue fallback
  - Options max pain      → Deribit public endpoint

What still needs Claude search:
  - Fed speaker headlines
  - Breaking macro / geopolitical news
  - Economic calendar
  (use CLAUDE_MACRO_PROMPT constant at bottom of this file)
"""

import requests
from bs4 import BeautifulSoup
from datetime import datetime, timezone, date
from collections import defaultdict

HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/123.0.0.0 Safari/537.36'
    ),
    'Accept-Language': 'en-US,en;q=0.9',
}

FARSIDE_URL = 'https://farside.co.uk/bitcoin-etf-flow/'


# ─────────────────────────────────────────────────────────────────────────────
#  YAHOO FINANCE — DXY + US10Y
# ─────────────────────────────────────────────────────────────────────────────

def _yahoo(ticker: str) -> dict:
    url = f'https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=5d'
    try:
        r    = requests.get(url, headers=HEADERS, timeout=12)
        r.raise_for_status()
        meta = r.json()['chart']['result'][0]['meta']
        price = meta.get('regularMarketPrice') or meta.get('chartPreviousClose')
        prev  = meta.get('previousClose') or meta.get('chartPreviousClose')
        chg   = price - prev if price and prev else None
        chg_p = chg / prev * 100 if chg and prev else None
        return {
            'price':      round(price, 4) if price else None,
            'prev_close': round(prev, 4)  if prev  else None,
            'change':     round(chg, 4)   if chg   else None,
            'change_pct': round(chg_p, 3) if chg_p else None,
            'source': 'Yahoo Finance',
        }
    except Exception as e:
        return {'error': str(e), 'source': 'Yahoo Finance'}


def fetch_dxy()   -> dict: return _yahoo('DX-Y.NYB')
def fetch_us10y() -> dict: return _yahoo('%5ETNX')


# ─────────────────────────────────────────────────────────────────────────────
#  FARSIDE.CO.UK — ETF FLOWS
# ─────────────────────────────────────────────────────────────────────────────

def fetch_etf_flows_farside() -> dict:
    try:
        r    = requests.get(FARSIDE_URL, headers=HEADERS, timeout=15)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, 'lxml')
        table = soup.find('table')
        if not table:
            return {'error': 'Table not found'}

        headers_row = table.find('tr')
        cols = [th.get_text(strip=True) for th in headers_row.find_all(['th','td'])]

        ibit_idx  = next((i for i,c in enumerate(cols) if 'IBIT'  in c.upper()), None)
        fbtc_idx  = next((i for i,c in enumerate(cols) if 'FBTC'  in c.upper()), None)
        total_idx = next((i for i,c in enumerate(cols) if 'TOTAL' in c.upper()), None)
        date_idx  = 0

        rows = table.find_all('tr')[1:]
        data_rows = []
        for row in rows:
            cells = [td.get_text(strip=True) for td in row.find_all(['td','th'])]
            if cells and len(cells) > 2:
                data_rows.append(cells)

        def parse_flow(val):
            val = str(val).replace(',','').replace('$','').strip()
            if val in ('','-','—','N/A'): return None
            try: return float(val)
            except: return None

        def row_flow(row, idx):
            return parse_flow(row[idx]) if idx is not None and idx < len(row) else None

        valid = [r for r in data_rows if r[date_idx] and r[date_idx] not in ('Total','')]
        recent = valid[-5:] if len(valid) >= 5 else valid

        sessions = [{'date': r[date_idx], 'ibit': row_flow(r,ibit_idx),
                     'fbtc': row_flow(r,fbtc_idx), 'total': row_flow(r,total_idx)}
                    for r in recent]

        def streak(sess, key):
            count = 0
            for s in reversed(sess):
                if s.get(key) is not None and s[key] > 0: count += 1
                else: break
            return count

        return {
            'source':       f'farside.co.uk — {FARSIDE_URL}',
            'last_session': sessions[-1] if sessions else {},
            'prev_session': sessions[-2] if len(sessions)>=2 else {},
            'sessions_5d':  sessions,
            'ibit_5d_sum':  round(sum(s['ibit']  for s in sessions if s.get('ibit')  is not None), 1),
            'fbtc_5d_sum':  round(sum(s['fbtc']  for s in sessions if s.get('fbtc')  is not None), 1),
            'total_5d_sum': round(sum(s['total'] for s in sessions if s.get('total') is not None), 1),
            'consecutive_positive': streak(sessions, 'total'),
        }
    except Exception as e:
        return {'error': str(e), 'source': 'farside.co.uk'}


def fetch_etf_flows_sosovalue() -> dict:
    try:
        r = requests.get('https://sosovalue.com/api/etf/btc-etf-flow', headers=HEADERS, timeout=12)
        r.raise_for_status()
        d = r.json()
        if isinstance(d, list) and d:
            l = d[-1]
            return {'source':'SoSoValue','date':l.get('date'),
                    'total':l.get('totalNetFlow'),'ibit':l.get('IBIT'),'fbtc':l.get('FBTC')}
        return {'source':'SoSoValue','raw': str(d)[:200]}
    except Exception as e:
        return {'error': str(e), 'source': 'SoSoValue'}


# ─────────────────────────────────────────────────────────────────────────────
#  DERIBIT PUBLIC — OPTIONS MAX PAIN
# ─────────────────────────────────────────────────────────────────────────────

def fetch_options_data() -> dict:
    try:
        r = requests.get('https://www.deribit.com/api/v2/public/get_instruments',
                         params={'currency':'BTC','kind':'option','expired':False},
                         headers=HEADERS, timeout=12)
        instruments = r.json().get('result', [])
        today = date.today()
        upcoming = [i for i in instruments
                    if 0 <= (datetime.fromtimestamp(i.get('expiration_timestamp',0)/1000,
                              tz=timezone.utc).date() - today).days <= 7]

        oi_by_strike = defaultdict(lambda: {'call_oi':0,'put_oi':0})
        for inst in upcoming[:60]:
            try:
                tr = requests.get('https://www.deribit.com/api/v2/public/get_order_book',
                                  params={'instrument_name':inst['instrument_name'],'depth':1},
                                  headers=HEADERS, timeout=6).json().get('result',{})
                oi = tr.get('open_interest',0)
                s  = inst.get('strike')
                if inst.get('option_type')=='call': oi_by_strike[s]['call_oi'] += oi
                else: oi_by_strike[s]['put_oi'] += oi
            except: pass

        max_pain = (max(oi_by_strike.keys(),
                        key=lambda s: oi_by_strike[s]['call_oi']+oi_by_strike[s]['put_oi'])
                    if oi_by_strike else None)
        total_c = sum(v['call_oi'] for v in oi_by_strike.values())
        total_p = sum(v['put_oi']  for v in oi_by_strike.values())
        pc = round(total_p/total_c,3) if total_c>0 else None

        expiries = sorted(set(
            datetime.fromtimestamp(i.get('expiration_timestamp',0)/1000,
                                   tz=timezone.utc).date().isoformat()
            for i in upcoming))

        return {
            'source':         'Deribit public API',
            'nearest_expiry': expiries[0] if expiries else None,
            'expiries':       expiries,
            'max_pain_est':   max_pain,
            'put_call_ratio': pc,
            'pc_note':       ('Bullish skew' if pc and pc<0.8 else
                              'Bearish skew' if pc and pc>1.2 else 'Neutral'),
        }
    except Exception as e:
        return {'error': str(e), 'source': 'Deribit public'}


# ─────────────────────────────────────────────────────────────────────────────
#  ORCHESTRATOR + FORMATTER
# ─────────────────────────────────────────────────────────────────────────────

def fetch_all_macro() -> dict:
    print("🔄  DXY …"); dxy   = fetch_dxy()
    print("🔄  US10Y …"); us10y = fetch_us10y()
    print("🔄  ETF flows (farside.co.uk) …"); etf = fetch_etf_flows_farside()
    if etf.get('error'):
        print(f"  ⚠️  farside: {etf['error']} → trying SoSoValue …")
        etf2 = fetch_etf_flows_sosovalue()
        if not etf2.get('error'): etf = etf2
    print("🔄  Options (Deribit) …"); opts = fetch_options_data()
    return {'dxy':dxy,'us10y':us10y,'etf':etf,'options':opts}


def format_macro_block(data: dict) -> str:
    now = datetime.now(timezone.utc)
    L_=[]; A=L_.append
    A("━━━ AUTO-FETCHED MACRO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    A(f"  {now.strftime('%Y-%m-%d %H:%M UTC')}  |  Yahoo Finance · farside.co.uk · Deribit public")
    A("")

    dxy = data.get('dxy',{})
    if not dxy.get('error'):
        chg=dxy.get('change',0) or 0; pct=dxy.get('change_pct',0) or 0
        d_='↑' if chg>0 else '↓' if chg<0 else '→'
        flag='🔴 Headwind for BTC' if chg>0.3 else '🟢 Tailwind for BTC' if chg<-0.3 else '⚪ Neutral'
        A(f"  DXY     : {dxy.get('price')}  {d_} {chg:+.3f} ({pct:+.2f}%)  [{flag}]")
    else: A(f"  DXY     : ⚠️  {dxy.get('error')}")

    y=data.get('us10y',{})
    if not y.get('error'):
        chg=y.get('change',0) or 0; pct=y.get('change_pct',0) or 0
        d_='↑' if chg>0 else '↓' if chg<0 else '→'
        flag='🔴 Risk-off pressure' if chg>0.05 else '🟢 Easing' if chg<-0.05 else '⚪ Stable'
        A(f"  US 10Y  : {y.get('price')}%  {d_} {chg:+.4f} ({pct:+.2f}%)  [{flag}]")
    else: A(f"  US 10Y  : ⚠️  {y.get('error')}")

    A("")
    etf=data.get('etf',{})
    if not etf.get('error'):
        ls=etf.get('last_session',{}); ps=etf.get('prev_session',{})
        def ff(v): return f"${v:+.1f}M" if v is not None else "N/A"
        A(f"  ETF flows — {etf.get('source')}")
        A(f"  Last ({ls.get('date','?')}):  IBIT {ff(ls.get('ibit'))}  FBTC {ff(ls.get('fbtc'))}  TOTAL {ff(ls.get('total'))}")
        if ps: A(f"  Prev ({ps.get('date','?')}):  IBIT {ff(ps.get('ibit'))}  FBTC {ff(ps.get('fbtc'))}  TOTAL {ff(ps.get('total'))}")
        A(f"  5-day:  IBIT {ff(etf.get('ibit_5d_sum'))}  FBTC {ff(etf.get('fbtc_5d_sum'))}  TOTAL {ff(etf.get('total_5d_sum'))}")
        pos=etf.get('consecutive_positive',0)
        A(f"  Streak: {'🟢' if pos>=3 else '🟡' if pos>0 else '🔴'} {pos} consecutive positive sessions")
    else: A(f"  ETF flows: ⚠️  {etf.get('error')}")

    A("")
    opts=data.get('options',{})
    if not opts.get('error'):
        mp=opts.get('max_pain_est')
        A(f"  Options (Deribit):  Nearest expiry: {opts.get('nearest_expiry','N/A')}")
        A(f"    Max Pain (est): ${mp:,}" if mp else "    Max Pain (est): N/A")
        A(f"    Put/Call ratio: {opts.get('put_call_ratio','N/A')}  [{opts.get('pc_note','')}]")
    else: A(f"  Options: ⚠️  {opts.get('error')}")

    A("")
    A("━━━ STILL NEEDS CLAUDE SEARCH (use CLAUDE_MACRO_PROMPT below) ━━━━━━━")
    A("  • Fed speaker headlines (last 24H)")
    A("  • Breaking macro / geopolitical news")
    A("  • Economic calendar next 24H")
    A("  • BTC narrative / sentiment")
    return '\n'.join(L_)


# ─────────────────────────────────────────────────────────────────────────────
#  CLAUDE SEARCH PROMPT  (paste into Claude after running the script)
# ─────────────────────────────────────────────────────────────────────────────

CLAUDE_MACRO_PROMPT = """
You are a macro research assistant. Use web search for each item below.
Be specific. Source every claim. Return ONLY the block — no preamble, no questions.

Search 1: "Fed speaker today {date}" OR "FOMC member speech today"
Search 2: "macro economic data release today {date}"
Search 3: "Iran war oil markets {date}" OR "geopolitical risk crypto {date}"
Search 4: "Bitcoin news today {date}"
Search 5: "economic calendar this week high impact"

━━━ MACRO SEARCH RESULTS — {date} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Fed speakers    : [Name] @ [Venue] — [Hawkish/Dovish/Neutral]
                    Quote: "[<15 words]"  Source: [pub] | [time UTC]

  Macro data      : [Event]: Actual [X] vs Forecast [Y] → [Bullish/Bearish]
                    Source: [pub] | [time UTC]

  Geopolitical    : [1-sentence] → BTC: [Bullish/Bearish/Neutral]
                    Source: [pub] | [time UTC]

  BTC narrative   : [dominant narrative last 6H — 1 sentence]
                    Source: [pub] | [time UTC]

  Next 🔴 event   : [Name] | [Date] [Time UTC/CET] | Forecast: [X]
                    Source: investing.com/economic-calendar
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
""".strip()


# ─────────────────────────────────────────────────────────────────────────────
#  MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    print("\n" + "═"*60)
    print("  BTC MACRO FETCHER")
    print("  Yahoo Finance · farside.co.uk · Deribit public")
    print("═"*60 + "\n")

    data  = fetch_all_macro()
    block = format_macro_block(data)
    print("\n" + block)

    today = datetime.now(timezone.utc).strftime('%B %d, %Y')
    prompt = CLAUDE_MACRO_PROMPT.replace('{date}', today)

    print("\n" + "═"*60)
    print("  PASTE THIS INTO CLAUDE FOR MACRO SEARCH")
    print("═"*60)
    print(prompt)

    ts = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M')
    with open(f"macro_{ts}.txt", 'w') as f:
        f.write(block + "\n\n" + "="*60 + "\n" + prompt)
    print(f"\n💾  Saved → macro_{ts}.txt")


if __name__ == '__main__':
    main()