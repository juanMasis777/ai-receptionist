import { useEffect, useState } from "react";
import { api, formatDate, formatTime, money, timeAgo } from "../api.js";

const TYPE_LABEL = { booking: "Booking", question: "Question", complaint: "Complaint", callback: "Callback", other: "Review" };

export default function OwnerDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);

  async function refresh() {
    try {
      setData(await api.ownerSummary());
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, []);

  async function openConversation(id) {
    try {
      setSelected(await api.conversation(id));
    } catch (e) {
      setError(e.message);
    }
  }

  const bookings = data?.bookings || [];
  const conversations = data?.conversations || [];
  const notifications = data?.notifications || [];
  const spanish = conversations.filter((c) => c.language === "es").length;
  const revenue = bookings.reduce((a, b) => a + b.price, 0);
  const converted = conversations.filter((c) => c.bookingCode).length;

  return (
    <div className="owner">
      <aside className="side">
        <div className="side-logo">C</div>
        <strong>{data?.business.name || "Clásico Barber Studio"}</strong>
        <small>Owner dashboard</small>
        <nav>
          <a className="active">Overview</a>
          <a href="/">Customer chat ↗</a>
        </nav>
        <div className="side-note"><i className="dot" /> Receptionist online 24/7<br />English · Español</div>
      </aside>

      <main className="owner-main">
        <header className="owner-head">
          <div>
            <p className="eyebrow">AI receptionist</p>
            <h1>What happened while you were cutting hair</h1>
          </div>
          <button className="btn" onClick={refresh}>Refresh</button>
        </header>
        {error && <p className="error">{error}</p>}

        <div className="stats">
          <Stat label="Upcoming bookings" value={bookings.length} sub={`${money(revenue)} booked`} />
          <Stat label="Conversations" value={conversations.length} sub={`${converted} turned into bookings`} />
          <Stat label="In Spanish" value={conversations.length ? `${Math.round((spanish / conversations.length) * 100)}%` : "–"} sub={`${spanish} of ${conversations.length} chats`} />
          <Stat label="Needs you" value={notifications.filter((n) => n.type !== "booking").length} sub="questions & callbacks" accent />
        </div>

        <div className="owner-grid">
          <section className="card">
            <h2>Upcoming bookings</h2>
            {bookings.length === 0 ? <Empty text="No bookings yet. Try the customer chat." /> : (
              <table>
                <thead><tr><th>When</th><th>Customer</th><th>Service</th><th>Lang</th><th>Code</th></tr></thead>
                <tbody>
                  {bookings.map((b) => (
                    <tr key={b.id} onClick={() => b.conversationId && openConversation(b.conversationId)}>
                      <td><strong>{formatDate(b.date)}</strong><small>{formatTime(b.time)}</small></td>
                      <td><strong>{b.customerName}</strong><small>{b.phone}</small></td>
                      <td>{b.serviceName}<small>{money(b.price)} · {b.minutes} min</small></td>
                      <td><span className={`lang ${b.language}`}>{b.language.toUpperCase()}</span></td>
                      <td className="mono">{b.code}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="card">
            <h2>Notifications</h2>
            {notifications.length === 0 ? <Empty text="Nothing yet." /> : (
              <ul className="feed">
                {notifications.slice(0, 8).map((n) => (
                  <li key={n.id} onClick={() => n.conversationId && openConversation(n.conversationId)}>
                    <span className={`tag ${n.type}`}>{TYPE_LABEL[n.type] || n.type}</span>
                    <p>{n.summary}</p>
                    <small>{n.customerName ? `${n.customerName} · ` : ""}{timeAgo(n.createdAt)}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="card">
          <h2>Conversations</h2>
          {conversations.length === 0 ? <Empty text="Conversations from the website chat will show up here." /> : (
            <ul className="convos">
              {conversations.map((c) => (
                <li key={c.id} onClick={() => openConversation(c.id)} className={selected?.id === c.id ? "on" : ""}>
                  <span className={`lang ${c.language}`}>{(c.language || "en").toUpperCase()}</span>
                  <p>{c.preview}</p>
                  {c.bookingCode && <span className="tag booking">Booked</span>}
                  <small>{c.turns} msgs · {timeAgo(c.updatedAt)}</small>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      {selected && (
        <aside className="drawer">
          <header><strong>Conversation</strong><button className="ghost" onClick={() => setSelected(null)}>✕</button></header>
          <div className="transcript">
            {selected.transcript.map((t, i) => (
              <div key={i} className={`bubble ${t.role}`}>
                {t.text.replace(/\*\*/g, "")}
                {t.tools?.length > 0 && (
                  <div className="tool-row">{t.tools.map((x, j) => <code key={j} className={x.isError ? "err" : ""}>{x.tool}</code>)}</div>
                )}
              </div>
            ))}
          </div>
        </aside>
      )}
    </div>
  );
}

function Stat({ label, value, sub, accent }) {
  return (
    <div className={`stat ${accent ? "accent" : ""}`}>
      <small>{label}</small>
      <strong>{value}</strong>
      <em>{sub}</em>
    </div>
  );
}

function Empty({ text }) {
  return <p className="empty">{text}</p>;
}
