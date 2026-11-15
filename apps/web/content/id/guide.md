pubmy mengubah dokumen, e-book, dan komik jadi EPUB 3 yang lolos Send to Kindle. Semua diproses di browser kamu, jadi tidak ada file yang diunggah. Setiap EPUB punya daftar isi dan diperiksa dengan validator EPUB sebelum diberikan. File yang sudah EPUB tidak dikonversi: kamu bisa langsung membacanya di halaman.

## Cara konversi

1. **Pilih file.** Klik Pilih file, atau tarik file ke halaman [Konversi](/). Maksimal {{MAX_FILES}} file, masing-masing {{MAX_MB}} MB. Daftar format yang didukung ada di halaman [Format](/format/).
2. **Tunggu konversinya.** Setiap file muncul sebagai satu baris di antrean. Selama dikonversi, baris itu menampilkan bilah progres. Kalau statusnya sudah Siap, klik Pratinjau untuk melihat isi EPUB di halaman sebelum diunduh.
3. **Unduh.** Klik Unduh EPUB di baris file itu. Kalau beberapa file sudah siap, Unduh semua (ZIP) mengunduh semua file yang siap sekaligus dalam satu ZIP.

## Kirim ke Kindle

pubmy tidak mengirim apa pun ke Amazon. Kirim EPUB-nya sendiri lewat Send to Kindle dari Amazon: lewat email ke alamat Send to Kindle kamu, lewat Send to Kindle for Web, atau lewat aplikasinya. EPUB dari pubmy dibuat supaya lolos pemeriksaan Send to Kindle.

## Batas waktu

Hasil konversi hanya disimpan di memori tab browser. {{RETENTION_MIN}} menit setelah sebuah EPUB siap, EPUB itu dihapus dari memori dan barisnya berubah jadi Dihapus. Pratinjau yang masih terbuka ikut ditutup saat itu.

Sisa waktunya terlihat di baris file sebagai "Hasil dihapus dari memori dalam" diikuti hitung mundur. Butuh waktu lebih lama? Buka tombol titik tiga (Aksi lainnya) di baris itu lalu pilih Perpanjang: hitung mundurnya mulai lagi dari {{RETENTION_MIN}} menit.

## Membaca EPUB

Kalau kamu memasukkan file .epub, file itu tidak dikonversi. pubmy membukanya di pembaca di halaman ini. Barisnya berstatus Siap dibaca dan punya tombol Baca, tanpa tombol unduh. EPUB pertama dari setiap kali kamu memasukkan file langsung terbuka kalau belum ada pembaca yang terbuka. EPUB yang dilindungi DRM tidak bisa dibuka.

Batas waktu {{RETENTION_MIN}} menit juga berlaku untuk EPUB yang kamu buka, tapi hitung mundurnya berhenti selama pembacanya terbuka. Setelah pembaca ditutup, hitung mundurnya mulai lagi dari awal.

## FAQ

### Apakah pubmy gratis?

Ya. Website ini gratis dipakai, dan kodenya open source dengan lisensi MIT di [GitHub](https://github.com/belajarcarabelajar/pubmy). Selengkapnya di halaman [Tentang](/tentang/).

### Apakah file kamu diunggah?

Tidak. Konversi berjalan di browser kamu sendiri, dan file kamu tidak dikirim ke server mana pun. Detailnya ada di halaman [Privasi](/privasi/).

### Kenapa file kamu gagal atau ditolak?

Alasannya tertulis di baris file itu. Kemungkinan alasannya:

- File dilindungi DRM.
- PDF atau dokumen Office dikunci kata sandi.
- File lebih dari {{MAX_MB}} MB, atau antrean sudah penuh ({{MAX_FILES}} file).
- Format file tidak didukung. Cek halaman [Format](/format/).
- File kosong atau tidak bisa dibaca.
- Browser terlalu lama untuk membaca PDF. Coba versi terbaru Chrome, Firefox, atau Safari.
- EPUB hasil konversi tidak lolos validator, jadi tidak diberikan.

Kalau menurut kamu file itu seharusnya bisa, [laporkan masalahnya di GitHub](https://github.com/belajarcarabelajar/pubmy/issues).

### Bisakah PDF hasil pindaian dikonversi?

Bisa. PDF hasil pindaian dibaca dengan OCR dalam bahasa Indonesia dan Inggris.

### Bagaimana dengan file ber-DRM?

File MOBI atau AZW3 dengan DRM ditolak dan tidak pernah didekripsi. Baca alasannya di halaman [DRM](/drm/).

### Bisakah dipakai di HP?

Bisa. Ketuk Pilih file untuk memilih file. Tarik dan lepas hanya untuk komputer. Di HP atau tablet batasnya sama: maksimal {{MAX_FILES}} file, masing-masing {{MAX_MB}} MB.
