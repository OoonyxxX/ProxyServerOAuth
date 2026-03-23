import { query } from "./db.js";

const VALID_ROLES = new Set(["user", "editor", "moderator", "admin"]);

export async function updateUserName(userId, newName) {
  const normalized = String(newName).trim();
  const sql = `
    UPDATE user_profiles
    SET display_name = $2
    WHERE user_id = $1
    RETURNING display_name;
  `;
  const { rows } = await query(sql, [userId, normalized]);
  return rows[0];
}

export async function updateUserRole(userId, newRole) {
  if (!VALID_ROLES.has(newRole)) {
    throw new Error("Invalid role value");
  }

  const sql = `
    UPDATE user_profiles
    SET role = $2
    WHERE user_id = $1
    RETURNING role;
  `;
  const { rows } = await query(sql, [userId, newRole]);
  return rows[0];
}

export async function getUserRole(userId) {
  const sql = `
    SELECT role FROM user_profiles
    WHERE user_id = $1
  `;
  const { rows } = await query(sql, [userId]);
  return rows[0]?.role ?? null;
}
