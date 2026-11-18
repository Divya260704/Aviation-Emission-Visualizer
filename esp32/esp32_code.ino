#include <WiFi.h>
#include <HTTPClient.h>
#include <time.h>

#define MQ135_PIN 34   // FIXED PIN

const char* ssid = "Thamo's POCO F4";
const char* password = "sollamaaten";

String firebaseHost = "https://emission-data-53ea6-default-rtdb.firebaseio.com";

// NTP Server
const char* ntpServer = "pool.ntp.org";
long gmtOffset_sec = 19800;   // IST (UTC +5:30)
int daylightOffset_sec = 0;

void setup() {
  Serial.begin(115200);

  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println(" Connected");

  // Configure time
  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);

  Serial.println("Waiting for time sync...");
  delay(2000);
}

void loop() {

  // 🔹 Read CO2
  int co2 = analogRead(MQ135_PIN);

  if (co2 == 0) {
    Serial.println("⚠️ Sensor not reading! Check wiring.");
  }

  // 🔹 Get time
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    Serial.println("Failed to obtain time");
    return;
  }

  // 🔹 Format date & time
  char formattedTime[30];
  strftime(formattedTime, sizeof(formattedTime), "%Y-%m-%d %H:%M:%S", &timeinfo);

  Serial.print("CO2 Value: ");
  Serial.println(co2);

  Serial.print("Date & Time: ");
  Serial.println(formattedTime);

  // 🔹 Send to Firebase
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;

    String url = firebaseHost + "/sensor_data.json";
    http.begin(url);
    http.addHeader("Content-Type", "application/json");

    String jsonData = "{";
    jsonData += "\"co2\":" + String(co2) + ",";
    jsonData += "\"datetime\":\"" + String(formattedTime) + "\"";
    jsonData += "}";

    int httpResponseCode = http.POST(jsonData);

    Serial.print("HTTP Response Code: ");
    Serial.println(httpResponseCode);

    http.end();
  }

  delay(10000);
}