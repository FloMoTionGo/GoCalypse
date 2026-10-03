# GoCalypse: notes for agents

Read CONSTRAINTS.md before writing code. Do not weaken it to make a change pass.

## Tests come first

Every change to shipped behaviour starts as failing tests (tests/README.md, "Red first"):

1. Write the tests for the feature or bug at every level it touches: server
   unit (`server/src/**/*.test.ts`), integration (`tests/integration/`), GUI
   (`tests/gui/`). Give them literal, unique names.
2. List them in `tests/pending.json`, run `node tests/run.mjs`, and check that
   they are shown *red as expected* while everything else passes. Commit those
   tests on their own.
3. Implement, take the entries off `tests/pending.json`, run again, and commit.

Never list an existing test as pending, skip a test, or delete an assertion to
get to green. The floor guard refuses those moves. If a check is wrong, say so
to the user instead of working around it.

`node tests/run.mjs quick` takes ~13 s; the full run (`node tests/run.mjs`) takes
~85 s and needs Edge or Chrome. Use `--grep <name>` and single tiers while
iterating.
