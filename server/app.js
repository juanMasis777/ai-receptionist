import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { KnowledgeBase } from "./knowledge.js";
import { Store } from "./store.js";
import { SupabaseStore } from "./supabase-store.js";
import { AnthropicLLM } from "./llm.js";
import { runTurn, detectLanguage } from "./agent.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BUSINESS_ID = process.env.BUSINESS_ID || "clasico-barber";
const business = JSON.parse(fs.readFileSync(path.join(root, "server/businesses", `${BUSINESS_ID}.json`), "utf8"));
const kb = new KnowledgeBase(fs.readFileSync(path.join(root, "server/businesses", `${BUSINESS_ID}.md`), "utf8"));
// Storage: Supabase when configured (needed on Vercel, where the disk is temporary),
// otherwise a JSON file in ./data for local development.
const useSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const dataDir = process.env.DATA_DIR || (process.env.VERCEL ? "/tmp/data" : path.join(root, "data"));
const fileStore = useSupabase ? null : new Store(path.join(dataDir, `${BUSINESS_ID}.json`), path.join(root, "data", `${BUSINESS_ID}.json`));
if (process.env.VERCEL && !useSupabase) console.warn("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set: bookings are kept in /tmp and will be lost.");

// One SupabaseStore per request, so concurrent requests never share half-loaded data.
function getStore() {
  if (!useSupabase) return fileStore;
  return new SupabaseStore({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, businessId: BUSINESS_ID });
}

let llm = null;
function getLLM() {
  if (!llm) llm = new AnthropicLLM(); // throws a clear error if the key is missing
  return llm;
}

async function forwardToWebhook(notification) {
  if (!process.env.OWNER_WEBHOOK_URL) return;
  try {
    await fetch(process.env.OWNER_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ business: business.name, ...notification }),
    });
  } catch (err) {
    console.error("Owner webhook failed:", err.message);
  }
}

// Keep the prompt bounded: drop old turns, always cutting at a plain user message
// so tool_use / tool_result pairs are never split.
function trimHistory(messages, max = 40) {
  if (messages.length <= max) return messages;
  let start = messages.length - max;
  while (start < messages.length && !(messages[start].role === "user" && typeof messages[start].content === "string")) start++;
  return messages.slice(start);
}

// Simple per-IP rate limit for the public chat endpoint.
const hits = new Map();
function rateLimit(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < 60_000);
  if (recent.length >= 20) return res.status(429).json({ error: "Too many messages. Please wait a minute." });
  recent.push(now);
  hits.set(key, recent);
  next();
}

function ownerAuth(req, res, next) {
  const token = process.env.OWNER_TOKEN;
  if (token && req.get("x-owner-token") !== token) return res.status(401).json({ error: "Unauthorized" });
  next();
}

export const app = express();
app.set("trust proxy", true); // real client IP behind Vercel's proxy, for the rate limit
app.use(express.json({ limit: "32kb" }));

app.get("/api/business", (_req, res) => {
  const { name, phone, address, hours, services, demo } = business;
  res.json({ name, phone, address, hours, services, demo });
});

app.post("/api/chat", rateLimit, async (req, res) => {
  const message = String(req.body?.message || "").trim();
  if (!message) return res.status(400).json({ error: "message is required" });
  if (message.length > 1000) return res.status(400).json({ error: "message is too long" });

  const conversationId = /^[a-f0-9-]{36}$/.test(req.body?.conversationId || "") ? req.body.conversationId : crypto.randomUUID();

  let client;
  try {
    client = getLLM();
  } catch (err) {
    return res.status(503).json({ error: err.message });
  }

  const store = getStore();
  try {
    await store.load({ conversationId });
    const convo = store.getConversation(conversationId);
    const result = await runTurn({
      llm: client, business, kb, store, conversationId,
      history: trimHistory(convo?.messages || []),
      userMessage: message,
      onNotify: forwardToWebhook,
    });
    const at = new Date().toISOString();
    const transcript = [
      ...(convo?.transcript || []),
      { role: "customer", text: message, at },
      { role: "assistant", text: result.reply, at, tools: result.trace.map((t) => ({ tool: t.tool, isError: t.isError })) },
    ];
    const booking = result.trace.find((t) => t.tool === "book_appointment" && !t.isError);
    store.upsertConversation(conversationId, {
      messages: result.messages,
      transcript,
      language: convo?.language || detectLanguage(message),
      ...(booking && { bookingCode: booking.output.code }),
      usage: {
        input: (convo?.usage?.input || 0) + result.usage.input,
        output: (convo?.usage?.output || 0) + result.usage.output,
      },
    });
    await store.flush();
    res.json({ conversationId, reply: result.reply, tools: result.trace.map((t) => t.tool), booking: booking?.output || null });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "The assistant is unavailable right now. Please call the shop." });
  }
});

app.get("/api/owner/summary", ownerAuth, async (_req, res) => {
  const store = getStore();
  try {
    await store.load({ all: true });
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: "Could not load data." });
  }
  const { bookings, notifications, conversations } = store.data;
  res.json({
    business: { name: business.name },
    bookings: [...bookings].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)),
    notifications,
    conversations: Object.values(conversations)
      .map((c) => ({
        id: c.id,
        language: c.language,
        updatedAt: c.updatedAt,
        turns: c.transcript.filter((t) => t.role === "customer").length,
        preview: c.transcript.at(-2)?.text || "",
        bookingCode: c.bookingCode || null,
        usage: c.usage || null,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  });
});

app.get("/api/owner/conversations/:id", ownerAuth, async (req, res) => {
  if (!/^[a-f0-9-]{36}$/.test(req.params.id)) return res.status(404).json({ error: "Not found" });
  const store = getStore();
  try {
    await store.load({ conversationId: req.params.id });
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: "Could not load data." });
  }
  const c = store.getConversation(req.params.id);
  if (!c) return res.status(404).json({ error: "Not found" });
  res.json({ id: c.id, language: c.language, transcript: c.transcript, bookingCode: c.bookingCode || null });
});

// Unknown /api routes answer JSON instead of an HTML page.
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

if (process.env.NODE_ENV === "production" && !process.env.VERCEL) {
  const dist = path.join(root, "dist");
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

export { business };
