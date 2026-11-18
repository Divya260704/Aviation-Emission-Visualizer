import pandas as pd
import numpy as np
from sklearn.preprocessing import MinMaxScaler
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, Dense
import glob
import pickle

# 🔥 Load all CSV files
files = glob.glob("dataset/*.csv")

df_list = [pd.read_csv(f) for f in files]
df = pd.concat(df_list, ignore_index=True)

print("Total rows:", len(df))

# 🔥 Use only CO2 values
data = df['co2'].values.reshape(-1, 1)

# 🔥 Normalize
scaler = MinMaxScaler()
data_scaled = scaler.fit_transform(data)

# 🔥 Create sequences
X = []
y = []

window_size = 5

for i in range(len(data_scaled) - window_size):
    X.append(data_scaled[i:i+window_size])
    y.append(data_scaled[i+window_size])

X = np.array(X)
y = np.array(y)

print("Shape:", X.shape)

# 🔥 Build LSTM
model = Sequential([
    LSTM(50, input_shape=(window_size, 1)),
    Dense(1)
])

model.compile(optimizer='adam', loss='mse')

# 🔥 Train
model.fit(X, y, epochs=5, batch_size=64)

# 🔥 Save model
model.save("lstm_model.keras")

# 🔥 Save scaler
with open("scaler.pkl", "wb") as f:
    pickle.dump(scaler, f)

print("✅ Model Trained & Saved")