import { Router } from "express";
import { HistoryStore, isGameId, ListQuery } from "./store";

/**
 * GET /history?from=<ms>&to=<ms>&limit=<n>: finished games, newest first, as
 * summaries ({ games, total }). GET /history/:id: one game with its frames.
 * Only games that are over are ever in the store, so nothing here can show a
 * game under way.
 */

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

/** A whole, non-negative number of ms, or undefined when the parameter is absent. */
function readMs(value: unknown, name: string): number | undefined | { error: string } {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || !/^\d{1,15}$/.test(value)) return { error: `${name} must be a time in milliseconds` };
  return Number(value);
}

export function parseListQuery(query: Record<string, unknown>): ListQuery | { error: string } {
  const from = readMs(query.from, "from");
  const to = readMs(query.to, "to");
  const limit = readMs(query.limit, "limit");
  for (const v of [from, to, limit]) if (typeof v === "object") return v;
  if (typeof from === "number" && typeof to === "number" && from > to) return { error: "from must not be after to" };
  const out: ListQuery = { limit: Math.min(MAX_LIMIT, Math.max(1, (limit as number | undefined) ?? DEFAULT_LIMIT)) };
  if (typeof from === "number") out.from = from;
  if (typeof to === "number") out.to = to;
  return out;
}

export function historyRoutes(store: () => HistoryStore): Router {
  const router = Router();
  router.get("/history", (req, res) => {
    const query = parseListQuery(req.query as Record<string, unknown>);
    if ("error" in query) return res.status(400).json({ error: query.error });
    res.json(store().list(query));
  });
  router.get("/history/:id", (req, res) => {
    const record = isGameId(req.params.id) ? store().get(req.params.id) : undefined;
    if (!record) return res.status(404).json({ error: "no such game" });
    res.json(record);
  });
  return router;
}
