from fastapi import FastAPI
import firebase_admin
from firebase_admin import credentials, db
import numpy as np
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, Dense

app = FastAPI()

# Firebase setup
cred = credentials.Certificate("firebase_key.json")
firebase_admin.initialize_app(cred, {
    'databaseURL': 'https://emission-data-53ea6-default-rtdb.firebaseio.com/'
})

# Get data
def get_data():
    ref = db.reference('data')
    data = ref.get()

    co2_values = []

    for key in data:
        co2_values.append(data[key]['co2'])

    return np.array(co2_values)

# Train LSTM
def train_lstm(data):
    data = data.reshape(-1, 1)

    X, y = [], []

    for i in range(len(data)-3):
        X.append(data[i:i+3])
        y.append(data[i+3])

    X, y = np.array(X), np.array(y)

    model = Sequential([
        LSTM(50, return_sequences=False, input_shape=(3,1)),
        Dense(1)
    ])

    model.compile(optimizer='adam', loss='mse')
    model.fit(X, y, epochs=5, verbose=0)

    pred = model.predict(X[-1].reshape(1,3,1))

    return float(pred[0][0])

@app.get("/data")
def get_co2_data():
    data = get_data()
    prediction = train_lstm(data)

    return {
        "co2": data.tolist(),
        "prediction": prediction
    }