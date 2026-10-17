const ownerHeaders = () => {
  try {
    const t = localStorage.getItem("ownerToken");
    return t ? { "x-owner-token": t } : {};
  } catch {
    return {};
  }
};

async function request(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  business: () => request("/api/business"),
  chat: (message, conversationId) =>
    request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, conversationId }),
    }),
  ownerSummary: () => request("/api/owner/summary", { headers: ownerHeaders() }),
  conversation: (id) => request(`/api/owner/conversations/${id}`, { headers: ownerHeaders() }),
};

export const money = (n) => `$${Number(n).toFixed(0)}`;

export function formatTime(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export function formatDate(date) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export function timeAgo(iso) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
