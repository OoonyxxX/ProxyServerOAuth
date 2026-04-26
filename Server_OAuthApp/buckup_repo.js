import { query } from "./db.js";

export async function createMarkersSnapshotBackup() {
  const sql = `
    INSERT INTO markers_backups (backup_type, row_count, data, meta)
    SELECT
      'daily_snapshot',
      COUNT(*)::int,
      COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.id), '[]'::jsonb),
      jsonb_build_object(
        'table', 'markers',
        'source', 'cron'
      )
    FROM markers m
    RETURNING id, created_at, row_count;
  `;

  const { rows } = await query(sql);
  return rows[0];
}

export async function createManualMarkersBackup(reason = "manual") {
  const sql = `
    INSERT INTO markers_backups (backup_type, row_count, data, meta)
    SELECT
      'manual_snapshot',
      COUNT(*)::int,
      COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.id), '[]'::jsonb),
      jsonb_build_object(
        'table', 'markers',
        'source', 'manual',
        'reason', $1
      )
    FROM markers m
    RETURNING id, created_at, row_count;
  `;

  const { rows } = await query(sql, [reason]);
  return rows[0];
}


export async function cleanupOldMarkerBackups() {
  const sql = `
    DELETE FROM markers_backups
    WHERE backup_type = 'daily_snapshot'
      AND created_at < now() - interval '30 days'
    RETURNING id;
  `;

  const { rowCount } = await query(sql);
  return rowCount;
}