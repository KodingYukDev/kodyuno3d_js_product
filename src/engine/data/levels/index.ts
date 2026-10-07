import type { LevelDefinition, PinEvent, SerialLine } from '@kodyuno/types'

// Helper: check if pin toggled between HIGH and LOW at least N times
function pinToggled(pinEvents: PinEvent[], pin: number | string, minToggles = 2): boolean {
  const events = pinEvents.filter((e) => e.pin === pin)
  let toggles = 0
  for (let i = 1; i < events.length; i++) {
    if (events[i].value !== events[i - 1].value) toggles++
  }
  return toggles >= minToggles
}

// Helper: check if pin was ever set HIGH
function pinEverHigh(pinEvents: PinEvent[], pin: number | string): boolean {
  return pinEvents.some((e) => e.pin === pin && e.value === 1)
}

// Helper: check if serial log contains text
function serialContains(serial: SerialLine[], text: string): boolean {
  return serial.some((l) => l.text.includes(text))
}

export const LEVELS: LevelDefinition[] = [
  // ============================================================
  // DUNIA 1 — Kedip-kedip
  // ============================================================
  {
    id: 1,
    worldId: 1,
    name: 'Lampu Pertama',
    description: 'Nyalakan LED di pin 13 dan biarkan menyala terus.',
    boardType: 'uno',
    allowedBlocks: ['uno_setup', 'uno_loop', 'uno_pin_mode', 'uno_digital_write'],
    initialComponents: [
      { id: 'led-1', type: 'led', label: 'LED Merah', pins: [{ role: 'anode', pin: 13 }] },
    ],
    objectives: [
      {
        id: 'led-on',
        description: 'Nyalakan LED pin 13 (HIGH)',
        check: (evts) => pinEverHigh(evts, 13),
      },
    ],
    hints: [
      'Gunakan blok "atur pin" untuk set pin 13 sebagai OUTPUT dulu.',
      'Lalu pakai blok "tulis digital" dan pilih HIGH untuk menyalakan LED.',
    ],
    quiz: [
      {
        id: 'q1',
        question: 'Apa fungsi blok "atur pin sebagai OUTPUT"?',
        options: ['Membaca nilai pin', 'Mengatur pin untuk mengirim sinyal', 'Menghapus program', 'Mengatur kecepatan'],
        correctIndex: 1,
        explanation: 'OUTPUT artinya pin tersebut mengirimkan sinyal — bisa menyalakan LED, buzzer, dll.',
      },
    ],
  },

  {
    id: 2,
    worldId: 1,
    name: 'Kedip Terus',
    description: 'Buat LED pin 13 berkedip — menyala lalu mati secara bergantian.',
    boardType: 'uno',
    allowedBlocks: ['uno_setup', 'uno_loop', 'uno_pin_mode', 'uno_digital_write', 'uno_delay', 'math_number'],
    initialComponents: [
      { id: 'led-1', type: 'led', label: 'LED Hijau', pins: [{ role: 'anode', pin: 13 }] },
    ],
    objectives: [
      {
        id: 'blink',
        description: 'LED pin 13 berkedip minimal 2 kali',
        check: (evts) => pinToggled(evts, 13, 4),
      },
    ],
    hints: [
      'Di dalam loop, tulis HIGH lalu delay lalu LOW lalu delay lagi.',
      'Coba delay 500 ms (setengah detik).',
    ],
    quiz: [
      {
        id: 'q2',
        question: 'Berapa milidetik sama dengan 1 detik?',
        options: ['100', '500', '1000', '10000'],
        correctIndex: 2,
        explanation: '1 detik = 1000 milidetik. Jadi delay(1000) = jeda 1 detik.',
      },
    ],
  },

  {
    id: 3,
    worldId: 1,
    name: 'SOS!',
    description: 'Buat pola kedip SOS: 3 pendek, 3 panjang, 3 pendek.',
    boardType: 'uno',
    allowedBlocks: ['uno_setup', 'uno_loop', 'uno_pin_mode', 'uno_digital_write', 'uno_delay', 'math_number'],
    initialComponents: [
      { id: 'led-1', type: 'led', label: 'LED SOS', pins: [{ role: 'anode', pin: 13 }] },
    ],
    objectives: [
      {
        id: 'sos',
        description: 'LED berkedip minimal 9 kali bergantian',
        check: (evts) => pinToggled(evts, 13, 18),
      },
    ],
    hints: [
      'Untuk S: 3x kedip cepat (delay 200ms). Untuk O: 3x kedip lambat (delay 600ms).',
      'Ulangi pola: S (3 pendek) → O (3 panjang) → S (3 pendek).',
    ],
    quiz: [
      {
        id: 'q3',
        question: 'SOS adalah kode darurat internasional. Dalam kode Morse, S = ...',
        options: ['— — —', '· · ·', '— · —', '· — ·'],
        correctIndex: 1,
        explanation: 'S dalam kode Morse adalah 3 titik (pendek): · · ·. O adalah 3 garis (panjang): — — —.',
      },
    ],
  },

  // ============================================================
  // DUNIA 2 — Bunyi & Warna
  // ============================================================
  {
    id: 4,
    worldId: 2,
    name: 'LED Redup Cerah',
    description: 'Atur kecerahan LED menggunakan PWM (analogWrite).',
    boardType: 'uno',
    allowedBlocks: ['uno_setup', 'uno_loop', 'uno_pin_mode', 'uno_analog_write', 'uno_delay', 'math_number'],
    initialComponents: [
      { id: 'led-1', type: 'led', label: 'LED PWM', pins: [{ role: 'anode', pin: 9 }] },
    ],
    objectives: [
      {
        id: 'pwm',
        description: 'Atur kecerahan LED pin 9 (tulis nilai PWM)',
        check: (evts) => evts.some((e) => e.pin === 9 && e.value > 0),
      },
    ],
    hints: [
      'Pin PWM di Arduino Uno ada di pin 3, 5, 6, 9, 10, 11 (ada tanda ~).',
      'Nilai analogWrite: 0 = mati, 255 = penuh terang, 128 = setengah.',
    ],
    quiz: [
      {
        id: 'q4',
        question: 'Berapa nilai analogWrite untuk kecerahan 50%?',
        options: ['50', '100', '127', '200'],
        correctIndex: 2,
        explanation: 'analogWrite menggunakan nilai 0-255. Setengah dari 255 ≈ 127-128.',
      },
    ],
  },

  {
    id: 5,
    worldId: 2,
    name: 'Bunyi Pertama',
    description: 'Bunyikan buzzer dengan frekuensi tertentu.',
    boardType: 'uno',
    allowedBlocks: ['uno_setup', 'uno_loop', 'uno_pin_mode', 'uno_digital_write', 'uno_buzzer_tone', 'uno_buzzer_notone', 'uno_delay', 'math_number'],
    initialComponents: [
      { id: 'buz-1', type: 'buzzer', label: 'Buzzer', pins: [{ role: 'signal', pin: 8 }] },
    ],
    objectives: [
      {
        id: 'buzz',
        description: 'Aktifkan buzzer pin 8',
        check: (evts) => pinEverHigh(evts, 8),
      },
    ],
    hints: [
      'Gunakan blok "buzzer" dan masukkan frekuensi. 440 Hz = nada A.',
      'Jangan lupa delay, lalu "buzzer stop" agar tidak bunyi terus.',
    ],
    quiz: [
      {
        id: 'q5',
        question: 'Frekuensi 440 Hz menghasilkan nada apa?',
        options: ['Nada C', 'Nada A', 'Nada G', 'Nada F'],
        correctIndex: 1,
        explanation: '440 Hz adalah nada A4, nada standar untuk tuning alat musik.',
      },
    ],
  },

  {
    id: 6,
    worldId: 2,
    name: 'Melodi Sederhana',
    description: 'Buat buzzer memainkan beberapa nada berurutan.',
    boardType: 'uno',
    allowedBlocks: ['uno_setup', 'uno_loop', 'uno_pin_mode', 'uno_buzzer_tone', 'uno_buzzer_notone', 'uno_delay', 'math_number'],
    initialComponents: [
      { id: 'buz-1', type: 'buzzer', label: 'Buzzer Melodi', pins: [{ role: 'signal', pin: 8 }] },
    ],
    objectives: [
      {
        id: 'melody',
        description: 'Buzzer aktif dan mati minimal 3 kali',
        check: (evts) => pinToggled(evts, 8, 6),
      },
    ],
    hints: [
      'Coba nada: 262 Hz (C4), 294 Hz (D4), 330 Hz (E4).',
      'Setiap nada: tone → delay 300ms → noTone → delay 100ms.',
    ],
    quiz: [
      {
        id: 'q6',
        question: 'Dalam musik, not C4 memiliki frekuensi sekitar...',
        options: ['220 Hz', '262 Hz', '440 Hz', '880 Hz'],
        correctIndex: 1,
        explanation: 'C4 (do tengah) = ±262 Hz. A4 = 440 Hz. Semakin tinggi oktaf, semakin tinggi Hz.',
      },
    ],
  },

  // ============================================================
  // DUNIA 3 — Gerak & Motor
  // ============================================================
  {
    id: 7,
    worldId: 3,
    name: 'Servo Bergerak',
    description: 'Putar servo ke sudut 90 derajat.',
    boardType: 'uno',
    allowedBlocks: ['uno_setup', 'uno_loop', 'uno_servo_write', 'uno_delay', 'math_number'],
    initialComponents: [
      { id: 'srv-1', type: 'servo', label: 'Servo', pins: [{ role: 'signal', pin: 9 }] },
    ],
    objectives: [
      {
        id: 'servo-90',
        description: 'Putar servo ke sudut 90°',
        check: (evts) => evts.some((e) => e.pin === 9 && e.value > 0),
      },
    ],
    hints: [
      'Gunakan blok "servo pin 9 sudut 90°".',
      'Servo bergerak 0°–180°. 90° = posisi tengah.',
    ],
    quiz: [
      {
        id: 'q7',
        question: 'Berapa sudut maksimal servo standar?',
        options: ['90°', '120°', '180°', '360°'],
        correctIndex: 2,
        explanation: 'Servo standar bergerak dari 0° hingga 180°. Servo continuous dapat berputar penuh.',
      },
    ],
  },

  {
    id: 8,
    worldId: 3,
    name: 'Sapuan Servo',
    description: 'Buat servo bergerak bolak-balik dari 0° ke 180°.',
    boardType: 'uno',
    allowedBlocks: ['uno_setup', 'uno_loop', 'uno_servo_write', 'uno_delay', 'math_number'],
    initialComponents: [
      { id: 'srv-1', type: 'servo', label: 'Servo Sapu', pins: [{ role: 'signal', pin: 9 }] },
    ],
    objectives: [
      {
        id: 'sweep',
        description: 'Servo bergerak minimal 2 posisi berbeda',
        check: (evts) => {
          const srvEvts = evts.filter((e) => e.pin === 9)
          return new Set(srvEvts.map((e) => e.value)).size >= 2
        },
      },
    ],
    hints: [
      'Tulis 0° lalu delay, lalu tulis 180° lalu delay, dalam loop.',
    ],
    quiz: [
      {
        id: 'q8',
        question: 'Servo dikendalikan dengan sinyal apa?',
        options: ['Tegangan DC', 'PWM (Pulse Width Modulation)', 'Serial data', 'Frekuensi radio'],
        correctIndex: 1,
        explanation: 'Servo dikontrol oleh sinyal PWM. Lebar pulsa menentukan posisi sudut servo.',
      },
    ],
  },

  {
    id: 9,
    worldId: 3,
    name: 'Palang Otomatis',
    description: 'Buat palang (servo) membuka dan menutup setiap 2 detik.',
    boardType: 'uno',
    allowedBlocks: ['uno_setup', 'uno_loop', 'uno_pin_mode', 'uno_servo_write', 'uno_delay', 'math_number'],
    initialComponents: [
      { id: 'srv-1', type: 'servo', label: 'Palang', pins: [{ role: 'signal', pin: 9 }] },
      { id: 'led-1', type: 'led', label: 'Lampu Status', pins: [{ role: 'anode', pin: 13 }] },
    ],
    objectives: [
      {
        id: 'gate',
        description: 'Servo bergerak antara 0° dan 90°, LED juga ikut',
        check: (evts) => pinToggled(evts, 9, 2) && pinToggled(evts, 13, 2),
      },
    ],
    hints: [
      'Saat palang buka (servo 90°), nyalakan LED. Saat tutup (servo 0°), matikan LED.',
    ],
    quiz: [
      {
        id: 'q9',
        question: 'Apa nama sistem kendali otomatis berulang seperti palang di atas?',
        options: ['Loop kontrol', 'Sensor feedback', 'PID controller', 'Finite State Machine'],
        correctIndex: 0,
        explanation: 'Ini disebut loop kontrol sederhana — aksi dilakukan berulang di dalam fungsi loop().',
      },
    ],
  },

  // ============================================================
  // DUNIA 4 — Baca & Sensor
  // ============================================================
  {
    id: 10,
    worldId: 4,
    name: 'Baca Tombol',
    description: 'Baca nilai digital dari pin input (tombol) dan tampilkan di Serial.',
    boardType: 'uno',
    allowedBlocks: ['uno_setup', 'uno_loop', 'uno_pin_mode', 'uno_digital_read', 'uno_serial_begin', 'uno_serial_print', 'uno_delay', 'math_number'],
    initialComponents: [
      { id: 'pir-1', type: 'pir', label: 'Tombol / PIR', pins: [{ role: 'out', pin: 4 }] },
    ],
    objectives: [
      {
        id: 'read-btn',
        description: 'Tampilkan nilai pin 4 di Serial Monitor',
        check: (_evts, serial) => serial.length > 0,
      },
    ],
    hints: [
      'Gunakan Serial.begin(9600) di setup.',
      'Di loop, baca digitalRead(4) dan kirim ke Serial.println.',
    ],
    quiz: [
      {
        id: 'q10',
        question: 'Apa nilai digitalRead saat tombol ditekan (dengan INPUT_PULLUP)?',
        options: ['HIGH (1)', 'LOW (0)', '512', '-1'],
        correctIndex: 1,
        explanation: 'Dengan INPUT_PULLUP, tidak ditekan = HIGH, ditekan = LOW (karena terhubung ke GND).',
      },
    ],
  },

  {
    id: 11,
    worldId: 4,
    name: 'Sensor Suhu',
    description: 'Baca suhu dari sensor DHT11 dan tampilkan di Serial Monitor.',
    boardType: 'uno',
    allowedBlocks: ['uno_setup', 'uno_loop', 'uno_pin_mode', 'uno_dht_temp', 'uno_serial_begin', 'uno_serial_print', 'uno_delay', 'math_number', 'variables_set', 'variables_get'],
    initialComponents: [
      { id: 'dht-1', type: 'dht11', label: 'DHT11', pins: [{ role: 'data', pin: 2 }] },
    ],
    objectives: [
      {
        id: 'temp',
        description: 'Tampilkan data suhu di Serial Monitor',
        check: (_evts, serial) => serial.length > 0,
      },
    ],
    hints: [
      'Gunakan blok "suhu DHT11 pin 2" dan simpan ke variabel.',
      'Kirim variabel ke Serial.println.',
    ],
    quiz: [
      {
        id: 'q11',
        question: 'Protokol komunikasi apa yang digunakan DHT11?',
        options: ['I2C', 'SPI', '1-Wire (single wire)', 'UART'],
        correctIndex: 2,
        explanation: 'DHT11 menggunakan protokol 1-Wire — cukup 1 kabel data untuk mengirim suhu & kelembaban.',
      },
    ],
  },

  {
    id: 12,
    worldId: 4,
    name: 'Jarak Aman',
    description: 'Baca jarak ultrasonik dan nyalakan LED jika objek terlalu dekat (< 20 cm).',
    boardType: 'uno',
    allowedBlocks: ['uno_setup', 'uno_loop', 'uno_pin_mode', 'uno_ultrasonic', 'uno_digital_write', 'uno_serial_print', 'uno_serial_begin', 'uno_delay', 'controls_if', 'logic_compare', 'math_number', 'variables_set', 'variables_get'],
    initialComponents: [
      { id: 'ult-1', type: 'ultrasonic', label: 'Ultrasonik', pins: [{ role: 'trig', pin: 10 }, { role: 'echo', pin: 11 }] },
      { id: 'led-1', type: 'led', label: 'LED Peringatan', pins: [{ role: 'anode', pin: 13 }] },
    ],
    objectives: [
      {
        id: 'proximity',
        description: 'LED menyala saat jarak < 20 cm (geser slider sensor)',
        check: (evts) => pinEverHigh(evts, 13),
      },
    ],
    hints: [
      'Baca jarak ultrasonik, simpan ke variabel.',
      'Gunakan blok "jika" untuk cek apakah jarak < 20.',
      'Coba geser slider sensor ultrasonik ke nilai kecil (< 20).',
    ],
    quiz: [
      {
        id: 'q12',
        question: 'Sensor ultrasonik bekerja dengan prinsip apa?',
        options: ['Cahaya infrared', 'Gema gelombang suara', 'Medan magnet', 'Tekanan udara'],
        correctIndex: 1,
        explanation: 'Ultrasonik memancarkan gelombang suara, lalu mengukur waktu pantulan (gema) untuk menghitung jarak.',
      },
    ],
  },

  // ============================================================
  // DUNIA 5 — Layar LCD
  // ============================================================
  {
    id: 13,
    worldId: 5,
    name: 'Hello LCD',
    description: 'Tampilkan teks "Halo Dunia!" di LCD.',
    boardType: 'uno',
    allowedBlocks: ['uno_setup', 'uno_loop', 'uno_serial_begin', 'uno_serial_print', 'math_number'],
    initialComponents: [],
    objectives: [
      {
        id: 'lcd-hello',
        description: 'Kirim "Halo" ke Serial Monitor (simulasi LCD)',
        check: (_evts, serial) => serialContains(serial, 'Halo'),
      },
    ],
    hints: [
      'Pada simulator kita gunakan Serial Monitor sebagai pengganti LCD.',
      'Kirim teks "Halo Dunia!" ke Serial.println.',
    ],
    quiz: [
      {
        id: 'q13',
        question: 'LCD 16x2 artinya...',
        options: ['16 piksel dan 2 warna', '16 kolom dan 2 baris karakter', '16 MB dan 2 GHz', '16 pin dan 2 volt'],
        correctIndex: 1,
        explanation: 'LCD 16x2 = 16 kolom × 2 baris. Bisa menampilkan 32 karakter sekaligus.',
      },
    ],
  },

  {
    id: 14,
    worldId: 5,
    name: 'LCD Countdown',
    description: 'Tampilkan hitungan mundur 10 sampai 0 di Serial Monitor.',
    boardType: 'uno',
    allowedBlocks: ['uno_setup', 'uno_loop', 'uno_serial_begin', 'uno_serial_print', 'uno_delay', 'controls_for', 'math_number', 'variables_set', 'variables_get'],
    initialComponents: [],
    objectives: [
      {
        id: 'countdown',
        description: 'Tampilkan angka berurutan di Serial Monitor',
        check: (_evts, serial) => serial.length >= 5,
      },
    ],
    hints: [
      'Gunakan blok "for" untuk menghitung dari 10 ke 0.',
      'Di dalam loop for, kirim variabel ke Serial.println.',
    ],
    quiz: [
      {
        id: 'q14',
        question: 'Blok "for" digunakan untuk...',
        options: ['Membuat fungsi baru', 'Mengulang aksi sejumlah tertentu', 'Membaca sensor', 'Menyimpan data'],
        correctIndex: 1,
        explanation: 'Blok "for" mengulangi aksi dengan menghitung variabel dari angka awal ke akhir.',
      },
    ],
  },

  {
    id: 15,
    worldId: 5,
    name: 'Suhu di LCD',
    description: 'Baca suhu DHT11 dan tampilkan di Serial Monitor setiap 2 detik.',
    boardType: 'uno',
    allowedBlocks: ['uno_setup', 'uno_loop', 'uno_serial_begin', 'uno_serial_print', 'uno_dht_temp', 'uno_delay', 'math_number', 'variables_set', 'variables_get'],
    initialComponents: [
      { id: 'dht-1', type: 'dht11', label: 'DHT11', pins: [{ role: 'data', pin: 2 }] },
    ],
    objectives: [
      {
        id: 'temp-lcd',
        description: 'Kirim suhu minimal 3 kali ke Serial Monitor',
        check: (_evts, serial) => serial.length >= 3,
      },
    ],
    hints: [
      'Di setup: Serial.begin dan cetak label "Suhu:".',
      'Di loop: baca DHT11, kirim nilai, delay 2000.',
    ],
    quiz: [
      {
        id: 'q15',
        question: 'Mengapa kita gunakan delay(2000) untuk membaca DHT11?',
        options: ['Karena DHT11 mahal', 'DHT11 butuh waktu untuk konversi data', 'Untuk hemat baterai', 'Agar LED tidak rusak'],
        correctIndex: 1,
        explanation: 'DHT11 membutuhkan setidaknya 1 detik antar pembacaan. Delay 2000ms memberikan waktu yang cukup.',
      },
    ],
  },

  // ============================================================
  // DUNIA 6 — Proyek Akhir
  // ============================================================
  {
    id: 16,
    worldId: 6,
    name: 'Alarm Jarak',
    description: 'Kombinasikan ultrasonik + buzzer: buzzer bunyi semakin cepat saat objek mendekat.',
    boardType: 'uno',
    allowedBlocks: [],
    initialComponents: [
      { id: 'ult-1', type: 'ultrasonic', label: 'Ultrasonik', pins: [{ role: 'trig', pin: 10 }, { role: 'echo', pin: 11 }] },
      { id: 'buz-1', type: 'buzzer', label: 'Buzzer Alarm', pins: [{ role: 'signal', pin: 8 }] },
      { id: 'led-1', type: 'led', label: 'LED Indikator', pins: [{ role: 'anode', pin: 13 }] },
    ],
    objectives: [
      {
        id: 'alarm',
        description: 'Buzzer dan LED aktif saat jarak < 30 cm',
        check: (evts) => pinEverHigh(evts, 8) && pinEverHigh(evts, 13),
      },
    ],
    hints: [
      'Baca jarak, lalu gunakan if untuk cek apakah < 30.',
      'Jika ya: nyalakan buzzer dan LED. Jika tidak: matikan keduanya.',
    ],
    quiz: [],
  },

  {
    id: 17,
    worldId: 6,
    name: 'Termometer Digital',
    description: 'Tampilkan suhu dan beri peringatan LED jika suhu > 30°C.',
    boardType: 'uno',
    allowedBlocks: [],
    initialComponents: [
      { id: 'dht-1', type: 'dht11', label: 'DHT11', pins: [{ role: 'data', pin: 2 }] },
      { id: 'led-merah', type: 'led', label: 'LED Panas', pins: [{ role: 'anode', pin: 13 }] },
      { id: 'led-hijau', type: 'led', label: 'LED Normal', pins: [{ role: 'anode', pin: 12 }] },
    ],
    objectives: [
      {
        id: 'thermo',
        description: 'Kirim suhu ke Serial dan LED berubah sesuai kondisi',
        check: (_evts, serial) => serial.length > 0,
      },
    ],
    hints: [
      'Baca suhu DHT11 ke variabel.',
      'Jika suhu > 30: LED merah ON, LED hijau OFF. Sebaliknya kebalikan.',
    ],
    quiz: [],
  },

  {
    id: 18,
    worldId: 6,
    name: 'Robot Pintu',
    description: 'Servo membuka saat PIR mendeteksi gerak, buzzer bunyi sebentar, lalu tutup.',
    boardType: 'uno',
    allowedBlocks: [],
    initialComponents: [
      { id: 'pir-1', type: 'pir', label: 'Sensor PIR', pins: [{ role: 'out', pin: 4 }] },
      { id: 'srv-1', type: 'servo', label: 'Servo Pintu', pins: [{ role: 'signal', pin: 9 }] },
      { id: 'buz-1', type: 'buzzer', label: 'Buzzer', pins: [{ role: 'signal', pin: 8 }] },
    ],
    objectives: [
      {
        id: 'door',
        description: 'Servo bergerak dan buzzer aktif setelah PIR mendeteksi',
        check: (evts) => evts.some((e) => e.pin === 9 && e.value > 0) && pinEverHigh(evts, 8),
      },
    ],
    hints: [
      'Baca digitalRead(4) untuk cek PIR.',
      'Jika PIR = HIGH: servo buka (90°), buzzer ON, delay 2 detik, servo tutup (0°), buzzer OFF.',
      'Klik tombol PIR di simulator untuk simulasi deteksi.',
    ],
    quiz: [],
  },
]

export function getLevelById(id: number): LevelDefinition | undefined {
  return LEVELS.find((l) => l.id === id)
}
