import type { WorldDefinition } from '@kodyuno/types'

export const WORLDS: WorldDefinition[] = [
  {
    id: 1,
    name: 'Kedip-kedip',
    emoji: '💡',
    description: 'Belajar menyalakan dan mematikan LED — dasar Arduino!',
    levelIds: [1, 2, 3],
    bgColor: '#fef3c7',
  },
  {
    id: 2,
    name: 'Bunyi & Warna',
    emoji: '🔔',
    description: 'Kenali PWM, LED berwarna, dan buzzer',
    levelIds: [4, 5, 6],
    bgColor: '#fce7f3',
  },
  {
    id: 3,
    name: 'Gerak & Motor',
    emoji: '⚙️',
    description: 'Gerakkan servo dengan sudut yang tepat',
    levelIds: [7, 8, 9],
    bgColor: '#f0fdf4',
  },
  {
    id: 4,
    name: 'Baca & Sensor',
    emoji: '🌡️',
    description: 'Baca data dari sensor suhu, jarak, dan gerak',
    levelIds: [10, 11, 12],
    bgColor: '#ecfdf5',
  },
  {
    id: 5,
    name: 'Layar LCD',
    emoji: '🖥️',
    description: 'Tampilkan teks di layar LCD 16x2',
    levelIds: [13, 14, 15],
    bgColor: '#eff6ff',
  },
  {
    id: 6,
    name: 'Proyek Akhir',
    emoji: '🚀',
    description: 'Gabungkan semua yang sudah dipelajari!',
    levelIds: [16, 17, 18],
    bgColor: '#f5f3ff',
  },
]
