// Vercel serverless entry point. vercel.json rewrites every /api/* request here,
// and Express routes it by the original URL (/api/chat, /api/business, ...).
import { app } from "../server/app.js";

export default app;
