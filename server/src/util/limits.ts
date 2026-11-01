// What one address, and one client, may ask of the server at once
// (tasks/security_fixes T5, T6). One process on one machine: these counters in
// memory are the whole truth. GoRoom's static onAuth asks reserve() at the
// matchmaking step, onJoin/onLeave count the sockets, and every message
// handler runs within a MessageBudget.

export interface Caps {
  rooms: number; // live tables an address may be seated at
  sockets: number; // open sockets from one address
  reservations: number; // matchmake calls from one address inside a window
  windowMs: number;
}

// Generous on purpose: debug.html opens four panels, a shared office address
// may hold a few tables, and the GUI tests all come from 127.0.0.1.
export const DEFAULT_CAPS: Caps = { rooms: 16, sockets: 32, reservations: 32, windowMs: 15_000 };

export class AddressLimits {
  private readonly caps: Caps;
  private sockets = new Map<string, Map<string, number>>(); // ip -> roomId -> sockets there
  private recent = new Map<string, number[]>(); // ip -> reservation times inside the window

  constructor(caps: Partial<Caps> = {}, private readonly now: () => number = Date.now) {
    this.caps = { ...DEFAULT_CAPS, ...caps };
  }

  /**
   * A matchmake call from `ip`: why it is refused, or null, in which case it is
   * counted as a reservation. `opens` says the call may open a new table
   * (create, joinOrCreate); a join into an existing one is held to the sockets
   * cap only.
   */
  reserve(ip: string, opens = true): string | null {
    const t = this.now();
    const times = (this.recent.get(ip) ?? []).filter((at) => t - at < this.caps.windowMs);
    this.recent.set(ip, times);
    if (times.length >= this.caps.reservations) return "Too many tables asked for from your connection at once: wait a moment.";
    const { rooms, sockets } = this.count(ip);
    if (sockets >= this.caps.sockets) return `Too many connections from your address (${this.caps.sockets} at most).`;
    if (opens && rooms >= this.caps.rooms) return `You have ${rooms} tables open already: leave one before starting another.`;
    times.push(t);
    return null;
  }

  joined(ip: string, roomId: string) {
    const rooms = this.sockets.get(ip) ?? new Map<string, number>();
    rooms.set(roomId, (rooms.get(roomId) ?? 0) + 1);
    this.sockets.set(ip, rooms);
  }

  left(ip: string, roomId: string) {
    const rooms = this.sockets.get(ip);
    if (!rooms) return;
    const n = (rooms.get(roomId) ?? 0) - 1;
    if (n > 0) rooms.set(roomId, n);
    else rooms.delete(roomId);
    if (rooms.size === 0) this.sockets.delete(ip);
  }

  /** The room is gone: whatever sockets were still counted in it are released. */
  closed(roomId: string) {
    for (const [ip, rooms] of this.sockets) {
      rooms.delete(roomId);
      if (rooms.size === 0) this.sockets.delete(ip);
    }
  }

  count(ip: string): { rooms: number; sockets: number } {
    const rooms = this.sockets.get(ip);
    if (!rooms) return { rooms: 0, sockets: 0 };
    let sockets = 0;
    for (const n of rooms.values()) sockets += n;
    return { rooms: rooms.size, sockets };
  }
}

/** `rate` tokens a second, `burst` at most; take() says whether one was there to take. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(private readonly rate: number, private readonly burst: number, private readonly now: () => number = Date.now) {
    this.tokens = burst;
    this.last = now();
  }

  take(): boolean {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) * this.rate) / 1000);
    this.last = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export const MESSAGES_PER_SECOND = 20;
export const MESSAGE_BURST = 40; // the Kata's nine cells, clicked and switched a few times over

/** A bucket per client (by session id), and a count of what each one had dropped. */
export class MessageBudget {
  private clients = new Map<string, { bucket: TokenBucket; dropped: number }>();

  constructor(
    private readonly rate = MESSAGES_PER_SECOND,
    private readonly burst = MESSAGE_BURST,
    private readonly now: () => number = Date.now
  ) {}

  /** Whether this message is within the client's budget; when not, it counts as dropped. */
  allow(id: string): boolean {
    let entry = this.clients.get(id);
    if (!entry) this.clients.set(id, (entry = { bucket: new TokenBucket(this.rate, this.burst, this.now), dropped: 0 }));
    if (entry.bucket.take()) return true;
    entry.dropped += 1;
    return false;
  }

  dropped(id: string): number {
    return this.clients.get(id)?.dropped ?? 0;
  }

  forget(id: string) {
    this.clients.delete(id);
  }

  /** Every client's drops together, for the room's log at dispose. */
  totalDropped(): number {
    let n = 0;
    for (const entry of this.clients.values()) n += entry.dropped;
    return n;
  }
}

let shared: AddressLimits | undefined;

/**
 * The server's own limits: GOCALYPSE_MAX_ROOMS_PER_IP, GOCALYPSE_MAX_SOCKETS_PER_IP
 * and GOCALYPSE_MAX_RESERVATIONS_PER_IP (inside 15 s), else DEFAULT_CAPS.
 */
export function addressLimits(): AddressLimits {
  if (!shared) {
    const env = (name: string, fallback: number) => {
      const n = Number(process.env[name]);
      return Number.isInteger(n) && n > 0 ? n : fallback;
    };
    shared = new AddressLimits({
      rooms: env("GOCALYPSE_MAX_ROOMS_PER_IP", DEFAULT_CAPS.rooms),
      sockets: env("GOCALYPSE_MAX_SOCKETS_PER_IP", DEFAULT_CAPS.sockets),
      reservations: env("GOCALYPSE_MAX_RESERVATIONS_PER_IP", DEFAULT_CAPS.reservations),
    });
  }
  return shared;
}
