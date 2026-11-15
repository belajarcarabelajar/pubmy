File kamu tidak pernah keluar dari browser. Halaman ini menjelaskan apa yang terjadi pada file kamu di website pubmy, dan di skill agen serta CLI-nya.

## Di website

Konversi berjalan di dalam browser kamu sendiri. File kamu tidak diunggah ke server mana pun.

- Setiap EPUB disimpan di memori tab browser dan dihapus {{RETENTION_MIN}} menit setelah siap. Hitung mundur menunjukkan sisa waktunya, jadi tekan Unduh EPUB sebelum waktunya habis.
- Pratinjau yang sedang terbuka ditutup pada saat yang sama.
- EPUB yang kamu buka untuk dibaca mengikuti aturan {{RETENTION_MIN}} menit yang sama. Bedanya, hitung mundurnya berhenti selama pembacanya terbuka dan berjalan lagi saat kamu menutupnya.

Cara memakai halaman konversi ada di [Panduan](/panduan/).

## Yang disimpan browser

Kode pubmy sendiri hanya menyimpan satu hal di browser kamu: pilihan bahasa, di localStorage dengan kunci `pubmy.lang`. Kode pubmy tidak memasang cookie.

Saat kamu mengonversi PDF hasil pindaian, pustaka OCR (tesseract.js) menyimpan data bahasanya, Indonesia dan Inggris, di penyimpanan browser (IndexedDB) supaya tidak perlu dimuat ulang lain kali. Yang disimpan hanya data bahasa itu, bukan file kamu atau teksnya.

## Skrip di dalam buku

Pratinjau dan pembaca menampilkan isi buku di halaman konversi, dan buku bisa membawa skrip. Dalam pengecekan pada 2026-11-09 di Chromium 156, tidak satu pun dari enam cara buku menjalankan skrip berhasil berjalan di bawah Content Security Policy halaman konversi. Keenam cara itu: skrip inline, file skrip di dalam paket buku, SVG, `onerror`, tautan `javascript:`, dan meta refresh.

## Skill agen dan CLI

Skill dan CLI berjalan di komputer kamu sendiri.

- Hanya menulis ke `<folder>/pubmy-epub/` dan ke cache OCR di `~/.cache/pubmy`.
- Tidak pernah mengubah, memindahkan, menghapus, atau mengunggah file sumber kamu.
- Data bahasa OCR (Indonesia dan Inggris, sekitar 4 MB) sudah ikut di dalam skill dan dikunci dengan checksum, jadi PDF hasil pindaian tidak perlu unduhan apa pun.
- PDF pertama yang berisi rumus atau diagram garis mengunduh pustaka gambar (sekitar 15 MB, dicek terhadap checksum tetap). Tidak ada isi file yang ikut terkirim. Tanpa pustaka itu, misalnya saat offline, rumus tetap berupa teks dan laporannya menyebutkan hal itu.

Cara memasang dan memakai skill ada di halaman [Skill dan CLI](/cli/).
