// Forgets a saved game, names and all (README, "Removing a game"):
//
//   DATA_DIR=/data node build/tools/forgetGame.js <game id>
//
// Run where the data lives (fly ssh console on the machine). A server that is
// running keeps the game in its list until it restarts; the file is gone at once.
import { historyStore } from "../history/store";

const id = process.argv[2];
if (!id) {
  console.error("usage: node build/tools/forgetGame.js <game id>");
  process.exit(2);
}
if (historyStore().delete(id)) {
  console.log(`Forgot game ${id}`);
} else {
  console.error(`No saved game ${id}`);
  process.exit(1);
}
