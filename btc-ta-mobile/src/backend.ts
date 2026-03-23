import axios from 'axios';
import { RSI, EMA, MACD, StochasticRSI, BollingerBands, ADX, ATR, OBV, MFI } from 'technicalindicators';

export interface Candle {
    ts: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}
export type Timeframes = '15m' | '1h' | '4h' | '1d' | '1w';
export const TIMEFRAMES: Timeframes[] = ['15m', '1h', '4h', '1d', '1w'];
export const TF_LABELS: Record<string, string> = {
    '15m': '15M', '1h': '1H', '4h': '4H', '1d': 'Daily', '1w': 'Weekly'
};

const PROX_PCT = 0.015;
const FIB_DAYS = 90;

export const fetchBinanceOHLCV = async (symbol: string, interval: string, limit = 300): Promise<Candle[]> => {
    try {
        const res = await axios.get(`https://api.binance.com/api/v3/klines`, {
            params: { symbol, interval, limit }
        });
        return res.data.map((d: any[]) => ({
            ts: d[0],
            open: parseFloat(d[1]),
            high: parseFloat(d[2]),
            low: parseFloat(d[3]),
            close: parseFloat(d[4]),
            volume: parseFloat(d[5])
        }));
    } catch (e) {
        console.error(`Fetch error ${interval}:`, e);
        return [];
    }
};

export const fetchAllOHLCV = async () => {
    const data: Record<string, Candle[]> = {};
    for (const tf of TIMEFRAMES) {
        data[tf] = await fetchBinanceOHLCV('BTCUSDT', tf);
    }
    return data;
};

// Fear & Greed Index
export interface FGData { value: number; classification: string; change3d: number | null; }
export const fetchFearGreed = async (): Promise<FGData> => {
    try {
        const res = await axios.get('https://api.alternative.me/fng/?limit=3', { timeout: 10000 });
        const items = res.data.data;
        const v = parseInt(items[0].value);
        const cls = items[0].value_classification;
        const chg = items.length > 2 ? v - parseInt(items[2].value) : null;
        return { value: v, classification: cls, change3d: chg };
    } catch {
        return { value: 0, classification: 'ERROR', change3d: null };
    }
};

// Dominance
export interface DomData { btc: number | null; eth: number | null; }
export const fetchDominance = async (): Promise<DomData> => {
    try {
        const res = await axios.get('https://api.coingecko.com/api/v3/global', { timeout: 10000 });
        const p = res.data.data.market_cap_percentage;
        return { btc: Math.round(p.btc * 10) / 10, eth: Math.round(p.eth * 10) / 10 };
    } catch {
        return { btc: null, eth: null };
    }
};

// Derivatives
export interface DerData {
    fr?: number; fr_ts?: string;
    oi?: number; oi_chg?: number;
    ls?: number; ll?: number; ls_short?: number;
}
export const fetchDerivatives = async (): Promise<DerData> => {
    const R: DerData = {};
    try {
        const r = await axios.get('https://fapi.binance.com/fapi/v1/fundingRate', {
            params: { symbol: 'BTCUSDT', limit: 3 }, timeout: 10000
        });
        if (Array.isArray(r.data) && r.data.length > 0) {
            R.fr = parseFloat(r.data[r.data.length - 1].fundingRate) * 100;
            R.fr_ts = new Date(parseInt(r.data[r.data.length - 1].fundingTime)).toISOString().slice(11, 16) + ' UTC';
        }
    } catch {}
    try {
        const r = await axios.get('https://fapi.binance.com/fapi/v1/openInterest', {
            params: { symbol: 'BTCUSDT' }, timeout: 10000
        });
        R.oi = parseFloat(r.data.openInterest || '0');
    } catch {}
    try {
        const r = await axios.get('https://fapi.binance.com/futures/data/openInterestHist', {
            params: { symbol: 'BTCUSDT', period: '4h', limit: 6 }, timeout: 10000
        });
        if (Array.isArray(r.data) && r.data.length >= 2) {
            R.oi_chg = (parseFloat(r.data[r.data.length - 1].sumOpenInterest) - parseFloat(r.data[0].sumOpenInterest)) / parseFloat(r.data[0].sumOpenInterest) * 100;
        }
    } catch {}
    try {
        const r = await axios.get('https://fapi.binance.com/futures/data/topLongShortAccountRatio', {
            params: { symbol: 'BTCUSDT', period: '4h', limit: 1 }, timeout: 10000
        });
        if (Array.isArray(r.data) && r.data.length > 0) {
            R.ls = parseFloat(r.data[r.data.length - 1].longShortRatio);
            R.ll = parseFloat(r.data[r.data.length - 1].longAccount);
            R.ls_short = parseFloat(r.data[r.data.length - 1].shortAccount);
        }
    } catch {}
    return R;
};

// Formatting helpers
export const FV = (v: number | null | undefined, pre = '$', dec = 2) => {
    if (v === null || v === undefined || isNaN(v)) return 'N/A';
    if (pre === '$') return `$${v.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
    return v.toFixed(dec);
};

export const isNearLevel = (price: number, level: number | null | undefined): boolean => {
    if (!level || isNaN(level)) return false;
    return Math.abs(price - level) / price < PROX_PCT;
};

// Fibonacci levels
export const fibLevels = (candles: Candle[]) => {
    const recent = candles.slice(-FIB_DAYS);
    const hi = Math.max(...recent.map(c => c.high));
    const lo = Math.min(...recent.map(c => c.low));
    const d = hi - lo;
    return {
        SH: hi, SL: lo,
        '0.236': hi - 0.236 * d, '0.382': hi - 0.382 * d, '0.500': hi - 0.500 * d,
        '0.618': hi - 0.618 * d, '0.786': hi - 0.786 * d,
        '1.272': lo + 1.272 * d, '1.618': lo + 1.618 * d
    };
};

// Period levels: PDH/PDL/PDC, PWH/PWL/PWC
export const periodLevels = (data: Record<string, Candle[]>) => {
    const out: Record<string, number> = {};
    if (data['1d'] && data['1d'].length >= 2) {
        const p = data['1d'][data['1d'].length - 2];
        out.PDH = p.high; out.PDL = p.low; out.PDC = p.close;
    }
    if (data['1w'] && data['1w'].length >= 2) {
        const p = data['1w'][data['1w'].length - 2];
        out.PWH = p.high; out.PWL = p.low; out.PWC = p.close;
    }
    return out;
};

// ── Indicator logic (matching Streamlit's tf_signals) ──
export const tfSignals = (tf: string, candles: Candle[], currentPrice: number) => {
    const S: Record<string, [number, string]> = {};
    const close = candles.map(c => c.close);
    const high = candles.map(c => c.high);
    const low = candles.map(c => c.low);
    const volume = candles.map(c => c.volume);

    // EMA Stack
    const ema9 = EMA.calculate({ period: 9, values: close });
    const ema21 = EMA.calculate({ period: 21, values: close });
    const ema50 = EMA.calculate({ period: 50, values: close });
    const ema200 = EMA.calculate({ period: 200, values: close });

    const e9 = ema9[ema9.length - 1];
    const e21 = ema21[ema21.length - 1];
    const e50 = ema50[ema50.length - 1];
    const e200 = ema200[ema200.length - 1];

    if (e9 && e21 && e50 && e200) {
        if (e9 > e21 && e21 > e50 && e50 > e200 && currentPrice > e9) {
            S['EMA Stack'] = [1, 'Full Bull'];
        } else if (e200 > e50 && e50 > e21 && e21 > e9) {
            S['EMA Stack'] = [-1, 'Full Bear'];
        } else if (currentPrice > e200) {
            S['EMA Stack'] = [0, `Mixed above EMA200($${e200.toFixed(0)})`];
        } else {
            S['EMA Stack'] = [-1, `Below EMA200($${e200.toFixed(0)})`];
        }
    }

    // RSI
    const rsi = RSI.calculate({ period: 14, values: close });
    const r = rsi[rsi.length - 1];
    if (r) {
        if (r > 70) S['RSI14'] = [-1, `${r.toFixed(1)} Overbought`];
        else if (r > 60) S['RSI14'] = [1, `${r.toFixed(1)} Bullish`];
        else if (r < 30) S['RSI14'] = [1, `${r.toFixed(1)} Oversold`];
        else if (r < 40) S['RSI14'] = [-1, `${r.toFixed(1)} Bearish`];
        else S['RSI14'] = [0, `${r.toFixed(1)} Neutral`];
    }

    // MACD
    const macdData = MACD.calculate({
        values: close, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
        SimpleMAOscillator: false, SimpleMASignal: false
    });
    const m = macdData[macdData.length - 1];
    if (m && m.histogram !== undefined) {
        const hist = m.histogram!;
        // Momentum check
        const last3 = macdData.slice(-3).map(x => x.histogram).filter(x => x !== undefined);
        let mom = '';
        if (last3.length >= 3) {
            mom = Math.abs(last3[2]!) > Math.abs(last3[1]!) && Math.abs(last3[1]!) > Math.abs(last3[0]!) ? ' ↑' : ' ↓';
        }
        S['MACD'] = hist > 0 ? [1, `Bull ${hist > 0 ? '+' : ''}${hist.toFixed(1)}${mom}`] : [-1, `Bear ${hist.toFixed(1)}${mom}`];
    }

    // Bollinger Bands
    const bbData = BollingerBands.calculate({ period: 20, values: close, stdDev: 2 });
    const bb = bbData[bbData.length - 1];
    if (bb) {
        const bbw = ((bb.upper - bb.lower) / bb.middle) * 100;
        if (currentPrice > bb.upper) S['BB'] = [-1, `Above upper $${bb.upper.toFixed(0)}`];
        else if (currentPrice < bb.lower) S['BB'] = [1, `Below lower $${bb.lower.toFixed(0)}`];
        else {
            const sq = bbw < 3 ? ' [SQUEEZE]' : (bbw < 5 ? ' [compress]' : '');
            S['BB'] = [0, `Inside${sq} w:${bbw.toFixed(1)}%`];
        }
    }

    // StochRSI
    const stochRsiData = StochasticRSI.calculate({
        values: close, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3
    });
    const sr = stochRsiData[stochRsiData.length - 1];
    if (sr) {
        const sk = sr.k;
        const sd2 = sr.d;
        if (sk < 20 && sk > sd2) S['StochRSI'] = [1, `K:${sk.toFixed(0)} OvSold+cross`];
        else if (sk > 80 && sk < sd2) S['StochRSI'] = [-1, `K:${sk.toFixed(0)} OvBought+cross`];
        else if (sk > sd2) S['StochRSI'] = [0, `K:${sk.toFixed(0)}>${sd2.toFixed(0)}`];
        else S['StochRSI'] = [0, `K:${sk.toFixed(0)}<${sd2.toFixed(0)}`];
    }

    // ADX
    try {
        const adxData = ADX.calculate({ close, high, low, period: 14 });
        const adx = adxData[adxData.length - 1];
        if (adx) {
            const adxVal = adx.adx;
            const dip = adx.pdi;
            const din = adx.mdi;
            const st = adxVal > 25 ? 'Strong' : 'Weak';
            if (adxVal > 20) {
                S['ADX'] = dip > din
                    ? [1, `ADX:${adxVal.toFixed(0)} ${st} Bull`]
                    : [-1, `ADX:${adxVal.toFixed(0)} ${st} Bear`];
            } else {
                S['ADX'] = [0, `ADX:${adxVal.toFixed(0)} Ranging`];
            }
        }
    } catch { }

    // OBV (daily and weekly only)
    if (tf === '1d' || tf === '1w') {
        try {
            const obvData = OBV.calculate({ close, volume });
            if (obvData.length >= 28) {
                const obRecent = obvData.slice(-14);
                const obPrev = obvData.slice(-28, -14);
                const orAvg = obRecent.reduce((a, b) => a + b, 0) / 14;
                const opAvg = obPrev.reduce((a, b) => a + b, 0) / 14;
                const prRecent = close.slice(-14);
                const prPrev = close.slice(-28, -14);
                const prAvg = prRecent.reduce((a, b) => a + b, 0) / 14;
                const ppAvg = prPrev.reduce((a, b) => a + b, 0) / 14;
                if (orAvg > opAvg && prAvg > ppAvg) S['OBV'] = [1, 'Rising confirm'];
                else if (orAvg < opAvg && prAvg < ppAvg) S['OBV'] = [-1, 'Falling confirm'];
                else if (orAvg > opAvg) S['OBV'] = [1, 'Bull Divergence ⚠️'];
                else S['OBV'] = [-1, 'Bear Divergence ⚠️'];
            }
        } catch { }
    }

    // MFI (daily and weekly only)
    if (tf === '1d' || tf === '1w') {
        try {
            const mfiData = MFI.calculate({ close, high, low, volume, period: 14 });
            const mf = mfiData[mfiData.length - 1];
            if (mf !== undefined) {
                if (mf > 80) S['MFI'] = [-1, `${mf.toFixed(0)} OvBought`];
                else if (mf < 20) S['MFI'] = [1, `${mf.toFixed(0)} OvSold`];
                else S['MFI'] = [0, `${mf.toFixed(0)} Neutral`];
            }
        } catch { }
    }

    // RVOL
    if (volume.length >= 20) {
        const avgVol = volume.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const rv = volume[volume.length - 1] / avgVol;
        if (rv > 2.0) S['RVOL'] = [0, `${rv.toFixed(2)}x Very High`];
        else if (rv > 1.3) S['RVOL'] = [1, `${rv.toFixed(2)}x Above avg`];
        else if (rv < 0.6) S['RVOL'] = [-1, `${rv.toFixed(2)}x Low — weak`];
        else S['RVOL'] = [0, `${rv.toFixed(2)}x Normal`];
    }

    // CVD (cumulative volume delta)
    if (candles.length >= 10) {
        let cvd = 0;
        const cvdArr: number[] = [];
        for (const c of candles) {
            const delta = ((c.close - c.low) / (c.high - c.low + 1e-10)) * c.volume * 2 - c.volume;
            cvd += delta;
            cvdArr.push(cvd);
        }
        const recent5 = cvdArr.slice(-5);
        const prev5 = cvdArr.slice(-10, -5);
        const r5avg = recent5.reduce((a, b) => a + b, 0) / 5;
        const p5avg = prev5.reduce((a, b) => a + b, 0) / 5;
        if (r5avg > p5avg) S['CVD'] = [1, 'Net buying'];
        else S['CVD'] = [-1, 'Net selling'];
    }

    // Calculate Net
    let net = 0;
    for (const key in S) {
        net += S[key][0];
    }

    return { sigs: S, net };
};

// Fetch everything in one go
export interface AllData {
    ohlcv: Record<string, Candle[]>;
    fg: FGData;
    dom: DomData;
    der: DerData;
    price: number;
}

export const fetchAllData = async (): Promise<AllData> => {
    const [ohlcv, fg, dom, der] = await Promise.all([
        fetchAllOHLCV(),
        fetchFearGreed(),
        fetchDominance(),
        fetchDerivatives(),
    ]);
    const price = ohlcv['1h'] && ohlcv['1h'].length > 0
        ? ohlcv['1h'][ohlcv['1h'].length - 1].close
        : 0;
    return { ohlcv, fg, dom, der, price };
};
