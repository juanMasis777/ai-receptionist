# AI Receptionist (EN/ES)

A bilingual AI receptionist for small businesses. It chats with customers on the website in **English or Spanish**, answers questions from the business's own information, **checks real availability and books appointments**, and keeps the owner informed from a dashboard.

Built on the **Claude API with tool use**, without an agent framework. The demo business is a fictional Miami barber shop, *Clásico Barber Studio*.

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

### Deploy to Vercel

The Express app lives in `server/app.js`. `server/index.js` starts it locally; on Vercel, `api/index.js` exposes the same app as a serverless function and `vercel.json` routes every `/api/*` request to it.

1. Create the tables: run `supabase/migrations/20261019000000_receptionist_tables.sql` in the Supabase SQL editor.
2. Import the repo in Vercel (framework preset: Vite).
3. Add under Settings → Environment Variables: `ANTHROPIC_API_KEY`, `OWNER_TOKEN`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (the secret key, never exposed to the browser).
4. Deploy.

Storage: with the two Supabase variables set, bookings, conversations and owner notifications live in Postgres. Without them the app uses a JSON file in `./data` (local dev); on Vercel that file sits in `/tmp` and is lost.

Each request loads fresh rows, and every tool call writes before the model sees its result, so a booking is saved before the customer is told it is confirmed. Availability is re-read right before booking; a true race between two simultaneous requests for the last chair is still possible (a database constraint would close it).

### Use it for another business

Copy `server/businesses/clasico-barber.json` and `.md`, edit the services, hours and FAQ, and set `BUSINESS_ID` in `.env`. No code changes.

## Tests and evals

```bash
npm test                  # 21 offline tests, no API key needed
npm run evals             # 8 real-API scenarios (EN + ES)
npm run evals -- --trials 3
```

Offline tests cover availability math, double-booking, closing times, lead time, phone validation, FAQ retrieval, tool-error recovery and the step limit.

Eval scenarios: English booking, Spanish booking, price only from tools, Spanish FAQ, unsupported service + callback, closed day, no booking without confirmation, and prompt injection. Results are written to `evals/results/latest.md`.

## Limitations and next steps

- Web chat only. The same engine is meant to sit behind WhatsApp and a phone line (Twilio).
- Supabase storage is scoped by `business_id`, but there is no per-business login yet: one deployment serves one business.
- One calendar per business (with a chair count), no per-barber schedules yet.
- No SMS reminders yet.

## License

MIT
