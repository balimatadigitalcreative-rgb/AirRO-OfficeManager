# Mode Lapangan (tampilan HP baru) sebagai Demo — Desain

Tanggal: 2026-10-01 · Status: disetujui secara lisan per bagian, menunggu review dokumen ini

Mockup acuan (20 layar, Liquid Glass): https://claude.ai/artifact/VELPmw1GNUAFNQ5KXpxj8V

## Latar belakang

Pemilik ingin tampilan distribusi untuk HP yang sederhana, rinci, dan mudah dipakai pegawai
pengiriman. Mockup sudah disetujui. Sebelum diberikan ke semua orang, pemilik ingin **mencobanya
sendiri dulu**, lalu **melatih karyawan**, dan baru setelah itu **merilisnya ke semua akun**.

Selama tahap demo, hanya akun yang diberi izin yang melihat tampilan baru. Karyawan lain tetap
bekerja dengan tampilan lama tanpa perubahan apa pun.

## Keputusan pemilik (ditanyakan langsung)

1. **Data demo: dua-duanya.** Ada **Mode asli** (data dan transaksi sungguhan) dan **Mode latihan**
   (tidak masuk pembukuan).
2. **Mode latihan disimpan di HP masing-masing.** Data asli hanya dibaca sebagai salinan awal.
   Semua catatan latihan tinggal di HP itu dan tidak pernah dikirim ke server.
3. **Akses dua tingkat, hanya Owner yang memberi:**
   - **Demo latihan**: hanya Mode latihan;
   - **Demo penuh**: Mode latihan + Mode asli.
4. **Tahap A (tampilan demo) dan Tahap B (aturan & fitur baru) dibangun sekaligus.** Demo dibuka
   setelah keduanya selesai.
5. Aturan bisnis dari sesi mockup:
   - **SOP muatan minimal 80 galon per rit**, berlaku untuk **semua armada**. Di bawah angka itu
     wajib ada alasan.
   - **Kapasitas per armada** bisa diatur; muatan tidak boleh melebihi kapasitas.
   - **Foto wajib** untuk setiap transaksi pelanggan (Lunas/Bon/Transfer) dan setiap pembayaran bon
     manual. Foto nota pengeluaran juga wajib.
   - **Pengeluaran selalu dari uang setoran.** Tidak ada opsi "uang pribadi".
   - **Ganti rugi galon rusak tidak perlu persetujuan.**
   - **Semua koreksi transaksi wajib disetujui** kantor atau akun yang punya izin menyetujui. Tidak
     ada koreksi kecil yang langsung berlaku.
   - **Titik lokasi pelanggan bisa digeser** karena GPS HP bisa meleset.
   - **Tombol "Catat" (input manual) ada di tengah dock**, dengan animasi gerak liquid glass.

## Keputusan desain (disetujui per bagian)

- Tampilan baru dibangun sebagai **modul terpisah** (`dist-field*`). File lama `distribution.jsx`
  (±7.800 baris) tidak diubah.
- Modul berbicara ke server lewat **satu adaptor** dengan dua implementasi: asli dan latihan.
- Setiap aturan baru punya **saklar Owner** di Pengaturan, dan **awalnya mati**.
  - Tampilan baru selalu mengikuti aturan, terlepas dari saklarnya.
  - Server baru memaksa aturan setelah saklarnya dinyalakan saat rilis, supaya pengguna tampilan
    lama tidak tiba-tiba terhalang.
- **Pembukuan transfer yang lama tidak diubah otomatis.** Perbaikannya berupa skrip terpisah dengan
  mode daftar-dulu, dan baru dijalankan setelah pemilik setuju.

## Yang dibangun

### 1. Akses demo

- Dua izin baru di `deriveDistribusiCaps`: `distribusiDemoLatihan` dan `distribusiDemoPenuh`.
  - Keduanya **tidak pernah diturunkan dari peran** dan default `false` untuk semua, termasuk
    owner/GM. Owner memberikannya per akun.
  - `distribusiDemoPenuh` sudah mencakup latihan.
- **Hanya Owner yang boleh memberi atau mencabut.** Penjaganya meniru
  `assertSelfApproveGrantAllowed` di `user.service.js`, dengan peran dibaca live dari DB.
  - Di `finance-users.jsx`, kedua izin masuk katalog dengan `ownerOnly: true`.
  - Mode latihan tetap butuh izin dasar lapangan (`distribusiPengiriman`/`distribusiInput`) untuk
    **membaca** salinan data. Jadi Demo latihan pada akun tanpa izin baca tidak berguna, dan editor
    izin memberi petunjuk tentang hal ini.
- **Server menolak permintaan Mode asli dari akun tanpa `distribusiDemoPenuh`.**
  - Setiap permintaan dari tampilan baru membawa header `X-Airro-Ui: field`.
  - Middleware `requireFieldUi` pada rute distribusi: kalau header ada dan akun tidak punya
    `distribusiDemoPenuh`, permintaan **tulis** dijawab 403 dengan pesan
    "Akses Mode asli belum diberikan".
  - Permintaan baca diizinkan agar Mode latihan bisa menyalin data.
  - Setelah rilis (`fieldUiDefault = new`, bagian 5), penjaga ini tidak lagi memerlukan Demo penuh.
    Yang berlaku hanya izin lapangan biasa.
  - Header ini bukan pengaman utama (izin lama tetap berlaku). Gunanya menjaga agar tampilan demo
    tidak bisa menulis data asli tanpa izin Demo penuh.
- **Klien:**
  - Akun berizin melihat saklar "Tampilan baru (demo)" di menu Distribusi.
  - Dua pilihan disimpan per HP di `localStorage`: tampilan (`airro.dist.fieldUi` = `old|new`) dan
    mode (`airro.dist.fieldMode` = `latihan|asli`). Akun yang hanya punya Demo latihan tidak bisa
    memilih `asli`.

### 2. Modul Mode Lapangan (klien)

File baru di root. Semuanya masuk `build.mjs` FILES setelah `distribution.jsx` dan sebelum
`finance-shell.jsx`:

- `rit-plan.js`: `server/src/lib/rit-plan.js` dijadikan **isomorfik (UMD)** di root, seperti
  `dist-zones.js`. Server tetap `require()` file yang sama, dan Mode latihan bisa menyusun rute rit
  tanpa server.
- `dist-field-api.js`: adaptor. `FIELDAPI.real` membungkus `window.API.distribusi.*`, sedangkan
  `FIELDAPI.sandbox(snapshot)` adalah implementasi latihan. Satu antarmuka untuk keduanya:
  - baca: `board(date, fleet)`, `outstanding`, `customers`, `runs`, `ritRoute`, `daySummary`,
    `myChangeRequests`, `settings`;
  - tulis: `markStop`, `holdStop`, `cancelStop`, `createSale`, `payBon`, `openRun`, `closeRun`,
    `setLocation`, `setLocationPhoto`, `setPhone`, `addStop`, `adjustGallon`, `gallonDamage`,
    `addExpense`, `requestCorrection`, `requestVoid`, `requestReassign`, `withdrawRequest`,
    `closeDay`, `uploadPhoto`.
- `dist-field-sandbox.js`: penyimpanan latihan.
  - Isinya salinan data dari `real` saat latihan dimulai: pelanggan, papan hari ini, harga, rit,
    dan pengaturan.
  - Perubahan disimpan di IndexedDB per akun per HP. Foto disimpan lokal dan diperkecil.
  - Tombol "Ulang latihan" menghapus perubahan lalu menyalin ulang.
  - Aturan bisnis ditiru di sini (SOP, kapasitas, foto wajib, sisa bon, galon di pelanggan) supaya
    latihan terasa sama dengan asli.
- `dist-field.jsx`: layar-layar (lihat bagian 4).
- `dist-field.css`: gaya Liquid Glass dengan token warna di `:root`.
  - `backdrop-filter` **hanya** pada lapisan fungsional: dock, tombol bulat, sheet, dan menu Catat.
  - Menghormati `prefers-reduced-transparency` dan `prefers-reduced-motion`.
  - Di layar lebar, modul ditampilkan selebar HP di tengah.

**Keamanan Mode latihan:**
- `dist-field-sandbox.js` tidak boleh memanggil `window.API` atau `fetch`. Satu-satunya jalur baca
  adalah fungsi `snapshotFrom(real)` yang dipanggil sekali saat mulai, dan hanya memakai metode baca.
- Selama Mode latihan, pita oranye **"MODE LATIHAN — tidak tersimpan"** tampil di atas setiap layar.
- Pergantian mode selalu lewat konfirmasi.

**Integrasi di shell:** di `finance-shell.jsx`, layar `dist-deliveries` menampilkan `<FIELD.App/>`
kalau tampilan baru aktif dan akun berizin. Kalau tidak, `DIST.Deliveries` seperti sekarang. Menu
kantor lain (persetujuan, laporan, peta zona, harga) tidak berubah.

**Sesuai yang dibangun (Rencana 2, 2026-10-01):**
- Urutan bundel: `rit-plan.js` dan `dist-field-sandbox.js` setelah `dist-zones.js`;
  `dist-field-api.js` setelah `api.js`; `dist-field.jsx` setelah `dist-zones.jsx`. `dist-field.css`
  masuk `CSS_FILES` dan `index.html`.
- Semua file digabung dalam **satu cakupan**, jadi nama tingkat atas harus unik. Kelas CSS
  berawalan `mlap-` karena awalan `fld` sudah dipakai form lama. Ada tes statis yang menjaga keduanya.
- `API.distribusi.field.*` menandai setiap permintaan dengan `X-Airro-Ui: field`.
  `API.distribusi.fieldRules` sengaja tanpa tanda.
- Dua endpoint baru:
  - `GET /distribusi/field-context`: hari ini, armada, aturan, gudang, dan perkiraan galon per stop;
  - `PATCH /distribusi/customers/:id/phone`: izin `distribusiLokasiSimpan`, diaudit.
- Adaptor bernama `FIELDAPI.real` dan `FIELDAPI.openLatihan`. Mesin latihannya adalah
  `FIELDSANDBOX`. Aturan siapa-melihat-apa ada di satu fungsi murni, `FIELDAPI.prefState`.
- Kalau penyimpanan HP gagal atau tidak menjawab dalam 3 detik, latihan tetap jalan di memori dan
  layar memberi tahu bahwa latihan tidak tersimpan. "Koreksi saya" yang ditolak 403 dianggap kosong.
- Aturan lapangan diambil ulang hanya saat ada event `rules`. Tombol rilis hanya tampil untuk Owner.

### 3. Aturan & fitur baru di server

Semua migrasi **hanya menambah** kolom atau tabel. Tidak ada data lama yang diubah.

**3.0 Aturan lapangan: satu pengaturan** (keputusan implementasi)
- Semua aturan disimpan dalam **satu** settings key `fieldRules`, supaya saat rilis semuanya bisa
  dinyalakan sekaligus:
  `{ ritSop: { enabled, minLoad }, fleetCapacity: { "<plate>": galon }, wajibFotoTransaksi,
  wajibFotoPengeluaran, wajibAlasanBatal, hargaGantiRugiGalon, fieldUiDefault: 'old'|'new' }`.
- Service `fieldRules.service.js`. `GET /distribusi/field-rules` (izin `distribusi`) dan
  `PUT /distribusi/field-rules` (izin baru `distribusiAturanLapangan`, default owner/GM).
- Setiap perubahan dicatat di audit distribusi ("Aturan lapangan diubah").

**3.1 SOP muatan & kapasitas armada**
- Bagian dari `fieldRules`:
  - `ritSop` = `{ enabled: false, minLoad: 80 }`;
  - `fleetCapacity` = `{ "<plate>": <galon> }`. Kunci memakai plat nomor, sama seperti `airro_fleet`.
    Nilai 0 atau kosong berarti tanpa batas.
- `DeliveryRun.underSopReason String @default("")` (kolom baru).
- `openRun`:
  - kapasitas terisi dan `gallonsOut > kapasitas` → **400 selalu**, tanpa saklar, karena ini batas
    fisik;
  - `ritSop.enabled` dan `gallonsOut < minLoad` → alasan wajib (400 kalau kosong);
  - alasan disimpan dan ikut di audit;
  - tampilan baru selalu meminta alasan.

**3.2 Foto bukti transaksi**
- `DistTransaction.proofPhotoId String?` (Attachment id), `proofTakenAt DateTime?`,
  `proofLat Float?`, `proofLng Float?`.
- `createTransaction` (lunas/bon/transfer/pelunasan) menerima foto. Saklar
  `fieldRules.wajibFotoTransaksi` (default `false`): kalau `true`, foto wajib (400
  `PROOF_REQUIRED`). Id foto yang tidak ada ditolak (`PROOF_MISSING`).
- Foto terlihat di detail transaksi pada tampilan lama sebagai lampiran baca-saja.
- `DistExpense.photoId` sudah ada. Pengaturan `wajibFotoPengeluaran` membuatnya wajib.

**3.3 Metode Transfer & kolom metode bayar**
- `DistTransaction.payMethod String @default("")`, berisi `tunai | transfer | ''`.
- Penjualan: `method` tetap `lunas | bon | pelunasan`. Transfer adalah `method='lunas'` +
  `payMethod='transfer'`, sehingga semua agregat "lunas" yang sudah ada tetap benar.
  `pelunasan` juga mengisi `payMethod`.
- `isTransferPayment` membaca `payMethod` lebih dulu, lalu memakai akhiran catatan untuk baris lama.
- Pembukuan (`distTxnLines`): kalau `payMethod='transfer'`, baris kasnya memakai **Bank (1-1100)**
  untuk lunas maupun pelunasan. Selain itu tetap **Kas (1-1000)**.
- Setoran harian menghitung transfer **terpisah** dan tidak menambah uang yang harus disetor.
- **Data lama:** pelunasan transfer lama tercatat ke Kas. Skrip `scripts/reclass-transfer-payments.js`:
  - `--list` (default): menampilkan jumlah baris dan totalnya, tanpa menulis apa pun;
  - `--apply`: memposting jurnal koreksi Kas → Bank per baris melalui
    `reconcileDistTxn`/`dist_txn_adj`;
  - hanya dijalankan atas persetujuan pemilik;
  - dijaga `_db-guard`.

**3.4 Tunda & Batal per stop**
- `markSchema` menerima `ditunda` + `reason`. Alasan **wajib** untuk `ditunda`, dan disimpan di
  `pendingReason`, kolom yang sama dengan tutup hari.
- `batal` menerima `reason`, disimpan di `pendingReason`.
  - Saklar `fieldRules.wajibAlasanBatal` (default `false`): kalau `true`, alasan wajib di server.
  - Tampilan baru selalu meminta alasan.
- Stop yang ditunda tetap mengikuti aturan carry-over yang ada: muncul di "Belum terkirim" hari
  berikutnya.

**3.5 Geser titik lokasi**
- `CustomerLocationHistory` ditambah kolom `method String @default("gps")` (`gps | geser | form`),
  `deviceLat Float?`, `deviceLng Float?`, `deviceAccuracy Float?`, dan `fromDeviceM Float?` (jarak
  pin dari GPS perangkat, disimpan).
- `PATCH /customers/:id/location` menerima `method`, `deviceLat`, `deviceLng`, dan `deviceAccuracy`.
  Riwayat mencatat "digeser N m dari GPS perangkat".
- Jarak lebih dari 150 m dari posisi perangkat **tidak ditolak**, tetapi harus dikonfirmasi di UI dan
  ditandai di riwayat (`note`).
- **Perbaikan celah:** `updateCustomer` yang mengubah lat/lng lewat formulir sekarang juga menulis
  `CustomerLocationHistory` (`method='form'`) beserta titik sebelumnya.

**3.6 Ganti rugi galon rusak** (tanpa persetujuan)
- `fieldRules.hargaGantiRugiGalon` (rupiah per galon; owner/GM). Kalau belum diatur, ganti rugi
  ditolak dengan pesan yang jelas.
- Endpoint `POST /customers/:id/gallon-damage`, izin `distribusiInput`. Body: `qty`,
  `kind` (`pecah | bocor | retak | hilang`), `payMethod` (`tunai | bon | transfer`), `photoId`
  (wajib), `note`, dan `txnDate`. Qty lebih besar dari galon yang dipegang pelanggan ditolak.
  Dalam **satu transaksi DB**:
  1. Satu `GallonMovement` bertipe baru `damage_customer` (atau `loss_customer` untuk hilang)
     dengan `customerId` dan `transactionId`, yang memindahkan galon **pelanggan → rusak/hilang**.
     Invariant empat lokasi (depot + armada + pelanggan + rusak/hilang = total dimiliki) tetap
     berlaku;
  2. `DistTransaction` baru dengan `method` = `lunas` (tunai/transfer, `payMethod` diisi) atau `bon`,
     `kind='ganti_rugi'`, **`qty = 0`** (sehingga tidak pernah terhitung sebagai penjualan galon, HPP,
     atau cek integritas ledger), `gallonQty` = jumlah galon, dan `unitPriceLocked` = harga ganti rugi;
  3. audit.
- Pembukuan:
  - `kind='ganti_rugi'` + lunas: **Dr Kas/Bank, Cr 4-2000 Pendapatan Lain** (akun yang sudah ada);
  - bon: **Dr Piutang, Cr 4-2000 Pendapatan Lain**. Ikut ke Sisa Bon, sehingga invariant
    **AR = Σ Sisa Bon** tetap berlaku;
  - tidak ada HPP-on-sale.
- Dashboard: dikecualikan dari angka penjualan (`amount`, `byMethod`), tetapi uang tunai/transfernya
  tetap terhitung sebagai uang masuk dan setoran.
- Koreksi dan pindah pelanggan **ditolak** untuk ganti rugi. Satu-satunya jalan adalah batal (VOID,
  dengan persetujuan seperti biasa) lalu catat ulang. Void menonaktifkan movement-nya dan membalik
  jurnal.
- **Keputusan pemilik 2026-10-02 — ganti rugi dan aset galon.**
  - Ganti rugi yang dibayar uang (tunai/bon/transfer) otomatis menghapus galonnya dari aset galon
    (pool): Dr 1-1900 Akumulasi (bagiannya), Dr 6-8500 Rugi Pelepasan/Kerusakan Aset (sisa nilai buku),
    Cr 1-1440 Aset Galon (bagian harga perolehan). Nilai sisa ikut berkurang. Bagian akumulasi yang
    dihapus disimpan di `FixedAsset.writtenOffAccum`, jadi nilai buku di daftar aset tetap sama dengan
    buku besar. Satu baris `GallonPoolWriteOff` per transaksi mencatat apa yang diambil.
  - Pilihan baru **"Diganti galon baru"** (`payMethod 'ganti_galon'`): pelanggan menyerahkan galon baru.
    Tidak ada uang, tidak ada jurnal, aset tetap utuh, dan harga ganti rugi tidak diperlukan. Movement
    `replace_customer` memasukkan galon baru ke stok baik di gudang. Foto tetap wajib.
  - Batal (langsung, lewat persetujuan, atau massal) mengembalikan persis yang dihapus; memulihkan
    batal menghapusnya lagi. Kalau periode transaksi sudah ditutup, jurnalnya bertanggal hari ini.
  - Tanpa aset galon terdaftar, ganti rugi tetap tersimpan; tidak ada yang dihapus.
  - Ganti rugi lama (sebelum keputusan ini): Pemilik melihat daftarnya di layar Aset (pool galon →
    "Ganti rugi lama"), lalu menekan "Hapus dari aset".

**3.7 Koreksi saya**
- `GET /change-requests/mine`, izin `distribusiKoreksi`. Isinya pengajuan milik akun itu sendiri
  (`requestedById`) beserta status, catatan keputusan, dan ringkasan perubahan.
- `POST /change-requests/:id/withdraw`: pemohon menarik pengajuan yang masih `pending`. Status baru
  `withdrawn`, tercatat di audit.
- Persetujuan tidak berubah: `distribusiApprove`, dengan aturan persetujuan sendiri yang sudah ada.
- **Keputusan pemilik 2026-10-02 — menyetujui koreksi sendiri.** Akun yang punya akses Setujui
  Perubahan (`distribusiApprove`) boleh menyetujui koreksi, pembatalan, dan pindah pelanggan yang ia
  ajukan sendiri. Persetujuan itu tetap ditandai "disetujui sendiri", dicatat di audit, dan tetap kena
  batas nominal per orang (`maxSelfApproveAmount`). Akun yang hanya punya akses koreksi hanya bisa
  mengajukan. Izin terpisah `distribusiApproveSelf` kini mencakup sengketa, standar biaya, dan
  penggajian; hanya Pemilik yang boleh memberinya, termasuk lewat template peran. Tombol setujui
  tetap di kantor, tidak di HP.

**3.8 Ringkasan setoran harian**
- `GET /deliveries/day-summary?date&fleet` (izin `distribusiPengiriman`) mengembalikan:
  - `tunaiPenjualan`, `tunaiPelunasan`, `tunaiGantiRugi`, `transfer`, `bonBaru`, `pengeluaran`,
    `wajibSetor` (= total tunai − pengeluaran tunai);
  - `galon: { keluar, kembali, rusak }`, `stops: { terkirim, ditunda, batal, pending }`,
    `koreksiMenunggu` (semua pengajuan armada itu yang masih menunggu), dan
    `ritDiBawahSop: [{ runNo, gallonsOut, reason }]`.
- Semua angka dihitung dari data yang sama dengan `DistDeliveryReport`, sehingga tidak ada angka
  kedua.

### 4. Layar Mode Lapangan (mengikuti mockup)

Dock kaca terdiri dari Pengiriman · Peta · **[Catat]** · Pelanggan · Setoran. Catat adalah tombol
bulat biru terpisah yang membuka menu kaca berisi: Transaksi manual, Pembayaran bon, Pengeluaran,
Tambah stop, Penyesuaian galon, dan Ganti rugi galon.

| Layar | Sumber data / aksi |
|---|---|
| Pengiriman | `board`, `outstanding`, rit aktif. Menampilkan kartu "Berikutnya", filter Menunggu/Terkirim/Tunda, peringatan data belum lengkap, dan jumlah pelanggan di luar rute |
| Detail stop (sheet) | Daftar cek data pelanggan, Navigasi/Telepon/WA, Terima pembayaran bon, Penyesuaian, Ganti rugi, Tunda (alasan), Batal (alasan) |
| Transaksi | `createSale` dengan stepper keluar/kembali, Lunas/Bon/Transfer, **foto wajib**, dan tautan pembayaran bon |
| Rute rit / Peta | `ritRoute` + `rit-plan.js`. Peta memakai Leaflet + OSM yang sudah ada, dengan sheet ringkasan |
| Buka rit | `openRun` dengan pengukur SOP + kapasitas dan **alasan wajib di bawah SOP** |
| Pelanggan | `customers`, dengan filter Semua / Belum lengkap / Ada bon / Hari tetap |
| Lengkapi data | `setLocation` (GPS), `setPhone`, `setLocationPhoto` |
| Atur titik lokasi | Pin bisa diseret di atas peta (Leaflet marker `draggable`), titik GPS perangkat + lingkaran akurasi, titik lama, dan peringatan di atas 150 m. Tombol Peta / Satelit kalau kunci ArcGIS diisi (keputusan pemilik 2026-10-02, lihat "Di luar cakupan") |
| Tambah stop | `addStop`. Pelanggan tanpa titik langsung diarahkan ke Atur titik lokasi |
| Pembayaran bon | `payBon` (tunai/transfer), **foto wajib**, dengan alokasi bon tertua tampil lebih dulu (tampilan saja; sisa bon dihitung server seperti sekarang) |
| Penyesuaian galon | `adjustGallon` (fitur yang ada, tetap dengan persetujuan) |
| Ganti rugi galon | `gallonDamage` (3.6) |
| Pengeluaran | `addExpense`, selalu tunai dari setoran, dengan **foto nota wajib** |
| Koreksi (3 jenis + batalkan) | `requestCorrection`, `requestReassign`, dan `requestVoid`, dengan pratinjau dampak dari endpoint `/preview` yang sudah ada |
| Koreksi saya | `myChangeRequests`, `withdrawRequest` |
| Setoran / selesai kerja | `daySummary` + `closeDay` (alasan untuk stop yang belum selesai) |
| Armada & SOP (Owner/GM) | Pengaturan `ritSop`, `fleetCapacity`, dan saklar aturan. Dibuka dari Pengaturan tampilan lama **dan** dari tampilan baru untuk owner/GM |

Semua teks memakai `finance-i18n.js` (EN + ID), dengan prefix kunci `fld.*`.

**Sesuai yang dibangun (Rencana 3A, 2026-10-01): layar alur kerja harian.**
- File:
  - `dist-field-logic.js` (`FIELDLOGIC`): logika layar sebagai fungsi murni yang dites di Node;
  - `dist-field-kit.jsx`: komponen bersama, termasuk foto bukti dari kamera belakang, diperkecil, dan
    distempel jam + GPS;
  - `dist-field-day.jsx`: Pengiriman, Detail stop, Transaksi, Buka/Tutup rit, Rute/Peta, Setoran.
- Pengiriman menampilkan "Belum terkirim dari hari sebelumnya" hanya untuk dibaca. Penyelesaiannya
  tetap di tampilan lama, dan sopir tanpa `distribusiBelumTerkirim` melihat daftar kosong.
- `GET /field-context` kini menyertakan `openRun`: rit terbuka armada itu, tanggal berapa pun. Rit
  kemarin yang masih terbuka diarahkan untuk ditutup dulu.
- Transaksi disimpan sekali saja. Kalau penandaan "terkirim" gagal (sinyal hilang, atau server meminta
  lokasi), yang diulang hanya penandaannya.
- Foto latihan disimpan di kunci IndexedDB terpisah. Simpanan yang gagal dan "Ulang latihan" yang gagal
  ditampilkan di layar.
- Tampilan lapangan terang saja, mengikuti aplikasi yang belum punya tema gelap.
- Di HP, navigasi bawah aplikasi disembunyikan selama tampilan lapangan terbuka. Menu lengkap tetap bisa
  dibuka lewat tombol ☰.

**Sesuai yang dibangun (Rencana 3B, 2026-10-01): data pelanggan dan input manual.**
- `dist-field-cust.jsx` berisi tab Pelanggan (cari, filter Semua / Belum lengkap / Ada bon / Hari tetap),
  sheet pelanggan, Lengkapi data, Atur titik, Tambah stop, Pembayaran bon, Penyesuaian galon, Ganti rugi
  galon, dan Pengeluaran. Menu Catat kini aktif.
- **Kunci idempotensi:** kolom unik `clientRef` di `DistTransaction` dan `DistExpense`.
  - Penjualan, pelunasan, ganti rugi, atau pengeluaran yang dikirim ulang dengan kode yang sama
    mengembalikan baris yang sudah ada, termasuk saat respons hilang di jaringan.
  - Kode yang sama untuk pelanggan atau armada lain ditolak (409).
  - HP menyimpan kode itu per aksi dan per stop/pelanggan sampai tersimpan (localStorage, per mode,
    akun, armada, dan hari). Jadi keluar dari layar atau memuat ulang aplikasi lalu menyimpan lagi
    tidak mencatat dua kali. Layar memberi tahu "Sudah tersimpan sebelumnya".
- Transaksi manual untuk pelanggan yang masih punya stop "Menunggu" hari ini dicatat lewat stop itu,
  sehingga stopnya ikut ditandai terkirim.
- Atur titik tanpa GPS dan tanpa titik lama dimulai dari gudang. Pin wajib digeser dulu sebelum
  disimpan.
- Penyesuaian galon mengikuti saklar persetujuan galon milik pemilik (`adjustmentApproval`). Layar
  menyebutkan apakah penyesuaian menunggu kantor atau langsung berlaku. Di Mode latihan, penyesuaian
  selalu menunggu.
- **Aksi disaring berdasarkan izin**, sama dengan pengecekan di server:
  - `distribusiInput`: transaksi, bayar bon, ganti rugi;
  - `distribusiPenyesuaianGalon`: penyesuaian;
  - `distribusiExpense`: pengeluaran;
  - `distribusiOrder`: tambah stop;
  - `distribusiLokasiSimpan`: lengkapi data dan titik.
- Foto lokasi pelanggan hanya satu, karena kolom di server hanya satu.
- Liter dan odometer bensin disimpan di catatan pengeluaran.
- Pengeluaran dari tampilan baru selalu tunai; adaptor memaksanya.
- Alasan penyesuaian yang dipilih sopir dipetakan ke enum server. Kata-kata pilihan sopir tetap
  tersimpan di catatan.
- Daftar bon tertua di Pembayaran bon hanya untuk tampilan. Di Mode latihan, hanya transaksi latihan
  yang terlihat.

**Sesuai yang dibangun (Rencana 3C, 2026-10-01): koreksi, Koreksi saya, rilis.**
- `dist-field-koreksi.jsx`:
  - **Koreksi transaksi** dari stop Terkirim, dengan pilihan:
    - Pelanggan salah: saran pelanggan terdekat dari lokasi foto, lalu cari;
    - Jumlah galon;
    - Cara bayar Lunas/Bon/Transfer;
    - Nominal pelunasan;
    - Batalkan.
  - **Koreksi saya** (dari Setoran dan menu): Tarik saat Menunggu, Ajukan ulang saat Ditolak/Ditarik.
- Semua lewat mesin persetujuan yang ada. Transaksi asli tetap berlaku sampai disetujui. Ganti rugi
  hanya bisa dibatalkan.
- **Koreksi cara bayar di server:** `payMethod` tunai↔transfer, dengan foto bukti transfer (`PROOF_REQUIRED`).
  Saat disetujui, uang pindah Kas → Bank. Pratinjau tidak meminta foto. Alasan untuk kantor menyebut
  perubahan cara bayar dalam bahasa Indonesia, karena kotak persetujuan lama tidak menampilkannya.
- **Koreksi saya** terbuka untuk `distribusiKoreksi` atau `distribusiVoid`. Tarik dilakukan dengan satu
  tulis bersyarat, sehingga tidak pernah menimpa keputusan.
- Setoran memberi tahu kalau hari sudah ditutup dan meminta konfirmasi sebelum menutup lagi. Catatan
  lama tetap ada kecuali diganti.
- **Rilis:** `FLD_SCREENS_READY = true`. Tombol "Jadikan tampilan utama" (khusus Owner) kini aktif.

**Rencana 3D — kesetiaan desain (keputusan pemilik 2026-10-01).** Pemilik menilai hasil terhadap mockup
yang disetujui: tampilan, animasi, dan gesture, bukan hanya fungsi.
- Akun yang berhak (izin Pengiriman + Demo latihan/penuh, atau setelah rilis) langsung masuk tampilan
  lapangan **layar penuh** saat login, tanpa bar aplikasi lama dan tanpa banner unit.
  - Menu ⋯ punya "Kembali ke tampilan lama"; pilihan itu berlaku sampai login berikutnya.
  - Layar Aturan tetap dibuka di aplikasi.
- Penanda latihan menjadi chip kecil di header, selalu terlihat saat latihan; pita oranye dihapus.
- Gesture:
  - tarik sheet ke bawah untuk menutup;
  - usap kiri/kanan antar tab (tidak di peta, input, atau sheet);
  - Atur titik dengan menggeser peta di bawah pin tengah;
  - detent sheet peta (3D-2).
- Nilai material dan animasi disalin persis dari papan mockup. Pekerjaan dibagi dua:
  - 3D-1: fondasi;
  - 3D-2: tata ulang setiap layar sesuai papannya.
- **Sesuai yang dibangun (3D-1):**
  - shell mengembalikan `FIELD.App` layar penuh (`fieldFull`); `theme-color` = #EEF2F6 saat terbuka;
  - `dist-field-icons.jsx` memuat 45 ikon mockup sebagai elemen React;
  - `FldDock` dengan indikator tab cair;
  - `FldTop` berupa pil "Batal" kaca dengan judul di tengah;
  - `FldCtaBar` sebagai CTA tetap (dipakai layar di 3D-2);
  - `useFldSheetDrag`, `swipeTab`, dan Atur titik dengan pin tengah.

**Sesuai yang dibangun (Rencana 3D-2, 2026-10-02): setiap layar mengikuti papan mockupnya.**

Every field screen now follows its mockup board: Pengiriman (compact rit card + bar, tappable warnings, next-stop card, numbered coloured list), Detail stop (tall sheet), Transaksi, Buka/Tutup rit (sheet over Pengiriman with presets, SOP gauge and route-fit bar), Peta (full-bleed map, glass bar, 470/700 sheet), Setoran (KPI tiles, reason picker sheet, fixed close bar above the dock), Pelanggan (floating glass search, sideways chips), Lengkapi (mini-map), Atur titik (full-bleed map + glass sheet), Tambah stop (sheet), Bayar bon / Penyesuaian / Ganti rugi / Pengeluaran, Koreksi (tiles + impact rows), Koreksi saya (two segments), Armada & SOP. Deliberate differences: no Satelit toggle (needs a second tile service — owner to decide); Setoran and Peta keep the dock; the ganti-rugi price stays the owner's setting; reasons are picked in a sheet; board sample data the app does not have is not invented; touch targets stay ≥ 44 px. 3D-1 minors M5–M13 closed (old-view choice ends with the session, no finance flash before the rules load, scroll reset, keyboard pan counts, edge swipes left to the phone, tile press, top bar, quiet latihan chip, solid fallbacks). Small phones (320 × 640): sheet content scrolls instead of shrinking; the dock fits with a narrower centre slot. Screens were checked side by side with each board at 390 × 844 (boards rendered from the mockup files; the app through a real-time Chrome DevTools harness).

### 5. Rilis

1. **Demo:** deploy dengan semua saklar aturan mati. Hanya akun berizin yang melihat tampilan baru.
2. **Pelatihan:** karyawan diberi izin Demo latihan. Sopir uji coba diberi Demo penuh.
3. **Rilis ke semua akun:** Pengaturan (Owner) menyediakan tombol **"Jadikan tampilan utama"**
   (`fieldUiDefault` = `new`).
   - Setelah itu semua akun lapangan membuka tampilan baru. Mode asli tersedia untuk semua pemilik
     izin lapangan, dan izin demo tidak diperlukan lagi.
   - Mode latihan tetap tersedia bagi pemegang Demo latihan/penuh.
   - Owner menyalakan saklar aturan.
   - Tampilan lama bisa dibuka lewat menu selama masa transisi, lalu dihapus di pekerjaan terpisah.

## Pengujian

- **Server (Jest + supertest):**
  - penjaga izin demo khusus Owner: GM tidak bisa memberi, Owner bisa, dan tercatat di audit;
  - `requireFieldUi` (tulis ditolak tanpa Demo penuh, baca diizinkan);
  - SOP dan kapasitas: saklar mati/nyala, di atas kapasitas selalu ditolak, alasan tersimpan;
  - foto wajib saat saklar mati/nyala;
  - transfer → Bank dan tunai → Kas, untuk lunas maupun pelunasan;
  - skrip reklasifikasi: `--list` tidak menulis apa pun, `--apply` idempoten;
  - tunda (alasan wajib) dan batal (alasan wajib saat saklar nyala);
  - riwayat titik: `geser` dengan jarak dari perangkat, serta `form` yang mencatat titik sebelumnya;
  - ganti rugi galon:
    - movement pelanggan dan gudang seimbang;
    - jurnal ke pendapatan lain atau piutang;
    - **AR = Σ Sisa Bon**;
    - dikecualikan dari KPI penjualan;
    - void membalik semuanya;
  - koreksi saya: hanya milik sendiri, dan tarik kembali hanya bisa saat `pending`;
  - `day-summary` sama dengan angka laporan pengiriman.
- **Invariant yang ada** (integrityCheck: 0 jurnal hilang/yatim/ganda, AR = Σ Sisa Bon, stok galon)
  tetap hijau.
- **Klien (static + parse, tanpa dependensi root, sesuai aturan gerbang deploy):**
  - semua file baru ter-parse lewat `@babel/parser`;
  - `dist-field-sandbox.js` tidak mengandung `window.API`, `fetch(`, atau `XMLHttpRequest`;
  - pita "MODE LATIHAN" dirender di shell modul;
  - kunci i18n `fld.*` ada di kedua bahasa;
  - `rit-plan.js` di root dipakai server dan klien (satu sumber);
  - `build.mjs` memuat file baru dalam urutan yang benar.
- **Sandbox:** uji unit implementasi latihan (Node) untuk aturan SOP, foto wajib, sisa bon, dan galon
  di pelanggan, dengan snapshot contoh.
- Seluruh suite server harus hijau sebelum commit akhir.

## Di luar cakupan

- ~~**Tampilan peta satelit.**~~ **Dibangun 2026-10-02 (keputusan pemilik):** Atur titik punya tombol
  Peta / Satelit kalau Pemilik/GM mengisi kunci ArcGIS di Aturan lapangan (`fieldRules.satelliteKey`).
  Citra: Esri World Imagery (`ibasemaps-api.arcgis.com`), kredit "Powered by Esri" selalu terlihat.
  Tanpa kunci tombolnya tidak muncul. Kalau ubin satelit gagal dimuat, kembali ke peta jalan dengan
  pesan. Kunci ini terlihat oleh HP yang memakainya, jadi batasi di dasbor ArcGIS (lihat DEPLOY.md).
- Penghapusan tampilan lama. Dikerjakan setelah masa transisi, dalam pekerjaan terpisah.
- Pelanggan baru dibuat dari HP. Tambah stop hanya untuk pelanggan yang sudah ada, sama seperti
  sekarang.
- Kolom WhatsApp terpisah. `phone` dipakai sebagai nomor WA.
- Menjalankan skrip reklasifikasi transfer lama. Skripnya disediakan; menjalankannya adalah
  keputusan pemilik.
- Kamera dalam aplikasi (getUserMedia). Tetap memakai input file dengan `capture="environment"`
  seperti `UI.FileAttach`. Foto galeri tidak diblokir secara teknis di web, tetapi jam dan posisi
  pengambilan dicatat.

## Risiko & mitigasi

- **Ukuran pekerjaan besar.** Rencana dibagi per tugas yang masing-masing bisa diuji. Semua
  dikerjakan di satu cabang dan di-push hanya atas permintaan.
- **Salah sangka antara latihan dan asli.** Pita permanen, konfirmasi saat berganti mode, dan
  adaptor latihan yang secara struktur tidak bisa menulis ke server.
- **Aturan baru mengganggu tampilan lama.** Semua saklar mati sampai rilis. Kapasitas armada kosong
  berarti tanpa batas.
- **Penyimpanan HP penuh karena foto latihan.** Foto latihan diperkecil (≤ 1024 px) dan ada tombol
  "Ulang latihan".
