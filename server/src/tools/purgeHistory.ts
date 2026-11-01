// Clears the test noise from the saved games (README, "Test noise is not kept"):
// games from a debug table, and games nobody human played.
//
//   DATA_DIR=/data node build/tools/purgeHistory.js [--dry-run] [--any-bot]
//
// --dry-run lists what would go and why, and removes nothing. --any-bot also
// drops the games where only some seats were bots. Run where the data lives
// (fly ssh console on the machine). A server that is running keeps the games
// in its list until it restarts; the files are gone at once.
import { historyStore } from "../history/store";

const args = new Set(process.argv.slice(2));
for (const a of args) {
  if (a !== "--dry-run" && a !== "--any-bot") {
    console.error("usage: node build/tools/purgeHistory.js [--dry-run] [--any-bot]");
    process.exit(2);
  }
}
const dryRun = args.has("--dry-run");
const gone = historyStore().purge({ dryRun, anyBot: args.has("--any-bot") });
for (const g of gone) console.log(`${dryRun ? "would forget" : "forgot"} ${g.id} (${g.reason === "debug" ? "a debug table" : "nobody human played"})`);
console.log(`${gone.length} game(s) ${dryRun ? "would go" : "gone"}`);
