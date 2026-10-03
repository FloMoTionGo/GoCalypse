// node:test reporter: one JSON line per finished test, for tests/run.mjs to
// judge against tests/pending.json. Suites are left out; a file that fails to
// load is reported as a failed test named after the file.
export default async function* collect(source) {
  for await (const event of source) {
    if (event.type !== "test:pass" && event.type !== "test:fail") continue;
    const d = event.data;
    if (d.details?.type === "suite") continue;
    const err = d.details?.error;
    yield JSON.stringify({
      status: event.type === "test:pass" ? "pass" : "fail",
      name: d.name,
      file: d.file,
      nesting: d.nesting,
      skipped: Boolean(d.skip || d.todo),
      ms: Math.round(d.details?.duration_ms ?? 0),
      error: err
        ? String(err.cause?.message ?? err.message ?? err).split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 4).join(" ").slice(0, 300)
        : undefined,
    }) + "\n";
  }
}
