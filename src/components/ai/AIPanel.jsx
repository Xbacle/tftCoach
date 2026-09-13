import { useEffect, useMemo, useRef, useState } from 'react'
import { useTftData } from '../../services/dataLoader'
import { analyzeQuery } from '../../ai/analyzer'
import { retrieveContext, buildContextText } from '../../ai/retriever'
import { askGemini, askGeminiStream } from '../../ai/geminiClient'
import { buildOfflineFallback } from '../../ai/fallback'
import { loadChat, saveChat } from '../../ai/chatStorage'
import { AI_CONFIG } from '../../ai/aiConfig'
import { updateMemory } from '../../ai/memory'
import { directAnswer } from '../../ai/retriever'
import MarkdownText from './MarkdownText'

const QUICK = [
  ['Build', 'Có Ahri thì nên đánh đội hình nào?'],
  ['Item', 'Ahri cầm trang bị gì là mạnh nhất?'],
  ['Pivot', 'Đang có carry AP thì nên xoay bài thế nào?'],
  ['Meta', 'Meta hiện tại đội hình nào mạnh nhất?'],
]

const ICONS = { bot: '✦', user: '◉', send: '↑' }

// RAG v2: cache theo câu hỏi *và thực thể đã resolve*.  "Nó mạnh không?"
// sau Ahri không được dùng lại đáp án của cùng câu sau Xayah.
const ANSWER_CACHE = new Map()
const ANSWER_CACHE_MAX = 100
function cacheKey(analysis) {
  const entityIds = ['units', 'items', 'traits', 'augments']
    .flatMap((kind) => (analysis?.entities?.[kind] || []).map((entity) => entity.apiName || entity.name))
    .sort()
  return JSON.stringify([analysis?.normalized || '', analysis?.intent || 'general', entityIds])
}
function cacheAnswer(key, value) {
  if (ANSWER_CACHE.size >= ANSWER_CACHE_MAX) ANSWER_CACHE.delete(ANSWER_CACHE.keys().next().value)
  ANSWER_CACHE.set(key, value)
}

function EntityPills({ context }) {
  if (!context?.matched) return null
  const groups = [
    ['Tướng', context.matched.units],
    ['Item', context.matched.items],
    ['Tộc hệ', context.matched.traits],
    ['Augment', context.matched.augments],
  ].filter(([, values]) => values?.length)
  if (!groups.length) return null
  return <div className="ai-context-row">
    <span className="ai-context-label">DỮ LIỆU</span>
    {groups.flatMap(([label, values]) => values.slice(0, 3).map((value) => (
      <span className="ai-context-pill" title={label} key={`${label}-${value}`}>{value}</span>
    )))}
  </div>
}

function Message({ item }) {
  const isUser = item.role === 'user'
  const isTyping = item.meta?.streaming && !item.content
  return <div className={`ai-message ${isUser ? 'ai-message-user' : 'ai-message-ai'}`}>
    <div className="ai-message-avatar">{isUser ? ICONS.user : ICONS.bot}</div>
    <div className="ai-message-main">
      <div className="ai-message-topline">
        <span className="ai-message-role">{isUser ? 'BẠN' : 'TFT COACH'}</span>
        {item.meta?.model && <span className="ai-message-model">{item.meta.model}</span>}
      </div>
      {isUser
        ? <div className="ai-message-text">{item.content}</div>
        : isTyping
          ? <div className="ai-typing"><i /><i /><i /><span>Đang phân tích dữ liệu…</span></div>
          : <MarkdownText text={item.content} />}
      {!isUser && item.meta?.context && <EntityPills context={item.meta.context} />}
    </div>
  </div>
}

function Welcome({ submit, dataReady }) {
  return <div className="ai-welcome">
    <div className="ai-welcome-orb"><span>{ICONS.bot}</span></div>
    <div className="ai-welcome-kicker">SET 18 · AI HELPER</div>
    <h2>TFT Coach AI</h2>
    <p>Hỏi theo cách tự nhiên — tôi nhận diện tướng, item, tộc hệ và đội hình, rồi trả lời dựa trên dữ liệu thống kê của web.</p>
    <div className="ai-capabilities">
      <span><i>✓</i> Dữ liệu Set 18</span>
      <span><i>✓</i> Gợi ý đội hình</span>
      <span><i>✓</i> Trả lời realtime</span>
    </div>
    {!dataReady && <div className="ai-data-note">Đang tải dữ liệu TFT local…</div>}
    <div className="ai-quick-grid">
      {QUICK.map(([label, q]) => <button key={q} onClick={() => submit(q)}>
        <span>{label}</span>
        <b>{q}</b>
      </button>)}
    </div>
  </div>
}

// Không lưu context RAG vào localStorage (nặng, dễ tràn quota).
function stripMessagesForSave(messages) {
  return messages.slice(-30).map(({ meta, ...rest }) => {
    if (!meta) return rest
    const { context, ...lightMeta } = meta
    return { ...rest, meta: lightMeta }
  })
}

export default function AIPanel({ open, onClose }) {
  const { data, error: dataError } = useTftData()
  const idRef = useRef(0)
  const [messages, setMessages] = useState(() => loadChat().map((m) => ({ ...m, id: ++idRef.current })))
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [model, setModel] = useState('Gemini')
  const bodyRef = useRef(null)
  const inputRef = useRef(null)
  const abortRef = useRef(null)
  const memoryRef = useRef({})

  useEffect(() => { saveChat(stripMessagesForSave(messages)) }, [messages])
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 120)
  }, [open])
  useEffect(() => () => abortRef.current?.abort(), [])

  const statusLabel = useMemo(() => data ? 'DỮ LIỆU SẴN SÀNG' : 'ĐANG TẢI DỮ LIỆU', [data])

  function appendDelta(id, delta) {
    setMessages((current) => current.map((m) => (m.id === id ? { ...m, content: m.content + delta } : m)))
  }

  function finalizeMessage(id, patch) {
    setMessages((current) => current.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  }

  function clearChat() {
    abortRef.current?.abort()
    memoryRef.current = {}
    setMessages([])
    setError('')
    setQuestion('')
  }

  function stop() {
    abortRef.current?.abort()
    abortRef.current = null
    setBusy(false)
    setMessages((current) => current
      .map((m) => (m.meta?.streaming ? { ...m, meta: { ...m.meta, streaming: false } } : m))
      .filter((m) => m.role !== 'assistant' || m.content))
  }

  async function submit(text = question) {
    const message = text.trim()
    if (!message || busy) return
    setQuestion('')
    setError('')

    const history = messages
    const next = [...messages, { id: ++idRef.current, role: 'user', content: message }]
    setMessages(next)
    setBusy(true)

    const analysis = data
      ? analyzeQuery(data, message, history, memoryRef.current)
      : { intent: 'general', mentionsTft: false, query: message, entities: {} }
    const answerKey = cacheKey(analysis)

    if (analysis.intent === 'greeting') {
      setMessages((current) => [...current, {
        id: ++idRef.current,
        role: 'assistant',
        content: (data?.glossary?.phrases?.greeting) || 'Chào bạn 👋 Mình là **TFT Coach**. Cứ hỏi thẳng về tướng, item, tộc hệ, đội hình hoặc cách xoay bài nhé!',
        meta: { local: true },
      }])
      setBusy(false)
      return
    }

    const contextObject = data ? retrieveContext(data, analysis) : null
    const context = buildContextText(contextObject, AI_CONFIG.maxContextChars)

    // RAG v2: ghi nhớ thực thể để xử lý câu follow-up ("nó cầm gì?", "đội đó mạnh không?")
    memoryRef.current = updateMemory(analysis, contextObject)

    // RAG v2: câu tĩnh (ghép đồ / mốc tộc / đồ khuyên dùng / mô tả augment) —
    // trả lời THẲNG từ JSON, không gọi Gemini: số liệu luôn đúng và luôn giống nhau.
    const direct = directAnswer(data, analysis, contextObject)
    if (direct) {
      cacheAnswer(answerKey, direct)
      setMessages((current) => [...current, {
        id: ++idRef.current, role: 'assistant', content: direct,
        meta: { model: 'Set18 data', context: contextObject },
      }])
      setBusy(false)
      return
    }

    // RAG v2: cùng câu hỏi đã trả lời rồi -> dùng lại đúng câu trả lời cũ (nhất quán)
    const cached = ANSWER_CACHE.get(answerKey)
    if (cached) {
      setMessages((current) => [...current, {
        id: ++idRef.current, role: 'assistant', content: cached,
        meta: { model: 'Gemini (cached)', context: contextObject },
      }])
      setBusy(false)
      return
    }

    const assistantId = ++idRef.current

    const controller = new AbortController()
    abortRef.current = controller

    try {
      setMessages((current) => [...current, {
        id: assistantId,
        role: 'assistant',
        content: '',
        meta: { context: contextObject, streaming: true },
      }])

      let received = false
      const result = await askGeminiStream({
        message,
        context,
        analysis,
        history,
        signal: controller.signal,
        onDelta: (delta) => { received = true; appendDelta(assistantId, delta) },
      }).catch(async (streamErr) => {
        // Đã stream được một phần → giữ nguyên phần đã có, báo lỗi nhẹ.
        if (received) throw streamErr
        // Stream hỏng ngay từ đầu → thử lại bằng API thường một lần.
        return askGemini({ message, context, analysis, history, signal: controller.signal })
      })

      setModel(result.model || 'Gemini')
      cacheAnswer(answerKey, result.text)
      finalizeMessage(assistantId, { content: result.text, meta: { model: result.model, context: contextObject } })
    } catch (err) {
      if (err?.name === 'AbortError' || controller.signal.aborted) {
        // Người dùng bấm dừng: giữ lại phần văn bản đã stream được.
        finalizeMessage(assistantId, { meta: { streaming: false, context: contextObject } })
        setMessages((current) => current.filter((m) => m.role !== 'assistant' || m.content))
      } else {
        const fallbackText = buildOfflineFallback(analysis, contextObject, err?.message || '')
        finalizeMessage(assistantId, { content: fallbackText, meta: { fallback: true, context: contextObject } })
        setError(err?.status === 429
          ? 'Gemini đang giới hạn quota/tốc độ, đã hiển thị gợi ý từ dữ liệu local.'
          : (err?.message || 'Gemini đang tạm thời không phản hồi.'))
      }
    } finally {
      abortRef.current = null
      setBusy(false)
    }
  }

  if (!open) return null

  return <aside className="ai-panel" aria-label="TFT AI Coach">
    <header className="ai-head">
      <div className="ai-brand">
        <div className="ai-brand-icon">{ICONS.bot}</div>
        <div>
          <div className="ai-brand-title">TFT COACH <span>AI</span></div>
          <div className="ai-brand-subtitle">{model} · Dữ liệu Set 18</div>
        </div>
      </div>
      <div className="ai-head-actions">
        <span className={`ai-status ${data ? 'online' : ''}`}><i />{statusLabel}</span>
        <button onClick={clearChat} aria-label="New chat" title="Chat mới">＋</button>
        <button onClick={onClose} aria-label="Close" title="Đóng">×</button>
      </div>
    </header>

    <div ref={bodyRef} className="ai-body">
      {messages.length === 0 && <Welcome submit={submit} dataReady={Boolean(data)} />}
      {messages.map((item) => <Message key={item.id} item={item} />)}
      {error && <div className="ai-error">{error}</div>}
      {dataError && <div className="ai-error">TFT data chưa tải: {dataError}</div>}
    </div>

    <footer className="ai-composer">
      <form className="ai-form" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <div className="ai-input-wrap">
          <input
            ref={inputRef}
            disabled={busy}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={800}
            placeholder="Hỏi TFT Coach… ví dụ: ahri cầm gì?"
            aria-label="Tin nhắn tới TFT Coach"
          />
          <span className="ai-input-hint">{question.length}/800</span>
        </div>
        {busy
          ? <button type="button" className="ai-send ai-stop" onClick={stop} aria-label="Dừng" title="Dừng trả lời">■</button>
          : <button className="ai-send" disabled={!question.trim()} aria-label="Gửi">{ICONS.send}</button>}
      </form>
      <div className="ai-composer-note">Mình chỉ trả lời các câu hỏi về TFT · Dữ liệu Set 18 mới nhất</div>
    </footer>
  </aside>
}
