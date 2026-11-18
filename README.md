# ✈️ Aviation Emission Visualizer

A full-stack, real-time **aviation CO₂ emission monitoring dashboard** powered by an IoT hardware sensor (ESP32 + MQ-135), an LSTM deep learning model, Firebase Realtime Database, and a React frontend — built specifically for **Meenambakkam Airport (Chennai, India)**.

---

## 🌐 Live Dashboard Preview

> **Backend:** FastAPI (Python) &nbsp;|&nbsp; **Frontend:** React.js &nbsp;|&nbsp; **Hardware:** ESP32 + MQ-135 &nbsp;|&nbsp; **ML Model:** LSTM (TensorFlow/Keras)

---

## 📋 Table of Contents

- [Features](#-features)
- [System Architecture](#-system-architecture)
- [Tech Stack](#-tech-stack)
- [Hardware Setup (ESP32)](#-hardware-setup-esp32)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
  - [Backend Setup](#backend-setup)
  - [Frontend Setup](#frontend-setup)
- [API Endpoints](#-api-endpoints)
- [Environment Configuration](#-environment-configuration)
- [Alerts & Notifications](#-alerts--notifications)
- [ML Model Details](#-ml-model-details)

---

## 🚀 Features

- 📡 **Real-Time CO₂ Monitoring** — Live sensor readings from an MQ-135 gas sensor via ESP32, streamed to Firebase every 10 seconds
- 🧠 **LSTM-Based Prediction** — Deep learning model forecasts next CO₂ values using the last 5 hourly readings
- ☁️ **Atmospheric Intelligence** — Integrates live weather data (temperature, humidity, wind speed, pressure) from Open-Meteo API to adjust predictions using a physics-based model
- 🗺️ **Live Flight Tracking Map** — Real-time aircraft positions around Chennai fetched from FlightRadar24 and OpenSky Network
- 📊 **Historical Analytics** — 7-day aggregated CO₂ history with daily peak, minimum, and average values
- ⏱️ **Hourly Environmental Panel** — Per-hour CO₂ and atmospheric stats with AQI classification
- 🔔 **Telegram Notifications** — Automated threshold-breach alerts sent to your phone via a Telegram bot
- 🚨 **Smart Alert System** — Real-time and AI-predictive warnings when CO₂ approaches or crosses safe/toxic thresholds
- 🌍 **Pollution Index** — EPA-inspired weighted pollution index scoring CO₂, wind dispersion, humidity, temperature, and pressure

---

## 🏗️ System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        IoT Hardware                          │
│   ESP32 + MQ-135 Sensor                                      │
│   → Reads CO₂ every 10s                                      │
│   → Sends to Firebase Realtime DB via HTTP POST              │
└──────────────────────┬───────────────────────────────────────┘
                       │ Firebase
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                    FastAPI Backend                            │
│   - Fetches Firebase sensor_data node                        │
│   - Runs LSTM inference (TensorFlow/Keras)                   │
│   - Applies Open-Meteo weather adjustments                   │
│   - Proxies FlightRadar24 / OpenSky flight data             │
│   - Sends Telegram alerts on threshold breach                │
└──────────────────────┬───────────────────────────────────────┘
                       │ REST API
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                     React Frontend                           │
│   - Real-time CO₂ chart (last 1 hour)                       │
│   - LSTM prediction curve                                    │
│   - Live flight map (Leaflet.js)                             │
│   - Historical analytics tab                                 │
│   - Hourly environmental status panel                        │
│   - Alert notification system                                │
└──────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React.js, Leaflet.js, Chart.js |
| **Backend** | FastAPI (Python 3.10+) |
| **ML Model** | TensorFlow/Keras (LSTM), Scikit-learn (MinMaxScaler) |
| **Database** | Firebase Realtime Database |
| **IoT Hardware** | ESP32 DevKit, MQ-135 CO₂ Gas Sensor |
| **Weather API** | Open-Meteo (free, no API key required) |
| **Flight Data** | FlightRadar24 API, OpenSky Network |
| **Notifications** | Telegram Bot API |
| **Scheduler** | APScheduler (background jobs) |

---

## 🔌 Hardware Setup (ESP32)

### Components Required
- ESP32 DevKit V1
- MQ-135 Air Quality Gas Sensor
- Micro-USB cable
- Jumper wires

### Wiring

| MQ-135 Pin | ESP32 Pin |
|------------|-----------|
| VCC | 3.3V / 5V |
| GND | GND |
| AOUT (Analog) | GPIO 34 |

### Flashing the ESP32

1. Open `esp32/esp32_code.ino` in **Arduino IDE**
2. Install required libraries:
   - `WiFi.h` (built-in)
   - `HTTPClient.h` (built-in)
3. Update your credentials in the sketch:
   ```cpp
   const char* ssid = "YOUR_WIFI_SSID";
   const char* password = "YOUR_WIFI_PASSWORD";
   String firebaseHost = "https://YOUR-PROJECT-default-rtdb.firebaseio.com";
   ```
4. Select **Board:** `ESP32 Dev Module` → **Upload**

The ESP32 reads CO₂ every **10 seconds**, timestamps it via NTP (IST, UTC+5:30), and pushes it to Firebase.

---

## 📁 Project Structure

```
Aviation-Emission-Visualizer/
│
├── backend/
│   ├── main.py               # FastAPI app — all API endpoints & ML logic
│   ├── lstm.py               # LSTM model training script
│   ├── generate_dataset.py   # Synthetic dataset generator for training
│   ├── debug_firebase.py     # Firebase connection debugger
│   ├── lstm_model.keras      # Trained LSTM model weights
│   ├── model.pkl             # Auxiliary ML model
│   ├── scaler.pkl            # MinMaxScaler for LSTM input normalization
│   ├── requirements.txt      # Python dependencies
│   └── dataset/              # CO₂ training datasets (10 parts)
│
├── frontend/
│   ├── src/
│   │   ├── App.js            # Main dashboard component
│   │   ├── FlightMap.js      # Live flight tracking map (Leaflet)
│   │   ├── App.css           # Dashboard styles
│   │   └── index.js          # React entry point
│   ├── public/
│   └── package.json
│
├── Datasets/                 # Airport emission datasets (10 parts)
├── esp32/
│   └── esp32_code.ino        # Arduino sketch for ESP32 + MQ-135
│
├── co2_prediction_model.pkl  # CO₂ prediction model (root-level)
├── main.py                   # Root launcher script
├── server.py                 # Alternate server entry
├── pyrightconfig.json        # Python type-checking config
├── .gitignore
└── README.md
```

---

## 🚦 Getting Started

### Prerequisites

- Python 3.10+
- Node.js 18+ & npm
- Firebase project with Realtime Database enabled
- (Optional) Telegram bot token & chat ID for notifications

---

### Backend Setup

```bash
# 1. Navigate to the backend directory
cd backend

# 2. Create a virtual environment
python -m venv venv
venv\Scripts\activate       # Windows
# source venv/bin/activate  # macOS/Linux

# 3. Install dependencies
pip install -r requirements.txt
pip install FlightRadar24 apscheduler requests

# 4. Add your Firebase key
# Place your Firebase service account JSON as:
#   backend/firebase_key.json
# (Download from Firebase Console → Project Settings → Service Accounts)

# 5. Start the backend server
uvicorn main:app --reload --port 8000
```

The API will be available at: **http://localhost:8000**

---

### Frontend Setup

```bash
# 1. Navigate to the frontend directory
cd frontend

# 2. Install dependencies
npm install

# 3. Start the development server
npm start
```

The dashboard will open at: **http://localhost:3000**

---

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/data` | Real-time CO₂ values (last 1hr) + LSTM prediction + weather |
| `GET` | `/latest` | Most recent single CO₂ reading with level classification |
| `GET` | `/historical` | 7-day daily summary (peak, min, avg) |
| `GET` | `/hourly/realtime?date=YYYY-MM-DD` | Hourly CO₂ buckets for a specific day |
| `GET` | `/hourly/stats?date=YYYY-MM-DD` | Hourly CO₂ + atmospheric stats with AQI |
| `GET` | `/alerts` | Active real-time and AI-predicted alerts |
| `GET` | `/predict` | Multivariate pollution index with 24hr forecast curve |
| `GET` | `/flights` | Live flight data around Chennai airport |
| `GET` | `/hourly/forecast` | LSTM-based 24-hour CO₂ forecast |

---

## ⚙️ Environment Configuration

### Backend — `backend/main.py`

```python
# Telegram Notifications (optional)
TELEGRAM_BOT_TOKEN = "your_bot_token"
TELEGRAM_CHAT_ID   = "your_chat_id"

# CO₂ Thresholds (ppm)
SAFE_THRESHOLD  = 800.0   # Above this → "Medium" alert
TOXIC_THRESHOLD = 1200.0  # Above this → "Toxic" alert

# Firebase DB URL
"databaseURL": "https://YOUR-PROJECT-default-rtdb.firebaseio.com/"
```

> ⚠️ **Never commit `firebase_key.json` to GitHub.** It is already excluded in `.gitignore`.

---

## 🔔 Alerts & Notifications

### Dashboard Alerts
The `/alerts` endpoint checks two conditions:
1. **Real-time breach** — If current CO₂ ≥ 800 ppm (warning) or ≥ 1200 ppm (danger)
2. **AI Predictive breach** — If tomorrow's LSTM forecast exceeds thresholds at any hour

### Telegram Bot Setup
1. Message **@BotFather** on Telegram → `/newbot` → copy your token
2. Message **@userinfobot** → copy your Chat ID
3. Add both to `main.py` in the Telegram config section
4. The system auto-sends threshold breach alerts via APScheduler background jobs

---

## 🧠 ML Model Details

### LSTM Architecture
- **Input:** Last 5 hourly CO₂ readings (normalized via MinMaxScaler)
- **Architecture:** LSTM → Dense output layer
- **Training data:** 10-part airport CO₂ dataset + synthetic Firebase readings
- **Inference:** Iterative 1-step forecasting for 24-hour horizon

### Atmospheric Adjustment Engine
The raw LSTM prediction is adjusted using live weather parameters:

| Factor | Effect |
|--------|--------|
| **Wind Speed** | High wind disperses CO₂ (reduces prediction by up to 15%) |
| **Temperature** | High temps increase VOC/CO₂ reactions (slight increase) |
| **Humidity** | High humidity traps particulates near surface (slight increase) |

The combined modifier is clamped to **±25%** to prevent physically implausible results.

### Pollution Index Weights (EPA-inspired)
| Factor | Weight |
|--------|--------|
| CO₂ | 45% |
| Wind Dispersion | 25% |
| Humidity | 12% |
| Temperature | 10% |
| Pressure | 8% |

---

## 📊 CO₂ Level Classification

| Level | CO₂ Range | Color |
|-------|-----------|-------|
| ✅ Safe | < 800 ppm | Green |
| ⚠️ Medium | 800 – 1199 ppm | Orange |
| 🔴 Toxic | ≥ 1200 ppm | Red |

---

## 👤 Author

**Thamotharan**  
📧 tharanthamo018@gmail.com  
🔗 [github.com/thamosl](https://github.com/thamosl)

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
