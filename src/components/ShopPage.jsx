import { useEffect, useState } from "react";
import { api, money, formatTime } from "../api.js";
import ChatWidget from "./ChatWidget.jsx";

const DAYS = [["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"], ["mon", "Mon"]];

export default function ShopPage() {
  const [biz, setBiz] = useState(null);
  useEffect(() => {
    api.business().then(setBiz).catch(() => {});
  }, []);

  return (
    <div className="shop">
      <div className="demo-bar">
        Demo business · AI receptionist built by <strong>MADEVHUB</strong> · <a href="/owner">Open owner dashboard →</a>
      </div>
      <nav className="shop-nav">
        <span className="logo">Clásico <em>Barber Studio</em></span>
        <span className="nav-meta">{biz?.address} · {biz?.phone}</span>
      </nav>

      <header className="shop-hero">
        <p className="eyebrow">Little Havana · Miami</p>
        <h1>Sharp cuts.<br />Booked in seconds.</h1>
        <p className="lead">Text our receptionist any time, in English or Spanish. It checks real availability and books your chair, even after hours.</p>
      </header>

      <div className="shop-grid">
        <section className="panel">
          <h2>Services</h2>
          <ul className="services">
            {biz?.services.map((s) => (
              <li key={s.id}>
                <div><strong>{s.name.en}</strong><small>{s.name.es} · {s.minutes} min</small></div>
                <span>{money(s.price)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel">
          <h2>Hours</h2>
          <ul className="hours">
            {biz && DAYS.map(([k, label]) => (
              <li key={k}><span>{label}</span><span>{biz.hours[k] ? `${formatTime(biz.hours[k][0])} – ${formatTime(biz.hours[k][1])}` : "Closed"}</span></li>
            ))}
          </ul>
        </section>
      </div>

      <ChatWidget />
    </div>
  );
}
