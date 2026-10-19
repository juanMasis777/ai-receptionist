import { test } from "node:test";
import assert from "node:assert/strict";
import { SupabaseStore } from "../server/supabase-store.js";
import { Tools } from "../server/tools.js";
import { business, kb, NOW } from "./helpers.js";

// A tiny in-memory stand-in for Supabase's REST API (PostgREST), enough for SupabaseStore.
function fakeSupabase({ failBookingInsert = false } = {}) {
  const tables = { receptionist_bookings: [], receptionist_conversations: [], receptionist_notifications: [] };
  const calls = [];
  const fetchImpl = async (url, { method, headers, body }) => {
    const u = new URL(url);
    const table = u.pathname.split("/").pop();
    calls.push({ method, table, query: u.search, headers });
    const json = (status, data) => ({ ok: status < 300, status, json: async () => data, text: async () => JSON.stringify(data) });
    if (method === "GET") {
      const biz = u.searchParams.get("business_id")?.replace("eq.", "");
      const id = u.searchParams.get("id")?.replace("eq.", "");
      const rows = tables[table].filter((r) => r.business_id === biz && (!id || r.id === id));
      return json(200, rows.map((r) => ({ record: r.record })));
    }
    const row = JSON.parse(body);
    if (table === "receptionist_bookings" && failBookingInsert) return json(500, { message: "db down" });
    if (u.searchParams.get("on_conflict")) {
      const i = tables[table].findIndex((r) => r.business_id === row.business_id && r.id === row.id);
      if (i >= 0) tables[table][i] = row;
      else tables[table].push(row);
    } else {
      tables[table].push(row);
    }
    return { ok: true, status: 201, json: async () => null, text: async () => "" };
  };
  return { tables, calls, fetchImpl };
}

const newStore = (db, key = "sb_secret_test") =>
  new SupabaseStore({ url: "https://x.supabase.co/", key, businessId: "clasico-barber", fetchImpl: db.fetchImpl });

const booking = {
  customer_name: "Ana Pérez", phone: "305-555-0199", service_id: "haircut",
  date: "2026-10-18", time: "11:00", language: "es",
};

test("a booking is saved to Supabase before the tool returns", async () => {
  const db = fakeSupabase();
  const tools = new Tools({ business, kb, store: newStore(db), now: NOW, conversationId: "c1" });
  const out = await tools.run("book_appointment", booking);
  assert.equal(out.confirmed, true);
  assert.equal(db.tables.receptionist_bookings.length, 1);
  assert.equal(db.tables.receptionist_bookings[0].code, out.code);
  assert.equal(db.tables.receptionist_notifications.length, 1); // owner notified, in code
});

test("a second instance sees the first booking and will not double-book the last chair", async () => {
  const db = fakeSupabase();
  // Fill every chair at 11:00 from separate requests (separate store instances).
  for (let i = 0; i < business.chairs; i++) {
    const t = new Tools({ business, kb, store: newStore(db), now: NOW, conversationId: `c${i}` });
    await t.run("book_appointment", { ...booking, customer_name: `Client ${i}` });
  }
  const late = new Tools({ business, kb, store: newStore(db), now: NOW, conversationId: "late" });
  await assert.rejects(late.run("book_appointment", booking), /not available/);
  const avail = await late.run("check_availability", { date: "2026-10-18", service_id: "haircut" });
  assert.ok(!avail.available.includes("11:00"));
});

test("if Supabase fails, the tool errors instead of confirming, and nothing is retried later", async () => {
  const db = fakeSupabase({ failBookingInsert: true });
  const store = newStore(db);
  const tools = new Tools({ business, kb, store, now: NOW, conversationId: "c1" });
  await assert.rejects(tools.run("book_appointment", booking), /Supabase POST receptionist_bookings failed/);
  assert.equal(store.pending.length, 0);
  await store.flush();
  assert.equal(db.tables.receptionist_notifications.length, 0);
});

test("conversations are upserted and loaded back by id, scoped to the business", async () => {
  const db = fakeSupabase();
  const id = "3f2b1c4d-0000-4000-8000-000000000001";
  const a = newStore(db);
  a.upsertConversation(id, { transcript: [{ role: "customer", text: "hola" }] });
  await a.flush();
  a.upsertConversation(id, { language: "es" });
  await a.flush();
  assert.equal(db.tables.receptionist_conversations.length, 1);

  const b = newStore(db);
  await b.load({ conversationId: id });
  assert.equal(b.getConversation(id).language, "es");
  assert.equal(b.getConversation(id).transcript[0].text, "hola");

  const other = new SupabaseStore({ url: "https://x.supabase.co", key: "k", businessId: "other-shop", fetchImpl: db.fetchImpl });
  await other.load({ conversationId: id });
  assert.equal(other.getConversation(id), undefined);
});

test("secret keys go only in apikey; legacy JWT keys are also sent as Bearer", async () => {
  const db = fakeSupabase();
  await newStore(db, "sb_secret_abc").load();
  assert.equal(db.calls.at(-1).headers.apikey, "sb_secret_abc");
  assert.equal(db.calls.at(-1).headers.authorization, undefined);
  await newStore(db, "eyJhbGciOi.legacy.jwt").load();
  assert.equal(db.calls.at(-1).headers.authorization, "Bearer eyJhbGciOi.legacy.jwt");
});
