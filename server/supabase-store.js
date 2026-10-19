import { Store } from "./store.js";

// Supabase (Postgres) persistence with the same synchronous API as Store, so the
// booking logic in tools.js does not change. Pattern per request:
//   await store.load(...)   -> read fresh rows into this.data
//   sync store methods      -> change this.data and queue writes
//   await store.flush()     -> write the queued rows to Supabase
// Tools.run() flushes after every tool, so a booking is saved before the model
// is told it is confirmed. Create one SupabaseStore per request.
//
// Talks to the PostgREST API with fetch: no extra dependency. Uses the secret
// (service role) key, so it must only ever run on the server.

const TABLES = {
  bookings: "receptionist_bookings",
  conversations: "receptionist_conversations",
  notifications: "receptionist_notifications",
};

export class SupabaseStore extends Store {
  constructor({ url, key, businessId, fetchImpl = globalThis.fetch }) {
    super(null);
    if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for SupabaseStore.");
    this.url = url.replace(/\/$/, "");
    this.key = key;
    this.businessId = businessId;
    this.fetch = fetchImpl;
    this.pending = [];
  }

  headers(extra = {}) {
    // New-style secret keys (sb_secret_...) go only in `apikey`; legacy JWT keys also as Bearer.
    const auth = this.key.startsWith("sb_") ? {} : { authorization: `Bearer ${this.key}` };
    return { apikey: this.key, "content-type": "application/json", ...auth, ...extra };
  }

  async request(method, table, { query = "", body, prefer } = {}) {
    const res = await this.fetch(`${this.url}/rest/v1/${table}${query}`, {
      method,
      headers: this.headers(prefer ? { prefer } : {}),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Supabase ${method} ${table} failed: ${res.status} ${text.slice(0, 200)}`);
    }
    return res.status === 204 ? null : res.json().catch(() => null);
  }

  scope() {
    return `business_id=eq.${encodeURIComponent(this.businessId)}`;
  }

  async loadBookings() {
    const rows = await this.request("GET", TABLES.bookings, {
      query: `?${this.scope()}&select=record&order=created_at.asc&limit=2000`,
    });
    this.data.bookings = rows.map((r) => r.record);
  }

  /** Read what this request needs: one conversation, or everything for the owner dashboard. */
  async load({ conversationId = null, all = false } = {}) {
    const jobs = [this.loadBookings()];
    if (all) {
      jobs.push(
        this.request("GET", TABLES.notifications, { query: `?${this.scope()}&select=record&order=created_at.desc&limit=200` })
          .then((rows) => { this.data.notifications = rows.map((r) => r.record); }),
        this.request("GET", TABLES.conversations, { query: `?${this.scope()}&select=record&order=updated_at.desc&limit=200` })
          .then((rows) => { this.data.conversations = Object.fromEntries(rows.map((r) => [r.record.id, r.record])); }),
      );
    } else if (conversationId) {
      jobs.push(
        this.request("GET", TABLES.conversations, {
          query: `?${this.scope()}&id=eq.${encodeURIComponent(conversationId)}&select=record&limit=1`,
        }).then((rows) => { if (rows[0]) this.data.conversations[conversationId] = rows[0].record; }),
      );
    }
    await Promise.all(jobs);
  }

  /** Re-read bookings right before checking or taking a slot, to keep the double-booking window small. */
  async refreshBookings() {
    if (this.pending.length) await this.flush();
    await this.loadBookings();
  }

  save() {} // writes are queued per record instead of rewriting a file

  addBooking(booking) {
    const record = super.addBooking(booking);
    this.pending.push(["POST", TABLES.bookings, {
      id: record.id, business_id: this.businessId, code: record.code, status: record.status,
      date: record.date, time: record.time, record, created_at: record.createdAt,
    }]);
    return record;
  }

  upsertConversation(id, patch) {
    const record = super.upsertConversation(id, patch);
    this.pending.push(["UPSERT", TABLES.conversations, {
      id, business_id: this.businessId, record, updated_at: record.updatedAt,
    }]);
    return record;
  }

  addNotification(n) {
    const record = super.addNotification(n);
    this.pending.push(["POST", TABLES.notifications, {
      id: record.id, business_id: this.businessId, record, created_at: record.createdAt,
    }]);
    return record;
  }

  async flush() {
    try {
      while (this.pending.length) {
        const [op, table, row] = this.pending[0];
        if (op === "UPSERT") {
          await this.request("POST", table, { query: "?on_conflict=business_id,id", body: row, prefer: "resolution=merge-duplicates,return=minimal" });
        } else {
          await this.request("POST", table, { body: row, prefer: "return=minimal" });
        }
        this.pending.shift();
      }
    } catch (err) {
      // Drop the rest: a booking the customer was told failed must not be saved later by a retry.
      this.pending = [];
      throw err;
    }
  }
}
