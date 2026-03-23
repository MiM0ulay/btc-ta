import axios from 'axios';
import { RSI, EMA, MACD, StochasticRSI, BollingerBands, ADX, ATR, OBV, VWAP } from 'technicalindicators';
import { format } from 'date-fns';

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

// Formatting helpers
export const FV = (v: number | null, pre = '$', dec = 2) => {
    if (v === null || isNaN(v)) return 'N/A';
    return pre === '$' ? `$${v.toLocaleString(undefined, {minimumFractionDigits: dec, maximumFractionDigits: dec})}` : v.toFixed(dec);
};

// Indicator logic translation
export const tfSignals = (tf: string, candles: Candle[], currentPrice: number) => {
    const S: Record<string, [number, string]> = {};
    const close = candles.map(c => c.close);
    const high = candles.map(c => c.high);
    const low = candles.map(c => c.low);
    const volume = candles.map(c => c.volume);

    // EMA Stack
    const ema9 = EMA.calculate({period: 9, values: close});
    const ema21 = EMA.calculate({period: 21, values: close});
    const ema50 = EMA.calculate({period: 50, values: close});
    const ema200 = EMA.calculate({period: 200, values: close});
    
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
    const rsi = RSI.calculate({period: 14, values: close});
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
        values: close,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false
    });
    const m = macdData[macdData.length - 1];
    if (m && m.histogram !== undefined) {
        const hist = m.histogram;
        S['MACD'] = hist > 0 ? [1, `Bull ${hist.toFixed(1)}`] : [-1, `Bear ${hist.toFixed(1)}`];
    }

    // Bollinger Bands
    const bbData = BollingerBands.calculate({period: 20, values: close, stdDev: 2});
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
        values: close,
        rsiPeriod: 14,
        stochasticPeriod: 14,
        kPeriod: 3,
        dPeriod: 3
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

    // Calculate Net
    let net = 0;
    for (const key in S) {
        net += S[key][0];
    }

    return { sigs: S, net };
};
