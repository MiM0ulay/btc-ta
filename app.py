"""
BTC/USD Expert TA Engine — Streamlit Web App v2
Deploy: push app.py + requirements.txt to GitHub → share.streamlit.io
No API keys required.
"""
import streamlit as st, ccxt, pandas as pd, pandas_ta as ta, requests
from datetime import datetime, timezone
import warnings; warnings.filterwarnings('ignore')

st.set_page_config(page_title="₿ BTC Expert TA", page_icon="₿", layout="wide")
st.markdown("""<style>
  .stApp{background:#0d1117;color:#e6edf3;}
  h1{font-size:1.3rem!important;}
</style>""", unsafe_allow_html=True)

SYMBOL='BTC/USDT'; TIMEFRAMES=['15m','1h','4h','1d','1w']
CANDLES=300; FIB_DAYS=90; PROX_PCT=0.015

@st.cache_data(ttl=300)
def fetch_ohlcv():
    exc=ccxt.binance({'enableRateLimit':True}); data={}
    for tf in TIMEFRAMES:
        try:
            raw=exc.fetch_ohlcv(SYMBOL,tf,limit=CANDLES)
            df=pd.DataFrame(raw,columns=['ts','open','high','low','close','volume'])
            df['ts']=pd.to_datetime(df['ts'],unit='ms',utc=True)
            df.set_index('ts',inplace=True); data[tf]=df.astype(float)
        except Exception as e: st.warning(f"OHLCV {tf}: {e}")
    return data

@st.cache_data(ttl=300)
def fetch_fg():
    try:
        r=requests.get('https://api.alternative.me/fng/?limit=3',timeout=10)
        items=r.json()['data']; v=int(items[0]['value']); cls=items[0]['value_classification']
        chg=v-int(items[2]['value']) if len(items)>2 else None
        return v,cls,chg
    except: return None,'ERROR',None

@st.cache_data(ttl=600)
def fetch_dom():
    try:
        r=requests.get('https://api.coingecko.com/api/v3/global',timeout=10)
        p=r.json()['data']['market_cap_percentage']
        return round(p.get('btc',0),1),round(p.get('eth',0),1)
    except: return None,None

@st.cache_data(ttl=60)
def fetch_der():
    R={}
    try:
        r=requests.get('https://fapi.binance.com/fapi/v1/fundingRate',params={'symbol':'BTCUSDT','limit':3},timeout=10).json()
        if isinstance(r,list) and r:
            R['fr']=float(r[-1]['fundingRate'])*100
            R['fr_ts']=datetime.fromtimestamp(int(r[-1]['fundingTime'])/1000,tz=timezone.utc).strftime('%H:%M UTC')
    except: pass
    try:
        r=requests.get('https://fapi.binance.com/fapi/v1/openInterest',params={'symbol':'BTCUSDT'},timeout=10).json()
        R['oi']=float(r.get('openInterest',0))
    except: pass
    try:
        r=requests.get('https://fapi.binance.com/futures/data/openInterestHist',params={'symbol':'BTCUSDT','period':'4h','limit':6},timeout=10).json()
        if isinstance(r,list) and len(r)>=2:
            R['oi_chg']=(float(r[-1]['sumOpenInterest'])-float(r[0]['sumOpenInterest']))/float(r[0]['sumOpenInterest'])*100
    except: pass
    try:
        r=requests.get('https://fapi.binance.com/futures/data/topLongShortAccountRatio',params={'symbol':'BTCUSDT','period':'4h','limit':1},timeout=10).json()
        if isinstance(r,list) and r:
            R['ls']=float(r[-1]['longShortRatio']); R['ll']=float(r[-1]['longAccount']); R['ls_']=float(r[-1]['shortAccount'])
    except: pass
    return R

def compute_all(df):
    df=df.copy(); c,h,l,v=df['close'],df['high'],df['low'],df['volume']
    for p in [9,21,50,100,200]: df[f'ema{p}']=ta.ema(c,length=p)
    df['rsi14']=ta.rsi(c,length=14)
    s=ta.stochrsi(c,length=14,rsi_length=14,k=3,d=3)
    if s is not None: df['sk']=s.get('STOCHRSIk_14_14_3_3'); df['sd']=s.get('STOCHRSId_14_14_3_3')
    m=ta.macd(c,fast=12,slow=26,signal=9)
    if m is not None: df['mh']=m.get('MACDh_12_26_9'); df['mm']=m.get('MACD_12_26_9'); df['ms']=m.get('MACDs_12_26_9')
    bb=ta.bbands(c,length=20,std=2)
    if bb is not None: df['bbu']=bb.get('BBU_20_2.0'); df['bbl']=bb.get('BBL_20_2.0'); df['bbm']=bb.get('BBM_20_2.0'); df['bbw']=(df['bbu']-df['bbl'])/df['bbm']*100
    df['atr14']=ta.atr(h,l,c,length=14)
    adx=ta.adx(h,l,c,length=14)
    if adx is not None: df['adx']=adx.get('ADX_14'); df['dip']=adx.get('DMP_14'); df['din']=adx.get('DMN_14')
    df['obv']=ta.obv(c,v); df['mfi']=ta.mfi(h,l,c,v,length=14)
    try: df['vwap']=ta.vwap(h,l,c,v)
    except: pass
    st_=ta.supertrend(h,l,c,length=10,multiplier=3.0)
    if st_ is not None: df['std']=st_.get('SUPERTd_10_3.0'); df['stv']=st_.get('SUPERT_10_3.0')
    ps=ta.psar(h,l,c)
    if ps is not None: df['psl']=ps.get('PSARl_0.02_0.2'); df['pss']=ps.get('PSARs_0.02_0.2')
    try:
        ichi=ta.ichimoku(h,l,c)
        if ichi and len(ichi)==2:
            idf=ichi[0]
            for col in ['ISA_9','ISB_26','ITS_9','IKS_26']:
                if col in idf.columns: df[col]=idf[col].values[:len(df)]
    except: pass
    df['rvol']=df['volume']/df['volume'].rolling(20).mean()
    df['cvd']=(((c-l)/(h-l+1e-10))*v*2-v).cumsum()
    return df

def L(df,col):
    s=df[col].dropna() if col in df.columns else pd.Series(dtype=float)
    return float(s.iloc[-1]) if len(s)>0 else None

def FV(v,pre='$',dec=2):
    if v is None or (isinstance(v,float) and pd.isna(v)): return 'N/A'
    return f'${v:,.{dec}f}' if pre=='$' else f'{v:.{dec}f}'

def NR(price,level):
    if not level or (isinstance(level,float) and pd.isna(level)): return ''
    return '  ◀' if abs(price-level)/price<PROX_PCT else ''

def tf_signals(tf,df,price):
    df=compute_all(df); S={}
    # EMA Stack
    vs={p:L(df,f'ema{p}') for p in [9,21,50,200]}
    if all(v is not None for v in vs.values()):
        e9,e21,e50,e200=vs[9],vs[21],vs[50],vs[200]
        if e9>e21>e50>e200 and price>e9: S['EMA Stack']=(1,f'Full Bull')
        elif e200>e50>e21>e9: S['EMA Stack']=(-1,f'Full Bear')
        elif price>e200: S['EMA Stack']=(0,f'Mixed above EMA200(${e200:,.0f})')
        else: S['EMA Stack']=(-1,f'Below EMA200(${e200:,.0f})')
    # RSI
    r=L(df,'rsi14')
    if r:
        if r>70: S['RSI14']=(-1,f'{r:.1f} Overbought')
        elif r>60: S['RSI14']=(1,f'{r:.1f} Bullish')
        elif r<30: S['RSI14']=(1,f'{r:.1f} Oversold')
        elif r<40: S['RSI14']=(-1,f'{r:.1f} Bearish')
        else: S['RSI14']=(0,f'{r:.1f} Neutral')
    # MACD
    mh=L(df,'mh'); mm_=L(df,'mm'); ms_=L(df,'ms')
    if mh is not None and mm_ is not None and ms_ is not None:
        hs=df['mh'].dropna(); mom=''
        if len(hs)>=3:
            rv=list(hs.tail(3)); mom=' ↑' if abs(rv[-1])>abs(rv[-2])>abs(rv[-3]) else ' ↓'
        S['MACD']=(1,f'Bull {mh:+.1f}{mom}') if mh>0 else (-1,f'Bear {mh:+.1f}{mom}')
    # Supertrend
    sd=L(df,'std'); sv=L(df,'stv')
    if sd is not None and sv is not None:
        S['SuperTrend']=(1,f'Bull ${sv:,.0f}') if sd>0 else (-1,f'Bear ${sv:,.0f}')
    # PSAR
    pl_=L(df,'psl'); ps_=L(df,'pss')
    if pl_ is not None and not pd.isna(pl_): S['PSAR']=(1,f'Bull below ${pl_:,.0f}')
    elif ps_ is not None and not pd.isna(ps_): S['PSAR']=(-1,f'Bear above ${ps_:,.0f}')
    # BB
    bbu=L(df,'bbu'); bbl=L(df,'bbl'); bbw=L(df,'bbw')
    if bbu and bbl:
        if price>bbu: S['BB']=(-1,f'Above upper ${bbu:,.0f}')
        elif price<bbl: S['BB']=(1,f'Below lower ${bbl:,.0f}')
        else:
            sq=' [SQUEEZE]' if bbw and bbw<3 else ' [compress]' if bbw and bbw<5 else ''
            S['BB']=(0,f'Inside{sq} w:{bbw:.1f}%' if bbw else 'Inside')
    # ADX
    dip=L(df,'dip'); din=L(df,'din'); adx_=L(df,'adx')
    if dip and din and adx_:
        st_=('Strong' if adx_>25 else 'Weak')
        if adx_>20: S['ADX']=(1,f'ADX:{adx_:.0f} {st_} Bull') if dip>din else (-1,f'ADX:{adx_:.0f} {st_} Bear')
        else: S['ADX']=(0,f'ADX:{adx_:.0f} Ranging')
    # StochRSI
    sk=L(df,'sk'); sd2=L(df,'sd')
    if sk is not None and sd2 is not None:
        if sk<20 and sk>sd2: S['StochRSI']=(1,f'K:{sk:.0f} OvSold+cross')
        elif sk>80 and sk<sd2: S['StochRSI']=(-1,f'K:{sk:.0f} OvBought+cross')
        elif sk>sd2: S['StochRSI']=(0,f'K:{sk:.0f}>{sd2:.0f}')
        else: S['StochRSI']=(0,f'K:{sk:.0f}<{sd2:.0f}')
    # VWAP
    if tf in ['15m','1h','4h']:
        vw=L(df,'vwap')
        if vw: S['VWAP']=(1,f'Above ${vw:,.0f}') if price>vw else (-1,f'Below ${vw:,.0f}')
    # OBV
    if tf in ['1d','1w']:
        ob=df['obv'].dropna(); pr=df['close'].dropna()
        if len(ob)>=28:
            or_=ob.tail(14).mean(); op=ob.tail(28).head(14).mean()
            pr_=pr.tail(14).mean(); pp=pr.tail(28).head(14).mean()
            if or_>op and pr_>pp: S['OBV']=(1,'Rising confirm')
            elif or_<op and pr_<pp: S['OBV']=(-1,'Falling confirm')
            elif or_>op: S['OBV']=(1,'Bull Divergence ⚠️')
            else: S['OBV']=(-1,'Bear Divergence ⚠️')
    # MFI
    if tf in ['1d','1w']:
        mf=L(df,'mfi')
        if mf:
            if mf>80: S['MFI']=(-1,f'{mf:.0f} OvBought')
            elif mf<20: S['MFI']=(1,f'{mf:.0f} OvSold')
            else: S['MFI']=(0,f'{mf:.0f} Neutral')
    # Ichimoku
    if tf in ['1d','1w']:
        sa=L(df,'ISA_9'); sb=L(df,'ISB_26'); ts_=L(df,'ITS_9'); ks=L(df,'IKS_26')
        if sa and sb:
            top=max(sa,sb); bot=min(sa,sb)
            tk=' TK-bull' if (ts_ and ks and ts_>ks) else ' TK-bear' if (ts_ and ks) else ''
            if price>top: S['Ichimoku']=(1,f'Above cloud{tk}')
            elif price<bot: S['Ichimoku']=(-1,f'Below cloud{tk}')
            else: S['Ichimoku']=(0,f'In cloud{tk}')
    # CVD
    cvd=df['cvd'].dropna()
    if len(cvd)>=10:
        if cvd.tail(5).mean()>cvd.tail(10).head(5).mean(): S['CVD']=(1,'Net buying')
        else: S['CVD']=(-1,'Net selling')
    # RVOL
    rv=L(df,'rvol')
    if rv:
        if rv>2.0: S['RVOL']=(0,f'{rv:.2f}x Very High')
        elif rv>1.3: S['RVOL']=(1,f'{rv:.2f}x Above avg')
        elif rv<0.6: S['RVOL']=(-1,f'{rv:.2f}x Low — weak')
        else: S['RVOL']=(0,f'{rv:.2f}x Normal')
    return S, sum(v[0] for v in S.values())

def fib_lvls(df):
    r=df.tail(FIB_DAYS); hi,lo=r['high'].max(),r['low'].min(); d=hi-lo
    return {'SH':hi,'SL':lo,'0.236':hi-0.236*d,'0.382':hi-0.382*d,'0.500':hi-0.500*d,
            '0.618':hi-0.618*d,'0.786':hi-0.786*d,'1.272':lo+1.272*d,'1.618':lo+1.618*d}

def period_lvls(data):
    out={}
    if '1d' in data and len(data['1d'])>=2:
        p=data['1d'].iloc[-2]; out.update({'PDH':p['high'],'PDL':p['low'],'PDC':p['close']})
    if '1w' in data and len(data['1w'])>=2:
        p=data['1w'].iloc[-2]; out.update({'PWH':p['high'],'PWL':p['low'],'PWC':p['close']})
    return out

def build_block(data,fg_v,fg_c,fg_chg,btc_d,eth_d,der,macro):
    now=datetime.now(timezone.utc); price=float(data['1h'].iloc[-1]['close'])
    hi4=float(data['4h'].iloc[-1]['high']); lo4=float(data['4h'].iloc[-1]['low'])
    vol24=data['1h'].tail(24)['volume'].sum()*price/1e9
    fib=fib_lvls(data['1d']); pl=period_lvls(data)
    L_=[]; A=L_.append
    
    try:
        with open("master_prompt.md", "r", encoding="utf-8") as f:
            content = f.read().strip()
            if content: A(content + "\n")
    except Exception:
        pass

    A("╔══════════════════════════════════════════════════════════╗")
    A(f"   BTC/USD EXPERT TA BLOCK v2  |  {now.strftime('%Y-%m-%d %H:%M UTC')}")
    A("╚══════════════════════════════════════════════════════════╝")
    A(f"\nPrice:{FV(price)}  4H H/L:{FV(hi4)}/{FV(lo4)}  Vol24:{vol24:.2f}B")
    for k,v in pl.items(): A(f"  {k}:{FV(v)}{NR(price,v)}")
    A(f"\nFib ({FV(fib['SH'])}→{FV(fib['SL'])}):")
    for k in ['0.236','0.382','0.500','0.618','0.786','1.272','1.618']:
        A(f"  {k}: {FV(fib[k])}{NR(price,fib[k])}")
    fg_bar='█'*(fg_v//10)+'░'*(10-fg_v//10) if fg_v else ''
    chg_s=f" 3d:{fg_chg:+d}" if fg_chg else ''
    A(f"\nF&G:{fg_v}/100 {fg_bar} {fg_c}{chg_s} | BTC Dom:{btc_d}% ETH:{eth_d}%")
    fr=der.get('fr'); oi=der.get('oi'); ls=der.get('ls')
    if fr is not None: A(f"Funding:{fr:+.4f}%/8h ({der.get('fr_ts','?')})")
    if oi: A(f"OI:{oi:,.0f} BTC ({der.get('oi_chg',0):+.1f}% change)")
    if ls: A(f"L/S:{ls:.2f}  L:{der.get('ll',0)*100:.1f}%  S:{der.get('ls_',0)*100:.1f}%")
    tf_ui={'15m':'15MIN','1h':'1H','4h':'4H','1d':'DAILY','1w':'WEEKLY'}
    total=total_max=0
    for tf in TIMEFRAMES:
        if tf not in data: continue
        sigs,net=tf_signals(tf,data[tf],price); total+=net; total_max+=len(sigs)
        A(f"\n── {tf_ui[tf]} (net:{net:+d}) ──")
        for name,(score,label) in sigs.items():
            icon='✅' if score>0 else '🔴' if score<0 else '⚪'
            A(f"  {icon} {name:<12}: {label}")
    pct=total/total_max*100 if total_max else 0
    ov=('🟢 BULLISH' if pct>60 else '🟡 MILD BULL' if pct>30 else '🔴 BEARISH' if pct<-60 else '🟡 MILD BEAR' if pct<-30 else '⚪ NEUTRAL')
    A(f"\n► OVERALL:{ov}  ({total:+d}/{total_max}  {pct:+.0f}%)")
    A(f"\n── MACRO ──")
    A(f"DXY:{macro.get('dxy','?')} {macro.get('dxy_dir','')} | US10Y:{macro.get('us10y','?')}% chg:{macro.get('us10y_chg','?')}%")
    A(f"IBIT:{macro.get('ibit','?')}  FBTC:{macro.get('fbtc','?')}")
    A(f"Headline:{macro.get('headline','?')}"); A(f"Geo:{macro.get('geo','?')}")
    A(f"Events:{macro.get('events','?')}")
    A(f"Position: Entry:{macro.get('entry','?')} Size:{macro.get('size','?')} SL:{macro.get('sl','?')}")
    A(f"Tranches:{macro.get('tranches','?')}")
    A("\n══ Paste into Claude — 7-layer refinement protocol ══")
    return '\n'.join(L_)

# ── UI ────────────────────────────────────────────────────────────────────────
st.title("₿  BTC/USD Expert TA Engine  v2")
st.caption("15M · 1H · 4H · Daily · Weekly · Funding · OI · L/S · Signal Scoring")

cb,cp=st.columns([2,1])
with cb: fetch_btn=st.button("🔄  Fetch All Data & Compute",type="primary",use_container_width=True)
with cp:
    if 'price' in st.session_state: st.metric("BTC/USD",f"${st.session_state['price']:,.2f}")

if fetch_btn:
    with st.spinner("Fetching 5 timeframes + derivatives …"):
        try:
            d_=fetch_ohlcv(); fg_=fetch_fg(); dom_=fetch_dom(); der_=fetch_der()
            st.session_state.update({'data':d_,'fg':fg_,'dom':dom_,'der':der_,
                'price':float(d_['1h'].iloc[-1]['close']),'ready':True})
        except Exception as e: st.error(f"Error: {e}")

if st.session_state.get('ready'):
    data_=st.session_state['data']; price_=st.session_state['price']
    fg_v,fg_c,fg_chg=st.session_state['fg']; btc_d,eth_d=st.session_state['dom']
    der_=st.session_state['der']
    st.divider()
    m1,m2,m3,m4,m5=st.columns(5)
    m1.metric("F&G",f"{fg_v}/100",f"{fg_chg:+d}(3d)" if fg_chg else "")
    m2.metric("BTC Dom",f"{btc_d}%" if btc_d else "N/A")
    fr=der_.get('fr'); m3.metric("Funding/8h",f"{fr:+.4f}%" if fr is not None else "N/A")
    oi=der_.get('oi'); oi_c=der_.get('oi_chg')
    m4.metric("Open Interest",f"{oi:,.0f} BTC" if oi else "N/A",f"{oi_c:+.1f}%" if oi_c else "")
    ls_=der_.get('ls'); m5.metric("L/S Ratio",f"{ls_:.2f}" if ls_ else "N/A")
    st.divider()
    st.subheader("📊 Multi-Timeframe Signal Dashboard")
    tf_ui={'15m':'15M','1h':'1H','4h':'4H','1d':'Daily','1w':'Weekly'}
    all_sigs={}; tf_nets={}; all_inds=set()
    for tf in TIMEFRAMES:
        if tf not in data_: continue
        sigs,net=tf_signals(tf,data_[tf],price_)
        all_sigs[tf]=sigs; tf_nets[tf]=net; all_inds.update(sigs.keys())
    rows=[]
    for ind in sorted(all_inds):
        row={'Indicator':ind}
        for tf in TIMEFRAMES:
            if tf not in all_sigs: continue
            lbl=tf_ui[tf]
            if ind in all_sigs[tf]:
                sc,label=all_sigs[tf][ind]
                row[lbl]=('✅ ' if sc>0 else '🔴 ' if sc<0 else '⚪ ')+label
            else: row[lbl]='—'
        rows.append(row)
    st.dataframe(pd.DataFrame(rows),use_container_width=True,hide_index=True)
    st.subheader("🎯 Bias by Timeframe")
    cols=st.columns(len([tf for tf in TIMEFRAMES if tf in tf_nets]))
    total_s=total_m=0; ci=0
    for tf in TIMEFRAMES:
        if tf not in tf_nets: continue
        net=tf_nets[tf]; mx=len(all_sigs.get(tf,{})); total_s+=net; total_m+=mx
        pct=net/mx*100 if mx else 0
        lbl='🟢 Bull' if pct>30 else '🔴 Bear' if pct<-30 else '⚪ Neut'
        cols[ci].metric(tf_ui[tf],lbl,f"{net:+d}/{mx}"); ci+=1
    pct_ov=total_s/total_m*100 if total_m else 0
    ov=('🟢 BULLISH' if pct_ov>60 else '🟡 MILD BULL' if pct_ov>30 else '🔴 BEARISH' if pct_ov<-60 else '🟡 MILD BEAR' if pct_ov<-30 else '⚪ NEUTRAL')
    st.success(f"**Overall: {ov}** — {total_s:+d}/{total_m} ({pct_ov:+.0f}%)")
    st.divider()
    fc1,fc2=st.columns(2)
    fib=fib_lvls(data_['1d']); pl=period_lvls(data_)
    with fc1:
        st.subheader("📐 Fibonacci")
        for k,v in fib.items():
            if k in('SH','SL'): continue
            st.text(f"  {k:6} ${v:>12,.2f}{NR(price_,v)}")
        st.text(f"  High   ${fib['SH']:>12,.2f}"); st.text(f"  Low    ${fib['SL']:>12,.2f}")
    with fc2:
        st.subheader("📅 Period Levels")
        for k,v in pl.items(): st.text(f"  {k}  ${v:>12,.2f}{NR(price_,v)}")
    st.divider()
    st.subheader("📝 Macro Inputs")
    c1,c2=st.columns(2)
    with c1:
        dxy=st.text_input("DXY",placeholder="99.4"); dxy_dir=st.selectbox("DXY Dir",["","Up","Down","Flat"])
        us10y=st.text_input("US10Y (%)",placeholder="4.39"); us10y_c=st.text_input("US10Y chg",placeholder="+0.12")
        ibit=st.text_input("IBIT flow",placeholder="$169M"); fbtc_in=st.text_input("FBTC flow",placeholder="$64M")
    with c2:
        headline=st.text_input("Macro headline",placeholder="Fed holds…")
        geo=st.text_input("Geopolitical",placeholder="YES — Iran")
        events=st.text_area("Events",placeholder="14:30 UTC|CPI|🔴",height=70)
        entry=st.text_input("Entry",placeholder="$69,900"); size_in=st.text_input("Size",placeholder="40%")
        sl_in=st.text_input("SL",placeholder="$66,100"); tranches=st.text_input("Pending tranches",placeholder="35% at $68,950")
    if st.button("📋 Generate Block — Paste into Claude",type="primary",use_container_width=True):
        macro=dict(dxy=dxy,dxy_dir=dxy_dir,us10y=us10y,us10y_chg=us10y_c,ibit=ibit,fbtc=fbtc_in,
                   headline=headline,geo=geo,events=events or '[not filled]',
                   entry=entry,size=size_in,sl=sl_in,tranches=tranches)
        block=build_block(data_,fg_v,fg_c,fg_chg,btc_d,eth_d,der_,macro)
        st.code(block,language=None)
        st.download_button("💾 Download .txt",data=block,
            file_name=f"btc_expert_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M')}.txt",
            mime="text/plain",use_container_width=True)
else:
    st.info("👆 Press **Fetch All Data & Compute** to begin.")
    st.markdown("""**Auto-fetched (zero auth):** OHLCV 15M/1H/4H/Daily/Weekly · EMAs 9/21/50/100/200 all TFs · RSI · StochRSI · MACD · BB · ATR · ADX/DI · Supertrend · PSAR · OBV · MFI · CVD · RVOL · VWAP · Ichimoku · Fibonacci retracements+extensions · PDH/PDL/PWH/PWL · Pivots · **Funding Rate · Open Interest · Long/Short Ratio** · Fear&Greed · BTC/ETH Dominance

**You fill (2 min):** DXY · US10Y · ETF flows · events · your position""")
st.divider()
st.caption("Binance spot+futures public · alternative.me · CoinGecko · No auth required")


# ══════════════════════════════════════════════════════════════════════════════
#  MACRO TAB — add this section after the existing UI
#  In your app.py, replace the final st.divider() + st.caption() with this
# ══════════════════════════════════════════════════════════════════════════════
#
#  INTEGRATION GUIDE:
#  The Streamlit app already has the TA engine. To add the macro fetch tab,
#  wrap the whole UI in:
#       tab1, tab2 = st.tabs(["📊 TA Engine", "🌐 Macro Fetch"])
#       with tab1: [existing TA code]
#       with tab2: [macro fetch code below]
#
#  Then import btc_macro_fetch.py functions at the top.
#  The code below is the macro tab content.

MACRO_TAB_CODE = '''
with tab2:
    st.subheader("🌐 Auto-Fetch Macro Data")
    st.caption("Yahoo Finance · farside.co.uk · Deribit public — zero API keys")

    if st.button("🔄  Fetch DXY · US10Y · ETF Flows · Options", type="primary",
                 use_container_width=True, key="macro_btn"):
        with st.spinner("Fetching from verified sources …"):
            from btc_macro_fetch import fetch_all_macro, format_macro_block
            macro_data = fetch_all_macro()
            st.session_state["macro_data"] = macro_data

    if "macro_data" in st.session_state:
        md = st.session_state["macro_data"]

        # DXY + US10Y metrics
        mc1, mc2 = st.columns(2)
'''