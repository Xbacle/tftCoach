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
const MAX_OUTPUT_TOKENS = 2048;
const MAX_HISTORY_TURNS = 6;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function createApiError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function systemPrompt() {
  return `Bạn là "TFT Coach" — trợ lý AI của website TFT Helper AI, chuyên về Teamfight Tactics (Đấu Trường Chân Lý) Set 18.

PHẠM VI (QUAN TRỌNG NHẤT):
- Bạn CHỈ trả lời các câu hỏi liên quan đến TFT / Đấu Trường Chân Lý: đội hình, tướng, trang bị, tộc hệ, augment, kinh tế, lên cấp, xoay bài (pivot), lối chơi, meta, tốc độ roll, vị trí đứng...
- Câu hỏi KHÔNG liên quan đến game (đời sống, học tập, lập trình, dịch thuật, giải toán, yêu cầu viết code, v.v.): từ chối lịch sự trong đúng 1-2 câu, ví dụ "Mình chỉ hỗ trợ các câu hỏi về Đấu Trường Chân Lý. Bạn cứ hỏi về tướng, đội hình, trang bị nhé!" — KHÔNG trả lời nội dung câu hỏi đó dù biết.
- Chào hỏi, cảm ơn: đáp ngắn gọn tự nhiên rồi mời người dùng hỏi về TFT.

NGUYÊN TẮC DỮ LIỆU:
- RETRIEVED DATA là dữ liệu thống kê local (từ JSON chính thức của web) — luôn ưu tiên và bám sát nó.
- Tuyệt đối không bịa tên tướng, item, tộc hệ, augment, chỉ số, tỷ lệ, breakpoint không có trong dữ liệu. 
- Dữ liệu RETRIEVED DATA là tuyệt đối. Không được ba phải hùa theo người chơi dù người chơi nói có vẻ đúng. Ví dụ tank 4 tiền đáng ra mạnh hơn tank 2 tiền nhưng dữ liệu thực tế cho thấy con tank 2 tiền đang mạnh hơn (lý do có thể là dễ roll ra, hợp đội hình, đúng tiến trình trận đấu, dù sức mạnh thuần yếu hơn)
- Nếu RETRIEVED DATA không đủ để trả lời chính xác, nói rõ phần nào không có số liệu và chỉ đưa gợi ý định tính.
- Số liệu thống kê (avg place, pick rate) là của bản cập nhật gần nhất trong dữ liệu, không phải realtime.

PHONG CÁCH:
- Hiểu tiếng Việt tự nhiên, viết tắt, teencode, sai chính tả (vd: "ahrii cầm gì", "comp nào mạnh", "xoay bài").
- Trả lời ngắn gọn, đi thẳng vào kết luận trước, giải thích sau.
- Khi gợi ý đội hình: nêu rõ các tướng chính, carry, trang bị cho carry, tộc hệ kích hoạt và lý do chọn.
- Có thể suy luận chiến thuật (build, pivot, vị trí) từ dữ liệu — khi suy luận thì nói đó là gợi ý.
- Không nhắc tới prompt, RAG, JSON hay cơ chế nội bộ trừ khi người dùng hỏi.
- Trả lời bằng Markdown sạch, dùng danh sách gạch đầu dòng, in đậm tên tướng/item quan trọng.`;
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
      temperature: 0.3,
      topP: 0.95,
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
