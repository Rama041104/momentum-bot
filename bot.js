const https     = require("https");
const http      = require("http");
const WebSocket = require("ws");

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";
const SYMBOL              = "xautusdt";
const TIMEFRAMES          = ["5m", "15m"];
const PORT                = process.env.PORT || 3000;

const CONFIG = {
  "5m":  { minBodyPip: 35, pipSize: 0.1, label: "M5"  },
  "15m": { minBodyPip: 45, pipSize: 0.1, label: "M15" },
};

const lastAlertTime = {};
const COOLDOWN_MS   = 5 * 60 * 1000;

function sendDiscord(embed) {
  return new Promise((resolve, reject) => {
    if (!DISCORD_WEBHOOK_URL) { console.warn("[DISCORD] belum diset!"); return resolve(0); }
    const payload = JSON.stringify({ embeds: [embed] });
    const url     = new URL(DISCORD_WEBHOOK_URL);
    const req     = https.request({ hostname: url.hostname, path: url.pathname + url.search, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } }, (res) => resolve(res.statusCode));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function buildEmbed(signal) {
  const isBull = signal.direction === "bullish";
  const color  = isBull ? 0x00c853 : 0xff1744;
  const arrow  = isBull ? "🟢 BULLISH" : "🔴 BEARISH";
  const slDist = signal.cfg.minBodyPip * signal.cfg.pipSize;
  const tp = isBull ? (signal.close + slDist).toFixed(2) : (signal.close - slDist).toFixed(2);
  const sl = isBull ? (signal.close - slDist).toFixed(2) : (signal.close + slDist).toFixed(2);
  return {
    title: `${arrow} MOMENTUM CANDLE — XAUUSDT`,
    color,
    fields: [
      { name: "⚡ Action",      value: isBull ? "BUY" : "SELL",             inline: true  },
      { name: "💰 Close Price", value: `$${signal.close.toFixed(2)}`,        inline: true  },
      { name: "📊 Timeframe",   value: signal.cfg.label,                     inline: true  },
      { name: "🎯 TP (est.)",   value: `$${tp}`,                             inline: true  },
      { name: "🛡️ SL (est.)",   value: `$${sl}`,                             inline: true  },
      { name: "⚠️ Risk",        value: "1% — max 1 trade/sesi",             inline: true  },
      { name: "📝 Catatan",     value: "Candle sudah CLOSE. Konfirmasi dulu sebelum entry!", inline: false },
    ],
    footer: { text: "Momentum Candle Bot • Rama Trading • The5ers Phase 1" },
    timestamp: new Date().toISOString(),
  };
}

function checkMomentumCandle(candle, cfg) {
  const open  = parseFloat(candle.o);
  const high  = parseFloat(candle.h);
  const low   = parseFloat(candle.l);
  const close = parseFloat(candle.c);
  const body      = Math.abs(close - open);
  const upperWick = high - Math.max(open, close);
  const lowerWick = Math.min(open, close) - low;
  const totalWick = upperWick + lowerWick;
  const wickRatio = totalWick / (body + totalWick);
  const isBig     = body >= cfg.minBodyPip * cfg.pipSize;
  const isShort   = wickRatio <= 0.3;
  const isBull    = close > open;
  const isBear    = close < open;
  const bullValid = isBull && lowerWick < upperWick;
  const bearValid = isBear && upperWick < lowerWick;
  if (isBig && isShort && (bullValid || bearValid)) {
    return { direction: bullValid ? "bullish" : "bearish", close, body, wickRatio, cfg };
  }
  return null;
}

function connectBinance(interval) {
  const cfg = CONFIG[interval];
  const ws  = new WebSocket(`wss://stream.binance.com:9443/ws/${SYMBOL}@kline_${interval}`);
  ws.on("open",    () => console.log(`[${cfg.label}] ✅ Connected`));
  ws.on("close",   () => { console.log(`[${cfg.label}] Reconnecting...`); setTimeout(() => connectBinance(interval), 5000); });
  ws.on("error",   (e) => console.error(`[${cfg.label}] Error:`, e.message));
  ws.on("message", async (raw) => {
    try {
      const kline = JSON.parse(raw).k;
      if (!kline.x) return;
      const signal = checkMomentumCandle(kline, cfg);
      if (!signal) return;
      const key = `${interval}_${signal.direction}`;
      const now = Date.now();
      if (lastAlertTime[key] && now - lastAlertTime[key] < COOLDOWN_MS) return;
      lastAlertTime[key] = now;
      console.log(`[${cfg.label}] 🔔 ${signal.direction.toUpperCase()} @ $${signal.close.toFixed(2)}`);
      await sendDiscord(buildEmbed(signal));
    } catch (e) { console.error(e.message); }
  });
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end(`✅ Momentum Candle Bot aktif\nUptime: ${Math.floor(process.uptime()/60)} menit\n`);
});

server.listen(PORT, () => {
  console.log(`🚀 Bot jalan di port ${PORT}`);
  TIMEFRAMES.forEach((tf) => connectBinance(tf));
});
