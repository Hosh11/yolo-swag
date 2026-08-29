/**
 * Small DB CLI: `npm run db:migrate | db:reset | db:seed`.
 * Loads .env.local then .env so it matches what Next reads.
 */
import { readFileSync, existsSync } from "node:fs";

for (const file of [".env.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

const { getDb } = await import("../src/lib/db/client");
const { migrate, drop } = await import("../src/lib/db/migrate");
const repo = await import("../src/lib/db/repo");

const command = process.argv[2] ?? "migrate";
const db = await getDb();

switch (command) {
  case "migrate": {
    await migrate(db);
    console.log("Schema is up to date.");
    break;
  }
  case "reset": {
    await drop(db);
    await migrate(db);
    console.log("Dropped and recreated every table.");
    break;
  }
  case "seed": {
    const project = await repo.createProject({
      name: "The Salt Line",
      description: "Literary novel, second draft. Chapters 8-12 are the mess.",
      deadline: new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10),
      word_goal: 90_000,
    });
    await repo.createTask({
      title: "Rewrite the harbour scene in chapter 9 — 300 words, badly, on purpose",
      project_id: project.id,
      priority: 1,
    });
    await repo.createTask({
      title: "Email Maya back about the residency",
      priority: 1,
      due_date: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
    });
    await repo.capture({
      content: "What if the lighthouse keeper is the one who wrote the letters?",
      kind: "idea",
      project_id: project.id,
    });
    await repo.logWords({ words: 820, project_id: project.id, note: "Chapter 8, the argument on the pier." });
    console.log("Seeded a project, two tasks, an idea, and one writing session.");
    break;
  }
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}

await db.destroy();
