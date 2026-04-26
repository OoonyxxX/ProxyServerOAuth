import { pool } from "./db.js";

async function run() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const insertSql = `
      INSERT INTO markers_backups (backup_type, row_count, data, meta)
      SELECT
        'daily_snapshot',
        COUNT(*)::int,
        COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.id), '[]'::jsonb),
        jsonb_build_object(
          'table', 'markers',
          'source', 'render_cron'
        )
      FROM markers m
      RETURNING id, created_at, row_count;
    `;

    const result = await client.query(insertSql);
    const backup = result.rows[0];

    const cleanupSql = `
      DELETE FROM markers_backups
      WHERE backup_type = 'daily_snapshot'
        AND created_at < now() - interval '30 days'
    `;
    await client.query(cleanupSql);

    await client.query("COMMIT");

    console.log("[backup] ok", backup);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[backup] failed", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();