import { query } from "./db.js";

export async function getUID(provider, providerUserId, email) {
  // TODO(P2): источник истины схемы сейчас ReadMe.txt; перед продом синхронизировать db/schema/*.sql с этой схемой.
  const sql = `
    WITH existing AS (
      SELECT user_id
      FROM user_identities
      WHERE provider = $1 AND provider_user_id = $2
    ),
    new_user AS (
      INSERT INTO users (last_login_at)
      SELECT NULL
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
      SELECT id, $1, $2, $3 FROM uid
      ON CONFLICT (provider, provider_user_id)
      DO UPDATE SET email = COALESCE(EXCLUDED.email, user_identities.email)
      RETURNING user_id
    ),
    touch_user AS (
      UPDATE users u
      SET last_login_at = now()
      WHERE u.id = (SELECT user_id FROM ins_identity)
      RETURNING u.id
    ),
    ensure_profile AS (
      INSERT INTO user_profiles (user_id, display_name, role)
      SELECT (SELECT user_id FROM ins_identity), NULL, 'user'
      WHERE NOT EXISTS (
        SELECT 1 FROM user_profiles p
        WHERE p.user_id = (SELECT user_id FROM ins_identity)
      )
      RETURNING user_id
    )
    SELECT
      u.id AS user_id,
      p.display_name,
      p.role
    FROM users u
    JOIN user_profiles p ON p.user_id = u.id
    WHERE u.id = (SELECT user_id FROM ins_identity);
  `;

  const { rows } = await query(sql, [provider, providerUserId, email]);
  // TODO(P2): для pre-prod добавить более явную диагностическую ошибку, если rows[0] отсутствует.
  return rows[0];
}
