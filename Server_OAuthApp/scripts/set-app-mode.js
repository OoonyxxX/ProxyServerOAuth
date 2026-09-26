// node scripts/set-app-mode.js maintenance
// node scripts/set-app-mode.js normal

import pg from "pg";
const { Pool } = pg;

function buildDatabaseUrl(url) {
  if (!url) throw new Error("DATABASE_URL is not set");
  if (!url.includes("sslmode=")) {
    url += (url.includes("?") ? "&" : "?") + "sslmode=require";
  }
  return url;
}

const pool = new Pool({
  connectionString: buildDatabaseUrl(process.env.DATABASE_URL)
});

async function main() {
    try {
        const mode = process.argv[2];

        if (!["normal", "maintenance"].includes(mode)) {
            console.error(
                "Usage: node scripts/set-app-mode.js normal|maintenance"
            );

            process.exitCode = 1;
            return;
        }

        await pool.query(
            `
            UPDATE app_state
            SET mode = $1
            WHERE id = 1
            `,
            [mode]
        );

        console.log(`App mode changed to: ${mode}`);

    } catch (error) {
        console.error("Failed to change app mode:", error);
        process.exitCode = 1;

    } finally {
        await pool.end();
    }
}

main();