"""Quick Firebase diagnostic - run with: python debug_firebase.py"""
import firebase_admin
from firebase_admin import credentials, db
from pathlib import Path
import json
import sys

# Force UTF-8 output on Windows
sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = Path(__file__).resolve().parent
cred = credentials.Certificate(str(BASE_DIR / "firebase_key.json"))
firebase_admin.initialize_app(cred, {
    "databaseURL": "https://emission-data-53ea6-default-rtdb.firebaseio.com/"
})

print("Connecting to Firebase...")
ref = db.reference("data")
data = ref.get()

if not data:
    print("NO DATA found at 'data' node in Firebase.")
else:
    keys = list(data.keys())
    print(f"TOTAL RECORDS: {len(keys)}")
    print("\n--- First 3 records ---")
    for k in keys[:3]:
        print(f"  KEY: {k}  VALUE: {json.dumps(data[k])}")
    print("\n--- Last 3 records ---")
    for k in keys[-3:]:
        print(f"  KEY: {k}  VALUE: {json.dumps(data[k])}")
    sample = data[keys[0]]
    if isinstance(sample, dict):
        print(f"\nFIELDS in a record: {list(sample.keys())}")
    else:
        print(f"\nRecord is not a dict, raw value: {sample}")
