import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client.js";

export async function runMigrations(databaseUrl: string): Promise<void> {
  const { db, client } = createDb(databaseUrl);
  try {
    await migrate(db, { migrationsFolder: defaultMigrationsFolder() });
  } finally {
    await client.end();
  }
}

function defaultMigrationsFolder(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
}
