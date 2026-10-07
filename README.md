# KodyUno 3D

Simulator Arduino / ESP 3D di browser — produk mandiri KodingYuk (tanpa login KodyLabs).

- **Meja kerja 3D** (three.js): board, breadboard, komponen dan kabel jumper sebagai model 3D;
  orbit, zoom, pandangan miring/atas, efek cahaya LED (bloom), bayangan.
- **Engine sama dengan KodyUno 2D** (`src/engine`, disalin dari `ky_labs/src/kodyuno`):
  interpreter C++, firmware asli AVR (avr8js), solver rangkaian, 46 komponen, library, contoh,
  serial monitor/plotter, impor/ekspor Wokwi, link berbagi. Tampilan 2D tetap ada (tombol 2D).
- **Interaksi langsung**: klik pin/lubang/kaki untuk memasang kabel, seret part (kaki otomatis
  masuk lubang breadboard), R putar, Delete hapus, Ctrl+Z/Y. Saat sketch berjalan: tekan tombol,
  putar potensiometer, gerakkan joystick, geser slide switch langsung di 3D. Buzzer berbunyi (WebAudio).

## Cara kerja 3D

Rangkaian tetap disimpan di ruang kanvas 2D engine (14 unit = pitch 2,54 mm). Scene 3D hanya
proyeksi: x kanvas → x scene, y kanvas → z scene, dalam mm (`src/three/units.ts`). Jadi semua
aturan snap, solver dan format project identik dengan KodyUno 2D.

Tekstur part diambil dari artwork kody-* yang sama (`src/three/rasterize.ts`), jadi LCD, OLED,
TFT, 7-segment, NeoPixel ikut berubah sesuai state. Part penting dimodelkan penuh
(`src/three/partModels.ts`): LED, LED RGB, resistor, tombol, buzzer, TO-92, servo, potensiometer,
HC-SR04, PIR, relay, sensor gas, joystick.

## Mesin eksekusi

Uno/Nano/Mega "Otomatis": compile di server KodyUno (Cloud Run lewat gateway) lalu avr8js.
Gateway hanya menerima origin yang terdaftar (`ALLOWED_ORIGINS` di
`ky_labs/workers/compiler-gateway/wrangler.jsonc`). Kalau tidak terjangkau, sketch otomatis
dijalankan interpreter C++ di browser. Pilihan "Interpreter C++ (offline)" selalu tersedia.

## Perintah

```
npm install
npm run dev        # http://localhost:5183
npm run build
npm run deploy     # build + wrangler deploy (Worker "kodyuno3d")
```

Atribusi artwork Wokwi (MIT): `THIRD_PARTY_NOTICES.md` — jangan dihapus.
