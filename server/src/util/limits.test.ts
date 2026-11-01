import { test } from "node:test";
import assert from "node:assert/strict";

// util/limits.ts and util/net.ts (tasks/security_fixes T5, T6): how many tables,
// sockets and reservations one address may hold, a message budget per client,
// and the address behind a proxy. Loaded at run time, so these show red on
// their own until the modules are in.
function limits(): any {
  return require("./limits");
}
function net(): any {
  return require("./net");
}

test("a counter refuses the N+1th room for an address and frees it when a room closes", () => {
  const { AddressLimits } = limits();
  const l = new AddressLimits({ rooms: 2, sockets: 10, reservations: 100 });
  assert.equal(l.reserve("1.2.3.4"), null);
  l.joined("1.2.3.4", "r1");
  assert.equal(l.reserve("1.2.3.4"), null);
  l.joined("1.2.3.4", "r2");
  assert.match(l.reserve("1.2.3.4"), /tables/, "a third table is refused, and says so");
  assert.equal(l.reserve("1.2.3.4", false), null, "joining one of the open tables is still allowed");
  assert.equal(l.reserve("5.6.7.8"), null, "another address is not affected");
  l.left("1.2.3.4", "r1"); // its only socket there
  assert.equal(l.reserve("1.2.3.4"), null, "a table left is a table freed");
  l.joined("1.2.3.4", "r3");
  l.closed("r2");
  assert.deepEqual(l.count("1.2.3.4"), { rooms: 1, sockets: 1 });
});

test("a counter refuses more sockets than an address may hold, and more reservations than its window allows", () => {
  const { AddressLimits } = limits();
  let now = 1_000_000;
  const l = new AddressLimits({ rooms: 10, sockets: 2, reservations: 3, windowMs: 1000 }, () => now);
  assert.equal(l.reserve("a"), null);
  l.joined("a", "r1");
  assert.equal(l.reserve("a", false), null);
  l.joined("a", "r1");
  assert.match(l.reserve("a", false), /connections/, "a third socket is refused");
  l.closed("r1");
  now += 1001; // the reservation window has passed
  assert.equal(l.reserve("a"), null);
  assert.equal(l.reserve("a"), null);
  assert.equal(l.reserve("a"), null);
  assert.match(l.reserve("a"), /wait/, "a fourth reservation inside one window is refused");
  now += 1001;
  assert.equal(l.reserve("a"), null);
});

test("an address list from a proxy counts by its first entry", () => {
  const { clientIp } = net();
  assert.equal(clientIp("203.0.113.9, 10.0.0.1"), "203.0.113.9");
  assert.equal(clientIp(["203.0.113.9", "10.0.0.1"]), "203.0.113.9");
  assert.equal(clientIp("::ffff:203.0.113.9"), "203.0.113.9");
  assert.equal(clientIp(" 203.0.113.9 "), "203.0.113.9");
  assert.equal(clientIp(undefined), "unknown");
  assert.equal(clientIp(""), "unknown");
});

test("a message bucket lets a burst of 40 through and drops the 41st within the same second", () => {
  const { TokenBucket } = limits();
  const now = 0;
  const b = new TokenBucket(20, 40, () => now);
  for (let i = 0; i < 40; i++) assert.equal(b.take(), true, `message ${i + 1}`);
  assert.equal(b.take(), false, "the 41st");
});

test("the bucket refills at 20 a second", () => {
  const { TokenBucket } = limits();
  let now = 0;
  const b = new TokenBucket(20, 40, () => now);
  const drain = () => {
    let n = 0;
    while (b.take()) n++;
    return n;
  };
  drain();
  now += 1000;
  assert.equal(drain(), 20);
  now += 500;
  assert.equal(drain(), 10);
  now += 60_000;
  assert.equal(drain(), 40, "never more than the burst");
});
