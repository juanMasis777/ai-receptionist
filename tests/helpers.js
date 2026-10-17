import fs from "node:fs";
import { KnowledgeBase } from "../server/knowledge.js";
import { Store } from "../server/store.js";
import { Tools } from "../server/tools.js";

export const business = JSON.parse(fs.readFileSync(new URL("../server/businesses/clasico-barber.json", import.meta.url)));
export const kb = new KnowledgeBase(fs.readFileSync(new URL("../server/businesses/clasico-barber.md", import.meta.url), "utf8"));
// Saturday Oct 17 2026, 2:00 PM in Miami.
export const NOW = () => new Date("2026-10-17T14:00:00-04:00");

export function makeTools(overrides = {}) {
  const store = new Store(null); // in-memory
  const notes = [];
  const tools = new Tools({ business, kb, store, now: NOW, conversationId: "c1", onNotify: (n) => notes.push(n), ...overrides });
  return { tools, store, notes };
}
