// Mirage IMAP/SMTP handlers, Apache-2.0. See LICENSE.

// integ/server/kit/typescript/bind.ts
var DEFAULT_BIND_HOST = "127.0.0.1";
var DEFAULT_ADVERTISE_HOST = "127.0.0.1";
var WILDCARDS = /* @__PURE__ */ new Set(["0.0.0.0", "::", "[::]"]);
function bindHost() {
  const v = process.env.MIRAGE_BIND_HOST;
  return v === void 0 || v === "" ? DEFAULT_BIND_HOST : v;
}
function advertiseHost() {
  const explicit = process.env.MIRAGE_ADVERTISE_HOST;
  if (explicit !== void 0 && explicit !== "") return explicit;
  const bound = bindHost();
  return WILDCARDS.has(bound) ? DEFAULT_ADVERTISE_HOST : bound;
}
function authorityHost(host) {
  if (host.startsWith("[")) return host;
  return host.includes(":") ? `[${host}]` : host;
}

// integ/server/kit/typescript/errors.ts
var KitError = class extends Error {
};
var TenantError = class extends KitError {
};

// integ/server/kit/typescript/fault.ts
var MAX_DELAY_MS = 2 ** 31 - 1;

// integ/server/kit/typescript/db.ts
import { DatabaseSync } from "node:sqlite";

// integ/server/kit/typescript/tenant.ts
var RUN_PREFIX = "_run";
var NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
function checkName(kind, value) {
  if (!NAME_RE.test(value)) throw new TenantError(`invalid ${kind} name: ${JSON.stringify(value)}`);
  return value;
}

// integ/server/kit/typescript/config.ts
var DEFAULTS = {
  defaultPort: 0,
  tenantKind: "none",
  tenantFromBearer: false,
  tenantTokenPattern: "",
  runTokenPattern: process.env.MIRAGE_RUN_TOKEN_PATTERN ?? "",
  mintSharing: "global",
  mintFormat: "{kind}_new_{n}",
  maxBodyBytes: 64 * 1024 * 1024
};
var REQUIRED = ["service", "schema"];
var KNOWN = /* @__PURE__ */ new Set([...Object.keys(DEFAULTS), ...REQUIRED]);
function parseConfig(raw) {
  const unknown = Object.keys(raw).filter((k) => !KNOWN.has(k));
  if (unknown.length > 0) {
    throw new KitError(`unknown KitConfig fields: ${unknown.sort().join(", ")}`);
  }
  for (const k of REQUIRED) {
    if (typeof raw[k] !== "string" || raw[k] === "") {
      throw new KitError(`KitConfig.${k} is required`);
    }
  }
  const pattern = raw.runTokenPattern === void 0 ? DEFAULTS.runTokenPattern : raw.runTokenPattern;
  if (typeof pattern !== "string") throw new KitError("KitConfig.runTokenPattern must be a string");
  if (pattern !== "") {
    try {
      new RegExp(pattern);
    } catch {
      throw new KitError("KitConfig.runTokenPattern must be a valid regular expression");
    }
    const groups = new RegExp(`(?:${pattern})|`).exec("")?.groups;
    if (groups === void 0 || !Object.hasOwn(groups, "run")) {
      throw new KitError("KitConfig.runTokenPattern needs a named run capture");
    }
  }
  return {
    ...DEFAULTS,
    ...raw,
    runTokenPattern: pattern,
    service: raw.service,
    schema: raw.schema
  };
}

// integ/server/kit/typescript/fixture.ts
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
var HERE = dirname(fileURLToPath(import.meta.url));
var INTEG_ROOT = resolve(HERE, "..", "..", "..");
var DEFAULT_FIXTURE_ROOT = join(INTEG_ROOT, "fixtures");
var SCHEMA_ROOT = join(INTEG_ROOT, "prisma");
function schemaFor(service) {
  return join(SCHEMA_ROOT, `${service}.prisma`);
}

// integ/server/kit/typescript/http.ts
import { constants } from "node:buffer";

// integ/server/kit/typescript/route.ts
var Router = class {
  routes;
  queues = /* @__PURE__ */ new Map();
  readers = /* @__PURE__ */ new Map();
  constructor(routes) {
    this.routes = routes;
  }
  // Whether a route answers this method at exactly this declared path, which
  // is how a fault plan names the route it fires on. HEAD rides a GET route,
  // as it does in `match`.
  declares(method, path) {
    const want = method.toUpperCase();
    return this.routes.some(
      (spec) => spec.path === path && (spec.method === want || want === "HEAD" && spec.method === "GET")
    );
  }
  match(method, pathname) {
    const want = method.toUpperCase();
    for (const spec of this.routes) {
      if (spec.method !== want && !(want === "HEAD" && spec.method === "GET")) continue;
      const m = spec.pattern.exec(pathname);
      if (m === null) continue;
      const params = {};
      spec.params.forEach((name, i) => {
        params[name] = decodeURIComponent(m[i + 1] ?? "");
      });
      return { spec, params };
    }
    return null;
  }
  // Generalizes the per-workspace serialize() the notion fake carried before
  // it moved onto the kit. One event loop answers every
  // request, so two writes to the same rows interleave at any await: both
  // read, both write back, the later one silently drops the earlier change.
  //
  // The queue key is the RUN, not (run, tenant), because the run is what owns
  // the SQLite file every tenant in it writes through. The clock and the
  // minter moved down to the tenant when /reset learned to scope itself, so
  // this is now coarser than it strictly has to be, and deliberately: keying
  // finer than the state it protects is not a smaller lock, it is a missing
  // one, and one file is the state actually shared here.
  enqueue(run, work) {
    const prior = this.queues.get(run) ?? Promise.resolve();
    const readers = [...this.readers.get(run) ?? []];
    const next = Promise.all([prior, ...readers]).then(work);
    const settled = next.then(
      () => void 0,
      () => void 0
    );
    this.queues.set(run, settled);
    void settled.then(() => {
      if (this.queues.get(run) === settled) this.queues.delete(run);
    });
    return next;
  }
  // Reads share a snapshot boundary and run concurrently. A subsequent write
  // waits for them, so reset/drop cannot close a client still being read.
  read(run, work) {
    const next = (this.queues.get(run) ?? Promise.resolve()).then(work);
    const settled = next.then(
      () => void 0,
      () => void 0
    );
    const readers = this.readers.get(run) ?? /* @__PURE__ */ new Set();
    readers.add(settled);
    this.readers.set(run, readers);
    void settled.then(() => {
      readers.delete(settled);
      if (readers.size === 0) this.readers.delete(run);
    });
    return next;
  }
  // Build clients and other context inside work, after preceding resets and
  // deletions. Keeping the scheduling decision here makes protocol arms agree.
  run(run, write2, work) {
    return write2 ? this.enqueue(run, work) : this.read(run, work);
  }
  // The pending work on ONE run, for a caller that has to see the effect of an
  // already-accepted write before deciding. `drain` is every run at once,
  // which would make one run's slow reset block every other run's requests.
  async settled(run) {
    await this.queues.get(run);
  }
  async drain() {
    await Promise.all([
      ...this.queues.values(),
      ...[...this.readers.values()].flatMap((r) => [...r])
    ]);
  }
};

// integ/server/kit/typescript/snapshot.ts
var SQLITE = Buffer.from("SQLite format 3\0", "latin1");

// integ/server/kit/typescript/http.ts
var LOAD_PATH = new RegExp(`^(?:/${RUN_PREFIX}/[^/]+)?/_kit/runs/[^/]+/load$`);
var SNAPSHOT_BYTES = constants.MAX_STRING_LENGTH;

// integ/server/kit/typescript/sql.ts
var STATEMENTS = /* @__PURE__ */ new WeakMap();
var RUNS = /* @__PURE__ */ new WeakMap();
function stmt(db2, sql) {
  RUNS.set(db2, (RUNS.get(db2) ?? 0) + 1);
  let cache = STATEMENTS.get(db2);
  if (cache === void 0) {
    cache = /* @__PURE__ */ new Map();
    STATEMENTS.set(db2, cache);
  }
  let made = cache.get(sql);
  if (made === void 0) {
    made = db2.prepare(sql);
    cache.set(sql, made);
  }
  return made;
}
function one(db2, sql, ...params) {
  return stmt(db2, sql).get(...params) ?? null;
}
function all(db2, sql, ...params) {
  return stmt(db2, sql).all(...params);
}
function exec(db2, sql, ...params) {
  return Number(stmt(db2, sql).run(...params).changes);
}
var BYTES = "CASE WHEN ? THEN X'' ELSE ? END";
function bytes(value) {
  return [value !== null && value.length === 0 ? 1 : 0, value];
}
var UTF8 = new TextDecoder("utf-8", { ignoreBOM: true });

// integ/server/mail/imap.ts
import { createServer } from "node:net";

// integ/server/mail/queue.ts
var queue = new Router([]);

// integ/server/mail/config.ts
var config = parseConfig({
  service: "mail",
  schema: schemaFor("mail"),
  // The kit's HTTP port. IMAP and SMTP take their own, below.
  defaultPort: 5085,
  tenantKind: "pk-column"
});
var MAIL_DOMAIN_FLAG = "--mail-domain";
var INBOX = "INBOX";
var DEFAULT_MAIL_DOMAIN = "example.com";
var DOMAIN_RE = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/;
function mailDomain(argv = process.argv.slice(2)) {
  const i = argv.indexOf(MAIL_DOMAIN_FLAG);
  const named = i === -1 ? process.env.MIRAGE_MAIL_DOMAIN ?? DEFAULT_MAIL_DOMAIN : argv[i + 1] ?? "";
  if (!DOMAIN_RE.test(named)) {
    throw new KitError(`${MAIL_DOMAIN_FLAG} takes a domain, got ${JSON.stringify(named)}`);
  }
  return named;
}
function splitAddress(raw) {
  const at = raw.lastIndexOf("@");
  if (at <= 0 || at === raw.length - 1) return null;
  return { local: raw.slice(0, at), domain: raw.slice(at + 1).toLowerCase() };
}

// integ/server/mail/mime.ts
var CTE_HEADER = "content-transfer-encoding";
var CT_HEADER = "content-type";
function firstHeader(headers, name) {
  return (headers[name] ?? [])[0] ?? "";
}
function boundaryOf(contentType) {
  const m = /boundary="?([^";]+)"?/i.exec(contentType);
  return m === null ? null : m[1] ?? null;
}
function decodeQuotedPrintable(text) {
  return text.replace(/=\r?\n/g, "").replace(
    /=([0-9A-Fa-f]{2})/g,
    (_all, hex) => String.fromCharCode(Number.parseInt(hex, 16))
  );
}
function decodePart(headers, body) {
  const encoding = firstHeader(headers, CTE_HEADER).toLowerCase().trim();
  if (encoding === "base64") return Buffer.from(body, "base64").toString("utf8");
  if (encoding === "quoted-printable") return decodeQuotedPrintable(body);
  return body;
}
function splitParts(body, boundary) {
  const marker = `--${boundary}`;
  const out = [];
  for (const chunk of body.split(marker)) {
    const trimmed = chunk.replace(/^\r?\n/, "");
    if (trimmed === "" || trimmed.startsWith("--")) continue;
    out.push(trimmed);
  }
  return out;
}
function headersOf(text) {
  const split = /\r?\n\r?\n/.exec(text);
  const head = split === null ? text : text.slice(0, split.index);
  const body = split === null ? "" : text.slice(split.index + split[0].length);
  const headers = {};
  for (const raw of head.split(/\r?\n/)) {
    const colon = raw.indexOf(":");
    if (colon === -1) continue;
    const name = raw.slice(0, colon).trim().toLowerCase();
    (headers[name] ??= []).push(raw.slice(colon + 1).trim());
  }
  return { headers, body };
}
function decodeBody(headers, body) {
  const boundary = boundaryOf(firstHeader(headers, CT_HEADER));
  if (boundary === null) return decodePart(headers, body);
  return splitParts(body, boundary).map((part) => {
    const inner = headersOf(part);
    const nested = boundaryOf(firstHeader(inner.headers, CT_HEADER));
    return nested === null ? decodePart(inner.headers, inner.body) : decodeBody(inner.headers, inner.body);
  }).join("\n");
}

// integ/server/mail/search.ts
var SearchError = class extends Error {
};
function parseSource(source) {
  const text = source.toString("utf8");
  const split = /\r?\n\r?\n/.exec(text);
  const head = split === null ? text : text.slice(0, split.index);
  const body = split === null ? "" : text.slice(split.index + split[0].length);
  const headers = /* @__PURE__ */ Object.create(null);
  let current = "";
  for (const raw of head.split(/\r?\n/)) {
    if (/^[ \t]/.test(raw) && current !== "") {
      const list2 = headers[current];
      if (list2 !== void 0 && list2.length > 0) {
        list2[list2.length - 1] = `${list2[list2.length - 1] ?? ""} ${raw.trim()}`;
      }
      continue;
    }
    const colon = raw.indexOf(":");
    if (colon === -1) continue;
    current = raw.slice(0, colon).trim().toLowerCase();
    (headers[current] ??= []).push(raw.slice(colon + 1).trim());
  }
  return { headers, head, body: decodeBody(headers, body) };
}
var MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function parseImapDate(raw) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(raw);
  if (m === null) throw new SearchError(`bad date ${raw}`);
  const month = MONTHS.indexOf((m[2] ?? "").toLowerCase());
  if (month === -1) throw new SearchError(`bad month ${raw}`);
  return Date.UTC(Number(m[3]), month, Number(m[1]));
}
function dayOf(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
function sentDay(msg) {
  const raw = msg.headers.date?.[0];
  if (raw === void 0) return Number.NaN;
  const at = Date.parse(raw);
  return Number.isNaN(at) ? Number.NaN : dayOf(at);
}
function headerText(msg, name) {
  return (own(msg.headers, name) ?? []).join(" ");
}
function has(msg, flag) {
  return msg.flags.some((one2) => one2.toLowerCase() === flag.toLowerCase());
}
function contains(haystack, needle) {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}
function own(table, key) {
  return Object.hasOwn(table, key) ? table[key] : void 0;
}
var FLAG_KEYS = {
  ALL: () => true,
  ANSWERED: (m) => has(m, "\\Answered"),
  UNANSWERED: (m) => !has(m, "\\Answered"),
  DELETED: (m) => has(m, "\\Deleted"),
  UNDELETED: (m) => !has(m, "\\Deleted"),
  DRAFT: (m) => has(m, "\\Draft"),
  UNDRAFT: (m) => !has(m, "\\Draft"),
  FLAGGED: (m) => has(m, "\\Flagged"),
  UNFLAGGED: (m) => !has(m, "\\Flagged"),
  SEEN: (m) => has(m, "\\Seen"),
  UNSEEN: (m) => !has(m, "\\Seen"),
  // \Recent is not stored: this fake has no notion of a session that has not
  // seen a message yet, and every consumer here reads \Seen instead. RECENT
  // therefore matches nothing and NEW, which is RECENT and UNSEEN, matches
  // nothing with it. Answering "everything" would be the dangerous direction.
  RECENT: () => false,
  NEW: () => false,
  OLD: () => true
};
var TEXT_KEYS = {
  BCC: (m) => headerText(m, "bcc"),
  BODY: (m) => m.body,
  CC: (m) => headerText(m, "cc"),
  FROM: (m) => headerText(m, "from"),
  SUBJECT: (m) => headerText(m, "subject"),
  TEXT: (m) => m.text,
  TO: (m) => headerText(m, "to")
};
var DATE_KEYS = {
  ON: { day: (m) => dayOf(m.internalDate), cmp: "on" },
  BEFORE: { day: (m) => dayOf(m.internalDate), cmp: "before" },
  SINCE: { day: (m) => dayOf(m.internalDate), cmp: "since" },
  SENTON: { day: sentDay, cmp: "on" },
  SENTBEFORE: { day: sentDay, cmp: "before" },
  SENTSINCE: { day: sentDay, cmp: "since" }
};
var Parser = class {
  words;
  seqMax;
  uidMax;
  at = 0;
  constructor(words, seqMax, uidMax) {
    this.words = words;
    this.seqMax = seqMax;
    this.uidMax = uidMax;
  }
  done() {
    return this.at >= this.words.length;
  }
  peek() {
    return this.words[this.at] ?? "";
  }
  take() {
    if (this.done()) throw new SearchError("unexpected end of search key");
    const word = this.words[this.at] ?? "";
    this.at += 1;
    return word;
  }
  // A whole search program is an implicit AND of everything left, which is
  // what makes `UNSEEN FROM "a"` mean both.
  all() {
    const tests = [];
    while (!this.done() && this.peek() !== ")") tests.push(this.one());
    if (tests.length === 0) return () => true;
    return (msg) => tests.every((t) => t(msg));
  }
  one() {
    const word = this.take();
    if (word === "(") {
      const inner = this.all();
      if (this.take() !== ")") throw new SearchError("missing )");
      return inner;
    }
    const key = word.toUpperCase();
    if (key === "NOT") {
      const inner = this.one();
      return (msg) => !inner(msg);
    }
    if (key === "OR") {
      const left = this.one();
      const right = this.one();
      return (msg) => left(msg) || right(msg);
    }
    const flag = own(FLAG_KEYS, key);
    if (flag !== void 0) return flag;
    if (key === "KEYWORD") {
      const keyword = this.take();
      return (msg) => has(msg, keyword);
    }
    const text = own(TEXT_KEYS, key);
    if (text !== void 0) {
      const want = this.take();
      return (msg) => contains(text(msg), want);
    }
    const date = own(DATE_KEYS, key);
    if (date !== void 0) {
      const when = parseImapDate(this.take());
      if (date.cmp === "on") return (msg) => date.day(msg) === when;
      if (date.cmp === "before") return (msg) => date.day(msg) < when;
      return (msg) => date.day(msg) >= when;
    }
    if (key === "HEADER") {
      const field = this.take().toLowerCase();
      const want = this.take();
      return (msg) => contains(headerText(msg, field), want);
    }
    if (key === "UID") {
      const set = this.take();
      return (msg) => inSet(set, msg.uid, this.uidMax);
    }
    if (/^[\d,:*]+$/.test(key)) return (msg) => inSet(key, msg.seq, this.seqMax);
    throw new SearchError(`unsupported search key ${key}`);
  }
};
function inSet(set, n, max) {
  for (const part of set.split(",")) {
    const [lo, hi] = part.split(":");
    if (hi === void 0) {
      if (lo === "*" ? n === max : Number(lo) === n) return true;
      continue;
    }
    const from = lo === "*" ? max : Number(lo);
    const to = hi === "*" ? max : Number(hi);
    if (n >= Math.min(from, to) && n <= Math.max(from, to)) return true;
  }
  return false;
}
function tokenize(raw) {
  const out = [];
  let at = 0;
  while (at < raw.length) {
    const ch = raw[at] ?? "";
    if (ch === " " || ch === "	") {
      at += 1;
      continue;
    }
    if (ch === "(" || ch === ")") {
      out.push(ch);
      at += 1;
      continue;
    }
    if (ch === '"') {
      let word2 = "";
      at += 1;
      while (at < raw.length && raw[at] !== '"') {
        if (raw[at] === "\\" && at + 1 < raw.length) {
          word2 += raw[at + 1] ?? "";
          at += 2;
          continue;
        }
        word2 += raw[at] ?? "";
        at += 1;
      }
      at += 1;
      out.push(word2);
      continue;
    }
    let word = "";
    while (at < raw.length && !" 	()".includes(raw[at] ?? "")) {
      word += raw[at] ?? "";
      at += 1;
    }
    out.push(word);
  }
  return out;
}
function searchMessages(raw, messages) {
  const words = tokenize(raw);
  if ((words[0] ?? "").toUpperCase() === "CHARSET") words.splice(0, 2);
  const seqMax = messages.reduce((top, one2) => Math.max(top, one2.seq), 0);
  const uidMax = messages.reduce((top, one2) => Math.max(top, one2.uid), 0);
  const parser = new Parser(words, seqMax, uidMax);
  const test = parser.all();
  if (!parser.done()) throw new SearchError("trailing input in search key");
  return messages.filter((msg) => test(msg));
}

// integ/server/mail/store.ts
var MAILBOX = "SELECT tenant, name, uidNext, uidValidity, seq FROM MailMailbox";
var MESSAGE = "SELECT tenant, mailbox, uid, internalDate, flags, source, seq FROM MailMessage";
function canonicalName(name) {
  return name.toUpperCase() === INBOX ? INBOX : name;
}
async function mailboxOf(db2, tenant, name) {
  return one(
    db2,
    `${MAILBOX} WHERE tenant = ? AND name = ?`,
    tenant,
    canonicalName(name)
  );
}
async function mailboxesOf(db2, tenant) {
  const rows = all(db2, `${MAILBOX} WHERE tenant = ? ORDER BY seq`, tenant);
  return [...rows].sort((a, b) => {
    if (a.name === INBOX) return -1;
    if (b.name === INBOX) return 1;
    return a.seq - b.seq;
  });
}
var reservedValidity = /* @__PURE__ */ new WeakMap();
function validityKey(tenant, name) {
  return `${tenant}\0${name}`;
}
async function createMailbox(db2, tenant, name) {
  const canonical = canonicalName(name);
  const reserved = reservedValidity.get(db2)?.get(validityKey(tenant, canonical));
  exec(
    db2,
    "INSERT INTO MailMailbox (tenant, name, uidValidity, seq) VALUES (?, ?, ?, (SELECT COUNT(*) FROM MailMailbox WHERE tenant = ?))",
    tenant,
    canonical,
    reserved ?? 1,
    tenant
  );
  const made = await mailboxOf(db2, tenant, canonical);
  if (made === null) throw new Error(`mail fake: mailbox ${canonical} vanished as it was made`);
  return made;
}
function changeOne(db2, sql, ...params) {
  if (exec(db2, sql, ...params) === 0) throw new Error("mail fake: no row matched");
}
async function deleteMailbox(db2, tenant, name) {
  const canonical = canonicalName(name);
  const row = await mailboxOf(db2, tenant, canonical);
  exec(db2, "DELETE FROM MailMessage WHERE tenant = ? AND mailbox = ?", tenant, canonical);
  changeOne(db2, "DELETE FROM MailMailbox WHERE tenant = ? AND name = ?", tenant, canonical);
  const next = (row?.uidValidity ?? 0) + 1;
  let byName = reservedValidity.get(db2);
  if (byName === void 0) {
    byName = /* @__PURE__ */ new Map();
    reservedValidity.set(db2, byName);
  }
  byName.set(validityKey(tenant, canonical), next);
  return next;
}
async function messagesOf(db2, tenant, mailbox) {
  const rows = all(
    db2,
    `${MESSAGE} WHERE tenant = ? AND mailbox = ? ORDER BY uid`,
    tenant,
    canonicalName(mailbox)
  );
  return rows.map((row) => ({ ...row, internalDate: BigInt(row.internalDate) }));
}
function withSequence(rows) {
  return rows.map((row, i) => {
    const source = Buffer.from(row.source);
    const parsed = parseSource(source);
    return {
      seq: i + 1,
      uid: row.uid,
      internalDate: Number(row.internalDate),
      flags: row.flags === "" ? [] : row.flags.split(" "),
      headers: parsed.headers,
      body: parsed.body,
      source,
      // TEXT is header plus body, and the body half is the DECODED one: a
      // server that matched the transferred octets would answer `TEXT
      // "forecast"` with nothing for a base64 part and would match a search
      // for the base64 itself, neither of which any real server does. It is a
      // field of its own because FETCH serves `source` and must keep the raw
      // bytes -- sharing one field made every fetched message arrive decoded.
      text: `${parsed.head}

${parsed.body}`
    };
  });
}
async function appendMessage(db2, tenant, mailbox, source, flags, internalDate) {
  const canonical = canonicalName(mailbox);
  const box = await mailboxOf(db2, tenant, canonical);
  if (box === null) throw new Error(`no mailbox ${canonical}`);
  const uid = box.uidNext;
  exec(
    db2,
    `INSERT INTO MailMessage (tenant, mailbox, uid, internalDate, flags, source, seq) VALUES (?, ?, ?, ?, ?, ${BYTES}, (SELECT COUNT(*) FROM MailMessage WHERE tenant = ? AND mailbox = ?))`,
    tenant,
    canonical,
    uid,
    internalDate,
    flags.join(" "),
    ...bytes(source),
    tenant,
    canonical
  );
  changeOne(
    db2,
    "UPDATE MailMailbox SET uidNext = ? WHERE tenant = ? AND name = ?",
    uid + 1,
    tenant,
    canonical
  );
  return uid;
}
async function setFlags(db2, tenant, mailbox, uid, flags) {
  changeOne(
    db2,
    "UPDATE MailMessage SET flags = ? WHERE tenant = ? AND mailbox = ? AND uid = ?",
    flags.join(" "),
    tenant,
    canonicalName(mailbox),
    uid
  );
}
async function removeMessage(db2, tenant, mailbox, uid) {
  changeOne(
    db2,
    "DELETE FROM MailMessage WHERE tenant = ? AND mailbox = ? AND uid = ?",
    tenant,
    canonicalName(mailbox),
    uid
  );
}

// integ/server/mail/imap.ts
var CAPABILITIES = "IMAP4rev1 LITERAL+ UIDPLUS ENABLE ID NAMESPACE AUTH=PLAIN SASL-IR";
var FLAGS = "\\Answered \\Flagged \\Deleted \\Seen \\Draft";
function write(session, line) {
  session.socket.write(`${line}\r
`);
}
var MONTHS2 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function internalDateOf(ms) {
  const d = new Date(ms);
  const two = (n) => String(n).padStart(2, "0");
  return `${two(d.getUTCDate())}-${MONTHS2[d.getUTCMonth()] ?? "Jan"}-${String(d.getUTCFullYear())} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())} +0000`;
}
function parseInternalDate(raw) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(
    raw
  );
  if (m === null) return Number.NaN;
  const month = MONTHS2.findIndex((one2) => one2.toLowerCase() === (m[2] ?? "").toLowerCase());
  if (month === -1) return Number.NaN;
  const sign = m[7] === "-" ? 1 : -1;
  const offset = sign * (Number(m[8]) * 60 + Number(m[9])) * 6e4;
  return Date.UTC(Number(m[3]), month, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6])) + offset;
}
function parseCommand(line, literal) {
  const trimmed = line.replace(/\r$/, "");
  const first2 = trimmed.indexOf(" ");
  if (first2 === -1) return null;
  const tag = trimmed.slice(0, first2);
  const rest = trimmed.slice(first2 + 1);
  const second = rest.indexOf(" ");
  const name = (second === -1 ? rest : rest.slice(0, second)).toUpperCase();
  const args = second === -1 ? [] : tokenize(rest.slice(second + 1));
  return { tag, name, args, literal };
}
function rawArgs(line, verb) {
  const trimmed = line.replace(/\r$/, "");
  const at = trimmed.toUpperCase().indexOf(` ${verb} `);
  return at === -1 ? "" : trimmed.slice(at + verb.length + 2);
}
function startImapServer(runtime, port) {
  const open = /* @__PURE__ */ new Set();
  const server = createServer((socket) => {
    open.add(socket);
    socket.on("close", () => open.delete(socket));
    const session = {
      socket,
      state: "unauth",
      tenant: "",
      run: "",
      mailbox: "",
      readOnly: false,
      pending: null,
      saslTag: null
    };
    write(session, `* OK [CAPABILITY ${CAPABILITIES}] mirage mail fake ready`);
    let buffer = Buffer.alloc(0);
    let swallow = false;
    let chain = Promise.resolve();
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (; ; ) {
        if (session.pending !== null) {
          const want = session.pending.need;
          if (buffer.length < want) return;
          const body = buffer.subarray(0, want);
          buffer = buffer.subarray(want);
          const held = session.pending;
          session.pending = null;
          swallow = true;
          const line2 = held.line;
          chain = chain.then(() => handle(runtime, session, line2, body));
          continue;
        }
        if (swallow) {
          if (buffer.length === 0) return;
          if (buffer[0] === 10) {
            buffer = buffer.subarray(1);
          } else if (buffer[0] === 13) {
            if (buffer.length < 2) return;
            if (buffer[1] === 10) buffer = buffer.subarray(2);
          }
          swallow = false;
          continue;
        }
        const nl = buffer.indexOf("\n");
        if (nl === -1) return;
        const line = buffer.subarray(0, nl).toString("utf8");
        buffer = buffer.subarray(nl + 1);
        const literal = /\{(\d+)(\+?)\}\r?$/.exec(line);
        if (literal !== null) {
          session.pending = { need: Number(literal[1]), chunks: [], line };
          if (literal[2] !== "+") write(session, "+ ready for literal data");
          continue;
        }
        chain = chain.then(() => handle(runtime, session, line, null));
      }
    });
    socket.on("error", () => {
      socket.destroy();
    });
  });
  return new Promise((resolve2) => {
    server.listen(port, bindHost(), () => {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("imap: no port");
      resolve2({
        server,
        port: address.port,
        close: async () => {
          await new Promise((done) => {
            server.close(() => {
              done();
            });
            for (const socket of open) socket.destroy();
            open.clear();
          });
        }
      });
    });
  });
}
function db(runtime, session) {
  return runtime.pool.sql(session.run);
}
async function handle(runtime, session, line, literal) {
  if (session.saslTag !== null) {
    const tag = session.saslTag;
    session.saslTag = null;
    await authenticate(runtime, session, tag, line.trim());
    return;
  }
  const cmd = parseCommand(line, literal);
  if (cmd === null) {
    write(session, "* BAD missing command");
    return;
  }
  try {
    await dispatch(runtime, session, cmd, line);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    write(session, `${cmd.tag} NO ${message}`);
  }
}
async function dispatch(runtime, session, cmd, line) {
  const { tag, name, args } = cmd;
  if (name === "CAPABILITY") {
    write(session, `* CAPABILITY ${CAPABILITIES}`);
    write(session, `${tag} OK CAPABILITY completed`);
    return;
  }
  if (name === "NOOP") {
    write(session, `${tag} OK NOOP completed`);
    return;
  }
  if (name === "LOGOUT") {
    write(session, "* BYE mirage mail fake signing off");
    write(session, `${tag} OK LOGOUT completed`);
    session.socket.end();
    return;
  }
  if (name === "ID") {
    write(session, '* ID ("name" "mirage-mail-fake")');
    write(session, `${tag} OK ID completed`);
    return;
  }
  if (name === "ENABLE") {
    write(session, `${tag} OK ENABLE completed`);
    return;
  }
  if (name === "NAMESPACE") {
    write(session, '* NAMESPACE (("" "/")) NIL NIL');
    write(session, `${tag} OK NAMESPACE completed`);
    return;
  }
  if (name === "LOGIN") {
    await login(runtime, session, tag, args);
    return;
  }
  if (name === "AUTHENTICATE") {
    if (args[1] === void 0) {
      session.saslTag = tag;
      write(session, "+ ");
      return;
    }
    await authenticate(runtime, session, tag, args[1]);
    return;
  }
  if (session.state === "unauth") {
    write(session, `${tag} NO command ${name} illegal in state NOAUTH`);
    return;
  }
  if (name === "LIST" || name === "LSUB") {
    await list(runtime, session, tag);
    return;
  }
  if (name === "STATUS") {
    await status(runtime, session, tag, args);
    return;
  }
  if (name === "CREATE") {
    await create2(runtime, session, tag, args);
    return;
  }
  if (name === "DELETE") {
    await remove2(runtime, session, tag, args);
    return;
  }
  if (name === "SELECT" || name === "EXAMINE") {
    await select2(runtime, session, tag, args, name === "EXAMINE");
    return;
  }
  if (name === "APPEND") {
    await append(runtime, session, tag, args, cmd.literal);
    return;
  }
  if (name === "CLOSE") {
    if (session.state === "selected" && !session.readOnly) {
      await expungeDeleted(runtime, session);
    }
    session.state = "auth";
    session.mailbox = "";
    write(session, `${tag} OK CLOSE completed`);
    return;
  }
  if (name === "UNSELECT") {
    session.state = "auth";
    session.mailbox = "";
    write(session, `${tag} OK UNSELECT completed`);
    return;
  }
  const uidMode = name === "UID";
  const verb = uidMode ? (args[0] ?? "").toUpperCase() : name;
  if (session.state !== "selected" && ["SEARCH", "FETCH", "STORE", "COPY", "EXPUNGE"].includes(verb)) {
    write(session, `${tag} NO command ${verb} illegal in state AUTH`);
    return;
  }
  if (session.state === "selected" && session.readOnly && ["STORE", "EXPUNGE"].includes(verb)) {
    write(session, `${tag} NO ${verb} refused: mailbox is opened READ-ONLY`);
    return;
  }
  if (verb === "SEARCH") {
    await search(runtime, session, tag, rawArgs(line, uidMode ? "SEARCH" : name), uidMode);
    return;
  }
  if (verb === "FETCH") {
    await fetch(runtime, session, tag, uidMode ? args.slice(1) : args, uidMode);
    return;
  }
  if (verb === "STORE") {
    await store(runtime, session, tag, uidMode ? args.slice(1) : args, uidMode);
    return;
  }
  if (verb === "COPY") {
    await copy(runtime, session, tag, uidMode ? args.slice(1) : args, uidMode);
    return;
  }
  if (verb === "EXPUNGE") {
    const uidSet = args[1] ?? "";
    if (uidMode && uidSet === "") {
      write(session, `${tag} BAD UID EXPUNGE takes a uid set`);
      return;
    }
    await expungeDeleted(runtime, session, uidMode ? uidSet : null);
    write(session, `${tag} OK EXPUNGE completed`);
    return;
  }
  write(session, `${tag} BAD unsupported command ${name}`);
}
async function authenticate(runtime, session, tag, blob) {
  const [, user, pass] = Buffer.from(blob, "base64").toString("utf8").split("\0");
  await login(runtime, session, tag, [user ?? "", pass ?? ""]);
}
async function login(runtime, session, tag, args) {
  const user = args[0] ?? "";
  const pass = args[1] ?? "";
  if (user === "" || pass === "") {
    write(session, `${tag} BAD LOGIN takes a username and a password`);
    return;
  }
  const address = splitAddress(user);
  const domain = mailDomain();
  if (address === null || address.domain !== domain.toLowerCase()) {
    write(
      session,
      `${tag} NO [AUTHENTICATIONFAILED] this server serves @${domain} only, not ${user}`
    );
    return;
  }
  let run;
  let tenant;
  try {
    run = checkName("run", pass);
    tenant = checkName("tenant", address.local);
  } catch {
    write(session, `${tag} NO [AUTHENTICATIONFAILED] invalid credentials`);
    return;
  }
  session.run = run;
  session.tenant = tenant;
  const boxes = await mailboxesOf(db(runtime, session), tenant);
  if (boxes.length === 0) {
    session.run = "";
    session.tenant = "";
    write(
      session,
      `${tag} NO [AUTHENTICATIONFAILED] no account ${user} in run ${run}; seed it with POST /reset first`
    );
    return;
  }
  session.state = "auth";
  write(session, `${tag} OK [CAPABILITY ${CAPABILITIES}] LOGIN completed`);
}
function quoted(name) {
  return `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
async function list(runtime, session, tag) {
  const parents = /* @__PURE__ */ new Set();
  for (const box of await mailboxesOf(db(runtime, session), session.tenant)) {
    const parent = box.name.includes("/") ? box.name.slice(0, box.name.lastIndexOf("/")) : null;
    if (parent !== null && !parents.has(parent)) {
      parents.add(parent);
      write(session, `* LIST (\\Noselect \\HasChildren) "/" ${quoted(parent)}`);
    }
    write(session, `* LIST (\\HasNoChildren) "/" ${quoted(box.name)}`);
  }
  write(session, `${tag} OK LIST completed`);
}
async function status(runtime, session, tag, args) {
  const name = canonicalName(args[0] ?? "");
  const box = await mailboxOf(db(runtime, session), session.tenant, name);
  if (box === null) {
    write(session, `${tag} NO [TRYCREATE] no such mailbox`);
    return;
  }
  const rows = await messagesOf(db(runtime, session), session.tenant, name);
  const unseen = rows.filter((one2) => !one2.flags.split(" ").includes("\\Seen")).length;
  const values = {
    MESSAGES: rows.length,
    RECENT: 0,
    UIDNEXT: box.uidNext,
    UIDVALIDITY: box.uidValidity,
    UNSEEN: unseen
  };
  const wanted = args.filter((one2) => one2 in values);
  const asked = wanted.length > 0 ? wanted : Object.keys(values);
  const rendered = asked.map((k) => `${k} ${String(values[k] ?? 0)}`).join(" ");
  write(session, `* STATUS ${quoted(name)} (${rendered})`);
  write(session, `${tag} OK STATUS completed`);
}
async function create2(runtime, session, tag, args) {
  const name = canonicalName(args[0] ?? "");
  await queue.enqueue(session.run, async () => {
    if (await mailboxOf(db(runtime, session), session.tenant, name) !== null) {
      write(session, `${tag} NO mailbox already exists`);
      return;
    }
    await createMailbox(db(runtime, session), session.tenant, name);
    write(session, `${tag} OK CREATE completed`);
  });
}
async function remove2(runtime, session, tag, args) {
  const name = canonicalName(args[0] ?? "");
  if (name === INBOX) {
    write(session, `${tag} NO cannot delete INBOX`);
    return;
  }
  await queue.enqueue(session.run, async () => {
    if (await mailboxOf(db(runtime, session), session.tenant, name) === null) {
      write(session, `${tag} NO no such mailbox`);
      return;
    }
    await deleteMailbox(db(runtime, session), session.tenant, name);
    if (session.mailbox === name) {
      session.state = "auth";
      session.mailbox = "";
    }
    write(session, `${tag} OK DELETE completed`);
  });
}
async function select2(runtime, session, tag, args, readOnly) {
  const name = canonicalName(args[0] ?? "");
  const box = await mailboxOf(db(runtime, session), session.tenant, name);
  if (box === null) {
    write(session, `${tag} NO [TRYCREATE] no such mailbox`);
    return;
  }
  const rows = await messagesOf(db(runtime, session), session.tenant, name);
  write(session, `* FLAGS (${FLAGS})`);
  write(session, `* OK [PERMANENTFLAGS (${FLAGS} \\*)] flags permitted`);
  write(session, `* ${String(rows.length)} EXISTS`);
  write(session, "* 0 RECENT");
  write(session, `* OK [UIDVALIDITY ${String(box.uidValidity)}] uid validity`);
  write(session, `* OK [UIDNEXT ${String(box.uidNext)}] next uid`);
  session.state = "selected";
  session.mailbox = name;
  session.readOnly = readOnly;
  write(session, `${tag} OK [${readOnly ? "READ-ONLY" : "READ-WRITE"}] SELECT completed`);
}
async function loaded(runtime, session) {
  return withSequence(await messagesOf(db(runtime, session), session.tenant, session.mailbox));
}
async function search(runtime, session, tag, raw, uidMode) {
  let hits;
  try {
    hits = searchMessages(raw, await loaded(runtime, session));
  } catch (err) {
    if (!(err instanceof SearchError)) throw err;
    write(session, `${tag} BAD ${err.message}`);
    return;
  }
  const ids = hits.map((one2) => String(uidMode ? one2.uid : one2.seq));
  write(session, `* SEARCH${ids.length === 0 ? "" : ` ${ids.join(" ")}`}`);
  write(session, `${tag} OK SEARCH completed`);
}
function fetchItem(item, msg) {
  const key = item.toUpperCase();
  if (key === "UID") return `UID ${String(msg.uid)}`;
  if (key === "FLAGS") return `FLAGS (${msg.flags.join(" ")})`;
  if (key === "INTERNALDATE") return `INTERNALDATE "${internalDateOf(msg.internalDate)}"`;
  if (key === "RFC822.SIZE") return `RFC822.SIZE ${String(msg.source.length)}`;
  if (key === "ENVELOPE") return `ENVELOPE ${envelopeOf(msg.source)}`;
  if (key === "BODYSTRUCTURE") return `BODYSTRUCTURE ${structureOf(msg.source)}`;
  return null;
}
function nstring(value) {
  return value === null ? "NIL" : quoted(value);
}
function headerField(head, name) {
  for (const line of head.split("\r\n")) {
    const at = line.indexOf(":");
    if (at > 0 && line.slice(0, at).toLowerCase() === name) return line.slice(at + 1).trim();
  }
  return null;
}
function addressList(value) {
  if (value === null || value === "") return "NIL";
  const entries = value.split(",").map((raw) => {
    const trimmed = raw.trim();
    const open = trimmed.lastIndexOf("<");
    const email = open < 0 ? trimmed : trimmed.slice(open + 1, trimmed.lastIndexOf(">"));
    const name = open < 0 ? "" : trimmed.slice(0, open).trim().replace(/^"|"$/g, "");
    const [mailbox, host] = email.split("@");
    return `(${nstring(name === "" ? null : name)} NIL ${nstring(mailbox ?? "")} ${nstring(host ?? "")})`;
  });
  return `(${entries.join("")})`;
}
function envelopeOf(source) {
  const end = source.indexOf("\r\n\r\n");
  const head = source.subarray(0, end < 0 ? source.length : end).toString("latin1").replace(/\r\n[ \t]+/g, " ");
  const field = (name) => headerField(head, name);
  const from = addressList(field("from"));
  const sender = field("sender") === null ? from : addressList(field("sender"));
  const replyTo = field("reply-to") === null ? from : addressList(field("reply-to"));
  return `(${[
    nstring(field("date")),
    nstring(field("subject")),
    from,
    sender,
    replyTo,
    addressList(field("to")),
    addressList(field("cc")),
    addressList(field("bcc")),
    nstring(field("in-reply-to")),
    nstring(field("message-id"))
  ].join(" ")})`;
}
function structureOf(source) {
  const leaf = (disposition, name) => {
    const parameters = disposition === null ? "NIL" : `(${quoted(disposition)} (${quoted("filename")} ${nstring(name)}))`;
    return `(${quoted("text")} ${quoted("plain")} (${quoted("charset")} ${quoted("utf-8")}) NIL NIL ${quoted("base64")} 4 1 NIL ${parameters} NIL NIL)`;
  };
  const named = [
    ...source.toString("latin1").matchAll(/Content-Disposition: (\w+); filename="([^"]*)"/g)
  ];
  if (named.length === 0) return leaf(null, null);
  const parts = named.map((match) => leaf(match[1] ?? "", match[2] ?? ""));
  return `(${leaf(null, null)}${parts.join("")} ${quoted("mixed")} (${quoted("boundary")} ${quoted("integ-mime-boundary")}) NIL NIL NIL)`;
}
var BODY_ITEM = /^(BODY(?:\.PEEK)?\[\]|RFC822(?:\.TEXT)?)$/i;
var HEADER_ITEM = /^BODY(?:\.PEEK)?\[HEADER\]$/i;
function headerOf(source) {
  const end = source.indexOf("\r\n\r\n");
  return end < 0 ? source : source.subarray(0, end + 4);
}
function highest(rows, uidMode) {
  return rows.reduce((top, one2) => Math.max(top, uidMode ? one2.uid : one2.seq), 0);
}
async function fetch(runtime, session, tag, args, uidMode) {
  const set = args[0] ?? "";
  const items = args.slice(1).filter((one2) => one2 !== "(" && one2 !== ")");
  const rows = await loaded(runtime, session);
  const top = highest(rows, uidMode);
  const wanted = rows.filter((one2) => inSet(set, uidMode ? one2.uid : one2.seq, top));
  const asked = uidMode && !items.some((one2) => one2.toUpperCase() === "UID") ? ["UID", ...items] : items;
  for (const msg of wanted) {
    const parts = [];
    let body = null;
    let bodyKey = "";
    for (const item of asked) {
      const simple = fetchItem(item, msg);
      if (simple !== null) {
        parts.push(simple);
        continue;
      }
      if (BODY_ITEM.test(item)) {
        bodyKey = item.toUpperCase().startsWith("RFC822") ? "RFC822" : "BODY[]";
        body = msg.source;
        continue;
      }
      if (HEADER_ITEM.test(item)) {
        bodyKey = "BODY[HEADER]";
        body = headerOf(msg.source);
        continue;
      }
      write(session, `${tag} BAD unsupported fetch item ${item}`);
      return;
    }
    if (body === null) {
      write(session, `* ${String(msg.seq)} FETCH (${parts.join(" ")})`);
      continue;
    }
    const head = parts.length === 0 ? "" : `${parts.join(" ")} `;
    session.socket.write(
      `* ${String(msg.seq)} FETCH (${head}${bodyKey} {${String(body.length)}}\r
`
    );
    session.socket.write(body);
    session.socket.write(")\r\n");
  }
  write(session, `${tag} OK FETCH completed`);
}
var FLAG_OPS = /^([+-]?)FLAGS(\.SILENT)?$/i;
async function store(runtime, session, tag, args, uidMode) {
  const set = args[0] ?? "";
  const op = FLAG_OPS.exec(args[1] ?? "");
  if (op === null) {
    write(session, `${tag} BAD unsupported store item ${args[1] ?? ""}`);
    return;
  }
  const silent = op[2] !== void 0;
  const given = args.slice(2).filter((one2) => one2 !== "(" && one2 !== ")");
  await queue.enqueue(session.run, async () => {
    const rows = await loaded(runtime, session);
    const top = highest(rows, uidMode);
    for (const msg of rows) {
      if (!inSet(set, uidMode ? msg.uid : msg.seq, top)) continue;
      const before = new Set(msg.flags);
      if (op[1] === "+") for (const f of given) before.add(f);
      else if (op[1] === "-") for (const f of given) before.delete(f);
      else {
        before.clear();
        for (const f of given) before.add(f);
      }
      const next = [...before];
      await setFlags(db(runtime, session), session.tenant, session.mailbox, msg.uid, next);
      if (!silent) {
        write(
          session,
          `* ${String(msg.seq)} FETCH (${uidMode ? `UID ${String(msg.uid)} ` : ""}FLAGS (${next.join(" ")}))`
        );
      }
    }
    write(session, `${tag} OK STORE completed`);
  });
}
async function copy(runtime, session, tag, args, uidMode) {
  const set = args[0] ?? "";
  const target = canonicalName(args[1] ?? "");
  await queue.enqueue(session.run, async () => {
    const box = await mailboxOf(db(runtime, session), session.tenant, target);
    if (box === null) {
      write(session, `${tag} NO [TRYCREATE] no such mailbox`);
      return;
    }
    const rows = await loaded(runtime, session);
    const top = highest(rows, uidMode);
    const sources = [];
    const copies = [];
    for (const msg of rows) {
      if (!inSet(set, uidMode ? msg.uid : msg.seq, top)) continue;
      sources.push(msg.uid);
      copies.push(
        await appendMessage(
          db(runtime, session),
          session.tenant,
          target,
          msg.source,
          msg.flags,
          msg.internalDate
        )
      );
    }
    const copied = sources.length === 0 ? "" : `[COPYUID ${String(box.uidValidity)} ${sources.join(",")} ${copies.join(",")}] `;
    write(session, `${tag} OK ${copied}COPY completed`);
  });
}
async function append(runtime, session, tag, args, literal) {
  if (literal === null) {
    write(session, `${tag} BAD APPEND needs a literal`);
    return;
  }
  const mailbox = canonicalName(args[0] ?? "");
  const rest = args.slice(1).filter((one2) => one2 !== "(" && one2 !== ")" && !one2.startsWith("{"));
  const flags = rest.filter((one2) => one2.startsWith("\\"));
  const dated = rest.find((one2) => !one2.startsWith("\\") && /^\d/.test(one2));
  const when = dated === void 0 ? Number.NaN : parseInternalDate(dated);
  await queue.enqueue(session.run, async () => {
    const box = await mailboxOf(db(runtime, session), session.tenant, mailbox);
    if (box === null) {
      write(session, `${tag} NO [TRYCREATE] no such mailbox`);
      return;
    }
    const uid = await appendMessage(
      db(runtime, session),
      session.tenant,
      mailbox,
      literal,
      flags,
      Number.isNaN(when) ? runtime.state(session.run).of(session.tenant).clock.nowMs() : when
    );
    write(
      session,
      `${tag} OK [APPENDUID ${String(box.uidValidity)} ${String(uid)}] APPEND completed`
    );
  });
}
async function expungeDeleted(runtime, session, uidSet = null) {
  await queue.enqueue(session.run, async () => {
    const rows = await loaded(runtime, session);
    const top = highest(rows, true);
    const doomed = rows.filter(
      (one2) => one2.flags.includes("\\Deleted") && (uidSet === null || inSet(uidSet, one2.uid, top))
    );
    for (const msg of [...doomed].reverse()) {
      await removeMessage(db(runtime, session), session.tenant, session.mailbox, msg.uid);
      write(session, `* ${String(msg.seq)} EXPUNGE`);
    }
  });
}

// integ/server/mail/smtp.ts
import { SMTPServer } from "smtp-server";
function addressUser(raw) {
  const at = raw.indexOf("<");
  const inner = at === -1 ? raw : raw.slice(at + 1, raw.indexOf(">", at));
  return inner.trim();
}
var sessions = /* @__PURE__ */ new WeakMap();
function startSmtpServer(runtime, port) {
  const open = /* @__PURE__ */ new Set();
  const server = new SMTPServer({
    authOptional: false,
    disabledCommands: ["STARTTLS"],
    logger: false,
    onAuth: (auth, session, callback) => {
      const user = auth.username ?? "";
      const pass = auth.password ?? "";
      if (user === "" || pass === "") {
        callback(new Error("smtp: a username and password are required"));
        return;
      }
      const address = splitAddress(user);
      if (address === null || address.domain !== mailDomain().toLowerCase()) {
        callback(new Error(`smtp: this server serves @${mailDomain()} only, not ${user}`));
        return;
      }
      let run;
      let tenant;
      try {
        run = checkName("run", pass);
        tenant = checkName("tenant", address.local);
      } catch {
        callback(new Error("smtp: invalid credentials"));
        return;
      }
      void mailboxesOf(runtime.pool.sql(run), tenant).then((boxes) => {
        if (boxes.length === 0) {
          callback(new Error(`smtp: no such account in this run: ${user}`));
          return;
        }
        sessions.set(session, { run, tenant });
        callback(null, { user });
      }).catch((err) => {
        callback(err instanceof Error ? err : new Error(String(err)));
      });
    },
    onData: (stream, session, callback) => {
      const chunks = [];
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("end", () => {
        const auth = sessions.get(session);
        if (auth === void 0) {
          callback(new Error("smtp: not authenticated"));
          return;
        }
        const raw = Buffer.concat(chunks);
        const domain = mailDomain().toLowerCase();
        const to = session.envelope.rcptTo.map((one2) => splitAddress(addressUser(one2.address))).filter((one2) => one2 !== null).filter((one2) => one2.domain === domain).map((one2) => one2.local);
        void queue.enqueue(auth.run, async () => {
          const db2 = runtime.pool.sql(auth.run);
          for (const recipient of to) {
            if (await mailboxOf(db2, recipient, INBOX) === null) continue;
            const box = canonicalName(INBOX);
            if (await mailboxOf(db2, recipient, box) === null) {
              await createMailbox(db2, recipient, box);
            }
            await appendMessage(
              db2,
              recipient,
              box,
              raw,
              [],
              runtime.state(auth.run).of(recipient).clock.nowMs()
            );
          }
        }).then(
          () => {
            callback(null);
          },
          (err) => {
            callback(err instanceof Error ? err : new Error(String(err)));
          }
        );
      });
    }
  });
  return new Promise((resolve2) => {
    server.server.on("connection", (socket) => {
      open.add(socket);
      socket.on("close", () => open.delete(socket));
    });
    server.listen(port, bindHost(), () => {
      const address = server.server.address();
      if (address === null || typeof address === "string") throw new Error("smtp: no port");
      resolve2({
        server,
        port: address.port,
        close: async () => {
          await new Promise((done) => {
            server.close(() => {
              done();
            });
            for (const socket of open) socket.destroy();
            open.clear();
          });
        }
      });
    });
  });
}

// integ/server/mail/arms.ts
async function startMailArms(runtime, imapPort, smtpPort) {
  const imap = await startImapServer(runtime, imapPort);
  const smtp = await startSmtpServer(runtime, smtpPort);
  const host = authorityHost(advertiseHost());
  return {
    announces: [
      { token: "MAIL_IMAP_URL", url: `imap://${host}:${String(imap.port)}` },
      { token: "MAIL_SMTP_URL", url: `smtp://${host}:${String(smtp.port)}` }
    ],
    close: async () => {
      await Promise.all([imap.close(), smtp.close()]);
    }
  };
}
export {
  startMailArms
};
