import { useState } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, ActivityIndicator, Clipboard, Alert } from 'react-native';
import { fetchAllOHLCV, tfSignals, TIMEFRAMES, FV } from './src/backend';
import MASTER_PROMPT from './src/masterPrompt';

export default function App() {
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState('');

  const compute = async () => {
    setLoading(true);
    try {
      const data = await fetchAllOHLCV();
      const currentPrice = data['1h'][data['1h'].length - 1].close;
      
      let out = MASTER_PROMPT.trim() + "\n\n";
      out += "╔══════════════════════════════════════════════════════════╗\n";
      out += `   BTC/USD EXPERT TA BLOCK v3 (NATIVE MOBILE) | ${new Date().toISOString()}\n`;
      out += "╚══════════════════════════════════════════════════════════╝\n";
      out += `\nPrice: ${FV(currentPrice)}\n`;

      let totalNet = 0;
      let totalMax = 0;

      for (const tf of TIMEFRAMES) {
        if (!data[tf] || data[tf].length === 0) continue;
        const res = tfSignals(tf, data[tf], currentPrice);
        totalNet += res.net;
        totalMax += Object.keys(res.sigs).length;
        
        out += `\n── ${tf} (net:${res.net > 0 ? '+' : ''}${res.net}) ──\n`;
        for (const [name, [score, label]] of Object.entries(res.sigs)) {
          const icon = score > 0 ? '✅' : (score < 0 ? '🔴' : '⚪');
          out += `  ${icon} ${name.padEnd(12)}: ${label}\n`;
        }
      }

      const pct = totalMax ? (totalNet / totalMax) * 100 : 0;
      const ov = pct > 60 ? '🟢 BULLISH' : (pct > 30 ? '🟡 MILD BULL' : (pct < -60 ? '🔴 BEARISH' : (pct < -30 ? '🟡 MILD BEAR' : '⚪ NEUTRAL')));
      out += `\n► OVERALL: ${ov}  (${totalNet > 0 ? '+' : ''}${totalNet}/${totalMax})\n`;
      out += "\n══ Paste into Claude — 7-layer refinement protocol ══";
      setOutput(out);
    } catch (e) {
      setOutput(`Error: ${e}`);
    }
    setLoading(false);
  };

  const copyToClipboard = () => {
    if (output) {
      Clipboard.setString(output);
      Alert.alert('Copied!', 'TA block + master prompt copied to clipboard.');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>₿ Expert TA Engine (Mobile)</Text>
      <Text style={styles.subtitle}>Master Prompt auto-loaded (389 lines)</Text>

      <TouchableOpacity style={styles.btn} onPress={compute} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>🔄 Fetch All Data & Compute</Text>}
      </TouchableOpacity>

      {output ? (
        <TouchableOpacity style={styles.copyBtn} onPress={copyToClipboard}>
          <Text style={styles.copyBtnText}>📋 Copy to Clipboard</Text>
        </TouchableOpacity>
      ) : null}

      <ScrollView style={styles.outputBox}>
        <Text style={styles.outputText} selectable={true}>{output || 'TA Data Block will appear here...'}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111', paddingTop: 60, paddingHorizontal: 15 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#fff', marginBottom: 5, textAlign: 'center' },
  subtitle: { fontSize: 13, color: '#888', marginBottom: 15, textAlign: 'center' },
  btn: { backgroundColor: '#f7931a', padding: 15, borderRadius: 8, alignItems: 'center', marginBottom: 10 },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  copyBtn: { backgroundColor: '#333', padding: 12, borderRadius: 8, alignItems: 'center', marginBottom: 10 },
  copyBtnText: { color: '#0f0', fontWeight: 'bold', fontSize: 14 },
  outputBox: { flex: 1, backgroundColor: '#000', borderRadius: 8, padding: 15, marginBottom: 20 },
  outputText: { color: '#0f0', fontFamily: 'monospace', fontSize: 13 }
});
