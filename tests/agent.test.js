import { test } from "node:test";
import assert from "node:assert/strict";
import { runTurn, systemPrompt, detectLanguage } from "../server/agent.js";
import { ScriptedLLM, text, toolUse } from "../server/llm.js";
import { Store } from "../server/store.js";
import { business, kb, NOW } from "./helpers.js";

const base = () => ({ business, kb, store: new Store(null), conversationId: "c1", now: NOW });

test("executes tool calls and returns the final text", async () => {
  const llm = new ScriptedLLM([
    [toolUse("check_availability", { date: "2026-10-20", service_id: "fade" })],
    [text("Tengo 10:00, 10:30 y 11:00 el martes. ¿Cuál prefieres?")],
  ]);
  const r = await runTurn({ ...base(), llm, userMessage: "Quiero un fade el martes" });
  assert.match(r.reply, /martes/);
  assert.equal(r.trace[0].tool, "check_availability");
  assert.equal(r.trace[0].output.available[0], "10:00");
  // tool_result must reference the tool_use id
  const second = llm.calls[1].messages.at(-1).content[0];
  assert.equal(second.type, "tool_result");
  assert.equal(second.tool_use_id, r.messages[1].content[0].id);
});

test("tool errors are returned to the model instead of crashing", async () => {
  const llm = new ScriptedLLM([
    [toolUse("book_appointment", { customer_name: "Ana", phone: "123", service_id: "haircut", date: "2026-10-20", time: "15:00", language: "en" })],
    [text("Could you repeat your phone number?")],
  ]);
  const r = await runTurn({ ...base(), llm, userMessage: "Book me" });
  assert.equal(r.trace[0].isError, true);
  const result = llm.calls[1].messages.at(-1).content[0];
  assert.equal(result.is_error, true);
  assert.match(result.content, /10-digit/);
  assert.match(r.reply, /phone/);
});

test("a full booking flow writes exactly one booking and one owner notification", async () => {
  const ctx = base();
  const llm = new ScriptedLLM([
    [toolUse("book_appointment", { customer_name: "Luis Gómez", phone: "(786) 555-0123", service_id: "combo", date: "2026-10-22", time: "17:00", language: "es" })],
    [text("¡Listo, Luis! Tu cita quedó confirmada.")],
  ]);
  await runTurn({ ...ctx, llm, userMessage: "Sí, confirmo" });
  assert.equal(ctx.store.data.bookings.length, 1);
  assert.equal(ctx.store.data.notifications.length, 1);
  assert.equal(ctx.store.data.bookings[0].language, "es");
});

test("stops after the step limit and alerts the owner", async () => {
  const ctx = base();
  const loop = Array.from({ length: 8 }, () => [toolUse("get_business_info", {})]);
  const r = await runTurn({ ...ctx, llm: new ScriptedLLM(loop), userMessage: "hi" });
  assert.equal(r.steps, 8);
  assert.equal(ctx.store.data.notifications[0].type, "other");
  assert.match(r.reply, /owner|dueño/);
});

test("system prompt carries today's date and the anti-injection rule", () => {
  const p = systemPrompt(business, NOW());
  assert.match(p, /2026-10-17/);
  assert.match(p, /untrusted/);
  assert.match(p, /Never state a price/);
});

test("language label for the dashboard", () => {
  assert.equal(detectLanguage("Hola, quiero una cita para mañana"), "es");
  assert.equal(detectLanguage("Hi, can I book a haircut tomorrow?"), "en");
});
