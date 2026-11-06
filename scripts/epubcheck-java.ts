// Cross-checks every fixtures/out/epub/*.epub with the Java EPUBCheck pinned in
// scripts/epubcheck-java.lock.json. Downloads the release zip into fixtures/out/epubcheck/
// when absent and verifies its sha256 on every run.
//
// Usage: bun scripts/epubcheck-java.ts [--check-only] [--epub-dir <dir>] [--work-dir <dir>] [--lock <file>]
// Exit: 0 every file has 0 fatal and 0 errors; 1 any fatal/error, sha256 mismatch, no EPUB found,
//       or (--check-only) no passing report; 3 Java is missing.
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

interface Lock {
  version: string;
  url: string;
  sha256: string;
  jar: string;
}

interface Message {
  id: string;
  severity: string;
  message: string;
  location?: string;
}

export interface FileReport {
  file: string;
  fatal: number;
  error: number;
  warning: number;
  messages: Message[];
}

export interface Report {
  epubcheck: string;
  generatedAt: string;
  pass: boolean;
  files: FileReport[];
}

interface EpubcheckJson {
  messages?: {
    ID?: string;
    severity?: string;
    message?: string;
    additionalLocations?: number;
    locations?: { path?: string; line?: number; column?: number }[];
  }[];
}

const KEPT = new Set(["FATAL", "ERROR", "WARNING"]);
const sha256 = (b: Uint8Array) => new Bun.CryptoHasher("sha256").update(b).digest("hex");

/** Counts EPUBCheck JSON messages by severity; each reported location is one occurrence. */
export function summarize(file: string, json: EpubcheckJson): FileReport {
  const r: FileReport = { file, fatal: 0, error: 0, warning: 0, messages: [] };
  for (const m of json.messages ?? []) {
    const sev = (m.severity ?? "").toUpperCase();
    if (!KEPT.has(sev)) continue;
    const n = Math.max(1, (m.locations?.length ?? 0) + (m.additionalLocations ?? 0));
    if (sev === "FATAL") r.fatal += n;
    else if (sev === "ERROR") r.error += n;
    else r.warning += n;
    const loc = m.locations?.[0];
    r.messages.push({
      id: m.ID ?? "?",
      severity: sev,
      message: m.message ?? "",
      location: loc?.path ? `${loc.path}:${loc.line ?? -1}:${loc.column ?? -1}` : undefined,
    });
  }
  return r;
}

const passes = (f: FileReport) => f.fatal === 0 && f.error === 0;

/** --check-only: true only when the report exists, lists at least one file, and every file passes. */
export function reportPasses(reportPath: string): boolean {
  if (!existsSync(reportPath)) return false;
  try {
    const r = JSON.parse(readFileSync(reportPath, "utf8")) as Report;
    return Array.isArray(r.files) && r.files.length > 0 && r.files.every(passes);
  } catch {
    return false;
  }
}

function javaVersion(): string | null {
  try {
    const p = Bun.spawnSync(["java", "-version"], { stdout: "pipe", stderr: "pipe" });
    if (p.exitCode !== 0) return null;
    return (p.stderr.toString() || p.stdout.toString()).split("\n")[0]?.trim() ?? "";
  } catch {
    return null;
  }
}

/** Returns the path of epubcheck.jar, or an error message. */
async function ensureJar(lock: Lock, workDir: string): Promise<{ jar: string } | { error: string }> {
  mkdirSync(workDir, { recursive: true });
  const zip = join(workDir, `epubcheck-${lock.version}.zip`);
  if (!existsSync(zip)) {
    const res = await fetch(lock.url);
    if (!res.ok) return { error: `download failed: HTTP ${res.status} from ${lock.url}` };
    const bytes = new Uint8Array(await res.arrayBuffer());
    const got = sha256(bytes);
    if (got !== lock.sha256) return { error: `sha256 mismatch for ${lock.url}: expected ${lock.sha256}, got ${got}` };
    await Bun.write(zip, bytes);
  } else {
    const got = sha256(new Uint8Array(readFileSync(zip)));
    if (got !== lock.sha256) return { error: `sha256 mismatch for ${zip}: expected ${lock.sha256}, got ${got}; delete it to download again` };
  }
  const jar = join(workDir, lock.jar);
  if (!existsSync(jar)) {
    let p = Bun.spawnSync(["unzip", "-q", "-o", zip, "-d", workDir], { stdout: "pipe", stderr: "pipe" });
    if (p.exitCode !== 0) p = Bun.spawnSync(["python3", "-I", "-m", "zipfile", "-e", zip, workDir], { stdout: "pipe", stderr: "pipe" });
    if (p.exitCode !== 0 || !existsSync(jar)) return { error: `could not extract ${zip}: ${p.stderr.toString().trim()}` };
  }
  return { jar };
}

function checkOne(jar: string, epub: string, name: string, jsonDir: string): FileReport {
  const out = join(jsonDir, `${name}.json`);
  const p = Bun.spawnSync(["java", "-jar", jar, epub, "--json", out], { stdout: "pipe", stderr: "pipe" });
  try {
    return summarize(name, JSON.parse(readFileSync(out, "utf8")) as EpubcheckJson);
  } catch {
    const tail = p.stderr.toString().trim().split("\n").slice(-3).join(" | ");
    return { file: name, fatal: 1, error: 0, warning: 0, messages: [{ id: "NO-REPORT", severity: "FATAL", message: `EPUBCheck exit ${p.exitCode}, no JSON report: ${tail}` }] };
  }
}

function arg(argv: string[], flag: string, fallback: string): string {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? resolve(argv[i + 1]) : fallback;
}

export async function main(argv: string[]): Promise<number> {
  const root = resolve(import.meta.dir, "..");
  const epubDir = arg(argv, "--epub-dir", join(root, "fixtures/out/epub"));
  const workDir = arg(argv, "--work-dir", join(root, "fixtures/out/epubcheck"));
  const lockPath = arg(argv, "--lock", join(import.meta.dir, "epubcheck-java.lock.json"));
  const reportPath = join(workDir, "report.json");

  if (argv.includes("--check-only")) {
    const ok = reportPasses(reportPath);
    console.log(ok ? `${reportPath}: every file passes` : `${reportPath}: missing, empty, or has failures`);
    return ok ? 0 : 1;
  }

  const lock = JSON.parse(readFileSync(lockPath, "utf8")) as Lock;
  const got = await ensureJar(lock, workDir);
  if ("error" in got) {
    console.error(got.error);
    return 1;
  }
  const java = javaVersion();
  if (java === null) {
    console.error("Java not found: `java -version` failed. Install a JRE 11+ or run this through colab-test.");
    return 3;
  }
  console.log(`EPUBCheck ${lock.version} on ${java}`);

  const epubs = existsSync(epubDir) ? readdirSync(epubDir).filter((f) => f.endsWith(".epub")).sort() : [];
  if (epubs.length === 0) {
    console.error(`no *.epub under ${epubDir}; run bun scripts/build-fixture-outputs.ts first`);
    return 1;
  }
  const jsonDir = join(workDir, "json");
  mkdirSync(jsonDir, { recursive: true });
  const files: FileReport[] = [];
  for (const name of epubs) {
    const r = checkOne(got.jar, join(epubDir, name), name, jsonDir);
    files.push(r);
    console.log(`${passes(r) ? "PASS" : "FAIL"} ${name}: fatal=${r.fatal} error=${r.error} warning=${r.warning}`);
    for (const m of r.messages) if (m.severity !== "WARNING") console.log(`  ${m.severity} ${m.id} ${m.location ?? ""} ${m.message}`);
  }
  const report: Report = { epubcheck: lock.version, generatedAt: new Date().toISOString(), pass: files.every(passes), files };
  await Bun.write(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const failed = files.filter((f) => !passes(f)).length;
  console.log(`${files.length - failed}/${files.length} files pass; report: ${reportPath}`);
  return failed > 0 ? 1 : 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
