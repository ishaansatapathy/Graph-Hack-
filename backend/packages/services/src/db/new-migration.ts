import fs from "node:fs/promises";
import path from "node:path";

const migrationDirectory = path.join(__dirname, "migrations");

async function main() {
  const name = process.argv[2]?.trim().toLowerCase();
  if (!name || !/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(name)) {
    throw new Error("Usage: npm run db:new-migration -- <lower_snake_case_name>");
  }
  const files = await fs.readdir(migrationDirectory);
  const latest = files.reduce((max, filename) => {
    const match = /^(\d{4})_[a-z0-9_]+\.sql$/i.exec(filename);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  if (latest >= 9_999) throw new Error("Migration number limit reached");
  const filename = `${String(latest + 1).padStart(4, "0")}_${name}.sql`;
  const target = path.join(migrationDirectory, filename);
  await fs.writeFile(target, "-- Add one SQL statement per block; separate statements with --> statement-breakpoint\n", { flag: "wx" });
  console.log(`Created ${target}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Could not create migration");
  process.exitCode = 1;
});
