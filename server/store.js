import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Minimal JSON-file persistence. One file per business keeps the demo
// dependency-free; replace with Postgres/Supabase for multi-tenant production.
export class Store {
  constructor(file = null) {
    this.file = file;
    this.data = { bookings: [], conversations: {}, notifications: [] };
    if (file && fs.existsSync(file)) this.data = { ...this.data, ...JSON.parse(fs.readFileSync(file, "utf8")) };
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file); // atomic replace, no half-written files
  }

  // ---- bookings
  bookingsOn(date) {
    return this.data.bookings.filter((b) => b.date === date && b.status === "confirmed");
  }

  addBooking(booking) {
    const record = {
      id: crypto.randomUUID(),
      code: `CB-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
      status: "confirmed",
      createdAt: new Date().toISOString(),
      ...booking,
    };
    this.data.bookings.push(record);
    this.save();
    return record;
  }

  // ---- conversations
  getConversation(id) {
    return this.data.conversations[id];
  }

  upsertConversation(id, patch) {
    const now = new Date().toISOString();
    const current = this.data.conversations[id] || { id, createdAt: now, messages: [], transcript: [], language: null };
    this.data.conversations[id] = { ...current, ...patch, updatedAt: now };
    this.save();
    return this.data.conversations[id];
  }

  // ---- owner notifications
  addNotification(n) {
    const record = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), read: false, ...n };
    this.data.notifications.unshift(record);
    this.save();
    return record;
  }
}
