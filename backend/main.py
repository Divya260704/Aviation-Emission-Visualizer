from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
import firebase_admin
from firebase_admin import credentials, db
import numpy as np
import pickle
from tensorflow.keras.models import load_model
import os
import json
import hashlib
from pathlib import Path
from datetime import datetime, timedelta
import math
import random
from typing import List, Optional, Tuple
import requests
import time
import random
from FlightRadar24 import FlightRadar24API
from apscheduler.schedulers.background import BackgroundScheduler

app = FastAPI()

# ─────────────────────────── Telegram Notification Config ───────────────────────────
# 1. Message @BotFather on Telegram → create a bot → paste the token below
# 2. Message @userinfobot on Telegram → paste your Chat ID below
TELEGRAM_BOT_TOKEN = "8672617324:AAGxA9FJEDXHvRYkmyKEID5tDf04cYwmeB8"
TELEGRAM_CHAT_ID   = "5460837287"
TELEGRAM_ENABLED   = bool(TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)

# Prevents repeated messages for the same event; resets after level drops
_last_alert_level = {"realtime": None, "forecast": None}
# Flight data cache to avoid OpenSky Network rate limits (60 seconds caching)
FLIGHT_CACHE = {"data": [], "timestamp": 0}
# Cache for aircraft metadata to prevent rate limits
AIRCRAFT_METADATA_CACHE = {}
# Cache for Open-Meteo weather data (5 minutes caching)
WEATHER_CACHE = {"data": {}, "timestamp": 0}


SAFE_THRESHOLD = 800.0
TOXIC_THRESHOLD = 1200.0

# CORS (for React)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    # Cookies/credentials aren't used by the frontend; keep this off to avoid stricter browser CORS behavior.
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent

FIREBASE_KEY_PATH = BASE_DIR / "firebase_key.json"
MODEL_PATH = BASE_DIR / "lstm_model.keras"
SCALER_PATH = BASE_DIR / "scaler.pkl"

# Firebase Initialization
firebase_enabled = True
try:
    cred = credentials.Certificate(str(FIREBASE_KEY_PATH))
    firebase_admin.initialize_app(
        cred,
        {
            "databaseURL": "https://emission-data-53ea6-default-rtdb.firebaseio.com/",  # 🔥 CHANGE THIS if needed
        },
    )
except Exception as e:
    firebase_enabled = False
    print(f"Firebase initialization failed: {e}")

# ✅ Load LSTM Model
model = None
try:
    model = load_model(str(MODEL_PATH))
except Exception as e:
    print(f"Model loading failed: {e}")

# ✅ Load Scaler
scaler = None
try:
    with open(str(SCALER_PATH), "rb") as f:
        scaler = pickle.load(f)
except Exception as e:
    print(f"Scaler loading failed: {e}")


# 🔥 Fetch data from Firebase
# Returns only the last `window_hours` worth of samples.
# Assumption: sensor writes roughly every `sample_interval_sec` seconds.

# Firebase sample datetime looks like: "2026-03-20 13:04:09" (space, no timezone)
# We parse it robustly so filtering/order works consistently.
def parse_datetime_maybe(s):
    if s is None:
        return None
    s = str(s).strip()
    if not s:
        return None

    # Try ISO first (handles both "T" and " " in many cases).
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        pass

    # Common formats we might see in Firebase.
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(s, fmt)
        except Exception:
            continue

    return None


def fetch_all_sensor_samples() -> List[Tuple[datetime, float, str]]:
    """
    Fetch and parse CO2 samples from Firebase.

    Returns list of tuples: (parsed_datetime, co2_value, original_datetime_string).
    """
    if not firebase_enabled:
        return []

    # Your Firebase has two nodes:
    # - `data` (older/numeric timestamps)
    # - `sensor_data` (realtime datetime strings)
    for node in ["sensor_data", "data"]:
        ref = db.reference(node)
        raw = ref.get()
        if raw:
            samples: List[Tuple[datetime, float, str]] = []
            for _, val in raw.items():
                if not isinstance(val, dict):
                    continue

                # Support common field names.
                co2_raw = val.get("co2", val.get("CO2", None))
                time_value = val.get(
                    "datetime",
                    val.get("time", val.get("timestamp", "")),
                )

                if co2_raw is None:
                    continue

                time_str = str(time_value) if time_value is not None else ""
                parsed_ts = parse_datetime_maybe(time_str)
                if parsed_ts is None:
                    continue

                samples.append((parsed_ts, float(co2_raw), time_str))

            samples.sort(key=lambda x: x[0])
            if samples:
                return samples

    return []


def get_day_key(samples: List[Tuple[datetime, float, str]], day: Optional[str]) -> str:
    if day:
        return day
    return datetime.now().strftime("%Y-%m-%d")

def hourly_avg_values(
    samples: List[Tuple[datetime, float, str]],
    day_key: str,
) -> List[Optional[float]]:
    """
    Aggregate samples into 24 buckets for a given day.
    Uses the AVERAGE of all readings within each hour.
    Only hours that have at least one real reading are populated.
    """
    buckets: List[List[float]] = [[] for _ in range(24)]
    if not samples:
        return [None] * 24

    for ts, co2_value, _time_str in samples:
        if ts.strftime("%Y-%m-%d") != day_key:
            continue
        buckets[ts.hour].append(co2_value)

    return [
        round(sum(vals) / len(vals), 1) if vals else None
        for vals in buckets
    ]

# Keep old name as alias for any internal use
hourly_last_values = hourly_avg_values


def hour_labels() -> List[str]:
    # Buckets are hourly; show the last bucket as 23:59 for a nicer day-end label.
    labels = []
    for h in range(24):
        if h == 23:
            labels.append("23:59")
        else:
            labels.append(f"{h:02d}:00")
    return labels


def get_current_value(samples: List[Tuple[datetime, float, str]]) -> Tuple[float, str]:
    if not samples:
        return 0.0, ""
    co2_value = float(samples[-1][1])
    time_str = str(samples[-1][2])
    return co2_value, time_str


def predict_next_hourly_sequence(hourly_values: List[Optional[float]], steps: int = 24) -> List[float]:
    """
    Predict next-hourly CO2 values using iterative 1-step forecasting.

    We feed the model the last 5 non-null hourly values.
    """
    if model is None or scaler is None:
        return [0.0] * steps

    seq: List[float] = [v for v in hourly_values if v is not None]
    if not seq:
        return [0.0] * steps

    # Ensure at least 5 values.
    while len(seq) < 5:
        seq.insert(0, seq[0])

    preds: List[float] = []
    for _ in range(steps):
        last5 = np.array(seq[-5:], dtype=float).reshape(-1, 1)
        data_scaled = scaler.transform(last5)
        X = data_scaled.reshape(1, 5, 1)
        pred_scaled = model.predict(X)
        prediction = scaler.inverse_transform(pred_scaled)
        next_val = float(prediction[0][0])
        preds.append(next_val)
        seq.append(next_val)

    return preds


def fill_hourly_values(values: List[Optional[float]]) -> List[float]:
    """
    For prediction context: forward-fill gaps between real readings.
    Leading nulls before the first real reading remain 0 (not faked).
    This prevents the LSTM from training on fabricated early-day values.
    """
    filled: List[Optional[float]] = list(values)
    first_idx = next((i for i, v in enumerate(filled) if v is not None), None)

    if first_idx is None:
        return [0.0] * len(filled)

    # Forward fill from first real value onwards only
    last = filled[first_idx]
    for i in range(first_idx, len(filled)):
        if filled[i] is not None:
            last = filled[i]
        else:
            filled[i] = last

    # Leading slots before first reading get 400 (baseline CO2) instead of 0
    for i in range(0, first_idx):
        filled[i] = 400.0

    return [float(v) for v in filled]

def fill_hourly_up_to_current(hourly_values: List[Optional[float]], day_key: str) -> List[Optional[float]]:
    """
    For display: only forward-fill gaps BETWEEN real readings, up to current hour.
    Leading nulls (before first real reading) stay null — no fake data.
    Future hours (after current hour) stay null.
    """
    filled: List[Optional[float]] = list(hourly_values)

    try:
        target_dt = datetime.strptime(day_key, "%Y-%m-%d")
        now = datetime.now()
        if target_dt.date() == now.date():
            fill_up_to = now.hour
        elif target_dt.date() < now.date():
            fill_up_to = 23
        else:
            fill_up_to = -1
    except ValueError:
        fill_up_to = 23

    # Find first real reading
    first_real = next((i for i, v in enumerate(filled) if v is not None), None)
    if first_real is None:
        return filled  # no data at all, return all nulls

    # Forward-fill only BETWEEN real readings, never before first_real
    last = None
    for i in range(first_real, min(24, fill_up_to + 1)):
        if filled[i] is not None:
            last = filled[i]
        elif last is not None:
            filled[i] = last  # fill gap between readings

    # Ensure future hours beyond fill_up_to are null
    for i in range(fill_up_to + 1, 24):
        filled[i] = None

    return filled

def get_sensor_data(window_hours: float = 1.0, sample_interval_sec: int = 10):
    if not firebase_enabled:
        return [], []

    # Your Firebase has two nodes:
    # - `data` (older/numeric timestamps)
    # - `sensor_data` (real datetime strings in `timestamp`)
    # Prefer `sensor_data` for the realtime dashboard.
    ref = db.reference("sensor_data")
    data = ref.get()
    if not data:
        ref = db.reference("data")
        data = ref.get()

    values = []
    timestamps = []

    if not data:
        print("No data found in Firebase")
        return values, timestamps

    # Keep key ordering stable but also allow sorting if timestamps are parseable.
    items = []
    for key, val in data.items():
        try:
            if not isinstance(val, dict):
                continue

            # Support a couple of common alternate field names.
            co2_raw = val.get("co2", val.get("CO2", 0))
            time_value = val.get("datetime", val.get("time", val.get("timestamp", "")))

            co2_value = float(co2_raw)
            time_str = str(time_value) if time_value is not None else ""

            # Optional parsing for better chart/prediction ordering.
            parsed_ts = None
            if time_str:
                try:
                    parsed_ts = parse_datetime_maybe(time_str)
                except Exception:
                    parsed_ts = None

            items.append((parsed_ts, co2_value, time_str))

        except Exception as e:
            print("Error reading data:", e)
            continue

    # Sort by timestamp when possible; otherwise preserve insertion order.
    if any(ts is not None for ts, _, _ in items):
        items.sort(key=lambda x: x[0] if x[0] is not None else datetime.min)

    # Keep only the last 1-hour window.
    # Primary method: time-based filtering using parsed timestamps.
    # Use the latest Firebase timestamp as the reference (avoids timezone mismatches).
    now = datetime.now()  # fallback reference
    cutoff = now - timedelta(hours=float(window_hours))

    original_items = list(items)
    parsed_items = [it for it in original_items if it[0] is not None]
    if parsed_items:
        latest_ts = max(it[0] for it in parsed_items if it[0] is not None)
        cutoff = latest_ts - timedelta(hours=float(window_hours))
        # Only keep points newer than cutoff.
        time_filtered = [it for it in original_items if it[0] is not None and it[0] >= cutoff]
        items = time_filtered if time_filtered else original_items

    # Bounded slice to avoid returning too many points.
    window_seconds = float(window_hours) * 3600.0
    max_points = int(math.ceil(window_seconds / float(sample_interval_sec)))
    if max_points > 0 and len(items) > max_points:
        items = items[-max_points:]

    for _, co2_value, time_str in items:
        values.append(co2_value)
        timestamps.append(time_str)

    print("CO2 VALUES:", values)
    print("TIMESTAMPS:", timestamps)

    return values, timestamps


# 🔥 Prediction using LSTM
def predict_next(values):
    try:
        if model is None or scaler is None:
            return 0

        if len(values) < 5:
            print("Not enough data for prediction")
            return 0

        # Take last 5 values
        data = np.array(values[-5:]).reshape(-1, 1)

        print("Last 5 values:", data)

        # Normalize
        data_scaled = scaler.transform(data)

        # Reshape for LSTM
        X = data_scaled.reshape(1, 5, 1)

        # Predict
        pred_scaled = model.predict(X)

        # Convert back
        prediction = scaler.inverse_transform(pred_scaled)

        print("Prediction:", prediction)

        return float(prediction[0][0])

    except Exception as e:
        print("Prediction Error:", e)
        return 0


# ☁️ Atmospheric Meteorologocal Engine (Phase 1)
def get_current_weather():
    global WEATHER_CACHE
    now = time.time()
    if now - WEATHER_CACHE["timestamp"] < 300 and WEATHER_CACHE["data"]: # 5 min cache
        return WEATHER_CACHE["data"]
        
    w = WEATHER_CACHE["data"] if WEATHER_CACHE["data"] else {
        "temperature": 32.0, "humidity": 65.0, "pressure": 1010.0, "wind_speed": 10.0
    }
    
    try:
        # Open-Meteo API for Meenambakkam Airport Coordinates
        url = "https://api.open-meteo.com/v1/forecast?latitude=12.9822&longitude=80.1692&current=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m"
        r = requests.get(url, timeout=5)
        if r.status_code == 200:
            current = r.json().get("current", {})
            w = {
                "temperature": current.get("temperature_2m", w["temperature"]),
                "humidity": current.get("relative_humidity_2m", w["humidity"]),
                "pressure": current.get("surface_pressure", w["pressure"]),
                "wind_speed": current.get("wind_speed_10m", w["wind_speed"])
            }
            WEATHER_CACHE["data"] = w
            WEATHER_CACHE["timestamp"] = now
            
            # Phase 2: Firebase Cloud Logging
            if firebase_enabled:
                try:
                    ref = db.reference("weather_log")
                    ref.push({
                        "datetime": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        **w
                    })
                except Exception as e:
                    print(f"Firebase Weather Push Error: {e}")
                    
    except Exception as e:
        print(f"Weather Fetch Error: {e}")
        
    return w

def apply_atmospheric_adjustment(base_prediction: float, weather: dict) -> float:
    """Hybrid AI Pipeline: Mathmetically adjusts LSTM inference using physics-based weather constraints."""
    if base_prediction <= 0: return base_prediction
    
    # Baseline constraints
    base_wind = 12.0 # km/h
    base_temp = 32.0 # Celsius
    base_hum = 60.0  # %
    
    # 1. High Wind heavily disperses CO2. Low wind heavily traps it.
    wind = weather.get("wind_speed", base_wind)
    wind_factor = 1.0 - ((wind - base_wind) * 0.015) 
    
    # 2. High Temperature slightly increases VOC/CO2 reaction potential in domestic areas
    temp = weather.get("temperature", base_temp)
    temp_factor = 1.0 + ((temp - base_temp) * 0.005)
    
    # 3. High Humidity traps local particulates, increasing effective reading
    hum = weather.get("humidity", base_hum)
    hum_factor = 1.0 + ((hum - base_hum) * 0.002)
    
    modifier = wind_factor * temp_factor * hum_factor
    
    # Clamp modifier to prevent physics-defying edge cases (max +/- 25% adjustment)
    modifier = max(0.75, min(1.25, modifier))
    
    return base_prediction * modifier

@app.get("/predict")
def predict_pollution(
    co2: float = 400.0,
    temperature: float = 32.0,
    humidity: float = 65.0,
    pressure: float = 1010.0,
    wind_speed: float = 10.0
):
    """
    Multivariate Pollution Prediction Engine.
    Accepts live sensor + atmospheric inputs and returns a detailed prediction
    with factor contribution breakdown, 24-hour forecast curve, and confidence score.
    """
    # --- 1. Factor scoring (0-100 scale, higher = more polluting) ---
    # CO2 factor: normalised against safe (800) and toxic (1200) thresholds
    co2_score = min(100.0, max(0.0, (co2 - 350) / (1600 - 350) * 100))

    # Wind dispersion factor: high wind disperses pollution (inverse, lower score = cleaner)
    wind_score = min(100.0, max(0.0, 100.0 - (wind_speed / 40.0) * 100))

    # Humidity trapping factor: high humidity traps particles near surface
    hum_score = min(100.0, max(0.0, (humidity - 20) / (100 - 20) * 100))

    # Temperature inversion factor: at Chennai, higher temps above ~35°C worsen urban smog
    temp_score = min(100.0, max(0.0, (temperature - 20) / (45 - 20) * 100))

    # Pressure stability factor: low pressure = unstable atmosphere = better mixing
    # high pressure = stable inversion layers trapping pollutants
    pressure_score = min(100.0, max(0.0, (pressure - 990) / (1030 - 990) * 100))

    # --- 2. Weighted pollution index (EPA-inspired weights) ---
    weights = {"co2": 0.45, "wind": 0.25, "humidity": 0.12, "temperature": 0.10, "pressure": 0.08}
    pollution_index = (
        co2_score * weights["co2"] +
        wind_score * weights["wind"] +
        hum_score * weights["humidity"] +
        temp_score * weights["temperature"] +
        pressure_score * weights["pressure"]
    )

    # --- 3. Pollution level classification ---
    if pollution_index > 300:
        level = "Hazardous"
        level_color = "#881337"  # Maroon
    elif pollution_index > 200:
        level = "Very Unhealthy"
        level_color = "#7e22ce"  # Purple
    elif pollution_index > 150:
        level = "Unhealthy"
        level_color = "#ef4444"  # Red
    elif pollution_index > 100:
        level = "Unhealthy for Sensitive Groups"
        level_color = "#f97316"  # Orange
    elif pollution_index > 50:
        level = "Moderate"
        level_color = "#eab308"  # Yellow
    else:
        level = "Good"
        level_color = "#22c55e"  # Green

    # --- 4. Confidence based on how far inputs are from calibration baseline ---
    confidence = round(max(60.0, 100.0 - abs(co2 - 400) / 20), 1)

    # --- 5. 24-hour forecast curve: simulate how pollution evolves across day ---
    # Morning low wind + high humidity -> worse; afternoon heat disperses
    forecast = []
    for h in range(24):
        # Diurnal wind pattern: weakest at night (0-6), peaks at 14h
        hour_wind_mult = 0.5 + 0.8 * abs(math.sin(math.pi * h / 24))
        # Temperature rises mid-day, inverse for inversion
        hour_temp_mult = 1.0 + 0.1 * math.sin(math.pi * (h - 6) / 12)
        # Traffic-based CO2 peaks at 8am and 6pm
        traffic_co2_bump = 1.0 + 0.08 * (math.exp(-((h - 8) ** 2) / 4) + math.exp(-((h - 18) ** 2) / 4))
        hour_index = pollution_index * hour_wind_mult * hour_temp_mult * traffic_co2_bump
        forecast.append(round(min(100.0, hour_index), 2))

    return {
        "pollution_index": round(pollution_index, 2),
        "level": level,
        "level_color": level_color,
        "confidence": confidence,
        "factors": {
            "co2_contribution": round(co2_score * weights["co2"], 2),
            "wind_contribution": round(wind_score * weights["wind"], 2),
            "humidity_contribution": round(hum_score * weights["humidity"], 2),
            "temperature_contribution": round(temp_score * weights["temperature"], 2),
            "pressure_contribution": round(pressure_score * weights["pressure"], 2),
        },
        "scores": {
            "co2_score": round(co2_score, 1),
            "wind_score": round(wind_score, 1),
            "humidity_score": round(hum_score, 1),
            "temperature_score": round(temp_score, 1),
            "pressure_score": round(pressure_score, 1),
        },
        "forecast_24h": forecast,
        "inputs": {
            "co2": co2, "temperature": temperature,
            "humidity": humidity, "pressure": pressure, "wind_speed": wind_speed
        }
    }

# ✅ API Endpoint
@app.get("/data")
def get_data():
    try:
        # Last 1 hour window
        values, timestamps = get_sensor_data(window_hours=1.0, sample_interval_sec=10)
        prediction_base = predict_next(values)
        
        # Inject Atmospheric AI Adjustments
        weather = get_current_weather()
        adjusted_prediction = apply_atmospheric_adjustment(float(prediction_base), weather)
        
        return {
            "co2": values,
            "time": timestamps,
            "prediction": adjusted_prediction,
            "prediction_base": float(prediction_base),
            "weather": weather
        }
    except Exception as e:
        # Prevent the frontend from breaking if the backend fails (Firebase/network/model).
        print(f"/data failed: {e}")
        return {
            "co2": [],
            "time": [],
            "prediction": 0.0,
            "prediction_base": 0.0,
            "weather": {}
        }


@app.get("/latest")
def latest():
    samples = fetch_all_sensor_samples()
    value, time_str = get_current_value(samples)

    level = "Safe"
    if value >= TOXIC_THRESHOLD:
        level = "Toxic"
    elif value >= SAFE_THRESHOLD:
        level = "Medium"

    return {
        "co2": float(value),
        "datetime": time_str,
        "level": level,
        "weather": get_current_weather()
    }


@app.get("/historical")
def get_historical():
    """
    Returns aggregated daily peaks, minimums, and averages for the last 7 available days.
    """
    samples = fetch_all_sensor_samples()
    
    # Group by date string "YYYY-MM-DD"
    daily_data = {}
    for ts, co2_val, _ in samples:
        if co2_val > 0:
            date_str = ts.strftime("%Y-%m-%d")
            daily_data.setdefault(date_str, []).append(co2_val)
            
    # Sort dates chronologically and pick the last 7 days
    sorted_dates = sorted(daily_data.keys())[-7:]
    
    results = []
    for d in sorted_dates:
        vals = daily_data[d]
        results.append({
            "date": d,
            "peak": max(vals),
            "min": min(vals),
            "avg": round(sum(vals)/len(vals), 1)
        })
        
    return {"history": results}


@app.get("/alerts")
def get_alerts():
    """
    Checks realtime and predictive CO2 to generate active dashboard warnings.
    """
    alerts = []
    samples = fetch_all_sensor_samples()
    if not samples:
        return {"alerts": []}
        
    # 1. Realtime constraint check
    last_val, _ = get_current_value(samples)
    if last_val >= TOXIC_THRESHOLD:
        alerts.append({
            "id": "rt-danger",
            "type": "danger",
            "title": "Hazardous Realtime Emission",
            "message": f"Realtime CO2 has breached the toxic threshold ({last_val} ppm).",
            "time": "Now"
        })
    elif last_val >= SAFE_THRESHOLD:
        alerts.append({
            "id": "rt-warn",
            "type": "warning",
            "title": "Elevated Realtime Emission",
            "message": f"Realtime CO2 is currently elevated ({last_val} ppm).",
            "time": "Now"
        })
        
    # 2. AI Predictive check for tomorrow
    day_key = get_day_key(samples, None)
    try:
        base_dt = datetime.strptime(day_key, "%Y-%m-%d")
        prev_key = (base_dt - timedelta(days=1)).strftime("%Y-%m-%d")
        
        prev_hourly = hourly_last_values(samples, prev_key)
        base_hourly = hourly_last_values(samples, day_key)
        context_seq = fill_hourly_values(prev_hourly) + fill_hourly_values(base_hourly)
        
        preds_base = predict_next_hourly_sequence(context_seq, steps=24)
        weather = get_current_weather()
        
        # Scan tomorrow's forecast curve for any standard threshold breaches
        max_pred = 0
        max_hour = 0
        for h in range(24):
            p = preds_base[h]
            hour_wind_mult = 0.5 + 0.8 * abs(math.sin(math.pi * h / 24))
            hour_temp_mult = 1.0 + 0.1 * math.sin(math.pi * (h - 6) / 12)
            traffic_co2_bump = 1.0 + 0.08 * (math.exp(-((h - 8) ** 2) / 4) + math.exp(-((h - 18) ** 2) / 4))
            
            base_mod = apply_atmospheric_adjustment(p, weather)
            final_p = base_mod * hour_wind_mult * hour_temp_mult * traffic_co2_bump
            if final_p > max_pred:
                max_pred = final_p
                max_hour = h
                
        if max_pred >= TOXIC_THRESHOLD:
             alerts.append({
                 "id": "fc-danger",
                 "type": "danger",
                 "title": "Critical AI Forecast",
                 "message": f"AI forecasts Hazardous CO2 ({round(max_pred, 1)} ppm) tomorrow around {str(max_hour).zfill(2)}:00.",
                 "time": "Tomorrow"
             })
        elif max_pred >= SAFE_THRESHOLD:
             alerts.append({
                 "id": "fc-warn",
                 "type": "warning",
                 "title": "Elevated AI Forecast",
                 "message": f"AI forecasts Elevated CO2 ({round(max_pred, 1)} ppm) tomorrow around {str(max_hour).zfill(2)}:00.",
                 "time": "Tomorrow"
             })
    except Exception as e:
        print(f"Alert prediction check failed: {e}")
         
    return {"alerts": alerts}


@app.get("/hourly/realtime")
def hourly_realtime(date: Optional[str] = None):
    """
    Realtime graph for a day (00:00 to 23:00).
    It uses the last observed value in each hour bucket.
    """
    samples = fetch_all_sensor_samples()
    day_key = get_day_key(samples, date)
    
    today_raw = [co2_val for ts, co2_val, _ in samples if ts.strftime("%Y-%m-%d") == day_key and co2_val > 0]
    raw_peak = max(today_raw) if today_raw else None
    raw_min = min(today_raw) if today_raw else None
    raw_avg = round(sum(today_raw) / len(today_raw), 1) if today_raw else None

    buckets = hourly_last_values(samples, day_key)
    buckets = fill_hourly_up_to_current(buckets, day_key)

    return {
        "date": day_key,
        "hours": hour_labels(),
        "co2": buckets,
        "peak": raw_peak,
        "min": raw_min,
        "avg": raw_avg,
    }


@app.get("/hourly/stats")
def hourly_stats(date: Optional[str] = None):
    """
    Returns per-hour averages of CO2, temperature, humidity, pressure, wind speed, and AQI
    for each hour of the requested day. Used by the Hourly Notification Panel.
    """
    samples = fetch_all_sensor_samples()
    day_key = get_day_key(samples, date)
    weather = get_current_weather()

    # Group raw co2 readings into hour buckets
    hourly_co2: dict = {}
    for ts, co2_val, _ in samples:
        if ts.strftime("%Y-%m-%d") == day_key and co2_val > 0:
            h = ts.hour
            hourly_co2.setdefault(h, []).append(co2_val)

    def aqi_from_co2(co2):
        # Map CO2 ppm -> simplified AQI score (0-500 scale)
        if co2 <= 400:   return round((co2 / 400) * 50, 1)
        elif co2 <= 600: return round(50 + ((co2 - 400) / 200) * 50, 1)
        elif co2 <= 800: return round(100 + ((co2 - 600) / 200) * 50, 1)
        elif co2 <= 1000: return round(150 + ((co2 - 800) / 200) * 50, 1)
        elif co2 <= 1200: return round(200 + ((co2 - 1000) / 200) * 100, 1)
        else: return round(min(500, 300 + ((co2 - 1200) / 300) * 200), 1)

    def aqi_label(aqi):
        if aqi <= 50:   return ("Good", "#22c55e")
        elif aqi <= 100: return ("Moderate", "#eab308")
        elif aqi <= 150: return ("Unhealthy for Sensitive Groups", "#f97316")
        elif aqi <= 200: return ("Unhealthy", "#ef4444")
        elif aqi <= 300: return ("Very Unhealthy", "#7e22ce")
        else: return ("Hazardous", "#881337")

    result = []
    for h in range(24):
        readings = hourly_co2.get(h, [])
        avg_co2 = round(sum(readings) / len(readings), 1) if readings else None
        aqi_val = aqi_from_co2(avg_co2) if avg_co2 is not None else None
        label, color = aqi_label(aqi_val) if aqi_val is not None else ("N/A", "#6b7280")

        result.append({
            "hour": h,
            "label": f"{str(h).zfill(2)}:00",
            "co2_avg": avg_co2,
            "temperature": weather.get("temperature"),
            "humidity": weather.get("humidity"),
            "pressure": weather.get("pressure"),
            "wind_speed": weather.get("wind_speed"),
            "aqi": aqi_val,
            "aqi_label": label,
            "aqi_color": color,
        })

    return {"date": day_key, "stats": result}


@app.get("/hourly/prediction")
def hourly_prediction(date: Optional[str] = None):
    """
    Prediction graph for the next day (00:00 to 23:00),
    predicted iteratively using the last 5 hourly values of the base day.
    """
    samples = fetch_all_sensor_samples()
    base_day_key = get_day_key(samples, date)

    base_dt = datetime.strptime(base_day_key, "%Y-%m-%d")
    prev_dt = base_dt - timedelta(days=1)
    target_dt = base_dt + timedelta(days=1)
    prev_key = prev_dt.strftime("%Y-%m-%d")
    target_key = target_dt.strftime("%Y-%m-%d")

    prev_hourly = hourly_last_values(samples, prev_key)
    base_hourly = hourly_last_values(samples, base_day_key)

    # Fill gaps so the model gets a stable sequence.
    prev_filled = fill_hourly_values(prev_hourly)
    base_filled = fill_hourly_values(base_hourly)

    # Use yesterday + today for prediction context.
    context_seq: List[float] = prev_filled + base_filled
    preds_base = predict_next_hourly_sequence(context_seq, steps=24)
    
    weather = get_current_weather()
    preds_adjusted = []
    for h in range(24):
        p = preds_base[h]
        # Simulate realistic diurnal physical constraints for the prediction line
        hour_wind_mult = 0.5 + 0.8 * abs(math.sin(math.pi * h / 24))
        hour_temp_mult = 1.0 + 0.1 * math.sin(math.pi * (h - 6) / 12)
        traffic_co2_bump = 1.0 + 0.08 * (math.exp(-((h - 8) ** 2) / 4) + math.exp(-((h - 18) ** 2) / 4))
        
        base_mod = apply_atmospheric_adjustment(p, weather)
        final_p = base_mod * hour_wind_mult * hour_temp_mult * traffic_co2_bump
        preds_adjusted.append(round(final_p, 2))

    return {
        "base_date": base_day_key,
        "date": target_key,
        "hours": hour_labels(),
        "actual": base_hourly,  # Frontend charts will skip None/null instead of plotting 0
        "prediction": preds_adjusted,
        "prediction_base": preds_base,
        "weather": weather
    }


@app.get("/csv")
def download_csv(date: Optional[str] = None):
    """
    Download CO2 samples for a given day as CSV.
    """
    samples = fetch_all_sensor_samples()
    day_key = get_day_key(samples, date)

    rows: List[str] = ["datetime,co2"]
    for ts, co2_value, time_str in samples:
        if ts.strftime("%Y-%m-%d") != day_key:
            continue
        # Use original string for fidelity.
        safe_time_str = time_str.replace("\n", " ").replace("\r", " ")
        rows.append(f"{safe_time_str},{co2_value}")

    csv_text = "\n".join(rows) + "\n"
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=co2_{day_key}.csv"},
    )

fr_api = FlightRadar24API()

@app.get("/flights")
def get_flights():
    """
    Fetch ALL real-time flights for Chennai Airport (MAA - Meenambakkam)
    using FlightRadar24's airport schedule API.
    Returns arrivals + departures with full metadata (airline, aircraft, times, status).
    Caches the result for 30 seconds.
    """
    global FLIGHT_CACHE, AIRCRAFT_METADATA_CACHE
    now = time.time()

    if now - FLIGHT_CACHE["timestamp"] < 30 and FLIGHT_CACHE["data"]:
        return {"flights": FLIGHT_CACHE["data"]}

    try:
        # ── Step 0: Fetch flights in Indian subcontinent for map background and telemetry ──
        # Bounding box: North 40, South 5, West 60, East 100
        try:
            all_raw = fr_api.get_flights(bounds="40.0,5.0,60.0,100.0")
        except:
            all_raw = []
        
        all_raw_by_id = {getattr(f, 'id', str(id(f))): f for f in all_raw}
        all_raw_by_callsign = {getattr(f, 'callsign', ''): f for f in all_raw if getattr(f, 'callsign', '')}

        # ── Step 1: Fetch MAA airport schedule (arrivals + departures) ──
        details = fr_api.get_airport_details("MAA", flight_limit=100)
        schedule = details.get("airport", {}).get("pluginData", {}).get("schedule", {})
        arrivals_raw = schedule.get("arrivals", {}).get("data", [])
        departures_raw = schedule.get("departures", {}).get("data", [])
        print(f"MAA schedule: {len(arrivals_raw)} arrivals, {len(departures_raw)} departures")

        parsed_chennai = []

        def parse_schedule_flight(entry, direction):
            """Parse a flight dict from the schedule API into a standard record."""
            f = entry.get("flight", {})

            # Identification
            ident = f.get("identification", {})
            callsign = ident.get("callsign") or ident.get("number", {}).get("default") or "Unknown"
            flight_id = ident.get("id") or callsign

            # Airline
            airline_node = f.get("airline", {})
            airline = airline_node.get("name") or airline_node.get("short") or airline_node.get("code", {}).get("iata") or "-"

            # Aircraft
            ac_node = f.get("aircraft", {})
            ac_type = ac_node.get("model", {}).get("text") or ac_node.get("model", {}).get("code") or "Unknown"

            # Airports
            ap_node = f.get("airport", {})
            origin_node = ap_node.get("origin") or {}
            dest_node = ap_node.get("destination") or {}
            origin = (origin_node.get("code") or {}).get("iata") or (origin_node.get("name")) or "MAA"
            dest = (dest_node.get("code") or {}).get("iata") or (dest_node.get("name")) or "MAA"

            # Times
            t = f.get("time", {})
            sched = t.get("scheduled", {})
            actual = t.get("real", {})
            est = t.get("estimated", {})
            other = t.get("other", {})

            dep_ts = actual.get("departure") or est.get("departure") or sched.get("departure")
            arr_ts = actual.get("arrival") or est.get("arrival") or other.get("eta") or sched.get("arrival")
            dep_time = datetime.fromtimestamp(dep_ts).strftime("%H:%M") if dep_ts else "-"
            eta_time = datetime.fromtimestamp(arr_ts).strftime("%H:%M") if arr_ts else "-"

            # Status (FR24 gives a text like "Landed 15:48", "Scheduled", "En Route")
            status_node = f.get("status", {})
            status_text = status_node.get("text") or ""
            live_node = f.get("live") or {}

            # Map FR24 status text to our status labels
            sl = status_text.lower()
            if "land" in sl or "arrived" in sl:
                status = "Approaching / Landing"
            elif "departed" in sl or "takeoff" in sl or "airborne" in sl:
                status = "Takeoff / Departing"
            elif "boarding" in sl or "parked" in sl or "gate" in sl or "ground" in sl:
                status = "Loading / Parked"
            elif "taxiing" in sl or "taxi" in sl:
                status = "Taxiing"
            elif "en route" in sl or "cruise" in sl:
                status = "En Route"
            elif "scheduled" in sl:
                status = f"Scheduled ({'ARR' if direction == 'arrival' else 'DEP'})"
            elif "cancelled" in sl or "cancel" in sl:
                status = "Cancelled"
            else:
                status = status_text or ("Arriving" if direction == "arrival" else "Departing")

            # Position from live data (if available)
            lat = live_node.get("latitude")
            lng = live_node.get("longitude")
            altitude = live_node.get("altitude") or 0
            velocity = live_node.get("speed", {}).get("kts") or live_node.get("speed", {}).get("kmh") or 0
            heading = live_node.get("track") or 0
            vertical_rate = live_node.get("vspeed") or 0
            on_ground = live_node.get("isGround") or ("land" in sl or "parked" in sl or "gate" in sl or "scheduled" in sl)

            # Enrich with real-time global map data
            raw_match = all_raw_by_id.get(flight_id) or all_raw_by_callsign.get(callsign)
            if raw_match:
                lat = getattr(raw_match, 'latitude', lat) or lat
                lng = getattr(raw_match, 'longitude', lng) or lng
                altitude = getattr(raw_match, 'altitude', altitude) or altitude
                velocity = getattr(raw_match, 'ground_speed', velocity) or velocity
                heading = getattr(raw_match, 'heading', heading) or heading
                vertical_rate = getattr(raw_match, 'vertical_speed', vertical_rate) or vertical_rate
                if getattr(raw_match, 'on_ground', False):
                    status = "Taxiing" if velocity > 2 else "Loading / Parked"

            # Allow lat/lng to be None if no live telemetry, preventing cluster on map
            # Fallback removed
            
            return {
                "id": flight_id,
                "callsign": callsign,
                "airline": airline,
                "ac_type": ac_type,
                "status": status,
                "origin": origin,
                "dest": dest,
                "dep_time": dep_time,
                "eta": eta_time,
                "country": "-",
                "lng": float(lng) if lng is not None else None,
                "lat": float(lat) if lat is not None else None,
                "altitude": float(altitude),
                "velocity": float(velocity),
                "heading": float(heading),
                "vertical_rate": float(vertical_rate),
                "last_seen": "Live",
                "is_chennai": True
            }

        seen_ids = set()
        for entry in arrivals_raw:
            try:
                rec = parse_schedule_flight(entry, "arrival")
                # Only include flights that are actually active/in-progress (exclude cancelled)
                if rec["id"] not in seen_ids and rec["status"] != "Cancelled":
                    parsed_chennai.append(rec)
                    seen_ids.add(rec["id"])
            except Exception as e:
                print(f"Arrival parse error: {e}")

        for entry in departures_raw:
            try:
                rec = parse_schedule_flight(entry, "departure")
                if rec["id"] not in seen_ids and rec["status"] != "Cancelled":
                    parsed_chennai.append(rec)
                    seen_ids.add(rec["id"])
            except Exception as e:
                print(f"Departure parse error: {e}")

        # ── Fallback if schedule returned nothing ──
        if not parsed_chennai:
            print("Schedule API returned nothing - falling back to geographic bounding box")
            raw_flights = fr_api.get_flights()
            for f in raw_flights:
                lat = getattr(f, 'latitude', 0) or 0
                lng = getattr(f, 'longitude', 0) or 0
                origin = getattr(f, 'origin_airport_iata', '') or ''
                dest_iata = getattr(f, 'destination_airport_iata', '') or ''
                is_near = (10.5 <= lat <= 14.5) and (78.0 <= lng <= 82.0)
                is_maa = 'MAA' in origin or 'MAA' in dest_iata or 'VOMM' in origin or 'VOMM' in dest_iata
                if is_near or is_maa:
                    flight_id = getattr(f, 'id', None) or str(id(f))
                    callsign = getattr(f, 'callsign', None) or "Unknown"
                    altitude = getattr(f, 'altitude', 0) or 0
                    velocity = getattr(f, 'ground_speed', 0) or 0
                    heading = getattr(f, 'heading', 0) or 0
                    vertical_rate = getattr(f, 'vertical_speed', 0) or 0
                    on_ground = getattr(f, 'on_ground', False)
                    airline = getattr(f, 'airline_iata', '') or ''
                    status = "Unknown"
                    if on_ground:
                        status = "Taxiing" if velocity > 2 else "Loading / Parked"
                    else:
                        if altitude < 10000:
                            status = "Takeoff / Departing" if vertical_rate > 1 else "Approaching / Landing" if vertical_rate < -1 else "Holding / Low Flight"
                        else:
                            status = "Climbing" if vertical_rate > 1 else "Descending" if vertical_rate < -1 else "En Route"
                    parsed_chennai.append({
                        "id": flight_id, "callsign": callsign, "airline": airline, "ac_type": "Passenger Jet",
                        "status": status, "origin": origin or "MAA", "dest": dest_iata or "Unknown",
                        "dep_time": "-", "eta": "-", "country": "-",
                        "lng": float(lng), "lat": float(lat), "altitude": float(altitude),
                        "velocity": float(velocity), "heading": float(heading), "vertical_rate": float(vertical_rate),
                        "last_seen": "Live", "is_chennai": True
                    })

        # ── Step 2: Extract global flights for map background ──
        # (all_raw already fetched in Step 0)

        maa_ids = {rec["id"] for rec in parsed_chennai}
        parsed_other = []
        for f in all_raw:
            flight_id = getattr(f, 'id', None) or str(id(f))
            if flight_id in maa_ids:
                continue
            lat = getattr(f, 'latitude', 0) or 0
            lng = getattr(f, 'longitude', 0) or 0
            altitude = getattr(f, 'altitude', 0) or 0
            velocity = getattr(f, 'ground_speed', 0) or 0
            heading = getattr(f, 'heading', 0) or 0
            vertical_rate = getattr(f, 'vertical_speed', 0) or 0
            on_ground = getattr(f, 'on_ground', False)
            callsign = getattr(f, 'callsign', None) or "Unknown"
            origin = getattr(f, 'origin_airport_iata', None) or "Unknown"
            dest_iata = getattr(f, 'destination_airport_iata', None) or "Unknown"
            airline = getattr(f, 'airline_iata', None) or ""
            status = "Unknown"
            if on_ground:
                status = "Taxiing" if velocity > 2 else "Loading / Parked"
            else:
                if altitude < 10000:
                    status = "Takeoff / Departing" if vertical_rate > 1 else "Approaching / Landing" if vertical_rate < -1 else "Holding / Low Flight"
                else:
                    status = "Climbing" if vertical_rate > 1 else "Descending" if vertical_rate < -1 else "En Route (Overflying)"
            parsed_other.append({
                "id": flight_id, "callsign": callsign, "airline": airline, "ac_type": "Passenger Jet",
                "status": status, "origin": origin, "dest": dest_iata, "dep_time": "-", "eta": "-", "country": "-",
                "lng": float(lng), "lat": float(lat), "altitude": float(altitude),
                "velocity": float(velocity), "heading": float(heading), "vertical_rate": float(vertical_rate),
                "last_seen": "Live", "is_chennai": False
            })

        if len(parsed_other) > 800:
            parsed_other = random.sample(parsed_other, 800)

        # Sort Chennai flights: on-ground first, then by status priority
        status_priority = {"Loading / Parked": 0, "Taxiing": 1, "Approaching / Landing": 2,
                          "Takeoff / Departing": 3, "En Route": 4, "Climbing": 5, "Descending": 6}
        parsed_chennai.sort(key=lambda x: (status_priority.get(x["status"], 9), x["altitude"]))

        final_flights = parsed_chennai + parsed_other
        print(f"Chennai MAA: {len(parsed_chennai)} flights | Global map: {len(parsed_other)} flights")

        FLIGHT_CACHE["data"] = final_flights
        FLIGHT_CACHE["timestamp"] = now
        return {"flights": final_flights}

    except Exception as e:
        print(f"Error fetching FR24 flights: {e}")
        import traceback; traceback.print_exc()
        return {"flights": FLIGHT_CACHE["data"]}


# ─────────────────────────── Telegram Notification Engine ───────────────────────────

def send_telegram(message: str):
    """Fire a message to the configured Telegram bot chat."""
    if not TELEGRAM_ENABLED:
        return
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        payload = {
            "chat_id": TELEGRAM_CHAT_ID,
            "text": message,
            "parse_mode": "Markdown"
        }
        resp = requests.post(url, json=payload, timeout=8)
        if resp.status_code != 200:
            print(f"Telegram error: {resp.text}")
    except Exception as e:
        print(f"Telegram send failed: {e}")


def check_and_notify():
    """
    Runs every 5 minutes via APScheduler.
    Checks realtime CO2 + AI prediction and sends Telegram alerts on threshold breaches.
    Deduplicates: only sends once per escalation/de-escalation event.
    """
    global _last_alert_level
    try:
        samples = fetch_all_sensor_samples()
        if not samples:
            return

        weather = get_current_weather()
        current_co2, _ = get_current_value(samples)
        now_str = datetime.now().strftime("%H:%M")

        # --- Realtime check ---
        if current_co2 >= TOXIC_THRESHOLD:
            rt_level = "TOXIC"
        elif current_co2 >= SAFE_THRESHOLD:
            rt_level = "ELEVATED"
        else:
            rt_level = "SAFE"

        if rt_level != _last_alert_level["realtime"] and rt_level != "SAFE":
            emoji = "🔴" if rt_level == "TOXIC" else "🟡"
            msg = (
                f"{emoji} *Chennai Airport Emission Alert*\n"
                f"Time: `{now_str}`\n"
                f"CO₂: `{round(current_co2, 1)} ppm` — *{rt_level}*\n"
                f"🌡 Temp: `{weather.get('temperature', '—')}°C` | "
                f"💧 Humidity: `{weather.get('humidity', '—')}%`\n"
                f"🌬 Wind: `{weather.get('wind_speed', '—')} km/h` | "
                f"📊 Pressure: `{weather.get('pressure', '—')} hPa`"
            )
            send_telegram(msg)

        _last_alert_level["realtime"] = rt_level

        # --- AI Forecast scan for tomorrow ---
        day_key = get_day_key(samples, None)
        base_dt = datetime.strptime(day_key, "%Y-%m-%d")
        prev_key = (base_dt - timedelta(days=1)).strftime("%Y-%m-%d")
        prev_hourly = hourly_last_values(samples, prev_key)
        base_hourly = hourly_last_values(samples, day_key)
        context_seq = fill_hourly_values(prev_hourly) + fill_hourly_values(base_hourly)
        preds = predict_next_hourly_sequence(context_seq, steps=24)
        max_pred = max(preds) if preds else 0
        max_hour = preds.index(max_pred) if preds else 0

        if max_pred >= TOXIC_THRESHOLD:
            fc_level = "TOXIC"
        elif max_pred >= SAFE_THRESHOLD:
            fc_level = "ELEVATED"
        else:
            fc_level = "SAFE"

        if fc_level != _last_alert_level["forecast"] and fc_level != "SAFE":
            emoji = "🔴" if fc_level == "TOXIC" else "🟡"
            msg = (
                f"{emoji} *AI Forecast Alert — Tomorrow*\n"
                f"Peak predicted: `{round(max_pred, 1)} ppm` at `{str(max_hour).zfill(2)}:00`\n"
                f"Level: *{fc_level}*\n"
                f"_(Based on atmospheric physics + LSTM model)_"
            )
            send_telegram(msg)

        _last_alert_level["forecast"] = fc_level

    except Exception as e:
        print(f"Telegram alert check failed: {e}")


# ─── APScheduler lifecycle ───────────────────────────────────────────────────────────

_scheduler = BackgroundScheduler()
_scheduler.add_job(check_and_notify, "interval", minutes=5, id="telegram_alert_job")


@app.on_event("startup")
def startup_event():
    _scheduler.start()
    print("[OK] Telegram alert scheduler started (every 5 min).")


@app.on_event("shutdown")
def shutdown_event():
    _scheduler.shutdown(wait=False)
    print("[STOP] Scheduler stopped.")


@app.get("/test-telegram")
def test_telegram():
    """Fires a test message to verify the Telegram bot is working."""
    if not TELEGRAM_ENABLED:
        return {"status": "disabled", "message": "Telegram is not configured. Check BOT_TOKEN and CHAT_ID."}
    test_msg = (
        "✅ *Chennai Emission Dashboard — Test Notification*\n"
        "📍 Your Telegram bot is connected and working!\n"
        "You will now receive alerts whenever CO₂ crosses dangerous thresholds."
    )
    send_telegram(test_msg)
    return {"status": "sent", "message": "Test message sent to your Telegram!"}
