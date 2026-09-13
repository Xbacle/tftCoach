import { useEffect, useRef, useState } from 'react'
import { useTftData } from '../../services/dataLoader'
import { loadChat, saveChat } from '../../ai/chatStorage'
import MarkdownText from './MarkdownText'

const ICONS = { bot: '✦', user: '◉', send: '↑' }

const QUICK = [
  'gợi ý đội hình mạnh nhất',
  'tộc Fae có mốc kích hoạt nào',
  'warmog ghép từ gì',
  'đội hình exodia là gì',
]

// Mode: m1 = Nhanh (Top-K 3) · m2 = Đầy đủ (rewrite + Top-K 6)
const MODES = [
  { id: 'm1', label: 'Nhanh', desc: 'Trả lời trực tiếp · tiết kiệm' },
  { id: 'm2', label: 'Đầy đủ', desc: 'Tự viết lại câu hỏi · nhiều dữ liệu hơn' },
]

function Message({ item }) {
  const isUser = item.role === 'user'
  return <div className={`ai-message ${isUser ? 'ai-message-user' : 'ai-message-ai'}`}>
    <div className="ai-message-avatar">{isUser ? ICONS.user : ICONS.bot}</div>
    <div className="ai-message-main">
      <div className="ai-message-topline">
        <span className="ai-message-role">{isUser ? 'BẠN' : 'TFT COACH'}</span>
        {item.meta?.model && <span className="ai-message-model">{item.meta.model}</span>}
      </div>
      {isUser ? <div className="ai-message-text">{item.content}</div> : <MarkdownText text={item.content} />}
    </div>
  </div>
}

export default function AIPanel({ open, onClose }) {
  const { data, error: dataError } = useTftData()
  const [mode, setMode] = useState(() => localStorage.getItem('tft-chat-mode') || 'm1')
  const [messages, setMessages] = useState(() => loadChat())
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const bodyRef = useRef(null)
  const abortRef = useRef(null)

  useEffect(() => { saveChat(messages) }, [messages])
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])
  useEffect(() => { if (open) setTimeout(() => document.querySelector('.ai-panel input')?.focus(), 120) }, [open])

  const topK = mode === 'm2' ? 6 : 3
  const modeInfo = MODES.find((m) => m.id === mode)

  function clearChat() {
    abortRef.current?.abort()
    setMessages([])
    setError('')
  }

  async function submit(text = question) {
    const message = text.trim()
    if (!message || busy) return
    setQuestion('')
    setError('')

    const history = messages.slice(-2)
    setMessages((cur) => [...cur, { role: 'user', content: message }])
    setBusy(true)

    try {
      // LỚP 2 — Mode 2: query rewriting (viết lại câu teencode/follow-up thành câu chuẩn)
      let searchQuery = message
      if (mode === 'm2') {
        const res = await fetch('/api/rewrite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, history }),
        })
        if (res.ok) { const j = await res.json(); searchQuery = j.question || message }
      }

      // LỚP 2 — tìm kiếm ngữ nghĩa Top-K (server-side: embed + cosine)
      const searchRes = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: searchQuery, topK }),
      })
      if (!searchRes.ok) {
        const j = await searchRes.json().catch(() => ({}))
        throw new Error(j.error || `Tìm kiếm lỗi (${searchRes.status})`)
      }
      const { chunks: hits } = await searchRes.json()
      const context = hits.map((h) => h.text).join('\n---\n')

      // LỐP 3 — Gemini trình bày
      const controller = new AbortController()
      abortRef.current = controller
      setMessages((cur) => [...cur, { role: 'assistant', content: '', meta: { model: 'gemini-3.6-flash', streaming: true } }])

      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, context, history }),
        signal: controller.signal,
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `Lỗi ${res.status}`) }

      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      let full = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          let evt = null
          try { evt = JSON.parse(line.slice(5).trim()) } catch { evt = null }
          if (!evt) continue
          if (evt.delta) {
            full += evt.delta
            setMessages((cur) => cur.map((m, i) => (i === cur.length - 1 ? { ...m, content: full } : m)))
          }
          if (evt.error) throw new Error(evt.error)
        }
      }
      if (!full.trim()) throw new Error('Không nhận được câu trả lời.')
    } catch (err) {
      const msg = err?.name === 'AbortError' ? 'Đã dừng.' : (err?.message || 'Lỗi không xác định')
      setError(msg)
      setMessages((cur) => cur.filter((m, i) => !(i === cur.length - 1 && m.role === 'assistant' && !m.content)))
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
          <div className="ai-brand-subtitle">{modeInfo.label} · {mode === 'm2' ? 'Top 6' : 'Top 3'} · RAG Set 18</div>
        </div>
      </div>
      <div className="ai-head-actions">
        <button onClick={clearChat} aria-label="Chat mới" title="Chat mới">＋</button>
        <button onClick={onClose} aria-label="Đóng" title="Đóng">×</button>
      </div>
    </header>

    <div className="ai-mode-row" role="tablist" aria-label="Chế độ chat">
      {MODES.map((m) => <button key={m.id}
        className={'ai-mode-btn' + (mode === m.id ? ' active' : '')}
        onClick={() => { setMode(m.id); localStorage.setItem('tft-chat-mode', m.id) }}
        title={m.desc}>
        {m.label}
      </button>)}
    </div>

    <div className="ai-body" ref={bodyRef}>
      {messages.length === 0 && <div className="ai-welcome">
        <div className="ai-welcome-orb">{ICONS.bot}</div>
        <div className="ai-welcome-kicker">SET 18 · RAG</div>
        <h2>TFT Coach AI</h2>
        <p>Hỏi về tướng, đội hình, trang bị, tộc/hệ, augments — trả lời dựa trên dữ liệu thống kê Set 18.</p>
        <div className="ai-quick-grid">
          {QUICK.map((q) => <button key={q} onClick={() => submit(q)}>{q}</button>)}
        </div>
      </div>}
      {messages.map((m, i) => <Message key={i} item={m} />)}
      {error && <div className="ai-error">{error}</div>}
      {dataError && <div className="ai-error">Dữ liệu chưa tải: {dataError}</div>}
    </div>

    <footer className="ai-composer">
      <form className="ai-form" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <div className="ai-input-wrap">
          <input value={question} onChange={(e) => setQuestion(e.target.value)}
            maxLength={500} placeholder="Hỏi TFT Coach… (vd: ahri cầm gì?)"
            aria-label="Tin nhắn tới TFT Coach" />
        </div>
        <button className="ai-send" disabled={busy || !question.trim()} aria-label="Gửi">{ICONS.send}</button>
      </form>
    </footer>
  </aside>
}
