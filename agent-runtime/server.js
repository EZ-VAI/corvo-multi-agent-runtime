// agent-runtime/server.js
//
// Standalone PM2 process for the Corvo agent runtime (v0: brand & product
// understanding agent + creative room). Separate from corvo-assembler (port 3099). No keys here
// beyond the shared secret — all DB/AI access goes through vps-proxy.

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { registerUnderstanding } = require("./understanding/routes");
const { registerFilms } = require("./room/bb_routes");
const { registerStudio } = require("./room/studioRoutes");
const { registerAgent } = require("./room/agentRoutes");

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));

const PORT = process.env.AGENT_PORT || 3100;
const SECRET = process.env.VPS_SHARED_SECRET || "";

// Auth for inbound calls to THIS runtime (frontend → agent). Reuses the shared
// secret. (Calls FROM the agent → proxy use the same secret in proxy.js.)
function auth(req, res, next) {
  if (!SECRET) return res.status(503).json({ error: "VPS_SHARED_SECRET not configured" });
  const h = req.headers.authorization || "";
  const x = req.headers["x-vps-secret"] || "";
  if (h === `Bearer ${SECRET}` || x === SECRET) return next();
  return res.status(401).json({ error: "unauthorized" });
}

app.get("/health", (_, res) => res.json({ status: "ok", runtime: "agent" }));

registerUnderstanding(app, auth);
// The pre-blackboard /room/deliberate session chain is retired. Keeping it
// registered meant two creative architectures could spend independently and
// produce incompatible state. Return an explicit migration signal instead of
// silently running the legacy path; FilmRoom uses /films + film-control.
app.all("/room/deliberate", auth, function (_req, res) {
  res.status(410).json({ error: "legacy_room_retired", use: "film-control + /films/:filmId" });
});
registerFilms(app, auth);
registerStudio(app, auth);
registerAgent(app, auth);

app.listen(PORT, () => console.log(`[agent-runtime] understanding agent listening on ${PORT}`));
