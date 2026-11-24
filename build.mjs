// 產生網站頁面：把 src/stage*.html 的內容套進 src/layout.html，輸出到網站根目錄。
// 用法：node build.mjs   （改完 src/ 之後執行，再 commit、push）
// src/Code.gs 是課程 repo student-starter/sheet/Code.gs 的副本，那份改了要複製過來再 build。
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const layout = readFileSync('src/layout.html', 'utf8');

for (const file of readdirSync('src').filter((f) => /^stage\d+\.html$/.test(f))) {
  const src = readFileSync(`src/${file}`, 'utf8');
  // 每個內容檔第一行：<!-- title: 頁面標題 -->
  const match = /^<!-- title: (.+?) -->\r?\n/.exec(src);
  if (!match) throw new Error(`${file} 第一行要是 <!-- title: ... -->`);
  const title = match[1];
  // <!-- include-code: 檔名 --> 換成 src/ 裡那個檔案的內容（轉成 HTML 安全的文字）。
  const body = src.replace(/<!-- include-code: (\S+) -->/g, (_, name) => escapeHtml(readFileSync(`src/${name}`, 'utf8').trimEnd()));
  const page = layout
    .replaceAll('{{TITLE}}', title)
    .replaceAll('{{NAV_TITLE}}', title)
    .replace('{{SECTIONS}}', () => body.slice(match[0].length));
  writeFileSync(file, page);
  console.log(`built ${file}`);
}

function escapeHtml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
