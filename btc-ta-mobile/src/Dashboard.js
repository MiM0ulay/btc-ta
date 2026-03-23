import React, { useState, useRef } from 'react';
import {
  StyleSheet, Text, View, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Dimensions, RefreshControl
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  fetchAllData, tfSignals, fibLevels, periodLevels, isNearLevel,
  TIMEFRAMES, TF_LABELS, FV
} from './backend';
import MASTER_PROMPT from './masterPrompt';

const { width } = Dimensions.get('window');

// ── Color Palette ──
const C = {
  bg: '#0a0e1a',
  card: '#111827',
  cardBorder: '#1e293b',
  accent: '#f7931a',      // Bitcoin orange
  accentDim: '#b36b12',
  bull: '#10b981',
  bear: '#ef4444',
  neutral: '#6b7280',
  text: '#e5e7eb',
  textDim: '#9ca3af',
  textMuted: '#6b7280',
  white: '#ffffff',
  gold: '#fbbf24',
  purple: '#8b5cf6',
  cyan: '#06b6d4',
  blue: '#3b82f6',
  surface: '#1a1f2e',
  surfaceLight: '#232a3d',
};

// ── Small metric card ──
const MetricCard = ({ label, value, sub, color }) => (
  <View style={[s.metricCard, { borderLeftColor: color || C.accent }]}>
    <Text style={s.metricLabel}>{label}</Text>
    <Text style={[s.metricValue, { color: color || C.text }]}>{value}</Text>
    {sub ? <Text style={[s.metricSub, { color: color || C.textDim }]}>{sub}</Text> : null}
  </View>
);

// ── Signal icon ──
const SigIcon = ({ score }) => {
  if (score > 0) return <Text style={{ color: C.bull, fontSize: 14 }}>✅</Text>;
  if (score < 0) return <Text style={{ color: C.bear, fontSize: 14 }}>🔴</Text>;
  return <Text style={{ color: C.neutral, fontSize: 14 }}>⚪</Text>;
};

// ── Bias pill ──
const BiasPill = ({ net, max }) => {
  const pct = max ? (net / max) * 100 : 0;
  let label, bg;
  if (pct > 30) { label = '🟢 Bull'; bg = C.bull + '30'; }
  else if (pct < -30) { label = '🔴 Bear'; bg = C.bear + '30'; }
  else { label = '⚪ Neut'; bg = C.neutral + '30'; }
  return (
    <View style={[s.biasPill, { backgroundColor: bg }]}>
      <Text style={s.biasTf}>{label}</Text>
      <Text style={s.biasNet}>{net > 0 ? '+' : ''}{net}/{max}</Text>
    </View>
  );
};

// ── Section header ──
const SectionHeader = ({ icon, title }) => (
  <View style={s.sectionHeader}>
    <Text style={s.sectionIcon}>{icon}</Text>
    <Text style={s.sectionTitle}>{title}</Text>
  </View>
);

// ── Progress bar for F&G ──
const FearGreedBar = ({ value }) => {
  const pct = Math.max(0, Math.min(100, value));
  let barColor = C.bear;
  if (pct > 75) barColor = C.bull;
  else if (pct > 50) barColor = C.gold;
  else if (pct > 25) barColor = C.accent;
  return (
    <View style={s.fgBarBg}>
      <View style={[s.fgBarFill, { width: `${pct}%`, backgroundColor: barColor }]} />
    </View>
  );
};

export default function Dashboard() {
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState(null);
  const [allSigs, setAllSigs] = useState(null);
  const [tfNets, setTfNets] = useState(null);
  const [fib, setFib] = useState(null);
  const [pLevels, setPLevels] = useState(null);
  const [totalNet, setTotalNet] = useState(0);
  const [totalMax, setTotalMax] = useState(0);
  const [lastUpdate, setLastUpdate] = useState(null);

  const compute = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const result = await fetchAllData();
      setData(result);

      // Compute signals for all timeframes
      const sigs = {};
      const nets = {};
      let tNet = 0, tMax = 0;
      const allIndicators = new Set();

      for (const tf of TIMEFRAMES) {
        if (!result.ohlcv[tf] || result.ohlcv[tf].length === 0) continue;
        const res = tfSignals(tf, result.ohlcv[tf], result.price);
        sigs[tf] = res.sigs;
        nets[tf] = { net: res.net, max: Object.keys(res.sigs).length };
        tNet += res.net;
        tMax += Object.keys(res.sigs).length;
        Object.keys(res.sigs).forEach(k => allIndicators.add(k));
      }

      setAllSigs(sigs);
      setTfNets(nets);
      setTotalNet(tNet);
      setTotalMax(tMax);

      // Fibonacci & Period Levels
      if (result.ohlcv['1d'] && result.ohlcv['1d'].length > 0) {
        setFib(fibLevels(result.ohlcv['1d']));
      }
      setPLevels(periodLevels(result.ohlcv));

      setLastUpdate(new Date());
    } catch (e) {
      Alert.alert('Error', String(e));
    }
    setLoading(false);
    setRefreshing(false);
  };

  const copyBlock = async () => {
    if (!data) return;
    let out = MASTER_PROMPT.trim() + '\n\n';
    out += '╔══════════════════════════════════════════════════════════╗\n';
    out += `   BTC/USD EXPERT TA BLOCK v3 (MOBILE) | ${new Date().toISOString()}\n`;
    out += '╚══════════════════════════════════════════════════════════╝\n';
    out += `\nPrice: ${FV(data.price)}\n`;

    for (const tf of TIMEFRAMES) {
      if (!allSigs || !allSigs[tf]) continue;
      const net = tfNets[tf].net;
      out += `\n── ${TF_LABELS[tf]} (net:${net > 0 ? '+' : ''}${net}) ──\n`;
      for (const [name, [score, label]] of Object.entries(allSigs[tf])) {
        const icon = score > 0 ? '✅' : (score < 0 ? '🔴' : '⚪');
        out += `  ${icon} ${name.padEnd(12)}: ${label}\n`;
      }
    }

    const pct = totalMax ? (totalNet / totalMax) * 100 : 0;
    const ov = pct > 60 ? '🟢 BULLISH' : (pct > 30 ? '🟡 MILD BULL' : (pct < -60 ? '🔴 BEARISH' : (pct < -30 ? '🟡 MILD BEAR' : '⚪ NEUTRAL')));
    out += `\n► OVERALL: ${ov}  (${totalNet > 0 ? '+' : ''}${totalNet}/${totalMax})\n`;

    // Fib
    if (fib) {
      out += `\nFib (${FV(fib.SH)}→${FV(fib.SL)}):\n`;
      for (const k of ['0.236', '0.382', '0.500', '0.618', '0.786', '1.272', '1.618']) {
        const near = isNearLevel(data.price, fib[k]) ? '  ◀' : '';
        out += `  ${k}: ${FV(fib[k])}${near}\n`;
      }
    }

    // FG, Dom, Der
    if (data.fg) out += `\nF&G: ${data.fg.value}/100 ${data.fg.classification}`;
    if (data.dom) out += ` | BTC Dom: ${data.dom.btc}% ETH: ${data.dom.eth}%`;
    if (data.der.fr !== undefined) out += `\nFunding: ${data.der.fr > 0 ? '+' : ''}${data.der.fr.toFixed(4)}%/8h`;
    if (data.der.oi) out += `\nOI: ${data.der.oi.toLocaleString()} BTC`;
    if (data.der.ls) out += `\nL/S: ${data.der.ls.toFixed(2)}`;

    out += '\n\n══ Paste into Claude — 7-layer refinement protocol ══';

    await Clipboard.setStringAsync(out);
    Alert.alert('Copied!', 'Full TA block + master prompt copied to clipboard.');
  };

  const overallPct = totalMax ? (totalNet / totalMax) * 100 : 0;
  const overallLabel = overallPct > 60 ? '🟢 BULLISH' : (overallPct > 30 ? '🟡 MILD BULL' : (overallPct < -60 ? '🔴 BEARISH' : (overallPct < -30 ? '🟡 MILD BEAR' : '⚪ NEUTRAL')));
  const overallColor = overallPct > 30 ? C.bull : (overallPct < -30 ? C.bear : C.neutral);

  // Get all unique indicators across timeframes
  const allIndicators = [];
  if (allSigs) {
    const indSet = new Set();
    for (const tf of TIMEFRAMES) {
      if (allSigs[tf]) Object.keys(allSigs[tf]).forEach(k => indSet.add(k));
    }
    allIndicators.push(...[...indSet].sort());
  }

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.logo}>₿</Text>
        <View style={s.headerText}>
          <Text style={s.title}>BTC Expert TA</Text>
          <Text style={s.subtitle}>Multi-Timeframe Dashboard</Text>
        </View>
        {data && (
          <View style={s.priceTag}>
            <Text style={s.priceText}>{FV(data.price)}</Text>
          </View>
        )}
      </View>

      {/* Fetch button */}
      {!data && (
        <TouchableOpacity style={s.fetchBtn} onPress={() => compute(false)} disabled={loading}>
          {loading ? (
            <View style={s.loadingRow}>
              <ActivityIndicator color={C.bg} />
              <Text style={s.fetchBtnText}>  Fetching…</Text>
            </View>
          ) : (
            <Text style={s.fetchBtnText}>🔄  Fetch All Data & Compute</Text>
          )}
        </TouchableOpacity>
      )}

      {!data && !loading && (
        <View style={s.welcomeCard}>
          <Text style={s.welcomeTitle}>Welcome</Text>
          <Text style={s.welcomeText}>
            Press the button above to fetch 5 timeframes of OHLCV data, derivatives, Fear & Greed, and dominance — all from public APIs, zero keys needed.
          </Text>
          <Text style={s.welcomeIndicators}>
            EMAs · RSI · StochRSI · MACD · BB · ADX · OBV · MFI · CVD · RVOL · Fibonacci · Period Levels · Funding · OI · L/S
          </Text>
        </View>
      )}

      {/* Dashboard */}
      {data && (
        <ScrollView
          style={s.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => compute(true)}
              tintColor={C.accent}
              colors={[C.accent]}
            />
          }
        >
          {/* ── Overall Bias ── */}
          <View style={[s.overallCard, { borderColor: overallColor }]}>
            <Text style={[s.overallLabel, { color: overallColor }]}>{overallLabel}</Text>
            <Text style={s.overallSub}>
              {totalNet > 0 ? '+' : ''}{totalNet}/{totalMax}  ({overallPct > 0 ? '+' : ''}{overallPct.toFixed(0)}%)
            </Text>
            {/* Progress bar */}
            <View style={s.overallBarBg}>
              <View style={[s.overallBarFill, {
                width: `${Math.abs(overallPct) * 0.5 + 50}%`,
                backgroundColor: overallColor,
              }]} />
            </View>
          </View>

          {/* ── Top Metrics Row ── */}
          <SectionHeader icon="📊" title="Market Overview" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.metricsRow}>
            <MetricCard
              label="F&G"
              value={`${data.fg.value}/100`}
              sub={data.fg.classification}
              color={data.fg.value > 60 ? C.bull : (data.fg.value < 40 ? C.bear : C.gold)}
            />
            <MetricCard
              label="BTC Dom"
              value={data.dom.btc ? `${data.dom.btc}%` : 'N/A'}
              color={C.accent}
            />
            <MetricCard
              label="ETH Dom"
              value={data.dom.eth ? `${data.dom.eth}%` : 'N/A'}
              color={C.purple}
            />
            <MetricCard
              label="Funding/8h"
              value={data.der.fr !== undefined ? `${data.der.fr > 0 ? '+' : ''}${data.der.fr.toFixed(4)}%` : 'N/A'}
              sub={data.der.fr_ts}
              color={data.der.fr > 0 ? C.bull : C.bear}
            />
            <MetricCard
              label="Open Interest"
              value={data.der.oi ? `${(data.der.oi / 1000).toFixed(1)}K BTC` : 'N/A'}
              sub={data.der.oi_chg !== undefined ? `${data.der.oi_chg > 0 ? '+' : ''}${data.der.oi_chg.toFixed(1)}%` : undefined}
              color={C.cyan}
            />
            <MetricCard
              label="L/S Ratio"
              value={data.der.ls ? data.der.ls.toFixed(2) : 'N/A'}
              sub={data.der.ll ? `L:${(data.der.ll * 100).toFixed(1)}% S:${(data.der.ls_short * 100).toFixed(1)}%` : undefined}
              color={data.der.ls && data.der.ls > 1 ? C.bull : C.bear}
            />
          </ScrollView>

          {/* Fear & Greed bar */}
          <View style={s.fgCard}>
            <View style={s.fgRow}>
              <Text style={s.fgLabel}>Fear & Greed</Text>
              <Text style={[s.fgValue, { color: data.fg.value > 60 ? C.bull : (data.fg.value < 40 ? C.bear : C.gold) }]}>
                {data.fg.value}
              </Text>
              {data.fg.change3d !== null && (
                <Text style={[s.fgChange, { color: data.fg.change3d > 0 ? C.bull : C.bear }]}>
                  {data.fg.change3d > 0 ? '+' : ''}{data.fg.change3d} (3d)
                </Text>
              )}
            </View>
            <FearGreedBar value={data.fg.value} />
            <View style={s.fgLabels}>
              <Text style={[s.fgSmall, { color: C.bear }]}>Extreme Fear</Text>
              <Text style={[s.fgSmall, { color: C.bull }]}>Extreme Greed</Text>
            </View>
          </View>

          {/* ── Timeframe Bias Grid ── */}
          <SectionHeader icon="🎯" title="Bias by Timeframe" />
          <View style={s.biasGrid}>
            {TIMEFRAMES.map(tf => {
              if (!tfNets || !tfNets[tf]) return null;
              const { net, max } = tfNets[tf];
              const pct = max ? (net / max) * 100 : 0;
              const color = pct > 30 ? C.bull : (pct < -30 ? C.bear : C.neutral);
              const label = pct > 30 ? 'Bull' : (pct < -30 ? 'Bear' : 'Neutral');
              return (
                <View key={tf} style={[s.biasCard, { borderBottomColor: color }]}>
                  <Text style={s.biasTfLabel}>{TF_LABELS[tf]}</Text>
                  <Text style={[s.biasLabel, { color }]}>{label}</Text>
                  <Text style={s.biasScore}>{net > 0 ? '+' : ''}{net}/{max}</Text>
                  <View style={s.miniBarBg}>
                    <View style={[s.miniBarFill, { width: `${Math.min(100, Math.abs(pct))}%`, backgroundColor: color }]} />
                  </View>
                </View>
              );
            })}
          </View>

          {/* ── Multi-TF Signal Table ── */}
          <SectionHeader icon="📊" title="Signal Dashboard" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={s.table}>
              {/* Header row */}
              <View style={s.tableRow}>
                <View style={[s.tableCell, s.tableCellInd, s.tableHeaderCell]}>
                  <Text style={s.tableHeaderText}>Indicator</Text>
                </View>
                {TIMEFRAMES.map(tf => (
                  allSigs && allSigs[tf] ? (
                    <View key={tf} style={[s.tableCell, s.tableHeaderCell]}>
                      <Text style={s.tableHeaderText}>{TF_LABELS[tf]}</Text>
                    </View>
                  ) : null
                ))}
              </View>

              {/* Data rows */}
              {allIndicators.map((ind, i) => (
                <View key={ind} style={[s.tableRow, i % 2 === 0 ? s.tableRowEven : null]}>
                  <View style={[s.tableCell, s.tableCellInd]}>
                    <Text style={s.tableCellIndText}>{ind}</Text>
                  </View>
                  {TIMEFRAMES.map(tf => {
                    if (!allSigs || !allSigs[tf]) return null;
                    const sig = allSigs[tf][ind];
                    if (!sig) return (
                      <View key={tf} style={s.tableCell}>
                        <Text style={s.tableCellDash}>—</Text>
                      </View>
                    );
                    const [score, label] = sig;
                    const color = score > 0 ? C.bull : (score < 0 ? C.bear : C.textDim);
                    return (
                      <View key={tf} style={s.tableCell}>
                        <SigIcon score={score} />
                        <Text style={[s.tableCellLabel, { color }]} numberOfLines={1}>{label}</Text>
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          </ScrollView>

          {/* ── Fibonacci Levels ── */}
          {fib && (
            <>
              <SectionHeader icon="📐" title="Fibonacci Levels" />
              <View style={s.levelCard}>
                <View style={s.levelRow}>
                  <Text style={[s.levelKey, { color: C.bull }]}>High</Text>
                  <Text style={s.levelVal}>{FV(fib.SH)}</Text>
                </View>
                {['0.236', '0.382', '0.500', '0.618', '0.786'].map(k => {
                  const near = isNearLevel(data.price, fib[k]);
                  return (
                    <View key={k} style={[s.levelRow, near ? s.levelRowNear : null]}>
                      <Text style={s.levelKey}>{k}</Text>
                      <Text style={[s.levelVal, near ? { color: C.accent } : null]}>{FV(fib[k])}</Text>
                      {near && <Text style={s.nearArrow}>◀</Text>}
                    </View>
                  );
                })}
                <View style={s.levelRow}>
                  <Text style={[s.levelKey, { color: C.bear }]}>Low</Text>
                  <Text style={s.levelVal}>{FV(fib.SL)}</Text>
                </View>
                <View style={s.divider} />
                <Text style={s.extTitle}>Extensions</Text>
                {['1.272', '1.618'].map(k => {
                  const near = isNearLevel(data.price, fib[k]);
                  return (
                    <View key={k} style={[s.levelRow, near ? s.levelRowNear : null]}>
                      <Text style={[s.levelKey, { color: C.purple }]}>{k}</Text>
                      <Text style={[s.levelVal, near ? { color: C.accent } : null]}>{FV(fib[k])}</Text>
                      {near && <Text style={s.nearArrow}>◀</Text>}
                    </View>
                  );
                })}
              </View>
            </>
          )}

          {/* ── Period Levels ── */}
          {pLevels && Object.keys(pLevels).length > 0 && (
            <>
              <SectionHeader icon="📅" title="Period Levels" />
              <View style={s.levelCard}>
                {Object.entries(pLevels).map(([k, v]) => {
                  const near = isNearLevel(data.price, v);
                  return (
                    <View key={k} style={[s.levelRow, near ? s.levelRowNear : null]}>
                      <Text style={[s.levelKey, { color: k.startsWith('PD') ? C.cyan : C.blue }]}>{k}</Text>
                      <Text style={[s.levelVal, near ? { color: C.accent } : null]}>{FV(v)}</Text>
                      {near && <Text style={s.nearArrow}>◀</Text>}
                    </View>
                  );
                })}
              </View>
            </>
          )}

          {/* ── Action Buttons ── */}
          <View style={s.actions}>
            <TouchableOpacity style={s.copyBtn} onPress={copyBlock}>
              <Text style={s.copyBtnText}>📋 Copy Full TA Block</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.refreshBtn} onPress={() => compute(false)} disabled={loading}>
              {loading ? (
                <ActivityIndicator color={C.accent} />
              ) : (
                <Text style={s.refreshBtnText}>🔄 Refresh</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Last update */}
          {lastUpdate && (
            <Text style={s.lastUpdate}>
              Last updated: {lastUpdate.toLocaleTimeString()}
            </Text>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {loading && data === null && (
        <View style={s.loadingOverlay}>
          <ActivityIndicator size="large" color={C.accent} />
          <Text style={s.loadingText}>Fetching 5 timeframes…</Text>
          <Text style={s.loadingSubtext}>OHLCV · F&G · Dominance · Derivatives</Text>
        </View>
      )}
    </View>
  );
}

// ── Styles ──
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 55, paddingBottom: 12, paddingHorizontal: 16,
    backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.cardBorder,
  },
  logo: { fontSize: 32, marginRight: 10 },
  headerText: { flex: 1 },
  title: { fontSize: 20, fontWeight: '800', color: C.white, letterSpacing: 0.5 },
  subtitle: { fontSize: 12, color: C.textDim, marginTop: 2 },
  priceTag: {
    backgroundColor: C.accent + '20', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: C.accent + '40',
  },
  priceText: { fontSize: 16, fontWeight: '700', color: C.accent },

  // Fetch button
  fetchBtn: {
    backgroundColor: C.accent, marginHorizontal: 16, marginTop: 16,
    padding: 16, borderRadius: 12, alignItems: 'center',
  },
  fetchBtnText: { color: C.bg, fontWeight: '800', fontSize: 16 },
  loadingRow: { flexDirection: 'row', alignItems: 'center' },

  // Welcome card
  welcomeCard: {
    margin: 16, backgroundColor: C.card, borderRadius: 12,
    padding: 20, borderWidth: 1, borderColor: C.cardBorder,
  },
  welcomeTitle: { fontSize: 18, fontWeight: '700', color: C.white, marginBottom: 8 },
  welcomeText: { fontSize: 14, color: C.textDim, lineHeight: 20, marginBottom: 12 },
  welcomeIndicators: { fontSize: 12, color: C.textMuted, lineHeight: 18 },

  // Overall
  overallCard: {
    margin: 16, marginBottom: 8, backgroundColor: C.card, borderRadius: 12,
    padding: 16, borderWidth: 1, alignItems: 'center',
  },
  overallLabel: { fontSize: 22, fontWeight: '800', letterSpacing: 1 },
  overallSub: { fontSize: 14, color: C.textDim, marginTop: 4 },
  overallBarBg: {
    width: '100%', height: 6, backgroundColor: C.surface,
    borderRadius: 3, marginTop: 12, overflow: 'hidden',
  },
  overallBarFill: { height: 6, borderRadius: 3 },

  // Section
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8,
  },
  sectionIcon: { fontSize: 16, marginRight: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: C.white },

  // Metric cards
  metricsRow: { paddingLeft: 12, marginBottom: 4 },
  metricCard: {
    backgroundColor: C.card, borderRadius: 10, padding: 12,
    marginHorizontal: 4, minWidth: 100, borderLeftWidth: 3,
    borderWidth: 1, borderColor: C.cardBorder,
  },
  metricLabel: { fontSize: 11, color: C.textMuted, fontWeight: '600', marginBottom: 4, textTransform: 'uppercase' },
  metricValue: { fontSize: 16, fontWeight: '700' },
  metricSub: { fontSize: 11, marginTop: 2 },

  // F&G Card
  fgCard: {
    marginHorizontal: 16, marginTop: 8, backgroundColor: C.card,
    borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.cardBorder,
  },
  fgRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  fgLabel: { fontSize: 13, color: C.textDim, flex: 1 },
  fgValue: { fontSize: 20, fontWeight: '800', marginRight: 8 },
  fgChange: { fontSize: 12, fontWeight: '600' },
  fgBarBg: { height: 8, backgroundColor: C.surface, borderRadius: 4, overflow: 'hidden' },
  fgBarFill: { height: 8, borderRadius: 4 },
  fgLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  fgSmall: { fontSize: 10 },

  // Bias grid
  biasGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: 12, gap: 8,
  },
  biasCard: {
    backgroundColor: C.card, borderRadius: 10, padding: 12,
    flex: 1, minWidth: (width - 48) / 3, borderBottomWidth: 3,
    borderWidth: 1, borderColor: C.cardBorder, alignItems: 'center',
  },
  biasTfLabel: { fontSize: 12, fontWeight: '700', color: C.white, marginBottom: 4 },
  biasLabel: { fontSize: 14, fontWeight: '800' },
  biasScore: { fontSize: 11, color: C.textDim, marginTop: 2 },
  miniBarBg: { width: '100%', height: 3, backgroundColor: C.surface, borderRadius: 2, marginTop: 6, overflow: 'hidden' },
  miniBarFill: { height: 3, borderRadius: 2 },
  biasPill: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginRight: 8, alignItems: 'center' },
  biasTf: { fontSize: 12, fontWeight: '700', color: C.white },
  biasNet: { fontSize: 10, color: C.textDim },

  // Table
  table: { marginHorizontal: 16, marginTop: 4 },
  tableRow: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.cardBorder,
  },
  tableRowEven: { backgroundColor: C.surface + '40' },
  tableCell: {
    width: 120, paddingVertical: 8, paddingHorizontal: 6,
    flexDirection: 'row', alignItems: 'center',
  },
  tableCellInd: { width: 100, backgroundColor: C.card },
  tableHeaderCell: { backgroundColor: C.card, paddingVertical: 10 },
  tableHeaderText: { fontSize: 12, fontWeight: '700', color: C.accent },
  tableCellIndText: { fontSize: 11, fontWeight: '600', color: C.white },
  tableCellLabel: { fontSize: 10, marginLeft: 4, flex: 1 },
  tableCellDash: { fontSize: 12, color: C.textMuted },

  // Level cards
  levelCard: {
    marginHorizontal: 16, backgroundColor: C.card, borderRadius: 12,
    padding: 14, borderWidth: 1, borderColor: C.cardBorder,
  },
  levelRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: C.cardBorder + '60',
  },
  levelRowNear: { backgroundColor: C.accent + '10' },
  levelKey: { width: 60, fontSize: 13, fontWeight: '700', color: C.textDim },
  levelVal: { flex: 1, fontSize: 14, fontWeight: '600', color: C.text, fontVariant: ['tabular-nums'] },
  nearArrow: { fontSize: 14, color: C.accent, marginLeft: 4 },
  divider: { height: 1, backgroundColor: C.cardBorder, marginVertical: 8 },
  extTitle: { fontSize: 12, color: C.purple, fontWeight: '700', marginBottom: 4 },

  // Actions
  actions: {
    flexDirection: 'row', paddingHorizontal: 16, marginTop: 16, gap: 10,
  },
  copyBtn: {
    flex: 2, backgroundColor: C.accent, borderRadius: 10,
    padding: 14, alignItems: 'center',
  },
  copyBtnText: { color: C.bg, fontWeight: '800', fontSize: 14 },
  refreshBtn: {
    flex: 1, backgroundColor: C.surface, borderRadius: 10,
    padding: 14, alignItems: 'center', borderWidth: 1, borderColor: C.accent + '40',
  },
  refreshBtnText: { color: C.accent, fontWeight: '700', fontSize: 14 },

  // Loading
  loadingOverlay: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
  },
  loadingText: { color: C.text, fontSize: 16, marginTop: 16, fontWeight: '600' },
  loadingSubtext: { color: C.textDim, fontSize: 12, marginTop: 4 },

  // Last update
  lastUpdate: { textAlign: 'center', color: C.textMuted, fontSize: 11, marginTop: 12 },
});
