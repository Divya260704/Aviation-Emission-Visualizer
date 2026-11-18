import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Line, Bar } from "react-chartjs-2";
import "chart.js/auto";
import FlightMap from "./FlightMap";

const SAFE_THRESHOLD = 800;
const TOXIC_THRESHOLD = 1200;
const GAUGE_MAX = 2000;

function hourLabels() {
  return Array.from({ length: 24 }, (_, i) => (i === 23 ? "23:59" : `${String(i).padStart(2, "0")}:00`));
}

function levelFromValue(v) {
  if (v >= TOXIC_THRESHOLD) return "Danger";
  if (v >= SAFE_THRESHOLD) return "Medium";
  return "Safe";
}

function Speedometer({ value, theme }) {
  const v = Math.max(0, Math.min(Number(value) || 0, GAUGE_MAX));

  // Gauge arc: 270 degrees across the top.
  const startAngle = 135;
  const endAngle = 405;
  const angle = startAngle + (v / GAUGE_MAX) * (endAngle - startAngle);

  const safeAngleEnd = startAngle + (SAFE_THRESHOLD / GAUGE_MAX) * (endAngle - startAngle);
  const toxicAngleEnd = startAngle + (TOXIC_THRESHOLD / GAUGE_MAX) * (endAngle - startAngle);

  const cx = 80;
  const cy = 80;
  const r = 70;
  const strokeW = 14;
  const needleLen = 58;

  const polar = (radius, aDeg) => {
    const rad = (aDeg * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  };

  const arcPath = (a0, a1) => {
    const p0 = polar(r, a0);
    const p1 = polar(r, a1);
    const largeArcFlag = Math.abs(a1 - a0) > 180 ? 1 : 0;
    const sweepFlag = 1;
    return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${largeArcFlag} ${sweepFlag} ${p1.x} ${p1.y}`;
  };

  // Tick marks + labels (car-speedometer style).
  const ticks = [];
  const majorEvery = 400;
  const minorEvery = 100;
  const tickMajorColor = theme === "dark" ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.75)";
  const tickMinorColor = theme === "dark" ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.25)";
  for (let val = 0; val <= GAUGE_MAX; val += minorEvery) {
    const pct = val / GAUGE_MAX;
    const a = startAngle + pct * (endAngle - startAngle);
    const isMajor = val % majorEvery === 0;
    const r1 = isMajor ? 58 : 64;
    const pA = polar(r1, a);
    const pB = polar(r, a);
    ticks.push(
      <line
        key={`tick-${val}`}
        x1={pA.x}
        y1={pA.y}
        x2={pB.x}
        y2={pB.y}
        stroke={isMajor ? tickMajorColor : tickMinorColor}
        strokeWidth={isMajor ? 3 : 2}
        strokeLinecap="round"
      />,
    );
  }

  const green = theme === "dark" ? "#22c55e" : "#16a34a";
  const yellow = theme === "dark" ? "#fbbf24" : "#d97706";
  const red = theme === "dark" ? "#ef4444" : "#dc2626";

  const needleColor = theme === "dark" ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.72)";
  const centerBg = theme === "dark" ? "#0f172a" : "#ffffff";
  const centerBorder = theme === "dark" ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)";

  return (
    <div style={{ width: 240, padding: 16, borderRadius: 12, border: "1px solid rgba(255,255,255,0.15)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontWeight: 700 }}>Current CO2</div>
        <div style={{ color: "rgba(255,255,255,0.8)", fontSize: 12 }}>gauge</div>
      </div>

      <div style={{ position: "relative", width: 160, height: 160, marginTop: 10, marginLeft: "auto", marginRight: "auto" }}>
        <svg width="160" height="160" viewBox="0 0 160 160">
          {/* Outer rim + inner glass */}
          <circle cx={cx} cy={cy} r={76} fill="none" stroke={theme === "dark" ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.15)"} strokeWidth="6" />
          <circle cx={cx} cy={cy} r={62} fill={theme === "dark" ? "rgba(15,23,42,0.88)" : "rgba(248,250,252,0.95)"} stroke={centerBorder} strokeWidth="2" />

          {/* Color arc */}
          <path d={arcPath(startAngle, safeAngleEnd)} stroke={green} strokeWidth={strokeW} fill="none" strokeLinecap="round" />
          <path d={arcPath(safeAngleEnd, toxicAngleEnd)} stroke={yellow} strokeWidth={strokeW} fill="none" strokeLinecap="round" />
          <path d={arcPath(toxicAngleEnd, endAngle)} stroke={red} strokeWidth={strokeW} fill="none" strokeLinecap="round" />

          {ticks}

          <g
            style={{ transform: `rotate(${angle}deg)`, transition: "transform 850ms ease-in-out", transformOrigin: `${cx}px ${cy}px` }}
          >
            {/* triangular needle (points right when angle=0) */}
            <polygon
              points={`${cx + 6},${cy - 7} ${cx + 6},${cy + 7} ${cx + needleLen},${cy}`}
              fill={needleColor}
              stroke="rgba(96,165,250,0.35)"
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
            <line x1={cx + 4} y1={cy} x2={cx + needleLen} y2={cy} stroke="rgba(96,165,250,0.35)" strokeWidth={1} strokeLinecap="round" />
          </g>

          <circle cx={cx} cy={cy} r={14} fill={centerBg} stroke={centerBorder} strokeWidth={2} />
        </svg>

        <div
          style={{
            position: "absolute",
            // Keep this overlay only for the center cap.
            // A large inset can cover the needle.
            inset: 42,
            borderRadius: 999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: 4,
            background: theme === "dark" ? "#0f172a" : "#ffffff",
            border: `1px solid ${centerBorder}`,
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: 18,
              fontWeight: 900,
              color:
                levelFromValue(Number(value || 0)) === "Safe"
                  ? "#22c55e"
                  : levelFromValue(Number(value || 0)) === "Medium"
                    ? "#fbbf24"
                    : "#ef4444",
            }}
          >
            {levelFromValue(Number(value || 0)).toUpperCase()}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "rgba(255,255,255,0.85)" }}>Safe</span>
          <span style={{ color: green, fontWeight: 700 }}>{`< ${SAFE_THRESHOLD}`}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "rgba(255,255,255,0.85)" }}>Medium</span>
          <span style={{ color: yellow, fontWeight: 700 }}>{`${SAFE_THRESHOLD} - ${TOXIC_THRESHOLD - 1}`}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "rgba(255,255,255,0.85)" }}>Toxic</span>
          <span style={{ color: red, fontWeight: 700 }}>{`>= ${TOXIC_THRESHOLD}`}</span>
        </div>
      </div>
    </div>
  );
}

function FlightTable({ theme, flights, selectedFlightId, onSelectFlight }) {
  const bg = theme === "dark" ? "#0f172a" : "#ffffff";
  const border = theme === "dark" ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)";
  const text = theme === "dark" ? "white" : "black";
  const headerBg = theme === "dark" ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.02)";
  const [tab, setTab] = React.useState("all");

  if (!flights || flights.length === 0) {
    return (
      <div style={{ flex: 1, padding: 16, borderRadius: 12, border: `1px solid ${border}`, background: bg, textAlign: "center", color: text }}>
        No flights currently in the tracked region.
      </div>
    );
  }

  const chennaiFlights = flights.filter(f => f.is_chennai);
  const arrivals   = chennaiFlights.filter(f => f.dest   === "MAA" || f.dest   === "VOMM" || String(f.status||"").toLowerCase().includes("approach") || String(f.status||"").toLowerCase().includes("land"));
  const departures = chennaiFlights.filter(f => f.origin === "MAA" || f.origin === "VOMM" || String(f.status||"").toLowerCase().includes("depart") || String(f.status||"").toLowerCase().includes("takeoff"));
  const displayFlights = tab === "arrivals" ? arrivals : tab === "departures" ? departures : chennaiFlights;

  const tabStyle = (t) => ({
    padding: "6px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", border: "none",
    background: tab === t ? "rgba(96,165,250,0.25)" : "transparent",
    color: tab === t ? "#60a5fa" : (theme === "dark" ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.4)"),
    transition: "all 0.15s",
  });

  return (
    <div style={{ flex: 1, width: "100%", overflowX: "auto", borderRadius: 12, border: `1px solid ${border}`, background: bg }}>
      <div style={{ padding: "16px 16px 0 16px", color: text, fontWeight: 800, fontSize: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span>Chennai Airport (MAA) — Live Flight Board</span>
            <span style={{
              padding: "3px 10px", borderRadius: 99, fontSize: 13, fontWeight: 800,
              background: "rgba(96,165,250,0.18)", color: "#60a5fa", border: "1px solid rgba(96,165,250,0.3)"
            }}>
              {chennaiFlights.length} flights
            </span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 500, opacity: 0.7 }}>Click a row to track · Auto-refreshes 10s</div>
      </div>
      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, padding: "10px 16px", borderBottom: `1px solid ${border}` }}>
        <button style={tabStyle("all")}       onClick={() => setTab("all")}>All ({chennaiFlights.length})</button>
        <button style={tabStyle("arrivals")}  onClick={() => setTab("arrivals")}>Arrivals ({arrivals.length})</button>
        <button style={tabStyle("departures")} onClick={() => setTab("departures")}>Departures ({departures.length})</button>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", color: text, textAlign: "left", whiteSpace: "nowrap" }}>
        <thead>
          <tr style={{ background: headerBg, borderBottom: `1px solid ${border}` }}>
            <th style={{ padding: "12px 16px", fontWeight: 700 }}>Flight</th>
            <th style={{ padding: "12px 16px", fontWeight: 700 }}>Route Schedule</th>
            <th style={{ padding: "12px 16px", fontWeight: 700 }}>Operator</th>
            <th style={{ padding: "12px 16px", fontWeight: 700 }}>Aircraft Details</th>
            <th style={{ padding: "12px 16px", fontWeight: 700 }}>Status</th>
            <th style={{ padding: "12px 16px", fontWeight: 700 }}>Telemetry (Alt/Spd)</th>
            <th style={{ padding: "12px 16px", fontWeight: 700 }}>Last Ping</th>
          </tr>
        </thead>
        <tbody>
          {displayFlights.length === 0 ? (
            <tr>
              <td colSpan="7" style={{ padding: "32px", textAlign: "center", fontStyle: "italic", opacity: 0.7, fontWeight: 600 }}>
                No {tab === "all" ? "" : tab} flights found for Chennai Airport (MAA).
              </td>
            </tr>
          ) : displayFlights.map((f, i, arr) => {
            const statusStr = f.status || "Unknown";
            const isRed = statusStr.includes("Approach") || statusStr.includes("Land");
            const isGreen = statusStr.includes("Takeoff") || statusStr.includes("Depart");
            const isYellow = statusStr.includes("Taxi") || statusStr.includes("Load");
            const sBg = isRed ? "rgba(239,68,68,0.2)" : isGreen ? "rgba(34,197,94,0.2)" : isYellow ? "rgba(245,158,11,0.2)" : "rgba(96,165,250,0.15)";
            const sC = isRed ? (theme==="dark"?"#fca5a5":"#dc2626") : isGreen ? (theme==="dark"?"#86efac":"#16a34a") : isYellow ? (theme==="dark"?"#fcd34d":"#d97706") : (theme==="dark"?"#93c5fd":"#2563eb");
            const isSelected = selectedFlightId === f.id;
            const rowBg = isSelected
              ? (theme === "dark" ? "rgba(250,204,21,0.10)" : "rgba(234,179,8,0.10)")
              : "transparent";
            const rowBorder = isSelected ? `rgba(250,204,21,0.4)` : (i < arr.length - 1 ? border : "none");

            return (
              <tr
                key={f.id}
                style={{ borderBottom: `1px solid ${rowBorder}`, transition: "background 0.2s", background: rowBg, cursor: "pointer" }}
                className="hover-tr"
                onClick={() => onSelectFlight && onSelectFlight(f)}
                title="Click to track this flight on the map"
              >
                <td style={{ padding: "12px 16px", fontWeight: 800 }}>
                  {isSelected && <span style={{ marginRight: 6, color: "#facc15" }}>📍</span>}
                  {f.callsign || "Unknown"}
                </td>
                <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 700 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                    <span style={{ color: theme === 'dark' ? '#93c5fd' : '#2563eb' }}>{f.origin || '-'}</span>
                    <span style={{ opacity: 0.8, fontFamily: 'monospace' }}>Dep: {f.dep_time || '-'}</span>
                  </div>
                  <div style={{ opacity: 0.5, fontSize: 10 }}>&darr;</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                    <span style={{ color: theme === 'dark' ? '#86efac' : '#16a34a' }}>{f.dest || '-'}</span>
                    <span style={{ opacity: 0.8, fontFamily: 'monospace' }}>Arr: {f.eta || '-'}</span>
                  </div>
                </td>
                <td style={{ padding: "12px 16px", fontWeight: 600 }}>{f.airline || "-"}</td>
                <td style={{ padding: "12px 16px", opacity: 0.9 }}>{!f.ac_type || f.ac_type === "Unknown" ? "Jet / Unknown" : f.ac_type}</td>
                <td style={{ padding: "12px 16px" }}>
                    <span style={{ padding: "6px 10px", borderRadius: 8, fontSize: 13, fontWeight: 800, background: sBg, color: sC }}>
                        {statusStr}
                    </span>
                </td>
                <td style={{ padding: "12px 16px", fontSize: 14, opacity: 0.85 }}>{Math.round(f.altitude || 0)}m / {Math.round(f.velocity || 0)}m/s</td>
                <td style={{ padding: "12px 16px", fontSize: 13 }}>
                  <div style={{ opacity: 0.8, fontWeight: 600 }}>{f.last_seen || "-"}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ChartCard({ title, theme, children, badge }) {
  const bg = theme === "dark" ? "#0f172a" : "#ffffff";
  const border = theme === "dark" ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)";
  const text = theme === "dark" ? "white" : "black";
  const sub = theme === "dark" ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.45)";
  return (
    <div style={{ flex: 1, minWidth: 0, padding: 16, borderRadius: 12, border: `1px solid ${border}`, background: bg }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ color: text, fontWeight: 800 }}>{title}</div>
        {badge && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px", borderRadius: 99, border: `1.5px solid ${badge.color}`, background: `${badge.color}18` }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: sub }}>Pollution Index</span>
            <span style={{ fontSize: 15, fontWeight: 900, color: badge.color }}>{badge.index}</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: badge.color }}>{badge.label}</span>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function LineChart({ theme, labels, series, lineLabel, extraSeries }) {
  const text = theme === "dark" ? "white" : "black";
  const grid = theme === "dark" ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)";
  const lineColor = theme === "dark" ? "#60a5fa" : "#2563eb";

  const extra = extraSeries
    ? [
      {
        label: extraSeries.label,
        data: extraSeries.data,
        borderColor: extraSeries.borderColor,
        backgroundColor: extraSeries.backgroundColor,
        borderWidth: extraSeries.borderWidth || 2,
        tension: extraSeries.tension || 0.2,
        pointRadius: extraSeries.pointRadius || 1,
        borderDash: extraSeries.borderDash || [6, 6],
        spanGaps: false,
      },
    ]
    : [];

  return (
    <Line
      data={{
        labels,
        datasets: [
          ...extra,
          {
            label: lineLabel,
            data: series,
            borderColor: lineColor,
            backgroundColor: "rgba(96,165,250,0.15)",
            borderWidth: 2,
            tension: 0.2,
            pointRadius: 5,
            pointHoverRadius: 7,
            pointBackgroundColor: lineColor,
            pointBorderColor: "#ffffff",
            pointBorderWidth: 1.5,
            spanGaps: false,
          },
          {
            label: "Safe limit (800)",
            data: labels.map(() => SAFE_THRESHOLD),
            borderColor: "rgba(34,197,94,0.95)",
            borderWidth: 1,
            borderDash: [6, 6],
            pointRadius: 0,
            spanGaps: false,
          },
          {
            label: "Toxic limit (1200)",
            data: labels.map(() => TOXIC_THRESHOLD),
            borderColor: "rgba(239,68,68,0.95)",
            borderWidth: 1,
            borderDash: [6, 6],
            pointRadius: 0,
            spanGaps: false,
          },
        ],
      }}
      options={{
        responsive: true,
        plugins: {
          legend: { labels: { color: text } },
          tooltip: { enabled: true },
        },
        scales: {
          x: {
            ticks: { color: text, autoSkip: false, maxRotation: 45, minRotation: 45, font: { size: 11 } },
            grid: { color: grid },
          },
          y: {
            ticks: { color: text },
            grid: { color: grid },
            title: { display: true, text: "CO2 (ppm)", color: text, font: { size: 11 } },
          },
        },
      }}
    />
  );
}

function PredictionChart({ theme, hours, actual, prediction }) {
  const isDark = theme === "dark";
  const text = isDark ? "rgba(255,255,255,0.65)" : "rgba(0,0,0,0.55)";
  const grid = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";

  return (
    <Line
      data={{
        labels: hours,
        datasets: [
          {
            label: "Today (Actual CO2)",
            data: actual,
            borderColor: isDark ? "#4ade80" : "#16a34a",
            backgroundColor: "transparent",
            borderWidth: 2.5,
            pointRadius: 0,
            tension: 0.4,
          },
          {
            label: "Tomorrow (AI Prediction)",
            data: prediction,
            borderColor: isDark ? "#818cf8" : "#4f46e5",
            backgroundColor: isDark ? "rgba(129,140,248,0.12)" : "rgba(79,70,229,0.10)",
            borderWidth: 3,
            fill: true,
            pointRadius: 0,
            tension: 0.4,
          },
        ],
      }}
      options={{
        responsive: true,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            position: "top",
            labels: { color: text, boxWidth: 12, padding: 16, font: { size: 12 } },
          },
          tooltip: {
            enabled: true,
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${Number(ctx.raw).toFixed(1)} ppm`,
            },
          },
        },
        scales: {
          x: {
            ticks: { color: text, font: { size: 11 }, autoSkip: false, maxRotation: 45, minRotation: 45 },
            grid: { color: grid },
          },
          y: {
            ticks: { color: text, font: { size: 11 } },
            grid: { color: grid },
            title: { display: true, text: "CO2 (ppm)", color: text, font: { size: 11 } },
          },
        },
      }}
    />
  );
}

function HistoricalAnalyticsView({ theme, history }) {
  const isDark = theme === "dark";
  const text = isDark ? "rgba(255,255,255,0.65)" : "rgba(0,0,0,0.55)";
  const grid = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const cardBg = isDark ? "#0f172a" : "#ffffff";
  const border = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)";

  const labels = history.map((d) => d.date);
  const avgData = history.map((d) => d.avg);
  const peakData = history.map((d) => d.peak);

  return (
    <div style={{ flex: 1, padding: 24, borderRadius: 12, border: `1px solid ${border}`, background: cardBg, marginBottom: 16 }}>
      <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 16 }}>7-Day Historical Analytics (CO2 ppm)</div>
      <div style={{ height: 400 }}>
        <Bar
          data={{
            labels,
            datasets: [
              {
                type: "line",
                label: "Daily Peak Emission",
                data: peakData,
                borderColor: isDark ? "#f87171" : "#ef4444",
                borderWidth: 3,
                fill: false,
                tension: 0.2,
                pointRadius: 5,
                pointBackgroundColor: isDark ? "#f87171" : "#ef4444",
              },
              {
                type: "bar",
                label: "Daily Average Emission",
                data: avgData,
                backgroundColor: isDark ? "rgba(96,165,250,0.8)" : "rgba(59,130,246,0.7)",
                borderRadius: 4,
              },
            ],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: "top", labels: { color: text, font: { weight: 'bold' } } },
              tooltip: { mode: "index", intersect: false },
            },
            scales: {
              x: { ticks: { color: text }, grid: { display: false } },
              y: {
                ticks: { color: text },
                grid: { color: grid },
                title: { display: true, text: "CO2 (ppm)", color: text, font: { weight: 'bold' } },
              },
            },
          }}
        />
      </div>
    </div>
  );
}


function App() {
  const [theme, setTheme] = useState("dark");
  const [activeTab, setActiveTab] = useState("realtime");
  const [historical, setHistorical] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [latest, setLatest] = useState({ co2: 0, datetime: "", level: "Safe" });
  const [realtime, setRealtime] = useState({ date: "", hours: hourLabels(), co2: Array(24).fill(null) });
  const [prediction, setPrediction] = useState({
    base_date: "",
    date: "",
    hours: hourLabels(),
    prediction: Array(24).fill(0),
    prediction_base: Array(24).fill(0),
  });
  const [flights, setFlights] = useState([]);
  const [weather, setWeather] = useState({});
  const [pollutionData, setPollutionData] = useState(null);
  const [selectedFlight, setSelectedFlight] = useState(null);
  const [flyKey, setFlyKey] = useState(0);
  const mapSectionRef = React.useRef(null);

  const apiBases = useMemo(() => ["http://127.0.0.1:8002", "http://127.0.0.1:8001", "http://127.0.0.1:8000"], []);

  const todayStr = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);

  async function fetchWithFallback(path) {
    let lastErr = null;
    for (const base of apiBases) {
      try {
        const res = await axios.get(`${base}${path}`);
        return res.data;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("All API endpoints failed");
  }

  async function fetchAll() {
    const realtimePath = `/hourly/realtime?date=${encodeURIComponent(todayStr)}`;
    const predictionPath = `/hourly/prediction?date=${encodeURIComponent(todayStr)}`;

    const [ldata, rdata, pdata, fdata, hdata, adata] = await Promise.all([
      fetchWithFallback("/latest"),
      fetchWithFallback(realtimePath),
      fetchWithFallback(predictionPath),
      fetchWithFallback("/flights").catch(() => ({ flights: [] })),
      fetchWithFallback("/historical").catch(() => ({ history: [] })),
      fetchWithFallback("/alerts").catch(() => ({ alerts: [] })),
    ]);

    setLatest(ldata);
    setRealtime(rdata);
    setPrediction(pdata);
    setFlights(fdata.flights || []);
    setHistorical(hdata.history || []);
    setAlerts(adata.alerts || []);
    const w = ldata.weather || {};
    setWeather(w);

    // Auto-run multivariate pollution prediction with live sensor + weather values
    try {
      const lco2 = ldata.co2 || 400;
      const q = new URLSearchParams({
        co2: String(Math.round(lco2)),
        temperature: String(w.temperature ?? 32),
        humidity: String(w.humidity ?? 65),
        pressure: String(w.pressure ?? 1010),
        wind_speed: String(w.wind_speed ?? 10),
      }).toString();
      const pr = await fetchWithFallback(`/predict?${q}`);
      setPollutionData(pr);
    } catch(e) {
      console.warn("Pollution predict failed:", e);
    }
  }

  useEffect(() => {
    fetchAll().catch((e) => console.error("Initial fetch failed:", e));
    const interval = setInterval(() => {
      fetchAll().catch((e) => console.error("Refresh failed:", e));
    }, 10000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const downloadCsv = async () => {
    const day = realtime?.date;
    if (!day) return;

    let lastErr = null;
    for (const base of apiBases) {
      try {
        const res = await axios.get(`${base}/csv?date=${encodeURIComponent(day)}`, {
          responseType: "blob",
        });
        const blob = new Blob([res.data], { type: "text/csv" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `co2_${day}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) console.error("CSV download failed:", lastErr);
  };

  const pageBg = theme === "dark" ? "#0b1220" : "#f8fafc";
  const pageText = theme === "dark" ? "white" : "black";
  const cardBg = theme === "dark" ? "#0f172a" : "#ffffff";
  const border = theme === "dark" ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)";
  const text = theme === "dark" ? "white" : "black";

  const [, setTimeTick] = useState(0);
  const [timeBaseMs, setTimeBaseMs] = useState(null);
  const [timeFetchedAtMs, setTimeFetchedAtMs] = useState(null);

  const parseBackendDatetime = (s) => {
    if (!s) return null;
    const str = String(s).trim();
    if (!str.includes(" ")) return null;
    const [datePart, timePart] = str.split(" ");
    const [Y, M, D] = datePart.split("-").map((x) => Number(x));
    const [hh, mm, ss] = timePart.split(":").map((x) => Number(x));
    if ([Y, M, D, hh, mm, ss].some((n) => Number.isNaN(n))) return null;
    return new Date(Y, M - 1, D, hh, mm, ss).getTime();
  };

  const formatLocalDatetime = (ms) => {
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  useEffect(() => {
    const parsed = parseBackendDatetime(latest.datetime);
    if (parsed !== null) {
      setTimeBaseMs(parsed);
      setTimeFetchedAtMs(Date.now());
    }
  }, [latest.datetime]);

  useEffect(() => {
    const id = setInterval(() => setTimeTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const displayMs =
    timeBaseMs !== null && timeFetchedAtMs !== null
      ? timeBaseMs + (Date.now() - timeFetchedAtMs)
      : null;

  const displayDatetime = displayMs !== null ? formatLocalDatetime(displayMs) : (latest.datetime || "-");

  const baseDate = displayMs !== null ? new Date(displayMs) : new Date();
  const currentHour = baseDate.getHours(); // 0..23

  // Realtime: full 24-hour X axis, only plot hours that have real avg data
  const fullHourLabels = realtime?.hours || hourLabels();
  const rawCo2 = realtime?.co2 || Array(24).fill(null);
  // Null out any future hours beyond current hour
  const realtimeSeries = Array.from({ length: 24 }, (_, i) => {
    if (i > currentHour) return null;   // future — no data yet
    return rawCo2[i] ?? null;           // null if no reading for that hour
  });
  const realtimeLabels = fullHourLabels;
  const tomorrowPredictedForCurrentHour =
    Array.isArray(prediction?.prediction) && prediction.prediction.length >= 24
      ? prediction.prediction[currentHour]
      : null;

  return (
    <div style={{ background: pageBg, color: pageText, minHeight: "100vh", padding: 20 }}>
      {/* CSS for hover row style in table */}
      <style>{`.hover-tr:hover { background: ${theme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'} !important }`}</style>

      {/* ─── Header & Tabs ─── */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ fontSize: 22, fontWeight: 900 }}>Aviation Emission Visualizer</div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            style={{
              padding: "10px 14px", borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.2)",
              background: theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
              color: pageText, cursor: "pointer", fontWeight: 700,
            }}
          >
            Toggle theme
          </button>
          <button
            onClick={downloadCsv}
            style={{
              padding: "10px 14px", borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.2)",
              background: theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
              color: pageText, cursor: "pointer", fontWeight: 700,
            }}
          >
            Download CO2 CSV
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, borderBottom: `1px solid ${border}`, paddingBottom: 12 }}>
        <div 
          onClick={() => setActiveTab('realtime')}
          style={{ padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 800, background: activeTab === 'realtime' ? (theme === 'dark' ? '#3b82f6' : '#2563eb') : 'transparent', color: activeTab === 'realtime' ? 'white' : pageText }}
        >
          Realtime Dashboard
        </div>
        <div 
          onClick={() => setActiveTab('historical')}
          style={{ padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 800, background: activeTab === 'historical' ? (theme === 'dark' ? '#3b82f6' : '#2563eb') : 'transparent', color: activeTab === 'historical' ? 'white' : pageText }}
        >
          Historical Trends & Analytics
        </div>
      </div>

      {/* Alerts Banner */}
      {alerts && alerts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          {alerts.map(al => {
            const isDanger = al.type === 'danger';
            const bg = isDanger ? (theme === 'dark' ? 'rgba(239,68,68,0.2)' : 'rgba(254,226,226,1)') : (theme === 'dark' ? 'rgba(245,158,11,0.2)' : 'rgba(254,243,199,1)');
            const br = isDanger ? (theme === 'dark' ? 'rgba(239,68,68,0.4)' : 'rgba(248,113,113,1)') : (theme === 'dark' ? 'rgba(245,158,11,0.4)' : 'rgba(252,211,77,1)');
            const col = isDanger ? (theme === 'dark' ? '#fca5a5' : '#991b1b') : (theme === 'dark' ? '#fde68a' : '#92400e');
            return (
              <div key={al.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: 8, background: bg, border: `1px solid ${br}`, color: col }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 20 }}>{isDanger ? '⚠️' : '🔔'}</span>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>{al.title}</div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{al.message}</div>
                  </div>
                </div>
                <div style={{ fontWeight: 700, fontSize: 13, opacity: 0.8, background: 'rgba(0,0,0,0.1)', padding: '4px 10px', borderRadius: 6 }}>{al.time}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Conditionally Render Content */}
      {activeTab === 'historical' ? (
        <HistoricalAnalyticsView theme={theme} history={historical} />
      ) : (
        <>
      {/* ═══════════════════════════════════════════════
          SECTION 1 — CO2 Realtime
      ═══════════════════════════════════════════════ */}
      <div style={{ display: "flex", gap: 16, marginBottom: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <Speedometer value={latest.co2} theme={theme} />

        <div style={{ flex: 1, minWidth: 320, padding: 16, borderRadius: 12, border: `1px solid ${border}`, background: cardBg }}>
          <div style={{ fontWeight: 900, marginBottom: 8, fontSize: 16 }}>CO₂ Realtime Status</div>
          <div style={{ opacity: 0.9, marginBottom: 14, fontSize: 13 }}>
            Realtime day: <b>{realtime.date || "—"}</b> &nbsp;|&nbsp; Prediction day: <b>{prediction.date || "—"}</b>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
            <div>
              <div style={{ opacity: 0.75, fontSize: 12 }}>Current CO₂</div>
              <div style={{ fontWeight: 900, fontSize: 28, lineHeight: 1.1 }}>{Number(latest.co2 || 0).toFixed(0)}</div>
              <div style={{ fontSize: 12, opacity: 0.5 }}>ppm</div>
              <div style={{ fontWeight: 800, marginTop: 4, color: latest.level === "Safe" ? "#22c55e" : latest.level === "Medium" ? "#fbbf24" : "#ef4444" }}>{latest.level}</div>
            </div>
            <div>
              <div style={{ opacity: 0.75, fontSize: 12 }}>Last Reading</div>
              <div style={{ fontWeight: 800, whiteSpace: "nowrap", fontSize: 13 }}>{displayDatetime}</div>
            </div>
          </div>

          {/* ── Live Insights Panel ── */}
          {(() => {
            const co2Val = Number(latest.co2 || 0);
            const validBuckets = (realtime?.co2 || []).filter(v => v !== null && v !== undefined);
            const peakCo2 = realtime?.peak !== null && realtime?.peak !== undefined ? realtime.peak : null;
            const minCo2  = realtime?.min !== null && realtime?.min !== undefined ? realtime.min : null;
            const avgCo2  = realtime?.avg !== null && realtime?.avg !== undefined ? realtime.avg : null;
            const maaFlights = (flights||[]).filter(f=>f.is_chennai).length;
            const airborne  = (flights||[]).filter(f=>f.is_chennai && !String(f.status||'').toLowerCase().includes('park') && !String(f.status||'').toLowerCase().includes('load') && !String(f.status||'').toLowerCase().includes('ground')).length;
            const healthTip = co2Val >= TOXIC_THRESHOLD
              ? { icon: '🚨', color: '#ef4444', msg: 'Hazardous — avoid outdoor activity near the airport zone.' }
              : co2Val >= SAFE_THRESHOLD
              ? { icon: '⚠️', color: '#fbbf24', msg: 'Elevated CO2 — sensitive groups should limit exposure.' }
              : { icon: '✅', color: '#22c55e', msg: 'Air quality is good. Safe for all activities.' };
            const trend = validBuckets.length >= 2
              ? validBuckets[validBuckets.length-1] > validBuckets[validBuckets.length-2] ? '↑ Rising' : validBuckets[validBuckets.length-1] < validBuckets[validBuckets.length-2] ? '↓ Falling' : '→ Stable'
              : '—';
            const trendColor = trend.startsWith('↑') ? '#ef4444' : trend.startsWith('↓') ? '#22c55e' : '#60a5fa';
            return (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${border}` }}>
                <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Live Insights</div>
                {/* Health advisory */}
                <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', borderRadius:8, background:`${healthTip.color}15`, border:`1px solid ${healthTip.color}40`, marginBottom:8 }}>
                  <span style={{fontSize:16}}>{healthTip.icon}</span>
                  <span style={{fontSize:12, color:healthTip.color, fontWeight:600}}>{healthTip.msg}</span>
                </div>
                {/* Stats row */}
                <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:8 }}>
                  {[
                    { label:'Today Peak', value: peakCo2 !== null ? `${peakCo2} ppm` : '—', color:'#f87171' },
                    { label:'Today Avg',  value: avgCo2 !== null ? `${avgCo2} ppm`  : '—', color:'#60a5fa' },
                    { label:'Today Min',  value: minCo2 !== null ? `${minCo2} ppm`  : '—', color:'#34d399' },
                    { label:'CO2 Trend',  value: trend, color: trendColor },
                  ].map(s => (
                    <div key={s.label} style={{ flex:'1 1 80px', padding:'6px 10px', borderRadius:8, background: theme==='dark'?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.03)', border:`1px solid ${border}` }}>
                      <div style={{fontSize:10, opacity:0.5, marginBottom:2}}>{s.label}</div>
                      <div style={{fontSize:13, fontWeight:800, color:s.color}}>{s.value}</div>
                    </div>
                  ))}
                </div>
                {/* Aviation impact */}
                <div style={{ fontSize:12, opacity:0.7, display:'flex', alignItems:'center', gap:6 }}>
                  <span>✈️</span>
                  <span><b style={{color:'#60a5fa'}}>{airborne}</b> of <b style={{color:'#60a5fa'}}>{maaFlights}</b> MAA flights currently airborne — contributing to local emission load</span>
                </div>
              </div>
            );
          })()}

          {tomorrowPredictedForCurrentHour !== null && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${border}` }}>
              <div style={{ opacity: 0.75, marginBottom: 6, fontSize: 12 }}>
                Tomorrow's prediction @ {String(currentHour).padStart(2, "0")}:00
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div style={{ fontWeight: 900, fontSize: 22 }}>{Number(tomorrowPredictedForCurrentHour).toFixed(0)} <span style={{ fontSize: 12, opacity: 0.5 }}>ppm</span></div>
                <div style={{ fontWeight: 800, color: levelFromValue(Number(tomorrowPredictedForCurrentHour)) === "Safe" ? "#22c55e" : levelFromValue(Number(tomorrowPredictedForCurrentHour)) === "Medium" ? "#fbbf24" : "#ef4444" }}>
                  {levelFromValue(Number(tomorrowPredictedForCurrentHour))}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
      {/* KPI strip: Chennai flights + weather */}
      <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 180px", minWidth: 180, padding: "18px 22px", borderRadius: 12, border: "1px solid rgba(96,165,250,0.35)", background: theme === "dark" ? "rgba(96,165,250,0.07)" : "rgba(59,130,246,0.06)" }}>
          <div style={{ fontSize: 12, opacity: 0.65, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>Chennai Flights (MAA)</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <div style={{ fontSize: 40, fontWeight: 900, color: "#60a5fa", lineHeight: 1.1 }}>{flights.filter(f => f.is_chennai).length}</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: theme === "dark" ? "#86efac" : "#16a34a" }}>
              {flights.filter(f => f.is_chennai && f.status && (f.status.includes('Taxi') || f.status.includes('Load') || f.status.includes('Park') || f.status.includes('Board') || f.status.includes('Gate') || f.status.includes('Ground'))).length} at airport
            </div>
          </div>
          <div style={{ fontSize: 11, opacity: 0.55, marginTop: 3 }}>arrivals &amp; departures</div>
        </div>
        <div style={{ flex: "1 1 180px", minWidth: 180, padding: "18px 22px", borderRadius: 12, border: `1px solid ${border}`, background: cardBg }}>
          <div style={{ fontSize: 12, opacity: 0.65, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>Temperature</div>
          <div style={{ fontSize: 34, fontWeight: 900, color: text }}>{weather.temperature ?? "—"} <span style={{ fontSize: 18, opacity: 0.5 }}>°C</span></div>
        </div>
        <div style={{ flex: "1 1 180px", minWidth: 180, padding: "18px 22px", borderRadius: 12, border: `1px solid ${border}`, background: cardBg }}>
          <div style={{ fontSize: 12, opacity: 0.65, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>Wind Speed</div>
          <div style={{ fontSize: 34, fontWeight: 900, color: text }}>{weather.wind_speed ?? "—"} <span style={{ fontSize: 18, opacity: 0.5 }}>km/h</span></div>
        </div>
        <div style={{ flex: "1 1 180px", minWidth: 180, padding: "18px 22px", borderRadius: 12, border: `1px solid ${border}`, background: cardBg }}>
          <div style={{ fontSize: 12, opacity: 0.65, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>Humidity</div>
          <div style={{ fontSize: 34, fontWeight: 900, color: text }}>{weather.humidity ?? "—"} <span style={{ fontSize: 18, opacity: 0.5 }}>%</span></div>
        </div>
        <div style={{ flex: "1 1 180px", minWidth: 180, padding: "18px 22px", borderRadius: 12, border: `1px solid ${border}`, background: cardBg }}>
          <div style={{ fontSize: 12, opacity: 0.65, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>Baro Pressure</div>
          <div style={{ fontSize: 34, fontWeight: 900, color: text }}>{weather.pressure ?? "—"} <span style={{ fontSize: 18, opacity: 0.5 }}>hPa</span></div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════
          SECTION 2 — CO2 Graphs
      ═══════════════════════════════════════════════ */}
      <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
        <ChartCard title={`Realtime CO2 — ${realtime.date || "Today"}`} theme={theme}>
          <LineChart theme={theme} labels={realtimeLabels} series={realtimeSeries} lineLabel="Realtime CO2" />
        </ChartCard>
        <ChartCard title={`CO2 Prediction — ${prediction.date || "Tomorrow"}`} theme={theme}>
          <LineChart
            theme={theme}
            labels={hourLabels()}
            series={Array.from({ length: 24 }, (_, i) => (prediction.prediction || [])[i] ?? null)}
            lineLabel="Tomorrow (AI Prediction)"
          />
        </ChartCard>
      </div>

      {/* ═══════════════════════════════════════════════
          SECTION 3 — Pollution Index
      ═══════════════════════════════════════════════ */}
      {pollutionData && (
        <div style={{ marginBottom: 16, padding: "20px 24px", borderRadius: 14, border: `1px solid ${border}`, background: cardBg, display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ textAlign: "center", minWidth: 130, padding: "16px 24px", borderRadius: 14, border: `2px solid ${pollutionData.level_color}`, background: `${pollutionData.level_color}15` }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", opacity: 0.6 }}>Pollution Index</div>
            <div style={{ fontSize: 52, fontWeight: 900, color: pollutionData.level_color, lineHeight: 1.1 }}>{pollutionData.pollution_index}</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: pollutionData.level_color }}>{pollutionData.level}</div>
            <div style={{ fontSize: 11, marginTop: 4, opacity: 0.55 }}>Confidence {pollutionData.confidence}%</div>
          </div>

          <div style={{ flex: "1 1 200px" }}>
            <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 12, opacity: 0.6, textTransform: "uppercase", letterSpacing: 1 }}>Atmospheric Parameters</div>
            {[
              { label: "CO₂",         value: `${pollutionData.inputs.co2} ppm`,         color: "#60a5fa" },
              { label: "Temperature", value: `${pollutionData.inputs.temperature}°C`,    color: "#fb923c" },
              { label: "Humidity",    value: `${pollutionData.inputs.humidity}%`,         color: "#34d399" },
              { label: "Pressure",    value: `${pollutionData.inputs.pressure} hPa`,     color: "#a78bfa" },
              { label: "Wind Speed",  value: `${pollutionData.inputs.wind_speed} km/h`,  color: "#f472b6" },
            ].map(r => (
              <div key={r.label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 13, opacity: 0.7 }}>{r.label}</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: r.color }}>{r.value}</span>
              </div>
            ))}
          </div>


        </div>
      )}

      {/* ═══════════════════════════════════════════════
          SECTION 4 — Live Map
      ═══════════════════════════════════════════════ */}
      <div ref={mapSectionRef} style={{ marginBottom: 16 }}>
        <FlightMap
          theme={theme}
          flights={flights}
          selectedFlight={selectedFlight}
          flyKey={flyKey}
          onSelectFlight={(f) => {
            setSelectedFlight(f);
            if (f) setFlyKey(k => k + 1);
          }}
        />
      </div>

      {/* ═══════════════════════════════════════════════
          SECTION 5 — Live Flight Dashboard
      ═══════════════════════════════════════════════ */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <FlightTable
          theme={theme}
          flights={flights}
          selectedFlightId={selectedFlight?.id}
          onSelectFlight={(f) => {
            setSelectedFlight(f);
            setFlyKey(k => k + 1);
            setTimeout(() => {
              mapSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 80);
          }}
        />
      </div>
        </>
      )}
    </div>
  );
}

export default App;