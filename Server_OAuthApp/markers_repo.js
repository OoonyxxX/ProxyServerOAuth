import { query, tx } from "./db.js";

const MAX_MARKERS_BATCH = 500;
const MAX_COLLECTED_BATCH = 1000;

function uniqueNonEmptyStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export async function getAllMarkers(userId) {
  const sql = `
    SELECT
      m.*,
      c.marker_id IS NOT NULL AS is_collected,
      COALESCE(content_data.content, '{}'::jsonb) AS content
    FROM markers m
    LEFT JOIN user_collected_markers c 
      ON m.id = c.marker_id AND c.user_id = $1
    LEFT JOIN LATERAL (
      SELECT jsonb_object_agg(
        grouped.content_type,
        grouped.content_ids
      ) AS content
      FROM (
        SELECT
          mc.content_type,
          jsonb_agg(mc.content_id ORDER BY mc.content_id) AS content_ids
        FROM marker_content mc
        WHERE mc.marker_id = m.id
        GROUP BY mc.content_type
      ) grouped
    ) content_data ON true

    ORDER BY m.id;
  `;
  const { rows } = await query(sql, [userId]);
  return rows;
}


export async function getMarkersByFilter(userIdToken, regionTokens, iconTokens, contentTypesTokens, contentIdTokens, underGround) {
  const sql = `
    WITH
    user_token AS (
      SELECT
        CASE WHEN $1::text ~ '^[+-][0-9]+$' THEN left($1::text, 1) END AS tok,
        CASE WHEN $1::text ~ '^[+-][0-9]+$' THEN substring($1::text from 2)::bigint END AS uid
    ),
    user_markers AS (
      SELECT ucm.marker_id AS id
      FROM user_collected_markers ucm
      JOIN user_token u ON u.uid IS NOT NULL AND ucm.user_id = u.uid
    ),
    reg_sets AS (
      SELECT
        array_agg(substring(tok from 2)) FILTER (WHERE left(tok, 1) = '+') AS reg_in,
        array_agg(substring(tok from 2)) FILTER (WHERE left(tok, 1) = '-') AS reg_out
      FROM unnest(coalesce($2::text[], '{}'::text[])) AS tok
    ),
    icon_sets AS (
      SELECT
        array_agg(substring(tok from 2)) FILTER (WHERE left(tok, 1) = '+') AS icon_in,
        array_agg(substring(tok from 2)) FILTER (WHERE left(tok, 1) = '-') AS icon_out
      FROM unnest(coalesce($3::text[], '{}'::text[])) AS tok
    ),
    with_content_types AS (
      SELECT 
        array_agg(substring(tok from 2)) FILTER (WHERE left(tok, 1) = '+') AS type_in,
        array_agg(substring(tok from 2)) FILTER (WHERE left(tok, 1) = '-') AS type_out
      FROM unnest(coalesce($4::text[], '{}'::text[])) AS tok
    ),
    with_content_ids AS (
      SELECT 
        array_agg(substring(tok from 2)) FILTER (WHERE left(tok, 1) = '+') AS content_in,
        array_agg(substring(tok from 2)) FILTER (WHERE left(tok, 1) = '-') AS content_out
      FROM unnest(coalesce($5::text[], '{}'::text[])) AS tok
    ),
    markers_with_flag AS (
      SELECT m.*, (um.id IS NOT NULL) AS is_collected
      FROM markers m
      LEFT JOIN user_markers um ON um.id = m.id
    )
    SELECT COALESCE(array_agg(m.id ORDER BY m.id), '{}') AS ids
    FROM markers_with_flag m
    CROSS JOIN user_token u
    CROSS JOIN reg_sets r
    CROSS JOIN icon_sets i
    CROSS JOIN with_content_types ct
    CROSS JOIN with_content_ids ci
    WHERE
      (u.uid IS NULL OR (u.tok = '+' AND m.is_collected) OR (u.tok = '-' AND NOT m.is_collected))
      AND (coalesce(cardinality(r.reg_in), 0) = 0 OR m.reg_id = ANY(r.reg_in))
      AND (coalesce(cardinality(r.reg_out), 0) = 0 OR m.reg_id <> ALL(r.reg_out))
      AND (coalesce(cardinality(i.icon_in), 0) = 0 OR m.icon_id = ANY(i.icon_in))
      AND (coalesce(cardinality(i.icon_out), 0) = 0 OR m.icon_id <> ALL(i.icon_out))
      AND (coalesce(cardinality(ct.type_in), 0) = 0 OR EXISTS (
            SELECT 1
            FROM marker_content mc
            WHERE mc.marker_id = m.id AND mc.content_type = ANY(ct.type_in)
          ))
      AND (coalesce(cardinality(ct.type_out), 0) = 0 OR NOT EXISTS (
            SELECT 1
            FROM marker_content mc
            WHERE mc.marker_id = m.id AND mc.content_type = ANY(ct.type_out)
          ))
      AND (coalesce(cardinality(ci.content_in), 0) = 0 OR EXISTS (
            SELECT 1
            FROM marker_content mc
            WHERE mc.marker_id = m.id AND mc.content_id = ANY(ci.content_in)
          ))
      AND (coalesce(cardinality(ci.content_out), 0) = 0 OR NOT EXISTS (
            SELECT 1
            FROM marker_content mc
            WHERE mc.marker_id = m.id AND mc.content_id = ANY(ci.content_out)
          ))
      AND ($6::boolean IS NULL OR m.under_ground = $6::boolean)
  `;

  const { rows } = await query(sql, [userIdToken, regionTokens, iconTokens, contentTypesTokens, contentIdTokens, underGround]);
  return rows[0].ids;
}

export async function upsertMarker(m) {
  const sql = `
    WITH new_marker AS (
      insert into markers (
        id, name, description, icon_id, lat, lng, reg_id, under_ground, height,
        color_r, color_g, color_b, is_collectible, uaid
      )
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      on conflict (id) do update set
        name = excluded.name,
        description = excluded.description,
        icon_id = excluded.icon_id,
        lat = excluded.lat,
        lng = excluded.lng,
        reg_id = excluded.reg_id,
        under_ground = excluded.under_ground,
        height = excluded.height,
        color_r = excluded.color_r,
        color_g = excluded.color_g,
        color_b = excluded.color_b,
        is_collectible = excluded.is_collectible,
        updated_at = now()
        uaid = excluded.uaid
      returning *
    ),
    deleted_content AS (
      DELETE FROM marker_content
      WHERE marker_id = $1
      RETURNING marker_id
    ),
    new_marker_content as (
      insert into marker_content (
        marker_id,
        content_type,
        content_id
      )
      select
        $1,
        content_entry.key,
        content_item.value
      from jsonb_each($14::jsonb) AS content_entry(key, value)
      cross join lateral jsonb_array_elements_text(
        content_entry.value
      ) as content_item(value)
      on conflict (marker_id, content_type, content_id)
      do nothing
      returning content_type, content_id
    )
    SELECT
      nm.*,
      COALESCE((
          SELECT jsonb_object_agg(
            grouped.content_type,
            grouped.content_ids
          )
          FROM (
            SELECT nmc.content_type, jsonb_agg(nmc.content_id ORDER BY nmc.content_id) AS content_ids
            FROM new_marker_content nmc
            GROUP BY nmc.content_type
          ) grouped
        ),
        '{}'::jsonb
      ) AS content
    FROM new_marker nm;
  `;

  const params = [
    m.id,
    m.name,
    m.description ?? null,
    m.icon_id,
    m.lat,
    m.lng,
    m.reg_id,
    m.under_ground ?? false,
    m.height ?? 0,
    m.color_r ?? 255,
    m.color_g ?? 255,
    m.color_b ?? 255,
    m.is_collectible,
    m.content,
    m.uaid
  ];

  const { rows } = await query(sql, params);
  return rows[0];
}

export async function upsertMarkersBatch(markers) {
  if (!markers.length) return { rows: [], count: 0 };

  if (markers.length > MAX_MARKERS_BATCH) {
    throw new Error(`Batch size exceeds limit (${MAX_MARKERS_BATCH})`);
  }

  return tx(async (client) => {
    const markerCols = [
      "id",
      "name",
      "description",
      "icon_id",
      "lat",
      "lng",
      "reg_id",
      "under_ground",
      "height",
      "color_r",
      "color_g",
      "color_b",
      "is_collectible",
      "uaid"
    ];

    const paramsPerMarker = markerCols.length + 1;

    const values = [];
    const markerRows = [];
    const contentRows = [];

    markers.forEach((m, i) => {
      const base = i * paramsPerMarker;

      values.push(
        m.id,
        m.name,
        m.description ?? null,
        m.icon_id,
        m.lat,
        m.lng,
        m.reg_id,
        m.under_ground ?? false,
        m.height ?? 0,
        m.color_r ?? 255,
        m.color_g ?? 255,
        m.color_b ?? 255,
        m.is_collectible,
        m.content,
        m.uaid
      );

      const markerPlaceholders = markerCols
        .map((_, columnIndex) => `$${base + columnIndex + 1}`)
        .join(", ");

      markerRows.push(`(${markerPlaceholders})`);

      const idPlaceholder = `$${base + 1}`;
      const contentPlaceholder = `$${base + paramsPerMarker}`;

      contentRows.push(
        `(${idPlaceholder}, ${contentPlaceholder}::jsonb)`
      );
    });

    const sql = `
      WITH input_content(marker_id, content) AS (
        VALUES
          ${contentRows.join(",\n")}
      ),

      new_marker AS (
        INSERT INTO markers (
          ${markerCols.join(", ")}
        )
        VALUES
          ${markerRows.join(",\n")}
        ON CONFLICT (id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          icon_id = excluded.icon_id,
          lat = excluded.lat,
          lng = excluded.lng,
          reg_id = excluded.reg_id,
          under_ground = excluded.under_ground,
          height = excluded.height,
          color_r = excluded.color_r,
          color_g = excluded.color_g,
          color_b = excluded.color_b,
          is_collectible = excluded.is_collectible,
          updated_at = now(),
          uaid = excluded.uaid
        RETURNING *
      ),

      deleted_content AS (
        DELETE FROM marker_content mc
        USING input_content input
        WHERE mc.marker_id = input.marker_id
        RETURNING mc.marker_id
      ),

      new_marker_content AS (
        INSERT INTO marker_content (
          marker_id,
          content_type,
          content_id
        )
        SELECT
          input.marker_id,
          content_entry.key,
          content_item.value
        FROM input_content input

        CROSS JOIN LATERAL jsonb_each(
          input.content
        ) AS content_entry(key, value)

        CROSS JOIN LATERAL jsonb_array_elements_text(
          content_entry.value
        ) AS content_item(value)

        ON CONFLICT (
          marker_id,
          content_type,
          content_id
        )
        DO NOTHING

        RETURNING
          marker_id,
          content_type,
          content_id
      )

      SELECT
        nm.*,
        COALESCE(
          (
            SELECT jsonb_object_agg(
              grouped.content_type,
              grouped.content_ids
            )
            FROM (
              SELECT
                nmc.content_type,
                jsonb_agg(
                  nmc.content_id
                  ORDER BY nmc.content_id
                ) AS content_ids
              FROM new_marker_content nmc
              WHERE nmc.marker_id = nm.id
              GROUP BY nmc.content_type
            ) grouped
          ),
          '{}'::jsonb
        ) AS content

      FROM new_marker nm;
    `;

    console.log("Parameter $15:", values[14]);
    console.log("All parameters:", values);

    const { rows } = await client.query(sql, values);

    return {
      rows,
      count: rows.length
    };
  });
}

export async function deleteMarker(markerId) {
  const sql = `delete from markers where id = $1 returning id;`;
  const { rows } = await query(sql, [markerId]);
  return rows[0] ?? null;
}

export async function deleteMarkersBatch(markerIds) {
  if (!markerIds.length) return { rows: [], count: 0 };

  const uniqueIds = uniqueNonEmptyStrings(markerIds);
  if (!uniqueIds.length) return { rows: [], count: 0 };
  if (uniqueIds.length > MAX_MARKERS_BATCH) {
    throw new Error(`Batch size exceeds limit (${MAX_MARKERS_BATCH})`);
  }

  const sql = `
    delete from markers
    where id = any($1::text[])
    returning id;
  `;

  const { rows } = await query(sql, [uniqueIds]);
  return { rows, count: rows.length };
}

export async function getAllCollectedMarkers(userId) {
  const sql = `
    SELECT marker_id AS id
    FROM user_collected_markers
    WHERE user_id = $1
    ORDER BY collected_at DESC;
  `;
  const { rows } = await query(sql, [userId]);
  return rows;
}

export async function setCollectedMarker(markerId, userId) {
  const sql = `
    WITH deleted AS (
      DELETE FROM user_collected_markers
      WHERE marker_id = $1 AND user_id = $2
      RETURNING marker_id
    ),
    inserted AS (
      INSERT INTO user_collected_markers (marker_id, user_id)
      SELECT $1, $2
      WHERE NOT EXISTS (SELECT 1 FROM deleted)
      RETURNING marker_id
    )
    SELECT 
      (SELECT COUNT(*) FROM inserted) AS inserted_count,
      (SELECT COUNT(*) FROM deleted) AS deleted_count;
  `;

  const { rows } = await query(sql, [markerId, userId]);
  return rows[0];
}

export async function addCollectedMarkersBatch(markerIds, userId) {
  if (!markerIds.length) return { rows: [], count: 0 };

  const uniqueIds = uniqueNonEmptyStrings(markerIds);
  if (!uniqueIds.length) return { rows: [], count: 0 };
  if (uniqueIds.length > MAX_COLLECTED_BATCH) {
    throw new Error(`Batch size exceeds limit (${MAX_COLLECTED_BATCH})`);
  }

  const sql = `
    INSERT INTO user_collected_markers (marker_id, user_id)
    SELECT UNNEST($1::text[]), $2
    ON CONFLICT DO NOTHING
    RETURNING marker_id;
  `;

  const { rows } = await query(sql, [uniqueIds, userId]);
  return { count: rows.length };
}
