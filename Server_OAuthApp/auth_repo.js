import { query } from "./db.js";

export async function getUID(provider, providerUserId, email) {
  // TODO(P2): источник истины схемы сейчас ReadMe.txt; перед продом синхронизировать db/schema/*.sql с этой схемой.
  const sql = `
    WITH existing AS (
      SELECT ui.user_id, up.display_name, up.role
      FROM user_identities ui
      LEFT JOIN user_profiles up ON up.user_id = ui.user_id
      WHERE ui.provider = $1 AND ui.provider_user_id = $2
    ),
    new_user AS (
      INSERT INTO users (last_login_at)
      SELECT now()
      WHERE NOT EXISTS (SELECT 1 FROM existing)
      RETURNING id
    ),
    uid AS (
      SELECT user_id AS id FROM existing
      UNION ALL
      SELECT id FROM new_user
    ),
    ins_identity AS (
      INSERT INTO user_identities (user_id, provider, provider_user_id, email)
      SELECT id, $1, $2, $3 
      FROM uid
      ON CONFLICT (provider, provider_user_id)
      DO UPDATE SET email = COALESCE(EXCLUDED.email, user_identities.email)
      RETURNING user_id
    ),
    touch_existing_user AS (
      UPDATE users
      SET last_login_at = now()
      WHERE id IN (SELECT user_id FROM existing)
      RETURNING id
    ),
    ensure_profile AS (
      INSERT INTO user_profiles (user_id, display_name, role)
      SELECT i.user_id, NULL, 'user'
      FROM ins_identity i
      WHERE NOT EXISTS (
        SELECT 1
        FROM existing e
        WHERE e.user_id = i.user_id
      )
      RETURNING user_id, display_name, role
    )
    SELECT
      i.user_id,
      COALESCE(ep.display_name, e.display_name) AS display_name,
      COALESCE(ep.role, e.role, 'user') AS role
    FROM ins_identity i
    LEFT JOIN ensure_profile ep ON ep.user_id = i.user_id
    LEFT JOIN existing e ON e.user_id = i.user_id;
  `;

  const { rows } = await query(sql, [provider, providerUserId, email]);
  // TODO(P2): для pre-prod добавить более явную диагностическую ошибку, если rows[0] отсутствует.
  return rows[0];
}
