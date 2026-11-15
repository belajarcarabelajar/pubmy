pubmy also comes as an agent skill and a command line tool. It is the same converter as the website. Give your coding agent (Claude Code, Codex, Cursor, OpenCode, Antigravity) a folder, and it converts every supported file in it, keeping the folder layout. The supported files are listed on [Formats](/en/formats/). If you only want to convert a few files, the [converter](/) in your browser is enough.

## Requirements

- [Bun](https://bun.sh) 1.4 or newer. Check with `bun --version`.
- The skill folder is self-contained: about 25 MB, most of it the OCR engine. It needs no `bun install`.
- Pick one install method below. Installing the same skill twice makes some harnesses list it twice.

## Install with one command

For any harness, with the [skills CLI](https://github.com/vercel-labs/skills). It needs [Node.js](https://nodejs.org) 22.20 or newer.

```bash
npx skills add belajarcarabelajar/pubmy --skill pubmy -g
```

It asks which harnesses to install for. To skip the question, name them with `-a`, for example `-a claude-code -a codex`. With `-g`, `claude-code` installs to `~/.claude/skills/pubmy`, and `codex`, `cursor`, `opencode` and `antigravity` install to `~/.agents/skills/pubmy`. Antigravity does not read that folder, so for Antigravity use the ZIP below instead.

## Claude Code plugin

Needs Claude Code 2.1.275 or newer. Inside a session:

```text
/plugin install pubmy --marketplace belajarcarabelajar/pubmy
```

Or from a shell:

```bash
claude plugin marketplace add belajarcarabelajar/pubmy
claude plugin install pubmy@pubmy
```

As a plugin the skill is named `pubmy:pubmy`. Update it with `claude plugin update pubmy@pubmy`.

## Download the ZIP

No Git or Node.js needed. Download [pubmy-skill.zip](https://github.com/belajarcarabelajar/pubmy/releases/latest/download/pubmy-skill.zip) from the latest release and unzip it into your harness's skills folder (see the table in the next section). The ZIP holds one folder, `pubmy`. The commands below use the Claude Code folder; for another harness, swap in its folder.

Linux or macOS:

```bash
curl -fsSLo /tmp/pubmy-skill.zip https://github.com/belajarcarabelajar/pubmy/releases/latest/download/pubmy-skill.zip
mkdir -p ~/.claude/skills && unzip -oq /tmp/pubmy-skill.zip -d ~/.claude/skills
```

Windows (PowerShell):

```powershell
Invoke-WebRequest https://github.com/belajarcarabelajar/pubmy/releases/latest/download/pubmy-skill.zip -OutFile "$env:TEMP\pubmy-skill.zip"
New-Item -ItemType Directory -Force "$HOME\.claude\skills" | Out-Null; Expand-Archive -Force "$env:TEMP\pubmy-skill.zip" "$HOME\.claude\skills"
```

## Skills folder per harness

| Harness | Skills folder |
|---|---|
| Claude Code | `~/.claude/skills` |
| Codex | `~/.agents/skills` |
| Cursor | `~/.agents/skills` |
| OpenCode | `~/.agents/skills` |
| Antigravity | `~/.gemini/config/skills` |

The Antigravity CLI (`agy`) does not read `~/.agents/skills`. In a check on 2026-11-07, a skill placed there was missing from its skill list, while one in `~/.gemini/config/skills` was listed.

## Usage

Once the skill is installed, ask your agent, for example: "convert the folder ~/Books to EPUB for my Kindle" or "ubah semua file di folder ini ke EPUB". The agent runs the CLI for you. To run it yourself:

```bash
bun skills/pubmy/scripts/pubmy.js <folder> [--force] [--rtl]
```

In this command, `skills/pubmy` is the skill folder inside a copy of the repository. For an installed skill, use the folder it was installed to, for example `~/.claude/skills/pubmy`.

- Every supported file under `<folder>` is converted into `<folder>/pubmy-epub/`, mirroring the subfolders: `<folder>/sub/book.pdf` becomes `<folder>/pubmy-epub/sub/book.pdf.epub`.
- A file is skipped when its EPUB already exists and is not older than the source, so a rerun only converts new or changed files.
- `--force` reconverts every file.
- `--rtl` uses right-to-left page order for comics (manga) and reconverts every file, as `--force` does.
- It prints one row per file: `converted`, `skipped`, `unsupported`, or `failed <CODE>`.
- It writes only to `<folder>/pubmy-epub/` and to the OCR cache in `~/.cache/pubmy`. It never changes, moves, deletes or uploads your source files. More on [Privacy](/en/privacy/).

| Exit code | Meaning |
|---|---|
| 0 | Every file was converted, skipped, or is not a supported format |
| 1 | At least one file failed |
| 2 | Usage error: no folder given, the path is not a folder, an unknown flag, or `<folder>/pubmy-epub` exists but is not a real folder |
