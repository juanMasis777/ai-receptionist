import { useEffect, useRef, useState } from "react";
import { api, formatTime } from "../api.js";

const STORAGE_KEY = "receptionist.conversation";
const GREETING = {
  role: "assistant",
  text: "Hi! I'm the Clásico virtual receptionist. I can book you in or answer questions. ¡También hablo español! 💈",
};
const SUGGESTIONS = ["Book a haircut for Saturday", "¿Cuánto cuesta un fade?", "Where can I park?"];

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null;
  } catch {
    return null;
  }
}

export default function ChatWidget({ defaultOpen = true }) {
  const saved = load();
  const [open, setOpen] = useState(defaultOpen);
  const [messages, setMessages] = useState(saved?.messages || [GREETING]);
  const [conversationId, setConversationId] = useState(saved?.conversationId || null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ messages, conversationId }));
    } catch {
      /* private mode: keep the chat in memory only */
    }
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, conversationId]);

  async function send(text) {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "customer", text: message }]);
    setBusy(true);
    try {
      const r = await api.chat(message, conversationId);
      setConversationId(r.conversationId);
      setMessages((m) => [...m, { role: "assistant", text: r.reply, booking: r.booking }]);
    } catch (err) {
      setMessages((m) => [...m, { role: "error", text: err.message }]);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setMessages([GREETING]);
    setConversationId(null);
  }

  if (!open)
    return (
      <button className="chat-launcher" onClick={() => setOpen(true)} aria-label="Open chat">
        <span>💬</span> Book or ask · Reserva
      </button>
    );

  return (
    <section className="chat" aria-label="Chat with the receptionist">
      <header className="chat-head">
        <div className="chat-avatar">C</div>
        <div>
          <strong>Clásico Receptionist</strong>
          <small><i className="dot" /> Online · English / Español</small>
        </div>
        <button className="ghost" onClick={reset} title="New conversation">↺</button>
        <button className="ghost" onClick={() => setOpen(false)} aria-label="Close chat">✕</button>
      </header>

      <div className="chat-list" ref={listRef}>
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.text}
            {m.booking && (
              <div className="booking-card">
                <span>✓ Confirmed · {m.booking.code}</span>
                <strong>{m.booking.service}</strong>
                <em>{m.booking.day} · {formatTime(m.booking.time)} · ${m.booking.price_usd}</em>
              </div>
            )}
          </div>
        ))}
        {busy && <div className="bubble assistant typing"><i /><i /><i /></div>}
      </div>

      {messages.length <= 1 && (
        <div className="chips">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => send(s)}>{s}</button>
          ))}
        </div>
      )}

      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type a message · Escribe un mensaje" maxLength={1000} />
        <button disabled={busy || !input.trim()} aria-label="Send">➤</button>
      </form>
      <p className="chat-foot">AI assistant · may make mistakes · bookings are confirmed by the shop</p>
    </section>
  );
}
