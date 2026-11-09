// Generates the PDF used by packages/core/test/pdf-header-block.test.ts: a mimic of a real 9-page A4
// user manual that was exported from a document template (a cover, then a header table on every
// other page, the whole table drawn twice on page 2, 13 pt numbered headings, an 11 pt unnumbered
// heading and a trailing 13 pt unnumbered one). Dev only (pdf-lib, MIT). The text is made up; the
// positions and sizes were read from the real file with pdf.js.
// A plain export without a command-line entry on purpose: scripts/build-fixture-outputs.ts runs every
// fixtures/make-*.ts with an out dir and converts what lands there, so a maker that writes nothing
// stays out of the EPUBCheck cross-check.
import { PDFDocument, StandardFonts } from "pdf-lib";

const PAGES = 9;
const LEADING = 18.6;
const LEFT = 42;

/** The template header table: x, y, size, text. The last cell holds the page number text. */
function headerCells(last: string): [number, number, number, string][] {
  return [
    [332.4, 814.5, 7.5, "No. Dokumen"],
    [414.1, 814.5, 7.5, ": F-DTD-10-07"],
    [332.4, 798.7, 7.5, "Revisi"],
    [414.1, 798.7, 7.5, ": 00"],
    [90.0, 781.5, 9, "DIREKTORAT"],
    [332.4, 783.0, 7.5, "Klasifikasi"],
    [414.1, 783.0, 7.5, ": Umum"],
    [205.5, 766.9, 12, "SATU CERTIFICATE"],
    [64.0, 767.1, 9, "TRANSFORMASI DIGITAL"],
    [332.4, 767.2, 7.5, "Tanggal Terbit"],
    [414.1, 767.2, 7.5, ": 4 Oktober 2026"],
    [105.8, 752.7, 9, "(DTD)"],
    [332.4, 751.5, 7.5, "Halaman"],
    [414.1, 751.5, 7.5, last],
  ];
}

/**
 * Nine A4 pages. Page 1: a cover without the header. Pages 2 to 9: the header table at the same
 * x, y and size every time; page 2 draws it twice at identical positions, the first copy with a
 * bare ":" as the page number and the second with ": 2 dari 9". Body text is 10 pt; the headings are
 * "1." to "7." at 13 pt bold, "Data yang wajib terpenuhi sebelum submit" at 11 pt bold (between
 * "3." and "4.", a sub-section of 3), a 15 pt sub-title above "1." and "Pertanyaan umum" at 13 pt bold.
 */
export async function makeHeaderBlockPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages = Array.from({ length: PAGES }, () => pdf.addPage([595.28, 841.89]));
  type Page = (typeof pages)[number];
  const put = (p: Page, text: string, x: number, y: number, size: number, f = font) => p.drawText(text, { x, y, size, font: f });
  const lines = (p: Page, text: string[], top: number, x = LEFT) => text.forEach((l, k) => put(p, l, x, top - k * LEADING, 10));
  const heading = (p: Page, text: string, y: number, size = 13) => put(p, text, LEFT, y, size, bold);

  put(pages[0], "User Manual", 227.3, 489.7, 20, bold);
  put(pages[0], "PENGEMBANGAN SISTEM SATU CERTIFICATE", 163.9, 450.9, 12);
  put(pages[0], "SATU CERTIFICATE", 241.2, 418.2, 12);
  put(pages[0], "Panduan Mahasiswa", 236.7, 385.4, 12);

  pages.slice(1).forEach((p, k) => {
    const draw = (last: string) => {
      for (const [x, y, size, text] of headerCells(last)) put(p, text, x, y, size);
      put(p, "USER MANUAL", 208.8, 792.5, 13, bold);
    };
    if (k === 0) draw(":");
    draw(`: ${k + 2} dari ${PAGES}`);
  });

  const rows: [string, string][] = [
    ["Nama Proyek", "PENGEMBANGAN SISTEM SATU CERTIFICATE"],
    ["Nama Sistem", "SATU CERTIFICATE"],
    ["Nama Sub Sistem", "Panduan Mahasiswa"],
    ["Program Id", "CERTIFICATE"],
    ["Nomor Versi Program", "1.0"],
  ];
  rows.forEach(([name, value], k) => {
    put(pages[1], name, 50.3, 692.8 - k * 31.3, 10);
    put(pages[1], value, 193.2, 692.8 - k * 31.3, 10);
  });

  heading(pages[2], "Panduan Mahasiswa / Lulusan", 692.1, 15);
  lines(pages[2], [
    "SATU Certificate adalah portal dokumen akademik untuk lulusan. Pada portal ini Anda memeriksa",
    "data kelulusan, mengunggah foto, lalu mengirim data ke fakultas. Setelah diverifikasi, Anda",
    "menerima ijazah dan transkrip yang sudah ditandatangani secara elektronik.",
  ], 664.2);
  heading(pages[2], "1. Masuk ke sistem", 538.4);
  lines(pages[2], [
    "Buka situs certificate.ui.ac.id, lalu klik tombol Masuk pada pojok kanan atas.",
    "Anda diarahkan ke laman SSO UI. Masukkan username dan password akun UI Anda.",
    "Setelah berhasil, beranda tampil berisi informasi akun dan periode pengisian data.",
  ], 512.7);

  heading(pages[3], "2. Melihat data lulusan", 695.1);
  lines(pages[3], [
    "Klik menu Lulusan. Laman Data Lulusan Saya menampilkan kartu data kelulusan Anda, yaitu foto,",
    "nama, program studi, nomor ijazah, tahapan status, dan tombol untuk mengunggah karya akhir.",
    "Kotak kuning muncul bila masih ada data yang harus dilengkapi sebelum Anda mengirim data.",
  ], 669.4);
  lines(pages[3], [
    "Klik tombol Lengkapi untuk membuka data lengkap Anda. Bagian Persyaratan menunjukkan",
    "apakah tagihan sudah lunas dan karya akhir sudah diunggah ke perpustakaan.",
    "Jika Anda lulus pada dua program studi atau lebih, setiap program memiliki kartu tersendiri.",
  ], 329.8);
  heading(pages[3], "3. Melengkapi data", 175.2);
  lines(pages[3], [
    "Saat laman data dibuka, sistem menampilkan ketentuan foto. Baca dan siapkan foto sesuai",
    "ketentuan tersebut, lalu lanjutkan ke langkah berikutnya.",
  ], 149.5);

  lines(pages[4], [
    "Foto harus berlatar polos, berukuran paling besar dua megabita, dan berformat JPG atau PNG.",
    "Pastikan wajah terlihat jelas dan tidak tertutup apa pun.",
  ], 700);
  lines(pages[5], [
    "Setelah foto terunggah, periksa kembali nama, tempat lahir, dan tanggal lahir Anda.",
    "Data yang salah diperbaiki oleh bagian akademik fakultas, bukan oleh mahasiswa.",
  ], 700);

  lines(pages[6], [
    "Lakukan langkah berikut, lalu periksa hasilnya pada kartu data Anda. Klik tombol Sync",
    "untuk mengambil data terbaru dan memperbarui status tagihan biaya pendidikan Anda.",
    "Periksa kembali seluruh data. Pastikan nama dan tempat lahir sesuai dokumen resmi.",
    "Buka tab Ijazah dan Transkrip untuk melihat rancangan dokumen Anda.",
  ], 673.8);
  heading(pages[6], "Data yang wajib terpenuhi sebelum submit", 409.1, 11);
  lines(pages[6], [
    "Foto sudah diunggah sesuai ketentuan, dan tidak ada tagihan biaya pendidikan yang tertunggak.",
    "Periode pengisian sedang dibuka, sehingga tombol kirim dapat dipakai oleh mahasiswa.",
    "Nama, tempat, dan tanggal lahir sudah benar, serta dua kotak pernyataan sudah dicentang.",
  ], 378.9);
  heading(pages[6], "4. Submit data", 200);
  lines(pages[6], [
    "Pada bagian bawah laman data, centang kedua pernyataan, lalu klik tombol Simpan.",
    "Status data berubah menjadi Telah Disubmit dan diteruskan ke fakultas untuk diverifikasi.",
  ], 174.4);

  lines(pages[7], [
    "Pernyataan pertama menyatakan bahwa Anda bersedia menghapus data setelah wisuda,",
    "dan pernyataan kedua menyatakan bahwa seluruh data yang Anda isi sudah benar.",
  ], 699.5, 72);
  heading(pages[7], "5. Memantau status", 523.9);
  lines(pages[7], [
    "Status terlihat pada label dan tahapan status di kartu data Anda. Riwayatnya dapat",
    "dibuka pada tombol Riwayat Status, termasuk pesan yang ditulis oleh verifikator fakultas.",
  ], 498.2);
  heading(pages[7], "6. Mengunduh dokumen", 319.5);
  lines(pages[7], [
    "Setelah dokumen ditandatangani Dekan dan Rektor, buka bagian Dokumen pada kartu data Anda.",
    "Ijazah, atau sertifikat profesi untuk program profesi, dan transkrip dapat diunduh di sana.",
  ], 293.8);

  lines(pages[8], [
    "Keaslian dokumen dapat diperiksa siapa saja melalui tautan verifikasi pada beranda situs.",
    "Tautan itu memuat nama pemilik dokumen, nomor dokumen, dan tanggal penandatanganan.",
  ], 441.1);
  heading(pages[8], "7. Punya lebih dari satu program studi?", 381.6);
  lines(pages[8], [
    "Jika Anda lulus pada dua program studi atau lebih, klik avatar di kanan atas,",
    "lalu pilih Ganti Program Studi untuk berpindah antar program.",
  ], 355.9);
  heading(pages[8], "Pertanyaan umum", 300.8);
  lines(pages[8], [
    "Data saya salah, tetapi status sudah Telah Disubmit. Hubungi admin fakultas agar data",
    "dikembalikan. Setelah status kembali menjadi Rancangan, Anda dapat memperbaikinya sendiri.",
    "Foto gagal diunggah. Pastikan format JPG atau PNG dan ukuran paling besar dua megabita.",
    "Tautan unduhan belum muncul padahal status Disetujui. Dokumen masih dalam proses tanda tangan.",
  ], 275.1);

  return pdf.save();
}
