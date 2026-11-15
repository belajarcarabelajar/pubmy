Setiap file yang kamu konversi dengan pubmy menjadi EPUB 3 lengkap dengan daftar isi. Sebelum kamu menerimanya, EPUB itu diperiksa dengan validator EPUB. EPUB yang tidak lolos pemeriksaan tidak diberikan. Halaman ini menjelaskan file apa saja yang bisa kamu masukkan dan apa hasilnya.

## Format yang didukung

| Input | Ekstensi | Hasilnya |
|---|---|---|
| PDF berteks | `.pdf` | Kolom dan judul dikenali dari tata letak teks. Header, footer, dan nomor halaman yang berulang di setiap halaman dibuang. Kalau PDF tidak punya outline, judul tanpa nomor yang ukurannya lebih kecil dari judul bernomor tetap berada di dalam babnya dan tercantum di bawah bab itu di daftar isi. Gambar tetap menjadi gambar, dan tabel yang dicetak menyamping disusun ulang menjadi tabel. Rumus dan diagram garis disimpan sebagai gambar dari bagian halamannya, jadi tampil persis seperti cetakannya. |
| PDF hasil pindaian | `.pdf` | Teksnya dibaca dengan OCR dalam bahasa Indonesia dan Inggris. |
| Dokumen pengolah kata dan teks | `.docx`, `.odt`, `.rtf`, `.html`, `.htm`, `.md`, `.txt` | Judul di dalam dokumen menjadi bab. |
| E-book Kindle tanpa DRM | `.mobi`, `.azw3` | Dikonversi menjadi EPUB. File yang dilindungi DRM ditolak, lihat [kebijakan DRM](/drm/). |
| Komik | `.cbz`, `.cbr` | Tata letak tetap, satu gambar per halaman. Urutan halaman dari kanan ke kiri untuk manga tersedia di [CLI](/cli/) lewat opsi `--rtl`. |

## File EPUB

File `.epub` yang kamu masukkan tidak dikonversi. File itu dibuka di pembaca supaya bisa langsung kamu baca.

- Barisnya berstatus "Siap dibaca" dan punya tombol **Baca**, tanpa tombol **Unduh EPUB**.
- Seperti hasil konversi, EPUB yang kamu buka dihapus dari memori setelah {{RETENTION_MIN}} menit. Hitungannya berhenti selama pembacanya terbuka. Penjelasan lengkapnya ada di halaman [Privasi](/privasi/).
- EPUB yang dilindungi DRM tidak bisa dibuka, lihat [kebijakan DRM](/drm/).

## Batas

Batas ini berlaku di situs web:

- Antrean memuat paling banyak {{MAX_FILES}} file, dan setiap file paling besar {{MAX_MB}} MB. File yang melewati batas ini ditolak dan tidak masuk antrean.
- PDF atau dokumen Office yang dikunci kata sandi tidak bisa dikonversi.
- Arsip komik yang tidak berisi gambar tidak bisa dikonversi, begitu juga arsip yang isinya terlalu besar setelah dibuka.
- File kosong dan file dengan format yang tidak didukung tidak bisa dikonversi.
- Untuk membaca PDF, browser kamu tidak boleh terlalu lama. Kalau muncul pesan soal itu, coba versi terbaru Chrome, Firefox, atau Safari.

Cara memakai konverter langkah demi langkah ada di [Panduan](/panduan/).
