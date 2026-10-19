// Local / single-server entry point (npm run dev, npm start).
// On Vercel the same app is served by api/index.js instead.
import { app, business } from "./app.js";

const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`AI receptionist for ${business.name} on http://localhost:${port}`));
