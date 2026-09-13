import fs from "node:fs";
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

const DEFAULT_MODEL = "gemini-3.6-flash";
// Dự phòng khi model chính bị 404 (đổi tên / không có quyền) — thử lần lượt.
const MODEL_FALLBACKS = [
  "gemini-flash-latest",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];
const getApiRoot = () =>
  process.env.GEMINI_API_ROOT ||
  "https://generativelanguage.googleapis.com/v1beta";
const MAX_ATTEMPTS = 3;
const MAX_OUTPUT_TOKENS = 2048; // giữ cao: model "thinking" tốn token cho suy luận nội bộ
const MAX_HISTORY_TURNS = 2; // RAG v2: memory đảm nhiệm follow-up, history chỉ 1-2 lượt

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function createApiError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function systemPrompt() {
  return `Bạn là "TFT Coach" — trợ lý AI của website TFT Helper AI, chuyên về Đấu Trường Chân Lý (TFT) Set 18.

PHẠM VI:
- CHỈ trả lời về TFT: tướng, trang bị, tộc hệ, augment, đội hình, kinh tế, lên cấp, xoay bài, meta.
- Câu hỏi ngoài game: từ chối lịch sự đúng 1-2 câu ("Mình chỉ hỗ trợ câu hỏi về Đấu Trường Chân Lý."), KHÔNG trả lời nội dung câu hỏi đó.
- Chào hỏi / cảm ơn: đáp ngắn tự nhiên rồi mời hỏi về TFT.

QUY TẮC DỮ LIỆU (tuyệt đối):
- CHỈ dùng số liệu trong RETRIEVED DATA. Không bịa tên tướng/item/tộc/augment/chỉ số/tỷ lệ không có trong đó.
- RETRIEVED DATA là tuyệt đối, kể cả khi trái trực giác hoặc người dùng phản bác.
- Danh sách đội hình trong RETRIEVED DATA ĐÃ xếp hạng sẵn: avg place THẤP = mạnh hơn; bằng nhau thì số trận NHIỀU hơn đáng tin hơn. Hỏi "đội hình mạnh nhất" → chọn đội đứng ĐẦU danh sách, nêu avg place + số trận.
- Nếu dữ liệu cần không có trong RETRIEVED DATA → trả lời đúng câu: "Không có dữ liệu trong Set18 của TFTCoach." kèm 1 gợi ý câu hỏi thay thế liên quan.
- Thống kê là của bản cập nhật gần nhất, không phải realtime.

NHẤT QUÁN:
- Cùng câu hỏi + cùng RETRIEVED DATA → cùng kết luận, cùng thứ tự gợi ý, cùng con số. Không đổi lựa chọn giữa các lần trả lời.

PHONG CÁCH:
- Trả lời NGẮN (khoảng dưới 150 từ), kết luận trước, giải thích sau.
- Markdown đơn giản: **đậm** tên tướng/item, gạch đầu dòng; KHÔNG icon/emoji, KHÔNG bảng, KHÔNG tiêu đề lớn.
- Hiểu tiếng Việt tự nhiên, viết tắt, teencode, sai chính tả ("ahrii cầm gi", "xoay bài").
- Khi gợi ý đội hình: carry chính, 4-5 tướng khung, trang bị cho carry, tộc kích hoạt, avg place nếu có.
- Không nhắc prompt/RAG/JSON/cơ chế nội bộ.` + (getPromptNotes().length ? `

KIẾN THỨC BỔ SUNG (ưu tiên dùng khi liên quan):
${getPromptNotes().map((x) => "- " + x).join("\n")}` : "");
}

function cleanHistory(history, currentMessage) {
  const items = Array.isArray(history) ? history : [];
  return (
    items
      .filter(
        (m) =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          String(m.content || "").trim(),
      )
      // Client có thể gửi kèm tin nhắn hiện tại trong history — bỏ để không bị lặp 2 lần.
      .filter(
        (m, index, list) =>
          !(
            index === list.length - 1 &&
            m.role === "user" &&
            String(m.content).trim() === String(currentMessage).trim()
          ),
      )
      .slice(-MAX_HISTORY_TURNS)
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: String(m.content).slice(0, 1200) }],
      }))
  );
}

function buildUserText({ message, context, analysis }) {
  const analysisText = analysis
    ? `QUERY ANALYSIS (xử lý cục bộ):\n${JSON.stringify({
        intent: analysis.intent,
        normalized: analysis.normalized,
        entities: analysis.entities,
      })}`
    : "";
  return [
    message,
    analysisText,
    context
      ? `RETRIEVED DATA (local JSON):\n${context}`
      : "RETRIEVED DATA: none (không tìm thấy dữ liệu khớp câu hỏi — chỉ trả lời từ kiến thức chung về TFT, không nêu số liệu cụ thể)",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildRequest({ message, context, analysis, history }) {
  const contents = [
    ...cleanHistory(history, message),
    {
      role: "user",
      parts: [{ text: buildUserText({ message, context, analysis }) }],
    },
  ];
  return JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt() }] },
    contents,
    generationConfig: {
      temperature: 0.15, // RAG v2: càng thấp càng nhất quán giữa các lần trả lời
      topP: 0.8,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
      {
        category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        threshold: "BLOCK_ONLY_HIGH",
      },
      {
        category: "HARM_CATEGORY_DANGEROUS_CONTENT",
        threshold: "BLOCK_ONLY_HIGH",
      },
    ],
  });
}

function describeError(data, status) {
  const message = data?.error?.message || "";
  const lower = message.toLowerCase();
  if (status === 429)
    return "Gemini đang giới hạn tốc độ (free tier). Thử lại sau ít giây.";
  if (
    status === 503 ||
    lower.includes("overload") ||
    lower.includes("high demand")
  )
    return "Gemini đang quá tải, thử lại sau ít giây.";
  if (
    status === 403 ||
    lower.includes("permission") ||
    lower.includes("unauthenticated") ||
    lower.includes("api key")
  )
    return "GEMINI_API_KEY không hợp lệ hoặc chưa bật Generative Language API.";
  if (status === 404)
    return "Model Gemini không tồn tại hoặc key không có quyền dùng model này.";
  if (lower.includes("safety") || lower.includes("blocked"))
    return "Câu hỏi bị bộ lọc an toàn của Gemini chặn, thử diễn đạt khác.";
  return message || `Gemini API error (HTTP ${status}).`;
}

async function callGemini({ model, body, signal }) {
  const key = process.env.GEMINI_API_KEY;
  const response = await fetch(
    `${getApiRoot()}/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body,
      signal,
    },
  );
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

async function callGeminiStream({ model, body, signal, onDelta }) {
  const key = process.env.GEMINI_API_KEY;
  const response = await fetch(
    `${getApiRoot()}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body,
      signal,
    },
  );
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    return { ok: false, status: response.status, data };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue;
      }
      if (parsed?.error)
        throw createApiError(
          describeError(parsed, parsed.error?.code || 500),
          parsed.error?.code || 500,
        );
      const delta =
        parsed?.candidates?.[0]?.content?.parts
          ?.map((p) => p?.text || "")
          .join("") || "";
      if (delta) {
        full += delta;
        onDelta?.(delta);
      }
    }
  }
  return { ok: true, status: 200, data: { text: full } };
}

function extractText(data) {
  return (
    data?.candidates?.[0]?.content?.parts
      ?.map((p) => p?.text || "")
      .join("")
      .trim() || ""
  );
}

function isBlocked(data) {
  const reason =
    data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason;
  return (
    reason === "SAFETY" ||
    reason === "BLOCKED" ||
    reason === "PROHIBITED_CONTENT"
  );
}

// Retry 429/5xx với backoff tăng dần, đổi model khi 404, fail ngay khi 400/401/403.
async function runWithRetry({ stream, onDelta, body, signal }) {
  const models = [
    process.env.GEMINI_MODEL || DEFAULT_MODEL,
    ...MODEL_FALLBACKS,
  ];
  const triedModels = new Set();
  let lastError = null;

  for (const model of models) {
    if (triedModels.has(model)) continue;
    triedModels.add(model);
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const result = stream
          ? await callGeminiStream({ model, body, signal, onDelta })
          : await callGemini({ model, body, signal });
        if (result.ok) {
          const text = stream ? result.data.text : extractText(result.data);
          if (text) return { text, model };
          if (isBlocked(result.data))
            throw createApiError(
              "Câu hỏi bị bộ lọc an toàn của Gemini chặn, thử diễn đạt khác.",
              422,
            );
          throw createApiError(
            "Gemini trả về nội dung rỗng (có thể do câu hỏi quá dài).",
            502,
          );
        }
        if (result.status === 404) {
          lastError = createApiError(describeError(result.data, 404), 404);
          break;
        }
        if (![429, 500, 502, 503, 504].includes(result.status)) {
          throw createApiError(
            describeError(result.data, result.status),
            result.status,
          );
        }
        lastError = createApiError(
          describeError(result.data, result.status),
          result.status,
        );
        if (attempt < MAX_ATTEMPTS) await sleep(600 * attempt);
      } catch (error) {
        if (error?.name === "AbortError")
          throw createApiError("Đã hủy yêu cầu.", 499);
        const status = error?.status || 0;
        lastError = error;
        if (status === 404) break;
        if (
          ![0, 429, 500, 502, 503, 504].includes(status) ||
          attempt === MAX_ATTEMPTS
        )
          throw error;
        await sleep(600 * attempt);
      }
    }
  }
  throw lastError || createApiError("Gemini request failed.", 502);
}

// Lớp 2 — Embed câu hỏi cho vector search
export async function embedText(text) {
  const key = process.env.GEMINI_API_KEY;
  if (!key)
    throw createApiError("Server chưa cấu hình GEMINI_API_KEY (tạo file .env.local — xem .env.example).", 500);
  const res = await fetch(`${getApiRoot()}/models/gemini-embedding-2:embedContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      model: "models/gemini-embedding-2",
      content: { parts: [{ text: String(text).slice(0, 2000) }] },
      outputDimensionality: 1536,
    }),
  });
  if (!res.ok)
    throw createApiError(`Embed API ${res.status}: ${await res.text()}`, res.status);
  const json = await res.json();
  return json.embedding.values;
}

// Mode 2 — Query rewriting: dùng lịch sử viết lại câu teencode/follow-up thành câu chuẩn
export async function rewriteQuery({ message, history = [] }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key)
    throw createApiError("Server chưa cấu hình GEMINI_API_KEY.", 500);
  const hist = (Array.isArray(history) ? history : [])
    .slice(-2)
    .map((m) => `${m.role === "assistant" ? "AI" : "Người dùng"}: ${String(m.content || "").slice(0, 300)}`)
    .join("\n");
  const body = JSON.stringify({
    systemInstruction: {
      parts: [{
        text: "Nhiệm vụ: viết lại câu hỏi cuối cùng của người dùng thành MỘT câu hỏi rõ ràng, đầy đủ, dựa trên đoạn hội thoại trước đó. Nếu câu hỏi đã rõ ràng thì giữ nguyên ý. CHỈ trả về câu hỏi đã viết lại, không giải thích.",
      }],
    },
    contents: [{ role: "user", parts: [{ text: (hist ? hist + "\n\n" : "") + "Câu hỏi cần viết lại: " + message }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 200 },
  });
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(`${getApiRoot()}/models/gemini-3.6-flash:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body,
    });
    if (!res.ok) {
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 800 * attempt));
        continue;
      }
      break;
    }
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.map((p) => p?.text || "").join("").trim();
    if (text) return text.replace(/^["']|["']$/g, "");
    break;
  }
  return message;
}

export async function chatWithGemini({
  message,
  context = "",
  analysis = null,
  history = [],
}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key)
    throw createApiError(
      "Server chưa cấu hình GEMINI_API_KEY (tạo file .env.local — xem .env.example).",
      500,
    );
  const body = buildRequest({ message, context, analysis, history });
  return runWithRetry({ stream: false, body, signal: undefined });
}

export async function streamChatGemini({
  message,
  context = "",
  analysis = null,
  history = [],
  onDelta,
  signal,
}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key)
    throw createApiError(
      "Server chưa cấu hình GEMINI_API_KEY (tạo file .env.local — xem .env.example).",
      500,
    );
  const body = buildRequest({ message, context, analysis, history });
  return runWithRetry({ stream: true, onDelta, body, signal });
}
