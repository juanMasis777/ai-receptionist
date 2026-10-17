import { localNow, isValidDate, dayKey, weekdayName, toMinutes, toHHMM, addDays } from "./time.js";

// Tools are deterministic code. The model decides WHEN to call them, but every
// fact (price, hours, free slots) and every write (bookings) goes through here,
// so the assistant cannot invent a price or double-book a chair.

export class ToolError extends Error {}

export const TOOL_SCHEMAS = [
  {
    name: "get_business_info",
    description:
      "Get the business's services (with prices and durations), opening hours, address and phone. Call this before stating any price, hour or service.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "search_knowledge",
    description:
      "Search the business FAQ (parking, payment, cancellations, walk-ins, kids, products, gift cards, services not offered). Write the query in English even if the customer writes in Spanish.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Short search query in English" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "check_availability",
    description: "List open appointment times for a service on a date (YYYY-MM-DD, business local time).",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD" },
        service_id: { type: "string" },
      },
      required: ["date", "service_id"],
      additionalProperties: false,
    },
  },
  {
    name: "book_appointment",
    description:
      "Book an appointment. Only call after the customer has explicitly confirmed the service, date, time, name and phone number.",
    input_schema: {
      type: "object",
      properties: {
        customer_name: { type: "string" },
        phone: { type: "string", description: "US phone number" },
        service_id: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD" },
        time: { type: "string", description: "HH:MM, 24-hour, one of the times from check_availability" },
        language: { type: "string", enum: ["en", "es"], description: "Language the customer is using" },
        notes: { type: "string" },
      },
      required: ["customer_name", "phone", "service_id", "date", "time", "language"],
      additionalProperties: false,
    },
  },
  {
    name: "notify_owner",
    description:
      "Send the owner a message: questions you cannot answer from the tools, complaints, callback requests, or anything that needs a human.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string", enum: ["question", "complaint", "callback", "other"] },
        summary: { type: "string", description: "One or two sentences, in English, for the owner" },
        customer_name: { type: "string" },
        phone: { type: "string" },
      },
      required: ["reason", "summary"],
      additionalProperties: false,
    },
  },
];

export class Tools {
  constructor({ business, kb, store, now = () => new Date(), conversationId = null, onNotify = () => {} }) {
    Object.assign(this, { business, kb, store, now, conversationId, onNotify });
  }

  async run(name, input) {
    const fn = {
      get_business_info: () => this.getBusinessInfo(),
      search_knowledge: () => this.searchKnowledge(input),
      check_availability: () => this.checkAvailability(input),
      book_appointment: () => this.bookAppointment(input),
      notify_owner: () => this.notifyOwner(input),
    }[name];
    if (!fn) throw new ToolError(`Unknown tool '${name}'.`);
    return fn();
  }

  service(id) {
    const s = this.business.services.find((x) => x.id === id);
    if (!s) throw new ToolError(`Unknown service_id '${id}'. Valid ids: ${this.business.services.map((x) => x.id).join(", ")}.`);
    return s;
  }

  getBusinessInfo() {
    const b = this.business;
    const today = localNow(b.timezone, this.now());
    return {
      name: b.name,
      address: b.address,
      phone: b.phone,
      today: `${today.date} (${weekdayName(today.date)})`,
      current_time: today.time,
      hours: Object.fromEntries(Object.entries(b.hours).map(([d, h]) => [d, h ? `${h[0]}-${h[1]}` : "closed"])),
      services: b.services.map((s) => ({ id: s.id, name: s.name, price_usd: s.price, minutes: s.minutes })),
    };
  }

  searchKnowledge({ query }) {
    if (!query?.trim()) throw new ToolError("query is required.");
    const results = this.kb.search(query, 3);
    if (!results.length) return { results: [], note: "No matching FAQ entry. Do not guess; offer to ask the owner." };
    return { results: results.map(({ id, title, text }) => ({ id, title, text })) };
  }

  openSlots(date, service) {
    const b = this.business;
    const hours = b.hours[dayKey(date)];
    if (!hours) return { open: false, slots: [] };
    const [open, close] = hours.map(toMinutes);
    const today = localNow(b.timezone, this.now());
    const earliest = date === today.date ? toMinutes(today.time) + 30 : -1; // 30-minute lead time
    const booked = this.store.bookingsOn(date).map((x) => {
      const start = toMinutes(x.time);
      return [start, start + x.minutes];
    });
    const slots = [];
    for (let t = open; t + service.minutes <= close; t += b.slotMinutes) {
      if (t < earliest) continue;
      const overlapping = booked.filter(([s, e]) => t < e && s < t + service.minutes).length;
      if (overlapping < b.chairs) slots.push(toHHMM(t));
    }
    return { open: true, hours: `${hours[0]}-${hours[1]}`, slots };
  }

  validateDate(date) {
    if (!isValidDate(date)) throw new ToolError(`Invalid date '${date}'. Use YYYY-MM-DD.`);
    const today = localNow(this.business.timezone, this.now()).date;
    if (date < today) throw new ToolError(`${date} is in the past. Today is ${today}.`);
    if (date > addDays(today, this.business.bookingWindowDays))
      throw new ToolError(`Bookings open only ${this.business.bookingWindowDays} days ahead.`);
  }

  checkAvailability({ date, service_id }) {
    this.validateDate(date);
    const service = this.service(service_id);
    const r = this.openSlots(date, service);
    if (!r.open) return { date, day: weekdayName(date), open: false, message: "Closed that day." };
    return {
      date, day: weekdayName(date), service: service.id, hours: r.hours,
      available: r.slots, total_available: r.slots.length, // all times: the model must see late slots too
      ...(r.slots.length === 0 && { message: "Fully booked or no times left that day." }),
    };
  }

  bookAppointment({ customer_name, phone, service_id, date, time, language, notes = "" }) {
    if (!customer_name || customer_name.trim().length < 2) throw new ToolError("customer_name is required.");
    const digits = String(phone || "").replace(/\D/g, "");
    if (!(digits.length === 10 || (digits.length === 11 && digits.startsWith("1"))))
      throw new ToolError("phone must be a valid 10-digit US number. Ask the customer to repeat it.");
    this.validateDate(date);
    if (!/^\d{2}:\d{2}$/.test(time)) throw new ToolError("time must be HH:MM (24-hour).");
    const service = this.service(service_id);
    const { open, slots } = this.openSlots(date, service);
    if (!open) throw new ToolError(`Closed on ${weekdayName(date)}.`);
    if (!slots.includes(time))
      throw new ToolError(`${time} is not available for ${service.id} on ${date}. Open times: ${slots.slice(0, 8).join(", ") || "none"}.`);

    const booking = this.store.addBooking({
      customerName: customer_name.trim(),
      phone: digits.slice(-10).replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3"),
      serviceId: service.id,
      serviceName: service.name.en,
      price: service.price,
      minutes: service.minutes,
      date, time, language, notes,
      conversationId: this.conversationId,
    });
    // The owner is always told about a booking: this does not depend on the model remembering.
    this.notify({
      type: "booking",
      summary: `New booking: ${booking.customerName}, ${service.name.en}, ${weekdayName(date)} at ${time}.`,
      customerName: booking.customerName,
      phone: booking.phone,
      bookingCode: booking.code,
    });
    return {
      confirmed: true, code: booking.code, service: service.name[language] || service.name.en,
      price_usd: service.price, date, day: weekdayName(date, language), time,
    };
  }

  notifyOwner({ reason, summary, customer_name, phone }) {
    if (!summary?.trim()) throw new ToolError("summary is required.");
    this.notify({ type: reason, summary: summary.trim(), customerName: customer_name, phone });
    return { sent: true };
  }

  notify(n) {
    const record = this.store.addNotification({ ...n, conversationId: this.conversationId });
    this.onNotify(record);
    return record;
  }
}
