# Pelanggan dengan Hari Tetap — Desain

Tanggal: 2026-09-30 · Status: disetujui secara lisan, menunggu review dokumen ini

## Latar belakang

Peta Zona membuat jadwal pelanggan **mengikuti zona**: armada + hari kirim zona ditulis ke setiap
pelanggan di dalamnya. Mode "Per hari kirim" membuat satu zona = rute satu hari untuk satu armada,
dan setiap pelanggan dikirim **sekali seminggu**.

Sebagian pelanggan punya **hari khusus** yang tidak boleh diubah, misalnya Hotel A: Senin, Rabu,
Jumat. Dengan aturan sekarang, hari-hari itu tertimpa menjadi satu hari. Pelanggan seperti ini juga
memakai kapasitas rute di beberapa hari, dan perencana saat ini tidak menghitungnya.

## Keputusan pemilik (ditanyakan langsung)

1. Pelanggan hari tetap dilayani **satu armada untuk semua harinya**, yaitu armada pemilik wilayahnya.
2. Tanda "hari tetap" **diatur manual per pelanggan** oleh admin.
3. Kalau sebuah hari penuh karena pelanggan hari tetap: **tolak dan beri saran**. Tidak ada yang
   tersimpan sampai beres.

## Yang dibangun

### 1. Data dan aturan

- Kolom baru `Customer.fixedDays` (boolean, default `false`). Migrasi hanya menambah kolom.
- Hari-harinya memakai kolom yang sudah ada, `Customer.deliveryDays`. Kalau `fixedDays = true`,
  minimal 1 hari wajib diisi (400 kalau kosong).
- **Aturan zona (`planMembership`)**: untuk pelanggan hari tetap, zona menentukan **armada saja**.
  Hari kirim pelanggan tidak pernah diubah oleh apa pun di fitur zona: buat, ubah, hapus, pindah
  zona, zona otomatis, maupun sinkronisasi titik lokasi. Pelanggan biasa tetap seperti sekarang.
- `updateCustomer`:
  - menerima `fixedDays`;
  - untuk pelanggan hari tetap yang ada di zona, **hari boleh diubah** di form pelanggan, sedangkan
    **armada tetap dikunci zona** (409 seperti sekarang);
  - mengubah `fixedDays` memicu sinkronisasi zona. Kalau tanda dimatikan, pelanggan kembali mengikuti
    hari zonanya, dan perubahan itu tampil di pratinjau peta berikutnya;
  - audit mencatat perubahan hari tetap, contoh: `hari tetap: Sen, Rab, Jum` / `hari tetap dimatikan`.
- `createCustomer` menerima `fixedDays`.
- `custClient`, daftar pelanggan, dan data peta menyertakan `fixedDays`.

### 2. Perencana "Per hari kirim" (`zone.service.autoDaily` + fungsi murni di `dist-zones.js`)

Istilah: **R** = pelanggan biasa bertitik, **F** = pelanggan hari tetap bertitik (yang dikunci di
luar semua zona tidak ikut). Hari kerja: **D** = Sen–Sab. Slot = (armada, hari).

1. **Wilayah.** Kelompokkan R seperti sekarang (`capacitatedGroups(R, max)`), lalu
   `assignSlots(groups, armadas, D)`. Hasilnya rute awal per slot dan wilayah setiap armada. Kalau R
   kosong, wilayah dibentuk dari titik F.
2. **Armada pelanggan hari tetap** = armada dari rute terdekat ke titiknya (jarak ke pusat rute).
3. **Beban hari tetap**: untuk setiap f di F dan setiap hari d ∈ `f.days ∩ D`, tambahkan
   `visits[armada_f][d] += 1`. Hari Minggu tidak dihitung kuotanya dan dicatat di pratinjau.
4. **Kuota tersisa per slot** = `max − visits[slot]`. Kalau ada kuota < 0, **tolak**: sebut slot,
   jumlah kunjungan hari tetap, dan nama pelanggannya, plus saran (naikkan maks / tambah armada / ubah
   hari tetap pelanggan tertentu).
5. **Cek total**: kalau `Σ kuota tersisa < |R|`, tolak dengan pesan "Kapasitas kurang" plus angka
   dan saran yang sama.
6. **Penyeimbangan** (fungsi murni baru `DZ.fitFixedLoad`): selama ada slot dengan
   `|anggota biasa| > kuota tersisa`, pindahkan satu pelanggan biasa dari slot itu ke slot lain yang
   masih punya ruang. Pilih pasangan (pelanggan, slot tujuan) dengan **tambahan jarak terkecil** ke
   pusat slot tujuan. Slot kosong memakai pusat wilayah armadanya, atau pusat semua titik kalau armada
   itu belum punya wilayah. Setelah itu jalankan langkah "unstretch" (pindah/tukar hanya bila tidak
   melanggar kuota tiap slot) sampai tidak ada perbaikan. Hasilnya deterministik.
7. **Zona** dibuat per slot yang punya anggota biasa. Nama, satu hari, armada, dan poligon mengikuti
   anggota biasa, seperti sekarang.
8. **Keanggotaan pelanggan hari tetap** = zona armadanya yang poligonnya memuat titiknya. Kalau tidak
   ada, dipakai zona armadanya yang pusatnya terdekat. Pelanggan dikunci (`zoneManual`) ke zona itu,
   sehingga zona memberinya **armada**, dan harinya tidak disentuh.

Mode "Jumlah zona" tidak berubah, kecuali aturan nomor 1 (hari pelanggan hari tetap tidak ditimpa).

### 3. Tampilan

- **Form pelanggan** (Pelanggan → Tambah/Ubah): sakelar **"Hari tetap"** di bawah pilihan hari
  kirim, dengan penjelasan singkat: "Zona tidak akan mengubah hari kirim pelanggan ini; armada tetap
  mengikuti zona." Menyimpan dengan sakelar aktif tanpa hari ditolak.
- **Detail pelanggan**: lencana "Hari tetap" di samping hari kirim.
- **Peta Zona**:
  - pelanggan hari tetap tampil sebagai penanda berlabel jumlah hari, misalnya **3×**;
  - popup-nya menunjukkan hari tetap, tombol **Atur hari tetap** (sakelar + pilihan hari + Simpan,
    lewat `PATCH /customers/:id`), dan chip filter baru **"Hari tetap · n"**.
- **Pratinjau "Per hari kirim"**:
  - setiap rute: `Senin · DK 1234 AB — 34 biasa + 3 hari tetap = 37/40`;
  - slot yang hanya berisi kunjungan hari tetap tampil sebagai baris info;
  - penolakan menyebut hari, rute, dan pelanggan hari tetap penyebabnya.
- Semua teks tersedia dalam bahasa Indonesia dan Inggris (`zn.*`, `dist.*`).

### 4. Yang tidak berubah

- Papan Pengiriman: hotel A tetap muncul setiap Senin, Rabu, dan Jumat di papan armadanya, karena
  papan dibuat dari `deliveryDays` + `armada` seperti sekarang.
- Satu armada per pelanggan. Armada per hari tidak termasuk ruang lingkup.
- Hak akses: mengubah hari tetap butuh `distribusiCustomers` (form pelanggan) seperti mengubah
  pelanggan biasa; zona otomatis butuh `distribusiZonaKelola`.

## Pengujian

- **Geometri / murni**:
  - `fitFixedLoad`: tidak ada slot melebihi kuota tersisa;
  - semua pelanggan biasa ditempatkan tepat sekali;
  - pemindahan memilih tambahan jarak terkecil;
  - deterministik;
  - total kurang → tidak ok, dengan angka yang benar.
- **`planMembership`**: hari pelanggan hari tetap tidak pernah berubah, sedangkan armadanya
  mengikuti zona.
- **Integrasi**:
  - hari tetap bertahan saat buat/ubah/hapus zona, pindah zona, zona otomatis (dua mode), dan saat
    titik lokasi diubah;
  - kunjungan hari tetap mengurangi kuota di setiap harinya;
  - penolakan menyebut slot dan pelanggan;
  - `fixedDays` tanpa hari → 400;
  - armada tetap 409, hari boleh diubah;
  - mematikan tanda → mengikuti zona lagi;
  - papan Pengiriman memunculkan pelanggan hari tetap di setiap harinya pada armada yang benar.
- **Tampilan**: harness headless untuk popup, penanda 3×, filter, dan pratinjau berkuota.

## Di luar ruang lingkup

- Armada berbeda per hari untuk satu pelanggan.
- Frekuensi fleksibel (misalnya "2× seminggu, hari bebas").
- Pengurutan stop dalam satu rute; sudah ada di papan Pengiriman ("Urutkan dari posisi saya").
