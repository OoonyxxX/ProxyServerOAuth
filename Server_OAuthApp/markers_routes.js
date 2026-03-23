import express from "express";
import * as Markers from "./markers_repo.js";

const router = express.Router();

const EDIT_ROLES = new Set(["editor", "moderator", "admin"]);
const DELETE_ROLES = new Set(["moderator", "admin"]);
const MAX_MARKERS_BATCH = 500;
const MAX_COLLECTED_BATCH = 1000;

function hasSessionUser(req) {
  return Boolean(req.session?.user_id);
}

function requireRole(req, res, allowedRoles) {
  if (!hasSessionUser(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  if (!allowedRoles.has(req.session.role)) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

function isNonEmptyString(value, maxLen = 128) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLen;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidMarker(marker) {
  if (!marker || typeof marker !== "object" || Array.isArray(marker)) return false;
  if (!isNonEmptyString(marker.id, 128)) return false;
  if (!isNonEmptyString(marker.name, 128)) return false;
  if (!isNonEmptyString(marker.icon_id, 128)) return false;
  if (!isNonEmptyString(marker.reg_id, 128)) return false;
  if (!isFiniteNumber(marker.lat) || marker.lat < -90 || marker.lat > 90) return false;
  if (!isFiniteNumber(marker.lng) || marker.lng < -180 || marker.lng > 180) return false;

  if (marker.under_ground != null && typeof marker.under_ground !== "boolean") return false;
  if (marker.height != null && (!isFiniteNumber(marker.height) || marker.height < -10000 || marker.height > 10000)) return false;

  for (const channel of ["color_r", "color_g", "color_b"]) {
    if (marker[channel] != null) {
      if (!Number.isInteger(marker[channel]) || marker[channel] < 0 || marker[channel] > 255) return false;
    }
  }

  return true;
}

function parseTokenArray(rawTokens) {
  if (rawTokens == null) return null;
  const tokens = Array.isArray(rawTokens) ? rawTokens : [rawTokens];
  if (tokens.some((t) => typeof t !== "string" || t.length < 2 || !["+", "-"].includes(t[0]))) {
    return null;
  }
  return tokens;
}


// GET /api/markers/all
// Получение всех маркеров.
router.get("/all", async (req, res, next) => {
  try {
    const rows = await Markers.getAllMarkers();
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/markers/collected
// Получение всех собранных пользователем маркеров.
router.get("/collected", async (req, res, next) => {
  try {
    const userId = req.session.user_id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const rows = await Markers.getAllCollectedMarkers(userId);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/markers/filter
// Получение маркеров по фильтрам.
router.get("/filter", async (req, res, next) => {
  try {
    const { userIdToken } = req.query;
    if (userIdToken != null) {
      if (typeof userIdToken !== "string" || !/^[+-][0-9]+$/.test(userIdToken)) {
        return res.status(400).json({ error: "userIdToken must match +<id> or -<id>" });
      }
    }

    const rawUnderGround = req.query.underGround;
    let underGround = null;
    if (rawUnderGround != null) {
      if (rawUnderGround === "true") underGround = true;
      else if (rawUnderGround === "false") underGround = false;
      else return res.status(400).json({ error: "underGround must be true or false" });
    }

    const regionTokens = parseTokenArray(req.query.regionTokens);
    if (req.query.regionTokens != null && regionTokens == null) {
      return res.status(400).json({ error: "regionTokens must contain tokens like +<reg_id> or -<reg_id>" });
    }

    const iconTokens = parseTokenArray(req.query.iconTokens);
    if (req.query.iconTokens != null && iconTokens == null) {
      return res.status(400).json({ error: "iconTokens must contain tokens like +<icon_id> or -<icon_id>" });
    }

    if (userIdToken == null && regionTokens == null && iconTokens == null && underGround == null) {
      return res.status(400).json({ error: "At least one filter parameter is required" });
    }

    const rows = await Markers.getMarkersByFilter(userIdToken ?? null, regionTokens, iconTokens, underGround);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/markers/single
// Апсерт одного измененного или добавленного маркера.
router.post("/single", async (req, res, next) => {
  try {
    if (!requireRole(req, res, EDIT_ROLES)) return;

    const marker = req.body;
    if (!isValidMarker(marker)) {
      return res.status(400).json({ error: "Invalid marker payload" });
    }

    const row = await Markers.upsertMarker(marker);
    res.json(row);
  } catch (err) {
    next(err);
  }
});


// POST /api/markers/array
// Апсерт массива измененных или добавленных маркеров. Батч.
router.post("/array", async (req, res, next) => {
  try {
    if (!requireRole(req, res, EDIT_ROLES)) return;

    const markers = req.body;
    if (!Array.isArray(markers)) {
      return res.status(400).json({ error: "JSON array is required" });
    }
    if (markers.length === 0) {
      return res.status(400).json({ error: "markers array must not be empty" });
    }
    if (markers.length > MAX_MARKERS_BATCH) {
      return res.status(400).json({ error: `markers array too large (max ${MAX_MARKERS_BATCH})` });
    }
    if (markers.some((m) => !isValidMarker(m))) {
      return res.status(400).json({ error: "Invalid marker payload in array" });
    }

    const result = await Markers.upsertMarkersBatch(markers);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/markers/collected/single
// Помечает один маркер как собранный этим пользователем.
router.post("/collected/single", async (req, res, next) => {
  try {
    const userId = req.session.user_id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { markerId } = req.body;
    if (!isNonEmptyString(markerId, 128)) {
      return res.status(400).json({ error: "markerId is required" });
    }

    const rows = await Markers.setCollectedMarker(markerId, userId);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/markers/collected/array
// Помечает массив маркеров как собранные этим пользователем. Батч.
router.post("/collected/array", async (req, res, next) => {
  try {
    const userId = req.session.user_id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { markerIds } = req.body;
    if (!Array.isArray(markerIds)) {
      return res.status(400).json({ error: "markerIds must be an array" });
    }
    if (markerIds.length === 0) {
      return res.status(400).json({ error: "markerIds must not be empty" });
    }
    if (markerIds.length > MAX_COLLECTED_BATCH) {
      return res.status(400).json({ error: `markerIds array too large (max ${MAX_COLLECTED_BATCH})` });
    }
    if (markerIds.some((id) => !isNonEmptyString(id, 128))) {
      return res.status(400).json({ error: "markerIds must contain non-empty strings" });
    }

    const rows = await Markers.setCollectedMarkersBatch(markerIds, userId);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/markers/single
// Удаляет один маркер.
router.delete("/single", async (req, res, next) => {
  try {
    if (!requireRole(req, res, DELETE_ROLES)) return;

    const { markerId } = req.body;
    if (!isNonEmptyString(markerId, 128)) {
      return res.status(400).json({ error: "markerId is required" });
    }

    const deleted = await Markers.deleteMarker(markerId);
    if (!deleted) return res.status(404).json({ error: "not found" });
    res.json(deleted);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/markers/array
// Удаляет массив маркеров. Батч.
router.delete("/array", async (req, res, next) => {
  try {
    if (!requireRole(req, res, DELETE_ROLES)) return;

    const { markerIds } = req.body;
    if (!Array.isArray(markerIds)) {
      return res.status(400).json({ error: "markerIds must be an array" });
    }
    if (markerIds.length === 0) {
      return res.status(400).json({ error: "markerIds must not be empty" });
    }
    if (markerIds.length > MAX_MARKERS_BATCH) {
      return res.status(400).json({ error: `markerIds array too large (max ${MAX_MARKERS_BATCH})` });
    }
    if (markerIds.some((id) => !isNonEmptyString(id, 128))) {
      return res.status(400).json({ error: "markerIds must contain non-empty strings" });
    }

    const deleted = await Markers.deleteMarkersBatch(markerIds);
    res.json(deleted);
  } catch (e) {
    next(e);
  }
});

export default router;
