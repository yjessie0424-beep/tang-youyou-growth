import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const babyRoot = path.join(projectRoot, "baby");

function execFileAsync(file, args, options) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options ?? {}, (error, stdout, stderr) => {
      if (error) {
        reject(
          new Error(
            `Command failed: ${file} ${args.join(" ")}\n${stderr || error.message}`
          )
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function isImage(filename) {
  return /\.(png|jpe?g|webp|gif)$/i.test(filename);
}

function isVideo(filename) {
  return /\.(mp4|mov|webm)$/i.test(filename);
}

function isCsv(filename) {
  return /\.csv$/i.test(filename);
}

function numericPrefix(filename) {
  const match = filename.match(/^(\d+)/);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

function formatDateFromYmd(ymd) {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

function parseLetterFilename(filename) {
  const base = filename.replace(/\.docx$/i, "");
  const match = base.match(/^[（(]\s*(\d{8})\s*[）)]\s*(.+)$/);
  if (!match) {
    return { dateYmd: null, title: base.trim() };
  }
  return { dateYmd: match[1], title: match[2].trim() };
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function docxToTextMac(filepath) {
  const { stdout } = await execFileAsync(
    "/usr/bin/textutil",
    ["-convert", "txt", "-stdout", filepath],
    { maxBuffer: 50 * 1024 * 1024 }
  );
  return stdout;
}

function normalizeText(raw) {
  return raw
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractSummary(text, targetLength = 55) {
  const paragraphs = normalizeText(text)
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);

  let summary = "";
  for (const paragraph of paragraphs) {
    if (!paragraph) continue;
    if (summary.length) summary += " ";
    summary += paragraph;
    if (summary.length >= targetLength) break;
  }

  if (summary.length > targetLength) {
    summary = summary.slice(0, targetLength).trimEnd() + "…";
  }
  return summary;
}

function extractKeywords(text, title, limit = 4) {
  const cleaned = `${title}\n${text}`.replace(/[^\u4e00-\u9fff]/g, "");
  const stopChars = new Set([
    "的",
    "了",
    "是",
    "在",
    "我",
    "你",
    "他",
    "她",
    "们",
    "这",
    "那",
    "有",
    "不",
    "就",
    "也",
    "都",
    "还",
    "很",
    "让",
    "给",
    "把",
    "着",
    "吗",
    "啊",
    "呀",
    "哦",
    "呢"
    ,
    "个"
  ]);
  const stop = new Set([
    "我们",
    "你们",
    "他们",
    "她们",
    "自己",
    "一个",
    "这个",
    "那个",
    "但是",
    "因为",
    "所以",
    "然后",
    "今天",
    "现在",
    "时候",
    "感觉",
    "事情",
    "已经",
    "还是",
    "没有",
    "不是",
    "就是"
  ]);

  /** @type {Map<string, number>} */
  const bigramCounts = new Map();
  for (let i = 0; i < cleaned.length - 1; i++) {
    const bigram = cleaned.slice(i, i + 2);
    if (stopChars.has(bigram[0]) || stopChars.has(bigram[1])) continue;
    if (stop.has(bigram)) continue;
    bigramCounts.set(bigram, (bigramCounts.get(bigram) ?? 0) + 1);
  }

  const bigramsByScore = [...bigramCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([bigram]) => bigram);

  const keywords = [];
  if (title) keywords.push(title);
  for (const candidate of bigramsByScore) {
    if (keywords.some((k) => k.includes(candidate))) continue;
    if ((bigramCounts.get(candidate) ?? 0) < 2) continue;
    keywords.push(candidate);
    if (keywords.length >= limit) break;
  }

  if (keywords.length < Math.min(2, limit)) {
    const fallback = ["宝宝", "妈妈", "爸爸", "成长", "幸福", "微笑", "眼泪"];
    for (const item of fallback) {
      if (keywords.length >= limit) break;
      if (!cleaned.includes(item)) continue;
      if (keywords.some((k) => k.includes(item))) continue;
      keywords.push(item);
    }
  }

  return keywords.slice(0, limit);
}

function parseCsvLine(line) {
  /** @type {string[]} */
  const cells = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        const next = line[i + 1];
        if (next === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }

    cell += ch;
  }

  cells.push(cell.trim());
  return cells;
}

function requireDateYmdDash(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date format: "${date}" (expected YYYY-MM-DD)`);
  }
}

async function loadMilestones() {
  const milestoneDir = path.join(babyRoot, "milestone");
  const milestoneFiles = new Set(
    (await fs.readdir(milestoneDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
  );

  const csvPath = path.join(milestoneDir, "milestones.csv");
  let csvRaw = null;
  try {
    csvRaw = await fs.readFile(csvPath, "utf8");
  } catch {
    csvRaw = null;
  }

  if (!csvRaw) {
    throw new Error(
      "Missing milestones table: baby/milestone/milestones.csv (please create it to add milestones)"
    );
  }

  const lines = csvRaw
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith("#"));

  if (lines.length < 2) {
    throw new Error("milestones.csv must include a header row and at least one data row.");
  }

  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const idx = (name) => header.indexOf(name);
  const filenameIdx = idx("filename");
  const titleIdx = idx("title");
  const dateIdx = idx("date");
  const descIdx = idx("description");
  const clipIdx = idx("clipSeconds");

  if (filenameIdx < 0 || titleIdx < 0 || dateIdx < 0) {
    throw new Error('milestones.csv header must include: "filename,title,date"');
  }

  /** @type {Array<any>} */
  const milestones = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]);
    const filename = (row[filenameIdx] ?? "").trim();
    const title = (row[titleIdx] ?? "").trim();
    const date = (row[dateIdx] ?? "").trim();
    const description = (descIdx >= 0 ? row[descIdx] : "")?.trim?.() ?? "";
    const clipSecondsRaw = clipIdx >= 0 ? (row[clipIdx] ?? "").trim() : "";

    if (!filename || !title || !date) {
      throw new Error(`milestones.csv row ${i + 1} missing required fields (filename/title/date).`);
    }

    requireDateYmdDash(date);

    if (!milestoneFiles.has(filename)) {
      throw new Error(`Missing milestone media file: baby/milestone/${filename} (row ${i + 1}).`);
    }

    const kind = isVideo(filename) ? "video" : "image";
    const clipSeconds =
      kind === "video"
        ? Number(clipSecondsRaw || 15)
        : undefined;

    milestones.push({
      filename,
      title,
      date,
      description,
      kind,
      ...(kind === "video" ? { clipSeconds } : {}),
      url: `baby/milestone/${filename}`
    });
  }

  milestones.sort((a, b) => a.date.localeCompare(b.date));
  return milestones;
}

async function listMedia(dir) {
  const absDir = path.join(babyRoot, dir);
  const entries = await fs.readdir(absDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => (isImage(name) || isVideo(name)) && !isCsv(name))
    .sort((a, b) => numericPrefix(a) - numericPrefix(b) || a.localeCompare(b));

  return files.map((filename) => ({
    filename,
    url: `baby/${dir}/${filename}`,
    kind: isVideo(filename) ? "video" : "image"
  }));
}

async function generateLetters() {
  const absDir = path.join(babyRoot, "letter");
  const entries = await fs.readdir(absDir, { withFileTypes: true });
  const docxFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /\.docx$/i.test(name))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));

  await fs.mkdir(path.join(projectRoot, "letters"), { recursive: true });

  /** @type {Array<any>} */
  const letters = [];
  /** @type {Set<string>} */
  const usedSlugs = new Set();

  for (const filename of docxFiles) {
    const { dateYmd, title } = parseLetterFilename(filename);
    const absPath = path.join(absDir, filename);
    const rawText = await docxToTextMac(absPath);
    const text = normalizeText(rawText);
    const summary = extractSummary(text, 55);
    const keywords = extractKeywords(text, title, 4);

    const baseSlug = dateYmd ? dateYmd : "letter";
    let slug = `${baseSlug}.html`;
    let counter = 2;
    while (usedSlugs.has(slug)) {
      slug = `${baseSlug}-${counter}.html`;
      counter += 1;
    }
    usedSlugs.add(slug);

    const date = dateYmd ? formatDateFromYmd(dateYmd) : null;
    const contentHtml = text
      .split("\n\n")
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
      .join("\n");

    const pageHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta name="robots" content="noindex,nofollow" />
    <title>${escapeHtml(title)} - 唐悠悠的成长记录</title>
    <link rel="stylesheet" href="../assets/styles.css" />
  </head>
  <body class="letter-page">
    <header class="letter-topbar">
      <a class="letter-back" href="../index.html#letters" aria-label="返回主页">返回</a>
    </header>
    <main class="letter-shell">
      <article class="paper">
        <div class="paper-meta">
          <div class="paper-title">${escapeHtml(title)}</div>
          ${date ? `<div class="paper-date">${escapeHtml(date)}</div>` : ""}
        </div>
        <div class="paper-body">
          ${contentHtml}
        </div>
        <footer class="paper-footer">— 爸爸妈妈</footer>
      </article>
    </main>
  </body>
</html>
`;

    await fs.writeFile(path.join(projectRoot, "letters", slug), pageHtml, "utf8");

    letters.push({
      id: slug.replace(/\.html$/i, ""),
      title,
      date,
      keywords,
      summary,
      url: `letters/${slug}`
    });
  }

  letters.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return letters;
}

async function main() {
  const cover = await listMedia("cover");
  const months = await listMedia("month");
  const love = await listMedia("love");
  const letters = await generateLetters();
  const milestones = await loadMilestones();

  const content = {
    meta: {
      generatedAt: new Date().toISOString()
    },
    profile: {
      name: "唐悠悠",
      gender: "女宝宝",
      birthDate: "2026-02-21",
      lunarBirth: "农历 2026年 正月初五",
      zodiac: "马",
      lucky: "初五迎财神（小财神）"
    },
    hero: {
      title: "唐悠悠的成长记录",
      subtitle: "健康和快乐是最重要的事情"
    },
    cover,
    months,
    milestones,
    letters,
    love
  };

  await fs.writeFile(
    path.join(projectRoot, "content.json"),
    JSON.stringify(content, null, 2),
    "utf8"
  );

  const preview = letters.map((letter) => ({
    title: letter.title,
    date: letter.date,
    keywords: letter.keywords,
    summary: letter.summary,
    url: letter.url
  }));
  await fs.writeFile(
    path.join(projectRoot, "letter-preview.json"),
    JSON.stringify(preview, null, 2),
    "utf8"
  );

  // eslint-disable-next-line no-console
  console.log(
    `Generated content.json, letter-preview.json, and ${letters.length} letters page(s).`
  );
}

await main();
