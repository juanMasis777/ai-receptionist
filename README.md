# AI Receptionist (EN/ES)

A bilingual AI receptionist for small businesses. It chats with customers on the website in **English or Spanish**, answers questions from the business's own information, **checks real availability and books appointments**, and keeps the owner informed from a dashboard.

Built on the **Claude API with tool use**, without an agent framework. The demo business is a fictional Miami barber shop, *Clásico Barber Studio*.

![Customer chat and owner dashboard](docs/screenshot.png)

## Why it is safe to put in front of customers

The model decides *what to do*; deterministic code decides *what is true*.

| Risk | How it is handled |
|---|---|
| Inventing prices, hours or services | The system prompt forbids stating any fact that did not come from a tool. Prices and hours live in `server/businesses/*.json`. |
| Double-booking a chair | `book_appointment` re-checks availability in code (chairs, service length, closing time, 30-minute lead time) before writing. |
| Booking without consent | The assistant must read back service, day, time, name and phone and get a clear yes. This is covered by an eval. |
| Owner never finds out | Every booking triggers an owner notification in code, not by the model's choice. Optional webhook for Slack, Zapier or n8n. |
| Prompt injection ("ignore your instructions…") | Customer text is treated as untrusted. The model cannot give discounts or change prices, and there is an eval for it. |
| Runaway loops / bad tool calls | Tool errors go back to the model so it can recover. The loop stops after 8 steps and alerts the owner. |

## How it works

```
Customer message ─▶ Claude (system prompt + 5 tools) ─▶ tool calls ─▶ deterministic code
                         ▲                                              │
                         └──────────── tool results / errors ◀──────────┘
                                         │
                                         ▼
                        JSON store: bookings · conversations · notifications ─▶ Owner dashboard
```

| Tool | What it does |
|---|---|
| `get_business_info` | Services with prices and durations, hours, address, today's date |
| `search_knowledge` | BM25 search over the business FAQ (`*.md`): parking, payment, cancellations… |
| `check_availability` | Open times for a service on a date |
| `book_appointment` | Validates and writes the booking, returns a confirmation code |
| `notify_owner` | Questions it can't answer, complaints, callback requests |

| File | Purpose |
|---|---|
| `server/agent.js` | System prompt and the tool-use loop |
| `server/tools.js` | Tool schemas and implementations (all business rules) |
| `server/knowledge.js` | Retrieval over the FAQ |
| `server/llm.js` | `AnthropicLLM` + `ScriptedLLM` for offline tests |
| `server/index.js` | Express API: chat, owner endpoints, webhook, rate limit |
| `src/` | React widget for the customer and the owner dashboard |
| `evals/run.js` | End-to-end scenarios against the real API |

## Run it

```bash
npm install
cp .env.example .env      # add your ANTHROPIC_API_KEY
npm run dev               # API on :8787, web on :5173
```

- Customer site and chat: http://localhost:5173
- Owner dashboard: http://localhost:5173/owner

Production: `npm run build && npm start` serves everything from one Node process.

### Use it for another business

Copy `server/businesses/clasico-barber.json` and `.md`, edit the services, hours and FAQ, and set `BUSINESS_ID` in `.env`. No code changes.

## Tests and evals

```bash
npm test                  # 15 offline tests, no API key needed
npm run evals             # 8 real-API scenarios (EN + ES)
npm run evals -- --trials 3
```

Offline tests cover availability math, double-booking, closing times, lead time, phone validation, FAQ retrieval, tool-error recovery and the step limit.

Eval scenarios: English booking, Spanish booking, price only from tools, Spanish FAQ, unsupported service + callback, closed day, no booking without confirmation, and prompt injection. Results are written to `evals/results/latest.md`.

## Limitations and next steps

- Web chat only. The same engine is meant to sit behind WhatsApp and a phone line (Twilio).
- JSON-file storage is for the demo; use Postgres for real multi-tenant use.
- One calendar per business (with a chair count), no per-barber schedules yet.
- No SMS reminders yet.

## License

MIT
