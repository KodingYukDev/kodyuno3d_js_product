// ============================================================
// KodyUno — starter sketches
//
// Every example runs as-is on the simulator; the parts each one expects
// are listed so the IDE can drop them onto the canvas in one click.
// ============================================================
import type { BoardType, ComponentType } from '@kodyuno/types'

export interface SketchExample {
  id: string
  title: string
  description: string
  /** Boards this example makes sense on; empty means all of them. */
  boards?: BoardType[]
  /** Parts to add to the canvas together with the code. */
  parts: ComponentType[]
  code: string
}

export const BLANK_SKETCH = `void setup() {
  // jalan sekali saat papan menyala
}

void loop() {
  // jalan berulang selamanya
}
`

export const SKETCH_EXAMPLES: SketchExample[] = [
  {
    id: 'blink',
    title: 'Blink',
    description: 'LED bawaan berkedip tiap detik. Sketch pertama semua orang.',
    parts: [],
    code: `// Blink — LED bawaan papan
void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  Serial.println("nyala");
  delay(1000);
  digitalWrite(LED_BUILTIN, LOW);
  Serial.println("mati");
  delay(1000);
}
`,
  },
  {
    id: 'blink-no-delay',
    title: 'Blink tanpa delay',
    description: 'Pakai millis() supaya papan tetap bisa mengerjakan hal lain.',
    parts: ['led', 'resistor'],
    code: `// Kedip tanpa memblokir loop()
const int ledPin = 13;
unsigned long previousMillis = 0;
const unsigned long interval = 500;
bool ledState = false;

void setup() {
  pinMode(ledPin, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  unsigned long now = millis();
  if (now - previousMillis >= interval) {
    previousMillis = now;
    ledState = !ledState;
    digitalWrite(ledPin, ledState ? HIGH : LOW);
    Serial.print("t=");
    Serial.print(now);
    Serial.print(" led=");
    Serial.println(ledState);
  }
}
`,
  },
  {
    id: 'fade',
    title: 'Fade PWM',
    description: 'analogWrite() menaikkan dan menurunkan kecerahan LED.',
    parts: ['led', 'resistor'],
    code: `// Fade — kecerahan naik turun dengan PWM
const int ledPin = 9;

void setup() {
  pinMode(ledPin, OUTPUT);
}

void loop() {
  for (int level = 0; level <= 255; level += 5) {
    analogWrite(ledPin, level);
    delay(15);
  }
  for (int level = 255; level >= 0; level -= 5) {
    analogWrite(ledPin, level);
    delay(15);
  }
}
`,
  },
  {
    id: 'button',
    title: 'Tombol dan LED',
    description: 'INPUT_PULLUP, pembacaan digital, dan debounce sederhana.',
    parts: ['pushbutton', 'led', 'resistor'],
    code: `// Tombol menyalakan LED, dengan debounce
const int buttonPin = 2;
const int ledPin = 13;

bool ledOn = false;
int lastReading = HIGH;
unsigned long lastChange = 0;

void setup() {
  pinMode(buttonPin, INPUT_PULLUP);
  pinMode(ledPin, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  int reading = digitalRead(buttonPin);
  if (reading != lastReading) {
    lastChange = millis();
    lastReading = reading;
  }
  if (millis() - lastChange > 40 && reading == LOW) {
    ledOn = !ledOn;
    digitalWrite(ledPin, ledOn);
    Serial.println(ledOn ? "LED ON" : "LED OFF");
    delay(200);
  }
}
`,
  },
  {
    id: 'potentiometer',
    title: 'Potensiometer ke Serial',
    description: 'analogRead() dan map() — dasar semua pembacaan sensor.',
    parts: ['potentiometer'],
    code: `// Baca potensiometer, tampilkan sebagai persen
const int knobPin = A0;

void setup() {
  Serial.begin(115200);
}

void loop() {
  int raw = analogRead(knobPin);
  int percent = map(raw, 0, 1023, 0, 100);
  Serial.print("raw=");
  Serial.print(raw);
  Serial.print("  persen=");
  Serial.print(percent);
  Serial.println("%");
  delay(200);
}
`,
  },
  {
    id: 'servo-sweep',
    title: 'Servo menyapu',
    description: 'Library Servo, gerak 0–180° bolak-balik.',
    parts: ['servo'],
    code: `#include <Servo.h>

Servo arm;

void setup() {
  arm.attach(9);
}

void loop() {
  for (int angle = 0; angle <= 180; angle += 2) {
    arm.write(angle);
    delay(15);
  }
  for (int angle = 180; angle >= 0; angle -= 2) {
    arm.write(angle);
    delay(15);
  }
}
`,
  },
  {
    id: 'lcd-i2c',
    title: 'LCD I2C 16×2',
    description: 'Tulis teks dan angka ke LCD lewat modul I2C.',
    parts: ['lcd', 'potentiometer'],
    code: `#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);

void setup() {
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("KodyUno siap!");
}

void loop() {
  lcd.setCursor(0, 1);
  lcd.print("Knob: ");
  lcd.print(analogRead(A0));
  lcd.print("   ");
  delay(200);
}
`,
  },
  {
    id: 'ultrasonic',
    title: 'Sensor jarak HC-SR04',
    description: 'pulseIn() mengukur waktu pantul dan mengubahnya ke sentimeter.',
    parts: ['ultrasonic'],
    code: `// HC-SR04 — ukur jarak
const int trigPin = 10;
const int echoPin = 11;

void setup() {
  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);
  Serial.begin(115200);
}

void loop() {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  long duration = pulseIn(echoPin, HIGH);
  long cm = duration / 58;

  Serial.print("Jarak: ");
  Serial.print(cm);
  Serial.println(" cm");
  delay(300);
}
`,
  },
  {
    id: 'dht',
    title: 'Suhu dan kelembapan DHT',
    description: 'Baca DHT11/DHT22 dan cetak hasilnya ke Serial.',
    parts: ['dht22'],
    code: `#include <DHT.h>

#define DHTPIN 4
#define DHTTYPE DHT22

DHT dht(DHTPIN, DHTTYPE);

void setup() {
  Serial.begin(115200);
  dht.begin();
}

void loop() {
  float suhu = dht.readTemperature();
  float lembap = dht.readHumidity();

  Serial.print("Suhu: ");
  Serial.print(suhu);
  Serial.print(" C  Kelembapan: ");
  Serial.print(lembap);
  Serial.println(" %");
  delay(1000);
}
`,
  },
  {
    id: 'ds18b20',
    title: 'Suhu DS18B20 (1-Wire)',
    description: 'Satu atau beberapa sensor DS18B20 di satu pin, dibaca dengan DallasTemperature.',
    parts: ['ds18b20'],
    code: `#include <OneWire.h>
#include <DallasTemperature.h>

// Kabel DQ di pin 2. Sensor lain boleh diparalel di kabel yang sama.
OneWire oneWire(2);
DallasTemperature sensors(&oneWire);

void setup() {
  Serial.begin(115200);
  sensors.begin();
  Serial.print("Sensor ditemukan: ");
  Serial.println(sensors.getDeviceCount());
}

void loop() {
  sensors.requestTemperatures(); // tunggu konversi (750 ms pada 12 bit)
  for (int i = 0; i < sensors.getDeviceCount(); i++) {
    Serial.print("Sensor ");
    Serial.print(i);
    Serial.print(": ");
    Serial.print(sensors.getTempCByIndex(i));
    Serial.println(" C");
  }
  delay(1000);
}
`,
  },
  {
    id: 'neopixel',
    title: 'NeoPixel pelangi',
    description: 'LED RGB addressable dengan Adafruit_NeoPixel.',
    boards: ['esp32', 'esp32-s3', 'esp32-c3', 'esp32-c6', 'esp32-s2', 'uno', 'nano'],
    parts: ['neopixel_matrix'],
    code: `#include <Adafruit_NeoPixel.h>

#define PIN 5
#define NUMPIXELS 16

Adafruit_NeoPixel strip(NUMPIXELS, PIN, NEO_GRB + NEO_KHZ800);
long hue = 0;

void setup() {
  strip.begin();
  strip.setBrightness(80);
}

void loop() {
  for (int i = 0; i < NUMPIXELS; i++) {
    strip.setPixelColor(i, strip.ColorHSV(hue + i * 3000));
  }
  strip.show();
  hue += 800;
  delay(30);
}
`,
  },
  {
    id: 'esp32-wifi',
    title: 'ESP32 WiFi dan info chip',
    description: 'Sambungkan WiFi (disimulasikan) dan cetak identitas papan.',
    boards: ['esp32', 'esp32-s3', 'esp32-s2', 'esp32-c3', 'esp32-c6'],
    parts: [],
    code: `#include <WiFi.h>

const char* ssid = "KodingYuk";
const char* password = "rahasia123";

void setup() {
  Serial.begin(115200);
  delay(200);

  Serial.print("Chip   : ");
  Serial.println(ESP.getChipModel());
  Serial.print("CPU    : ");
  Serial.print(ESP.getCpuFreqMHz());
  Serial.println(" MHz");
  Serial.print("Heap   : ");
  Serial.println(ESP.getFreeHeap());

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    delay(200);
  }
  Serial.println();
  Serial.print("IP     : ");
  Serial.println(WiFi.localIP());
}

void loop() {
  Serial.print("RSSI: ");
  Serial.println(WiFi.RSSI());
  delay(2000);
}
`,
  },
  {
    id: 'esp32-ledc',
    title: 'ESP32 LEDC PWM',
    description: 'PWM khas ESP32 lewat ledcSetup/ledcWrite, bukan analogWrite AVR.',
    boards: ['esp32', 'esp32-s3', 'esp32-s2', 'esp32-c3', 'esp32-c6'],
    parts: ['led', 'resistor'],
    code: `// LEDC — PWM khas ESP32
const int ledPin = 2;
const int channel = 0;
const int freq = 5000;
const int resolution = 8;

void setup() {
  ledcSetup(channel, freq, resolution);
  ledcAttachPin(ledPin, channel);
  Serial.begin(115200);
}

void loop() {
  for (int duty = 0; duty <= 255; duty += 5) {
    ledcWrite(channel, duty);
    delay(15);
  }
  for (int duty = 255; duty >= 0; duty -= 5) {
    ledcWrite(channel, duty);
    delay(15);
  }
}
`,
  },
  {
    id: 'oled',
    title: 'OLED SSD1306',
    description: 'Tampilkan teks di OLED 128×64 dengan API Adafruit GFX.',
    parts: ['ssd1306', 'potentiometer'],
    code: `#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

Adafruit_SSD1306 display(128, 64, &Wire, -1);
int counter = 0;

void setup() {
  display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
}

void loop() {
  display.clearDisplay();
  display.setCursor(0, 0);
  display.println("KodyUno OLED");
  display.setCursor(0, 16);
  display.print("Hitung: ");
  display.println(counter);
  display.setCursor(0, 32);
  display.print("Knob  : ");
  display.println(analogRead(A0));
  display.display();
  counter++;
  delay(400);
}
`,
  },
  {
    id: 'serial-command',
    title: 'Perintah lewat Serial',
    description: 'Ketik di kotak Serial Monitor untuk mengendalikan papan.',
    parts: ['led', 'resistor'],
    code: `// Ketik "on", "off", atau "blink" di Serial Monitor
const int ledPin = 13;
String buffer = "";

void setup() {
  pinMode(ledPin, OUTPUT);
  Serial.begin(115200);
  Serial.println("Siap. Perintah: on / off / blink");
}

void loop() {
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == '\\n' || c == '\\r') {
      buffer.trim();
      if (buffer.length() > 0) jalankan(buffer);
      buffer = "";
    } else {
      buffer += c;
    }
  }
}

void jalankan(String perintah) {
  if (perintah.equals("on")) {
    digitalWrite(ledPin, HIGH);
    Serial.println("LED menyala");
  } else if (perintah.equals("off")) {
    digitalWrite(ledPin, LOW);
    Serial.println("LED mati");
  } else if (perintah.equals("blink")) {
    for (int i = 0; i < 6; i++) {
      digitalWrite(ledPin, i % 2);
      delay(120);
    }
    Serial.println("Selesai berkedip");
  } else {
    Serial.print("Perintah tak dikenal: ");
    Serial.println(perintah);
  }
}
`,
  },
]

export function examplesForBoard(board: BoardType): SketchExample[] {
  return SKETCH_EXAMPLES.filter((example) => !example.boards || example.boards.includes(board))
}
