import { query } from "./db.js";

export async function getMaintenanceMode() {
  const sql = `
      SELECT mode
      FROM app_state
      WHERE id = 1
  `;

  const { rows } = await query(sql, []);
  return rows[0];
}