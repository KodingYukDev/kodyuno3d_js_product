// ============================================================
// KodyUno — offline library catalogue
//
// A curated index of libraries the Arduino world actually uses, shipped
// with the app so the search box works with no network call and no server
// of ours. Entries here are stubbed: their classes exist so a sketch keeps
// running, and the serial monitor says which calls were ignored.
//
// A library that is not in this list still works — upload its ZIP and the
// interpreter parses the real source.
// ============================================================
import type { SimLibrary } from './types'

type CatalogEntry = Omit<SimLibrary, 'support' | 'install'>

const entry = (value: CatalogEntry): SimLibrary => ({ ...value, support: 'stub' })

export const CATALOG_LIBRARIES: SimLibrary[] = [
  entry({
    id: 'fastled', name: 'FastLED', author: 'Daniel Garcia, Mark Kriegsman', version: '3.9.9',
    category: 'Display', description: 'LED addressable dengan efek cepat, alternatif Adafruit NeoPixel.',
    headers: ['FastLED.h'], keywords: ['fastled', 'ws2812', 'rgb', 'strip', 'led'], types: ['CRGB', 'CHSV', 'CFastLED'],
  }),
  entry({
    id: 'irremote', name: 'IRremote', author: 'Armin Joachimsmeyer', version: '4.4.1',
    category: 'Komunikasi', description: 'Kirim dan terima kode remote inframerah.',
    headers: ['IRremote.h', 'IRremote.hpp'], keywords: ['ir', 'infrared', 'remote', 'tv'], types: ['IRrecv', 'IRsend', 'decode_results'],
  }),
  entry({
    id: 'mfrc522', name: 'MFRC522', author: 'GithubCommunity', version: '1.4.12',
    category: 'Komunikasi', description: 'Pembaca kartu RFID RC522 lewat SPI.',
    headers: ['MFRC522.h'], keywords: ['rfid', 'rc522', 'nfc', 'kartu'], types: ['MFRC522'],
  }),
  entry({
    id: 'arduinojson', name: 'ArduinoJson', author: 'Benoit Blanchon', version: '7.2.1',
    category: 'Utilitas', description: 'Parse dan bangun JSON di mikrokontroler.',
    headers: ['ArduinoJson.h'], keywords: ['json', 'api', 'parse', 'serialize'], types: ['JsonDocument', 'StaticJsonDocument', 'DynamicJsonDocument', 'JsonObject', 'JsonArray'],
  }),
  entry({
    id: 'pubsubclient', name: 'PubSubClient', author: 'Nick O\'Leary', version: '2.8.0',
    category: 'Komunikasi', description: 'Klien MQTT untuk ESP32, ESP8266, dan Ethernet shield.',
    headers: ['PubSubClient.h'], keywords: ['mqtt', 'iot', 'broker', 'publish'], types: ['PubSubClient'],
  }),
  entry({
    id: 'blynk', name: 'Blynk', author: 'Volodymyr Shymanskyy', version: '1.3.2',
    category: 'Komunikasi', description: 'Dashboard IoT dan kontrol dari aplikasi ponsel.',
    headers: ['BlynkSimpleEsp32.h', 'BlynkSimpleEsp8266.h'], keywords: ['blynk', 'iot', 'dashboard'], types: ['BlynkTimer'],
  }),
  entry({
    id: 'esp-async-webserver', name: 'ESPAsyncWebServer', author: 'Hristo Gochkov', version: '3.3.0',
    category: 'Komunikasi', description: 'Web server asinkron untuk ESP32 dan ESP8266.',
    headers: ['ESPAsyncWebServer.h'], keywords: ['web', 'server', 'http', 'esp32'], types: ['AsyncWebServer', 'AsyncWebServerRequest'],
  }),
  entry({
    id: 'webserver', name: 'WebServer (ESP32)', author: 'Espressif', version: 'core',
    category: 'Komunikasi', description: 'Web server sinkron bawaan core ESP32.',
    headers: ['WebServer.h', 'ESP8266WebServer.h'], keywords: ['web', 'http', 'server'], types: ['WebServer', 'ESP8266WebServer'],
  }),
  entry({
    id: 'httpclient', name: 'HTTPClient', author: 'Espressif', version: 'core',
    category: 'Komunikasi', description: 'Permintaan HTTP dari ESP32 dan ESP8266.',
    headers: ['HTTPClient.h', 'ESP8266HTTPClient.h'], keywords: ['http', 'rest', 'api', 'get', 'post'], types: ['HTTPClient'],
  }),
  entry({
    id: 'ble', name: 'ESP32 BLE Arduino', author: 'Neil Kolban', version: 'core',
    category: 'Komunikasi', description: 'Bluetooth Low Energy server dan client di ESP32.',
    headers: ['BLEDevice.h', 'BLEServer.h', 'BLEUtils.h', 'BLE2902.h'],
    keywords: ['ble', 'bluetooth', 'esp32'], types: ['BLEServer', 'BLEService', 'BLECharacteristic', 'BLEAdvertising'],
    boards: ['esp32', 'esp32-s3', 'esp32-c3', 'esp32-c6'],
  }),
  entry({
    id: 'bluetoothserial', name: 'BluetoothSerial', author: 'Espressif', version: 'core',
    category: 'Komunikasi', description: 'Bluetooth Classic SPP di ESP32 klasik.',
    headers: ['BluetoothSerial.h'], keywords: ['bluetooth', 'spp', 'serial'], types: ['BluetoothSerial'],
    boards: ['esp32'],
  }),
  entry({
    id: 'preferences', name: 'Preferences', author: 'Espressif', version: 'core',
    category: 'Penyimpanan', description: 'Penyimpanan key-value NVS di ESP32.',
    headers: ['Preferences.h'], keywords: ['nvs', 'simpan', 'preferences', 'flash'], types: ['Preferences'],
    boards: ['esp32', 'esp32-s3', 'esp32-s2', 'esp32-c3', 'esp32-c6'],
  }),
  entry({
    id: 'spiffs', name: 'SPIFFS / LittleFS', author: 'Espressif', version: 'core',
    category: 'Penyimpanan', description: 'Sistem berkas di flash internal.',
    headers: ['SPIFFS.h', 'LittleFS.h', 'FS.h'], keywords: ['file', 'flash', 'spiffs', 'littlefs'], types: ['File', 'FS'],
  }),
  entry({
    id: 'sd', name: 'SD', author: 'Arduino, SparkFun', version: '1.3.0',
    category: 'Penyimpanan', description: 'Baca dan tulis kartu SD lewat SPI.',
    headers: ['SD.h', 'SD_MMC.h'], keywords: ['sd', 'kartu', 'file', 'log'], types: ['SDClass', 'File'],
  }),
  entry({
    id: 'adafruit-sensor', name: 'Adafruit Unified Sensor', author: 'Adafruit', version: '1.1.14',
    category: 'Sensor', description: 'Lapisan sensor bersama untuk library Adafruit.',
    headers: ['Adafruit_Sensor.h'], keywords: ['sensor', 'adafruit', 'unified'], types: ['sensors_event_t', 'Adafruit_Sensor'],
  }),
  entry({
    id: 'bmp280', name: 'Adafruit BMP280', author: 'Adafruit', version: '2.6.8',
    category: 'Sensor', description: 'Sensor tekanan dan suhu barometrik BMP280.',
    headers: ['Adafruit_BMP280.h'], keywords: ['bmp280', 'tekanan', 'barometer', 'altitude'], types: ['Adafruit_BMP280'],
  }),
  entry({
    id: 'bme280', name: 'Adafruit BME280', author: 'Adafruit', version: '2.2.4',
    category: 'Sensor', description: 'Suhu, kelembapan, dan tekanan dalam satu chip.',
    headers: ['Adafruit_BME280.h'], keywords: ['bme280', 'cuaca', 'humidity', 'tekanan'], types: ['Adafruit_BME280'],
  }),
  entry({
    id: 'mlx90614', name: 'Adafruit MLX90614', author: 'Adafruit', version: '2.1.5',
    category: 'Sensor', description: 'Termometer inframerah non-kontak.',
    headers: ['Adafruit_MLX90614.h'], keywords: ['mlx90614', 'suhu', 'inframerah', 'non kontak'], types: ['Adafruit_MLX90614'],
  }),
  entry({
    id: 'max30100', name: 'MAX30100 Pulse Oximeter', author: 'OXullo Intersecans', version: '1.2.1',
    category: 'Sensor', description: 'Sensor detak jantung dan SpO2.',
    headers: ['MAX30100_PulseOximeter.h'], keywords: ['max30100', 'detak', 'spo2', 'oximeter'], types: ['PulseOximeter'],
  }),
  entry({
    id: 'tinygps', name: 'TinyGPSPlus', author: 'Mikal Hart', version: '1.1.0',
    category: 'Sensor', description: 'Parser NMEA untuk modul GPS.',
    headers: ['TinyGPS++.h', 'TinyGPSPlus.h'], keywords: ['gps', 'nmea', 'lokasi', 'neo-6m'], types: ['TinyGPSPlus'],
  }),
  entry({
    id: 'ultrasonic', name: 'Ultrasonic', author: 'Erick Simões', version: '3.0.0',
    category: 'Sensor', description: 'Pembacaan HC-SR04 yang ringkas.',
    headers: ['Ultrasonic.h'], keywords: ['ultrasonic', 'hc-sr04', 'jarak'], types: ['Ultrasonic'],
  }),
  entry({
    id: 'dallas-ds3231', name: 'DS3231', author: 'Andrew Wickert', version: '1.1.2',
    category: 'Utilitas', description: 'RTC DS3231 presisi tinggi dengan alarm.',
    headers: ['DS3231.h'], keywords: ['ds3231', 'rtc', 'alarm', 'jam'], types: ['DS3231', 'RTClib'],
  }),
  entry({
    id: 'timerone', name: 'TimerOne', author: 'Paul Stoffregen', version: '1.1.1',
    category: 'Utilitas', description: 'Interrupt periodik dari Timer1 pada AVR.',
    headers: ['TimerOne.h'], keywords: ['timer', 'interrupt', 'periodik'], types: ['TimerOne'],
    boards: ['uno', 'nano', 'mega'],
  }),
  entry({
    id: 'ticker', name: 'Ticker', author: 'Espressif', version: 'core',
    category: 'Utilitas', description: 'Jadwalkan fungsi berkala tanpa memblokir loop().',
    headers: ['Ticker.h'], keywords: ['ticker', 'timer', 'schedule'], types: ['Ticker'],
  }),
  entry({
    id: 'bounce2', name: 'Bounce2', author: 'Thomas Fredericks', version: '2.72.0',
    category: 'Input', description: 'Debounce tombol tanpa delay().',
    headers: ['Bounce2.h'], keywords: ['debounce', 'tombol', 'button'], types: ['Bounce', 'Bounce2'],
  }),
  entry({
    id: 'onebutton', name: 'OneButton', author: 'Matthias Hertel', version: '2.6.1',
    category: 'Input', description: 'Klik, klik ganda, dan tekan lama dari satu tombol.',
    headers: ['OneButton.h'], keywords: ['tombol', 'button', 'klik', 'longpress'], types: ['OneButton'],
  }),
  entry({
    id: 'encoder', name: 'Encoder', author: 'Paul Stoffregen', version: '1.4.4',
    category: 'Input', description: 'Rotary encoder dengan pembacaan berbasis interrupt.',
    headers: ['Encoder.h'], keywords: ['encoder', 'rotary', 'ky-040'], types: ['Encoder'],
  }),
  entry({
    id: 'accelstepper', name: 'AccelStepper', author: 'Mike McCauley', version: '1.64.0',
    category: 'Aktuator', description: 'Stepper dengan akselerasi dan gerak non-blocking.',
    headers: ['AccelStepper.h'], keywords: ['stepper', 'akselerasi', 'motor', 'cnc'], types: ['AccelStepper', 'MultiStepper'],
  }),
  entry({
    id: 'afmotor', name: 'Adafruit Motor Shield', author: 'Adafruit', version: '1.0.1',
    category: 'Aktuator', description: 'Motor DC dan stepper lewat motor shield L293D.',
    headers: ['AFMotor.h', 'Adafruit_MotorShield.h'], keywords: ['motor', 'l293d', 'shield', 'dc'], types: ['AF_DCMotor', 'AF_Stepper', 'Adafruit_MotorShield'],
  }),
  entry({
    id: 'pca9685', name: 'Adafruit PWM Servo Driver', author: 'Adafruit', version: '3.0.2',
    category: 'Aktuator', description: '16 kanal PWM/servo lewat PCA9685 I2C.',
    headers: ['Adafruit_PWMServoDriver.h'], keywords: ['pca9685', 'servo', 'pwm', '16 channel'], types: ['Adafruit_PWMServoDriver'],
  }),
  entry({
    id: 'u8g2', name: 'U8g2', author: 'Oliver Kraus', version: '2.35.30',
    category: 'Display', description: 'Driver monokrom untuk OLED dan LCD grafis dengan banyak font.',
    headers: ['U8g2lib.h', 'U8x8lib.h'], keywords: ['u8g2', 'oled', 'font', 'grafis'], types: ['U8G2_SSD1306_128X64_NONAME_F_HW_I2C', 'U8X8_SSD1306_128X64_NONAME_HW_I2C'],
  }),
  entry({
    id: 'tft-espi', name: 'TFT_eSPI', author: 'Bodmer', version: '2.5.43',
    category: 'Display', description: 'Layar TFT SPI cepat untuk ESP32 dan ESP8266.',
    headers: ['TFT_eSPI.h'], keywords: ['tft', 'ili9341', 'st7789', 'layar'], types: ['TFT_eSPI', 'TFT_eSprite'],
  }),
  entry({
    id: 'adafruit-ili9341', name: 'Adafruit ILI9341', author: 'Adafruit', version: '1.6.1',
    category: 'Display', description: 'Layar TFT 2.4 inci 240×320 dengan API GFX.',
    headers: ['Adafruit_ILI9341.h'], keywords: ['ili9341', 'tft', 'layar', 'gfx'], types: ['Adafruit_ILI9341'],
  }),
  entry({
    id: 'tm1637', name: 'TM1637', author: 'Avishay Orpaz', version: '1.2.0',
    category: 'Display', description: 'Modul 7-segment 4 digit berbasis TM1637.',
    headers: ['TM1637Display.h'], keywords: ['tm1637', '7 segment', 'digit', 'jam'], types: ['TM1637Display'],
  }),
  entry({
    id: 'sevseg', name: 'SevSeg', author: 'Dean Reading', version: '3.7.0',
    category: 'Display', description: 'Display 7-segment multi digit tanpa driver tambahan.',
    headers: ['SevSeg.h'], keywords: ['7 segment', 'display', 'digit'], types: ['SevSeg'],
  }),
  entry({
    id: 'ntpclient', name: 'NTPClient', author: 'Fabrice Weinberg', version: '3.2.1',
    category: 'Utilitas', description: 'Sinkronisasi jam lewat NTP di board berjaringan.',
    headers: ['NTPClient.h'], keywords: ['ntp', 'jam', 'waktu', 'sync'], types: ['NTPClient'],
  }),
  entry({
    id: 'dfplayer', name: 'DFRobotDFPlayerMini', author: 'DFRobot', version: '1.0.6',
    category: 'Aktuator', description: 'Pemutar MP3 dari kartu microSD lewat serial.',
    headers: ['DFRobotDFPlayerMini.h'], keywords: ['mp3', 'dfplayer', 'audio', 'suara'], types: ['DFRobotDFPlayerMini'],
  }),
  entry({
    id: 'thingspeak', name: 'ThingSpeak', author: 'MathWorks', version: '2.1.1',
    category: 'Komunikasi', description: 'Kirim data sensor ke channel ThingSpeak.',
    headers: ['ThingSpeak.h'], keywords: ['thingspeak', 'cloud', 'iot', 'grafik'], types: ['ThingSpeakClass'],
  }),
  entry({
    id: 'firebase-esp', name: 'Firebase ESP Client', author: 'Mobizt', version: '4.4.14',
    category: 'Komunikasi', description: 'Realtime Database dan Firestore dari ESP32/ESP8266.',
    headers: ['Firebase_ESP_Client.h', 'FirebaseESP32.h'], keywords: ['firebase', 'cloud', 'database', 'iot'], types: ['FirebaseData', 'FirebaseAuth', 'FirebaseConfig'],
  }),
  entry({
    id: 'esp32servo360', name: 'ESP32 PWM', author: 'Espressif', version: 'core',
    category: 'Aktuator', description: 'Kontrol PWM LEDC bawaan ESP32.',
    headers: ['analogWrite.h'], keywords: ['pwm', 'ledc', 'esp32'], types: [],
    boards: ['esp32', 'esp32-s3', 'esp32-s2', 'esp32-c3', 'esp32-c6'],
  }),
  entry({
    id: 'painlessmesh', name: 'painlessMesh', author: 'painlessMesh team', version: '1.5.0',
    category: 'Komunikasi', description: 'Jaringan mesh antar ESP tanpa router.',
    headers: ['painlessMesh.h'], keywords: ['mesh', 'esp-now', 'jaringan'], types: ['painlessMesh'],
  }),
  entry({
    id: 'espnow', name: 'ESP-NOW', author: 'Espressif', version: 'core',
    category: 'Komunikasi', description: 'Kirim paket langsung antar ESP tanpa WiFi AP.',
    headers: ['esp_now.h'], keywords: ['esp-now', 'peer', 'wireless'], types: ['esp_now_peer_info_t'],
    boards: ['esp32', 'esp32-s3', 'esp32-s2', 'esp32-c3', 'esp32-c6', 'esp8266'],
  }),
  entry({
    id: 'nrf24', name: 'RF24', author: 'TMRh20', version: '1.4.11',
    category: 'Komunikasi', description: 'Radio 2.4GHz nRF24L01 untuk komunikasi antar board.',
    headers: ['RF24.h', 'nRF24L01.h'], keywords: ['nrf24', 'radio', 'wireless', '2.4ghz'], types: ['RF24'],
  }),
  entry({
    id: 'ethernet', name: 'Ethernet', author: 'Arduino', version: '2.0.2',
    category: 'Komunikasi', description: 'Shield Ethernet W5100/W5500.',
    headers: ['Ethernet.h'], keywords: ['ethernet', 'w5500', 'lan'], types: ['EthernetClient', 'EthernetServer'],
  }),
  entry({
    id: 'lowpower', name: 'LowPower', author: 'Rocket Scream', version: '1.81.0',
    category: 'Utilitas', description: 'Mode sleep hemat daya untuk AVR.',
    headers: ['LowPower.h'], keywords: ['sleep', 'hemat daya', 'baterai'], types: ['LowPowerClass'],
    boards: ['uno', 'nano', 'mega'],
  }),
  entry({
    id: 'pid', name: 'PID', author: 'Brett Beauregard', version: '1.2.1',
    category: 'Utilitas', description: 'Kontroler PID untuk suhu, kecepatan, dan balancing.',
    headers: ['PID_v1.h'], keywords: ['pid', 'kontrol', 'balancing', 'suhu'], types: ['PID'],
  }),
  entry({
    id: 'kalman', name: 'SimpleKalmanFilter', author: 'Denys Sene', version: '0.1.0',
    category: 'Utilitas', description: 'Filter Kalman ringan untuk menghaluskan pembacaan sensor.',
    headers: ['SimpleKalmanFilter.h'], keywords: ['kalman', 'filter', 'noise', 'smoothing'], types: ['SimpleKalmanFilter'],
  }),
  entry({
    id: 'movingaverage', name: 'MovingAverage', author: 'Rob Tillaart', version: '0.2.0',
    category: 'Utilitas', description: 'Rata-rata bergerak untuk data sensor.',
    headers: ['MovingAverage.h', 'RunningAverage.h'], keywords: ['average', 'filter', 'rata-rata'], types: ['MovingAverage', 'RunningAverage'],
  }),
  entry({
    id: 'capacitivesensor', name: 'CapacitiveSensor', author: 'Paul Badger', version: '0.5.1',
    category: 'Input', description: 'Sensor sentuh kapasitif dari dua pin dan satu resistor.',
    headers: ['CapacitiveSensor.h'], keywords: ['touch', 'sentuh', 'kapasitif'], types: ['CapacitiveSensor'],
  }),
]
