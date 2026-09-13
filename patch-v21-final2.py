# -*- coding: utf-8 -*-
"""chatCore: them import + promptNotes tu glossary.json."""
p = 'server/chatCore.js'
s = open(p, encoding='utf-8').read()

old_head = 'const DEFAULT_MODEL = "gemini-3.6-flash";'
new_head = '''import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Kien thuc bo sung tu glossary.json (them dong = "train" AI; restart PM2 de nhan)
let promptNotesCache = null;
function getPromptNotes() {
  if (promptNotesCache) return promptNotesCache;
  try {
    const g = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "public", "data", "glossary.json"), "utf8"),
    );
    promptNotesCache = Array.isArray(g.promptNotes) ? g.promptNotes : [];
  } catch {
    promptNotesCache = [];
  }
  return promptNotesCache;
}

const DEFAULT_MODEL = "gemini-3.6-flash";'''
assert old_head in s, 'head anchor'
s = s.replace(old_head, new_head, 1)

old_end = '- Trả lời bằng Markdown sạch, dùng danh sách gạch đầu dòng, in đậm tên tướng/item quan trọng.`;'
new_end = '''- Trả lời bằng Markdown sạch, dùng danh sách gạch đầu dòng, in đậm tên tướng/item quan trọng.` + (getPromptNotes().length ? `

KIẾN THỨC BỔ SUNG (ưu tiên dùng khi liên quan):
${getPromptNotes().map((x) => "- " + x).join("\\n")}` : "");'''
assert old_end in s, 'end anchor'
s = s.replace(old_end, new_end, 1)
open(p, 'w', encoding='utf-8').write(s)
print('chatCore promptNotes OK')

# ---- AIPanel: loi chao tu phrases ----
p = 'src/components/ai/AIPanel.jsx'
s = open(p, encoding='utf-8').read()
old = "        content: 'Chào bạn 👋 Mình là **TFT Coach**. Cứ hỏi thẳng về tướng, item, tộc hệ, đội hình hoặc cách xoay bài nhé!',"
new = "        content: (data?.glossary?.phrases?.greeting) || 'Chào bạn 👋 Mình là **TFT Coach**. Cứ hỏi thẳng về tướng, item, tộc hệ, đội hình hoặc cách xoay bài nhé!',"
assert old in s, 'P anchor'
s = s.replace(old, new, 1)
open(p, 'w', encoding='utf-8').write(s)
print('AIPanel phrases OK')
