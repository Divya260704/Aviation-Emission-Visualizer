import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import os

# Create folder
os.makedirs("dataset", exist_ok=True)

rows_per_file = 50000
num_files = 10

start_time = datetime(2025, 1, 1, 0, 0, 0)

for file_num in range(num_files):
    data = []
    current_time = start_time + timedelta(seconds=file_num * rows_per_file)

    co2 = 400  # starting value

    for i in range(rows_per_file):
        # simulate realistic fluctuation
        co2 += np.random.randint(-5, 10)
        co2 = max(350, min(2000, co2))

        data.append([
            current_time.strftime("%Y-%m-%d %H:%M:%S"),
            co2
        ])

        current_time += timedelta(seconds=5)

    df = pd.DataFrame(data, columns=["datetime", "co2"])

    df.to_csv(f"dataset/co2_data_{file_num+1}.csv", index=False)

print("✅ Dataset Generated (10 files, 500k rows total)")