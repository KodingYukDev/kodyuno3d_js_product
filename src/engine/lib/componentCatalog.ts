import type { ComponentType } from '@kodyuno/types'

export type ComponentCategory = 'Dasar' | 'Input' | 'Sensor' | 'Output' | 'Modul' | 'Display'

export interface CatalogPart {
  type: ComponentType
  label: string
  category: ComponentCategory
  emoji: string
  description: string
  pins: { role: string; pin: number | string }[]
}

const pin = (role: string) => ({ role, pin: '' })

export const COMPONENT_CATALOG: CatalogPart[] = [
  { type: 'led', label: 'LED 5mm', category: 'Dasar', emoji: '💡', description: 'LED satu warna', pins: [pin('anode')] },
  { type: 'rgb_led', label: 'LED RGB', category: 'Dasar', emoji: '🌈', description: 'LED merah, hijau, biru', pins: [pin('red'), pin('green'), pin('blue')] },
  { type: 'multimeter', label: 'Multimeter', category: 'Dasar', emoji: '📟', description: 'Ukur tegangan (V), arus (mA), hambatan (Ω)', pins: [] },
  { type: 'logic_analyzer', label: 'Logic Analyzer', category: 'Dasar', emoji: '📈', description: '8 kanal: rekam sinyal pin dari firmware, unduh .vcd', pins: [] },
  { type: 'resistor', label: 'Resistor', category: 'Dasar', emoji: '〰️', description: '220Ω, 1KΩ, atau 10KΩ', pins: [] },
  { type: 'pushbutton', label: 'Push Button', category: 'Input', emoji: '🔘', description: 'Tombol tekan momentary', pins: [pin('signal')] },
  { type: 'potentiometer', label: 'Potensiometer', category: 'Input', emoji: '🎛️', description: 'Potensiometer 10K', pins: [pin('signal')] },
  { type: 'rotary_encoder', label: 'Rotary Encoder', category: 'Input', emoji: '🎚️', description: 'Encoder putar dan tombol', pins: [pin('clk'), pin('dt'), pin('sw')] },
  { type: 'joystick', label: 'Joystick XY', category: 'Input', emoji: '🕹️', description: 'Dua sumbu analog dan tombol', pins: [pin('vrx'), pin('vry'), pin('sw')] },
  { type: 'keypad', label: 'Keypad 4×4', category: 'Input', emoji: '🔢', description: 'Keypad matriks 16 tombol', pins: [] },
  { type: 'ldr', label: 'Sensor Cahaya LDR', category: 'Sensor', emoji: '☀️', description: 'Intensitas cahaya analog dan digital', pins: [pin('signal'), pin('do')] },
  { type: 'sound_sensor', label: 'Sensor Suara', category: 'Sensor', emoji: '🎤', description: 'Mikrofon analog dan digital', pins: [pin('ao'), pin('do')] },
  { type: 'dht11', label: 'DHT11', category: 'Sensor', emoji: '🌡️', description: 'Suhu dan kelembapan', pins: [pin('data')] },
  { type: 'lm35', label: 'Sensor Suhu LM35', category: 'Sensor', emoji: '🌡', description: 'Sensor suhu analog', pins: [pin('signal')] },
  { type: 'ultrasonic', label: 'HC-SR04', category: 'Sensor', emoji: '📡', description: 'Sensor jarak ultrasonik', pins: [pin('trig'), pin('echo')] },
  { type: 'pir', label: 'Sensor PIR', category: 'Sensor', emoji: '👁️', description: 'Deteksi gerakan', pins: [pin('out')] },
  { type: 'water_sensor', label: 'Sensor Air', category: 'Sensor', emoji: '💧', description: 'Ketinggian atau tetesan air', pins: [pin('signal')] },
  { type: 'gas_sensor', label: 'Sensor Gas MQ', category: 'Sensor', emoji: '💨', description: 'Konsentrasi gas atau asap', pins: [pin('ao'), pin('do')] },
  { type: 'flame_sensor', label: 'Sensor Api', category: 'Sensor', emoji: '🔥', description: 'Deteksi nyala api', pins: [pin('ao'), pin('do')] },
  { type: 'ir_receiver', label: 'IR Receiver', category: 'Sensor', emoji: '📲', description: 'Penerima remote infrared', pins: [pin('out')] },
  { type: 'buzzer', label: 'Buzzer', category: 'Output', emoji: '🔔', description: 'Buzzer piezo aktif', pins: [pin('signal')] },
  { type: 'servo', label: 'Servo SG90', category: 'Output', emoji: '⚙️', description: 'Servo mikro 0–180°', pins: [pin('signal')] },
  { type: 'relay', label: 'Relay 1 Channel', category: 'Output', emoji: '🔌', description: 'Sakelar beban listrik', pins: [pin('in')] },
  { type: 'seven_segment', label: '7-Segment', category: 'Output', emoji: '8️⃣', description: 'Display angka satu digit', pins: [] },
  { type: 'led_matrix', label: 'LED Matrix 8×8', category: 'Output', emoji: '🔳', description: 'Modul dot matrix MAX7219', pins: [pin('din'), pin('cs'), pin('clk')] },
  { type: 'led_matrix4', label: 'LED Matrix 8×32', category: 'Output', emoji: '🟥', description: '4 modul MAX7219 berantai (LedControl 4 perangkat)', pins: [pin('din'), pin('cs'), pin('clk')] },
  { type: 'stepper', label: 'Stepper 28BYJ-48', category: 'Output', emoji: '⚙', description: 'Motor stepper dan driver', pins: [pin('in1'), pin('in2'), pin('in3'), pin('in4')] },
  { type: 'lcd', label: 'LCD 16×2', category: 'Modul', emoji: '🖥️', description: 'Display karakter 16×2 (backpack I2C)', pins: [pin('sda'), pin('scl')] },
  { type: 'rfid', label: 'RFID RC522', category: 'Modul', emoji: '💳', description: 'Pembaca kartu RFID SPI', pins: [pin('sda'), pin('sck'), pin('mosi'), pin('miso'), pin('rst')] },

  // ---- parts yang datang bareng dukungan ESP32 ----
  { type: 'neopixel', label: 'NeoPixel WS2812', category: 'Output', emoji: '✨', description: 'LED RGB addressable satu titik', pins: [pin('din')] },
  { type: 'neopixel_matrix', label: 'NeoPixel Matrix 8×8', category: 'Output', emoji: '🟦', description: 'Panel WS2812 8×8, satu kabel data', pins: [pin('din')] },
  { type: 'led_bar', label: 'LED Bar Graph', category: 'Output', emoji: '📶', description: '10 LED batang untuk level meter', pins: [] },
  { type: 'slide_switch', label: 'Slide Switch', category: 'Input', emoji: '🎚', description: 'Sakelar geser dua posisi', pins: [pin('2')] },
  { type: 'dip_switch', label: 'DIP Switch 8', category: 'Input', emoji: '🔢', description: 'Delapan sakelar kecil untuk konfigurasi', pins: [] },
  { type: 'tilt_switch', label: 'Sensor Kemiringan', category: 'Sensor', emoji: '📐', description: 'Deteksi miring atau terguling', pins: [pin('signal')] },
  { type: 'ntc_temp', label: 'Sensor Suhu NTC', category: 'Sensor', emoji: '🌡', description: 'Termistor NTC keluaran analog', pins: [pin('signal')] },
  { type: 'heart_sensor', label: 'Sensor Detak Jantung', category: 'Sensor', emoji: '❤️', description: 'Pulse sensor optik analog', pins: [pin('signal')] },
  { type: 'ds18b20', label: 'DS18B20', category: 'Sensor', emoji: '🌡', description: 'Sensor suhu digital 1-Wire, bisa banyak di satu pin', pins: [pin('data')] },
  { type: 'dht22', label: 'DHT22 / AM2302', category: 'Sensor', emoji: '🌦', description: 'Suhu dan kelembapan presisi', pins: [pin('data')] },
  { type: 'mpu6050', label: 'MPU6050', category: 'Sensor', emoji: '🧭', description: 'Akselerometer dan giroskop I2C', pins: [pin('sda'), pin('scl')] },
  { type: 'hx711', label: 'HX711 Load Cell', category: 'Sensor', emoji: '⚖️', description: 'ADC 24-bit untuk timbangan', pins: [pin('dt'), pin('sck')] },
  { type: 'ds1307', label: 'RTC DS1307', category: 'Modul', emoji: '⏰', description: 'Jam real-time I2C dengan baterai', pins: [pin('sda'), pin('scl')] },
  { type: 'microsd', label: 'Modul MicroSD', category: 'Modul', emoji: '💾', description: 'Penyimpanan kartu SD lewat SPI', pins: [pin('cs'), pin('mosi'), pin('miso'), pin('sck')] },
  { type: 'ssd1306', label: 'OLED SSD1306', category: 'Display', emoji: '📺', description: 'OLED 128×64 I2C, favorit proyek ESP32', pins: [pin('sda'), pin('sck')] },
  { type: 'lcd2004', label: 'LCD 20×4', category: 'Display', emoji: '🖵', description: 'LCD karakter besar 20 kolom 4 baris', pins: [pin('sda'), pin('scl')] },
  { type: 'tft_ili9341', label: 'TFT ILI9341 2.4"', category: 'Display', emoji: '🖼', description: 'Layar warna 240×320 lewat SPI', pins: [pin('cs'), pin('dc'), pin('mosi'), pin('sck')] },
]

export const catalogPart = (type: ComponentType) => COMPONENT_CATALOG.find((part) => part.type === type)
