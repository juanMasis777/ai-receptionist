// Tiny retrieval layer: split the business knowledge file into sections and rank
// them with BM25. No vector DB needed for a few dozen FAQs, and results are
// deterministic and easy to test. Swap for embeddings when the knowledge base grows.

const STOP = new Set(
  "a an and are as at be by can do does for from have how i in is it me my of on or our the to we what when where which who will with you your".split(" "),
);

// Very light English stemming so "parking" matches "park" and "cards" matches "card".
function stem(t) {
  if (t.length > 5 && t.endsWith("ing")) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith("ed")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

export function tokenize(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents so "café" matches "cafe"
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map(stem);
}

export function parseSections(markdown) {
  return markdown
    .split(/^## /m)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((block, i) => {
      const [title, ...rest] = block.split("\n");
      const body = rest.join(" ").trim();
      return { id: `kb-${i + 1}`, title: title.trim(), text: body, tokens: tokenize(`${title} ${title} ${body}`) };
    });
}

export class KnowledgeBase {
  constructor(markdown) {
    this.sections = parseSections(markdown);
    const n = this.sections.length;
    this.avgLen = this.sections.reduce((a, s) => a + s.tokens.length, 0) / Math.max(n, 1);
    const df = new Map();
    for (const s of this.sections) for (const t of new Set(s.tokens)) df.set(t, (df.get(t) || 0) + 1);
    this.idf = new Map([...df].map(([t, d]) => [t, Math.log(1 + (n - d + 0.5) / (d + 0.5))]));
  }

  search(query, k = 3) {
    const q = tokenize(query);
    const k1 = 1.2;
    const b = 0.75;
    return this.sections
      .map((s) => {
        let score = 0;
        for (const term of q) {
          const tf = s.tokens.filter((t) => t === term).length;
          if (!tf) continue;
          const idf = this.idf.get(term) || 0;
          score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * s.tokens.length) / this.avgLen)));
        }
        return { id: s.id, title: s.title, text: s.text, score: Number(score.toFixed(3)) };
      })
      .filter((r) => r.score > 0)
      .sort((a, b2) => b2.score - a.score)
      .slice(0, k);
  }
}
