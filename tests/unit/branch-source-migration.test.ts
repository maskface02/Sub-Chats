import { expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

it("adds nullable branch coordinates without changing old data and can run twice", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE conversations (id text PRIMARY KEY, highlight_text text); INSERT INTO conversations VALUES ('old', 'saved phrase');");
    const migration = readFileSync("drizzle/0002_branch_sources.sql", "utf8");
    await db.exec(migration);
    await db.exec(migration);
    expect((await db.query("SELECT * FROM conversations")).rows).toEqual([{ id: "old", highlight_text: "saved phrase", source_message_id: null, source_start: null, source_end: null }]);
    await db.exec("UPDATE conversations SET source_message_id = 'message', source_start = 4, source_end = 16 WHERE id = 'old'");
    expect((await db.query("SELECT source_start, source_end FROM conversations")).rows).toEqual([{ source_start: 4, source_end: 16 }]);
  } finally { await db.close(); }
}, 20000);
