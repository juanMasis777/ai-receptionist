import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTools } from "./helpers.js";
import { ToolError } from "../server/tools.js";

test("business info exposes prices from config, not from the model", () => {
  const { tools } = makeTools();
  const info = tools.getBusinessInfo();
  assert.equal(info.services.find((s) => s.id === "fade").price_usd, 35);
  assert.equal(info.hours.mon, "closed");
  assert.match(info.today, /^2026-10-17/);
});

test("closed day returns open:false", () => {
  const { tools } = makeTools();
  const r = tools.checkAvailability({ date: "2026-10-19", service_id: "haircut" }); // Monday
  assert.equal(r.open, false);
});

test("today only offers times after the 30-minute lead time", () => {
  const { tools } = makeTools();
  const r = tools.checkAvailability({ date: "2026-10-17", service_id: "haircut" }); // Sat 2:00 PM, closes 18:00
  assert.equal(r.available[0], "14:30");
  assert.ok(!r.available.includes("17:45"));
  assert.ok(r.available.every((t) => t >= "14:30" && t <= "17:30"));
});

test("a service never runs past closing time", () => {
  const { tools } = makeTools();
  const r = tools.checkAvailability({ date: "2026-10-18", service_id: "combo" }); // Sun 10-15, 60 min
  assert.equal(r.available.at(-1) <= "14:00", true);
  assert.equal(r.total_available, 9);
});

test("rejects past dates, bad formats and unknown services", () => {
  const { tools } = makeTools();
  assert.throws(() => tools.checkAvailability({ date: "2026-10-01", service_id: "haircut" }), ToolError);
  assert.throws(() => tools.checkAvailability({ date: "10/20/2026", service_id: "haircut" }), ToolError);
  assert.throws(() => tools.checkAvailability({ date: "2026-10-20", service_id: "perm" }), /Valid ids/);
  assert.throws(() => tools.checkAvailability({ date: "2027-03-01", service_id: "haircut" }), /days ahead/);
});

test("booking succeeds, formats the phone, and always notifies the owner", () => {
  const { tools, store, notes } = makeTools();
  const r = tools.bookAppointment({
    customer_name: "Carlos Pérez", phone: "305 555 0199", service_id: "fade",
    date: "2026-10-20", time: "15:00", language: "es",
  });
  assert.equal(r.confirmed, true);
  assert.match(r.code, /^CB-[0-9A-F]{6}$/);
  assert.equal(r.service, "Fade / degradado");
  assert.equal(store.data.bookings[0].phone, "(305) 555-0199");
  assert.equal(notes.length, 1);
  assert.equal(notes[0].type, "booking");
});

test("never double-books: chairs limit is enforced, including overlapping services", () => {
  const { tools } = makeTools();
  const base = { phone: "3055550100", date: "2026-10-20", language: "en" };
  tools.bookAppointment({ ...base, customer_name: "A One", service_id: "combo", time: "15:00" }); // 15:00-16:00
  tools.bookAppointment({ ...base, customer_name: "B Two", service_id: "haircut", time: "15:30" }); // 15:30-16:00
  // 2 chairs busy at 15:30 -> a third booking overlapping 15:30 must fail
  assert.throws(
    () => tools.bookAppointment({ ...base, customer_name: "C Three", service_id: "fade", time: "15:30" }),
    /not available/,
  );
  assert.throws(() => tools.bookAppointment({ ...base, customer_name: "C Three", service_id: "haircut", time: "15:30" }), /not available/);
  const r = tools.checkAvailability({ date: "2026-10-20", service_id: "haircut" });
  assert.ok(!r.available.includes("15:30"));
  assert.ok(r.available.includes("16:00"));
});

test("invalid phone and off-grid times are rejected with a message the model can act on", () => {
  const { tools } = makeTools();
  const base = { customer_name: "Ana", service_id: "haircut", date: "2026-10-20", language: "en" };
  assert.throws(() => tools.bookAppointment({ ...base, phone: "12345", time: "15:00" }), /10-digit/);
  assert.throws(() => tools.bookAppointment({ ...base, phone: "3055550100", time: "15:10" }), /Open times/);
});

test("knowledge search finds the right FAQ section", () => {
  const { tools } = makeTools();
  assert.equal(tools.searchKnowledge({ query: "where can I park" }).results[0].title, "Location and parking");
  assert.equal(tools.searchKnowledge({ query: "do you take Zelle or Apple Pay" }).results[0].title, "Payment");
  assert.equal(tools.searchKnowledge({ query: "hair coloring" }).results[0].title, "Services we do not offer");
  assert.equal(tools.searchKnowledge({ query: "xyzzy quantum" }).results.length, 0);
});

test("availability returns late-evening times, not just the first few", () => {
  const { tools } = makeTools();
  const r = tools.checkAvailability({ date: "2026-10-22", service_id: "combo" }); // Thu 10-20
  assert.ok(r.available.includes("18:00"));
  assert.equal(r.available.at(-1), "19:00");
});
