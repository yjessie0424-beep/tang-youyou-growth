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

async function listMedia(dir) {
  const absDir = path.join(babyRoot, dir);
  const entries = await fs.readdir(absDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => isImage(name) || isVideo(name))
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

  const milestoneMapping = [
    {
      filename: "1.JPG",
      title: "第一次打疫苗",
      date: "2026-03-01",
      description: "",
      kind: "image"
    },
    {
      filename: "2.MOV",
      title: "会熟练使用健身架",
      date: "2026-05-01",
      description: "",
      kind: "video",
      clipSeconds: 15
    },
    {
      filename: "3.JPG",
      title: "第一次出远门",
      date: "2026-06-06",
      description: "",
      kind: "image"
    },
    {
      filename: "4.JPG",
      title: "100天纪念",
      date: "2026-06-01",
      description: "",
      kind: "image"
    },
    {
      filename: "5.MOV",
      title: "跟妈妈的聊天",
      date: "2026-04-20",
      description: "",
      kind: "video",
      clipSeconds: 15
    },
    {
      filename: "6.MOV",
      title: "第一次逛商场",
      date: "2026-06-25",
      description: "",
      kind: "video",
      clipSeconds: 15
    }
  ];

  const milestoneDir = path.join(babyRoot, "milestone");
  const milestoneFiles = new Set(
    (await fs.readdir(milestoneDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
  );

  const milestones = milestoneMapping.map((item) => {
    if (!milestoneFiles.has(item.filename)) {
      throw new Error(
        `Missing milestone file: baby/milestone/${item.filename} (required by mapping)`
      );
    }
    return {
      ...item,
      url: `baby/milestone/${item.filename}`
    };
  });

  milestones.sort((a, b) => a.date.localeCompare(b.date));

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
