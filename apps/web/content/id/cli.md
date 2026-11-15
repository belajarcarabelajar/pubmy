pubmy juga tersedia sebagai skill agen dan alat baris perintah (CLI). Konverternya sama dengan yang ada di website. Berikan sebuah folder ke agen coding kamu (Claude Code, Codex, Cursor, OpenCode, Antigravity), lalu agen itu mengonversi setiap file yang didukung di dalamnya dengan susunan folder yang tetap sama. Daftar file yang didukung ada di [Format](/format/). Kalau kamu hanya perlu mengonversi beberapa file, [konverter](/) di browser sudah cukup.

## Kebutuhan

- [Bun](https://bun.sh) 1.4 atau lebih baru. Cek dengan `bun --version`.
- Folder skill-nya sudah lengkap: sekitar 25 MB, sebagian besar mesin OCR. Tidak perlu `bun install`.
- Pilih satu cara pasang di bawah. Memasang skill yang sama dua kali membuat sebagian harness menampilkannya dua kali.

## Pasang dengan satu perintah

Untuk harness apa pun, lewat [skills CLI](https://github.com/vercel-labs/skills). Butuh [Node.js](https://nodejs.org) 22.20 atau lebih baru.

```bash
npx skills add belajarcarabelajar/pubmy --skill pubmy -g
```

Perintah ini menanyakan harness mana yang mau dipasangi. Supaya tidak ditanya, sebutkan harness-nya dengan `-a`, misalnya `-a claude-code -a codex`. Dengan `-g`, `claude-code` terpasang di `~/.claude/skills/pubmy`, sedangkan `codex`, `cursor`, `opencode`, dan `antigravity` terpasang di `~/.agents/skills/pubmy`. Antigravity tidak membaca folder itu, jadi untuk Antigravity pakai ZIP di bawah.

## Plugin Claude Code

Butuh Claude Code 2.1.275 atau lebih baru. Di dalam sesi:

```text
/plugin install pubmy --marketplace belajarcarabelajar/pubmy
```

Atau dari shell:

```bash
claude plugin marketplace add belajarcarabelajar/pubmy
claude plugin install pubmy@pubmy
```

Sebagai plugin, nama skill-nya `pubmy:pubmy`. Perbarui dengan `claude plugin update pubmy@pubmy`.

## Unduh ZIP

Tidak perlu Git atau Node.js. Unduh [pubmy-skill.zip](https://github.com/belajarcarabelajar/pubmy/releases/latest/download/pubmy-skill.zip) dari rilis terbaru, lalu ekstrak ke folder skill harness kamu (lihat tabel di bagian berikutnya). Isi ZIP-nya satu folder, `pubmy`. Perintah di bawah memakai folder Claude Code; untuk harness lain, ganti dengan folder harness itu.

Linux atau macOS:

```bash
curl -fsSLo /tmp/pubmy-skill.zip https://github.com/belajarcarabelajar/pubmy/releases/latest/download/pubmy-skill.zip
mkdir -p ~/.claude/skills && unzip -oq /tmp/pubmy-skill.zip -d ~/.claude/skills
```

Windows (PowerShell):

```powershell
Invoke-WebRequest https://github.com/belajarcarabelajar/pubmy/releases/latest/download/pubmy-skill.zip -OutFile "$env:TEMP\pubmy-skill.zip"
New-Item -ItemType Directory -Force "$HOME\.claude\skills" | Out-Null; Expand-Archive -Force "$env:TEMP\pubmy-skill.zip" "$HOME\.claude\skills"
```

## Folder skill per harness

| Harness | Folder skill |
|---|---|
| Claude Code | `~/.claude/skills` |
| Codex | `~/.agents/skills` |
| Cursor | `~/.agents/skills` |
| OpenCode | `~/.agents/skills` |
| Antigravity | `~/.gemini/config/skills` |

Antigravity CLI (`agy`) tidak membaca `~/.agents/skills`. Dalam pengecekan 2026-11-07, skill yang ditaruh di sana tidak muncul di daftar skill-nya, sedangkan skill di `~/.gemini/config/skills` muncul.

## Cara pakai

Setelah skill terpasang, minta ke agen kamu, misalnya: "ubah semua file di folder ini ke EPUB" atau "convert the folder ~/Books to EPUB for my Kindle". Agen yang menjalankan CLI-nya. Untuk menjalankannya sendiri:

```bash
bun skills/pubmy/scripts/pubmy.js <folder> [--force] [--rtl]
```

Di perintah ini, `skills/pubmy` adalah folder skill di dalam salinan repositori. Untuk skill yang sudah terpasang, pakai folder tempat skill itu dipasang, misalnya `~/.claude/skills/pubmy`.

- Setiap file yang didukung di `<folder>` dikonversi ke `<folder>/pubmy-epub/` dengan subfolder yang sama: `<folder>/sub/book.pdf` menjadi `<folder>/pubmy-epub/sub/book.pdf.epub`.
- File dilewati kalau EPUB-nya sudah ada dan tidak lebih lama dari file sumbernya, jadi menjalankan ulang hanya mengonversi file yang baru atau berubah.
- `--force` mengonversi ulang semua file.
- `--rtl` memakai urutan halaman kanan ke kiri untuk komik (manga) dan mengonversi ulang semua file, sama seperti `--force`.
- Untuk setiap file dicetak satu baris: `converted`, `skipped`, `unsupported`, atau `failed <CODE>`.
- CLI hanya menulis ke `<folder>/pubmy-epub/` dan ke cache OCR di `~/.cache/pubmy`. File sumber kamu tidak pernah diubah, dipindah, dihapus, atau diunggah. Selengkapnya di [Privasi](/privasi/).

| Kode keluar | Arti |
|---|---|
| 0 | Setiap file berhasil dikonversi, dilewati, atau bukan format yang didukung |
| 1 | Setidaknya satu file gagal |
| 2 | Salah pakai: folder tidak diberikan, path bukan folder, flag tidak dikenal, atau `<folder>/pubmy-epub` ada tapi bukan folder sungguhan |
