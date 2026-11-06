// Original fixture text written for this spike (no third-party copyright).
export const pages: string[] = [
  `Bab 1: Membaca di Layar Kecil

Kebiasaan membaca buku digital terus tumbuh di Indonesia. Banyak pelajar menyimpan modul kuliah, catatan, dan novel di perangkat Kindle karena layarnya nyaman untuk mata dan baterainya awet berhari-hari. Namun tidak semua berkas siap dibaca di perangkat tersebut. Dokumen hasil pindaian, misalnya, hanya berisi gambar halaman tanpa teks yang bisa dipilih, sehingga ukuran huruf tidak dapat diubah dan pencarian kata tidak berjalan.

Masalah ini sering muncul pada arsip lama milik perpustakaan sekolah, fotokopi materi pelatihan, dan buku catatan yang dipotret dengan ponsel. Pembaca harus memperbesar halaman, menggeser ke kiri dan ke kanan, lalu kehilangan alur bacaan. Pengalaman seperti itu membuat orang cepat lelah dan akhirnya berhenti membaca.

Why Optical Character Recognition Matters

Optical character recognition turns a picture of a page into real text. Once the words exist as characters, a converter can reflow them into chapters, apply a readable font, and build a table of contents. The reader can then search for a term, highlight a sentence, and look up a definition without leaving the book.

Accuracy still decides whether the result is pleasant. A few wrong letters per paragraph are tolerable, but broken words in every line quickly ruin the reading flow. For that reason this experiment measures both speed and the error rate on a mixed Indonesian and English page.`,
  `Bab 2: Menyiapkan Halaman Pindaian

Kualitas gambar sangat menentukan hasil pengenalan huruf. Halaman sebaiknya dipindai dengan resolusi sekitar dua ratus titik per inci, dalam posisi lurus, dan dengan pencahayaan yang merata. Bayangan jari, lipatan kertas, serta noda tinta dapat dibaca sebagai huruf palsu oleh mesin. Karena itu langkah pertama selalu membersihkan gambar: memotong tepi yang gelap, meluruskan kemiringan, dan mengubah warna menjadi hitam putih.

Setelah gambar bersih, mesin pengenal membaca halaman baris demi baris. Mesin memerlukan data bahasa agar dapat menebak kata yang wajar. Data bahasa Indonesia membantu mengenali imbuhan seperti meng, peng, dan akhiran kan atau nya, sedangkan data bahasa Inggris berguna untuk istilah teknis yang sering muncul dalam buku pelajaran.

Choosing Languages for Recognition

Loading two language models at once costs more memory and time, yet it often improves the result on bilingual material. The engine compares each word against both vocabularies and keeps the most likely spelling. On a slow laptop or an older phone, the extra cost can be noticeable, so the application should load the data only when it detects that a file truly needs recognition.

A practical converter therefore checks the document first. When a PDF already contains a text layer, the converter skips recognition entirely and reads the existing characters. Only image pages without text go through the slower path.`,
  `Bab 3: Dari Teks ke Buku Elektronik

Teks hasil pengenalan belum langsung menjadi buku yang rapi. Nomor halaman, judul berjalan di bagian atas, dan pemenggalan kata di ujung baris harus dibuang lebih dulu. Paragraf yang terpotong oleh batas halaman perlu disambung kembali agar kalimat tetap utuh. Judul bab dikenali dari ukuran huruf atau dari pola seperti kata Bab yang diikuti angka.

Setelah struktur terbentuk, konverter menyusun berkas EPUB yang berisi bab, daftar isi, dan metadata seperti judul serta nama penulis. Berkas ini dapat dikirim ke Kindle melalui surel atau kabel, lalu dibaca dengan ukuran huruf pilihan pembaca. Gambar asli tetap dapat disertakan sebagai lampiran bila pembaca ingin membandingkan hasilnya.

Keeping the Process Private

Many students prefer that their notes never leave the device. Running recognition inside the browser keeps every page on the local computer, with no upload to a remote server. The trade off is speed: a browser worker shares the processor with everything else on the screen, and a long book may take several minutes.

A clear progress bar, the option to cancel, and a sensible default of one or two workers make that wait acceptable. Users can keep reading the first chapters while the rest of the book is still being processed in the background.`,
];
