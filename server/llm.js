import Anthropic from "@anthropic-ai/sdk";

// Two interchangeable backends with the same interface:
//   complete({ system, messages, tools }) -> { content, stopReason, usage }
// AnthropicLLM talks to the real API; ScriptedLLM replays canned responses so
// the agent loop can be tested offline, for free, in CI.

export class AnthropicLLM {
  constructor({ apiKey = process.env.ANTHROPIC_API_KEY, model = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5" } = {}) {
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.");
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async complete({ system, messages, tools }) {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools,
      messages,
    });
    return {
      content: res.content.map((b) => JSON.parse(JSON.stringify(b))),
      stopReason: res.stop_reason,
      usage: { input: res.usage.input_tokens, output: res.usage.output_tokens },
    };
  }
}

export class ScriptedLLM {
  constructor(responses) {
    this.responses = [...responses];
    this.calls = [];
  }

  async complete(req) {
    this.calls.push(structuredClone(req));
    const next = this.responses.shift();
    if (!next) throw new Error("ScriptedLLM ran out of responses");
    const content = typeof next === "function" ? next(req) : next;
    return { content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", usage: { input: 0, output: 0 } };
  }
}

// Helpers for writing scripted responses in tests.
let n = 0;
export const text = (t) => ({ type: "text", text: t });
export const toolUse = (name, input) => ({ type: "tool_use", id: `toolu_test_${++n}`, name, input });
