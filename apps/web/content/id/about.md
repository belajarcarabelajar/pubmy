pubmy mengubah dokumen, e-book, dan komik kamu jadi file EPUB yang diterima Kindle. Setiap EPUB berformat EPUB 3 dengan daftar isi, dan dicek dengan validator EPUB sebelum ditulis.

## Dua cara memakai pubmy

### Website

Di [halaman konversi](/), tarik hingga {{MAX_FILES}} file (masing-masing {{MAX_MB}} MB) atau tekan Pilih file. Lihat hasilnya lewat Pratinjau, lalu tekan Unduh EPUB untuk satu file atau Unduh semua (ZIP) untuk semua file yang sudah siap. File yang sudah berupa EPUB tidak dikonversi: file itu dibuka di pembaca lewat Baca supaya bisa langsung kamu baca. Semua proses berjalan di browser kamu (lihat [Privasi](/privasi/)).

### Skill agen dan CLI

Berikan sebuah folder ke agen coding kamu (Claude Code, Codex, Cursor, OpenCode, Antigravity), lalu agen mengonversi setiap file yang didukung di dalamnya dengan susunan folder yang tetap sama. Cara memasangnya ada di halaman [Skill dan CLI](/cli/).

## Sumber terbuka

pubmy dirilis dengan Lisensi MIT. Kode sumbernya ada di GitHub: [github.com/belajarcarabelajar/pubmy](https://github.com/belajarcarabelajar/pubmy).

## Perangkat lunak pihak ketiga

Pratinjau EPUB di website memakai foliate-js (MIT). Teks lisensinya ikut di website: [/licenses/foliate-js.txt](/licenses/foliate-js.txt). foliate-js juga dipakai untuk membaca file MOBI dan AZW3.

Komponen utama lain yang dipakai pubmy:

- unpdf: membaca PDF, dengan pdf.js di dalamnya (MIT; pdf.js Apache-2.0)
- tesseract.js: OCR untuk PDF hasil pindaian (Apache-2.0)
- mammoth: membaca DOCX (BSD-2-Clause)
- markdown-it: membaca Markdown (MIT)
- libarchive.js: membaca komik CBR (MIT)
- fflate: membaca dan menulis ZIP, misalnya EPUB, CBZ, DOCX, dan ODT (MIT)
- @likecoin/epubcheck-ts: memvalidasi EPUB (BSD-3-Clause)

Setiap komponen punya hak cipta dan teks lisensinya sendiri, yang diterbitkan bersama paketnya.

## Masukan

Menemukan masalah atau punya usul? [Laporkan masalah di GitHub Issues](https://github.com/belajarcarabelajar/pubmy/issues).

## Versi

Versi website saat ini: {{VERSION}}. Perubahan tiap versi ada di halaman [Rilis](/rilis/) dan di [GitHub Releases](https://github.com/belajarcarabelajar/pubmy/releases).
