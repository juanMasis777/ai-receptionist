// All scheduling happens in the business's local wall-clock time, so a 3:00 PM
// slot means 3:00 PM in Miami regardless of where the server runs.

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function localNow(timezone, now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(now).map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function isValidDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

export function dayKey(date) {
  return DAY_KEYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

export function weekdayName(date, lang = "en") {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(lang === "es" ? "es-US" : "en-US", {
    weekday: "long", month: "long", day: "numeric", timeZone: "UTC",
  });
}

export const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export const toHHMM = (mins) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

export function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
