/**
 * Example browser client for current backend routes.
 *
 * IMPORTANT:
 * 1) Backend CORS currently allows only:
 *    - https://mapofthenorth.com
 *    - https://www.mapofthenorth.com
 * 2) Session cookie is Secure + SameSite=None on backend, so use HTTPS.
 * 3) For session-protected routes, user must complete OAuth login first.
 */

// Adjust to your backend origin in production/development.
export const API_BASE = "https://your-backend-domain.com";

// Known backend limits and role policy copied from current routes.
const MAX_MARKERS_BATCH = 500;
const MAX_COLLECTED_BATCH = 1000;
const VALID_ROLES = ["user", "editor", "moderator", "admin"];
const EDIT_ROLES_NOTE = "editor|moderator|admin";
const DELETE_ROLES_NOTE = "moderator|admin";

/**
 * Unified request helper.
 *
 * Nuance:
 * - We always send credentials: "include" because backend auth is session-cookie based.
 * - Even GET /api/markers/all can safely use include; browser decides whether cookie exists.
 */
export async function apiRequest(path, { method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const message =
      (isJson && payload && typeof payload === "object" && payload.error) ||
      `Request failed: ${response.status}`;

    const error = new Error(String(message));
    error.status = response.status;
    error.payload = payload;

    // Typical backend statuses:
    // 400 - validation error
    // 401 - no valid session (not logged in)
    // 403 - role is not enough for route
    // 404 - entity not found
    // 500 - unexpected server error
    throw error;
  }

  return payload;
}

/**
 * AUTH ROUTES
 */

/**
 * GET /api/auth/google/login
 *
 * Nuance:
 * - Must be opened via browser navigation (redirect flow), not via fetch.
 * - Backend generates OAuth state in session, then redirects to Google.
 */
export function startGoogleLogin() {
  window.location.assign(`${API_BASE}/api/auth/google/login`);
}

/**
 * GET /api/auth/google/callback
 *
 * Nuance:
 * - This route is called by Google redirect automatically after user consent.
 * - Do NOT call it manually from frontend code.
 * - On success backend writes session (user_id/display_name/role) and redirects to site root.
 */
export const GOOGLE_CALLBACK_NOTE =
  "Handled by OAuth redirect; do not call from client manually.";

/**
 * USERS ROUTES
 */

/**
 * PATCH /api/users/me/name
 *
 * Required body:
 * - newName: string (trimmed length 1..64)
 *
 * Auth:
 * - Requires valid session (401 if not logged in).
 */
export function updateMyName(newName) {
  return apiRequest("/api/users/me/name", {
    method: "PATCH",
    body: { newName },
  });
}

/**
 * PATCH /api/users/user/role
 *
 * Required body:
 * - userId: positive integer
 * - newRole: one of user|editor|moderator|admin
 *
 * Auth/roles:
 * - Requires session.
 * - moderator can change only user/editor
 * - admin can change user/editor/moderator/admin
 * - other roles get 403
 */
export function updateUserRole(userId, newRole) {
  if (!VALID_ROLES.includes(newRole)) {
    throw new Error(`newRole must be one of: ${VALID_ROLES.join(", ")}`);
  }

  return apiRequest("/api/users/user/role", {
    method: "PATCH",
    body: { userId, newRole },
  });
}

/**
 * MARKERS ROUTES
 */

/**
 * GET /api/markers/all
 *
 * Auth:
 * - Public in current backend (no session required).
 */
export function getAllMarkers() {
  return apiRequest("/api/markers/all");
}

/**
 * GET /api/markers/collected
 *
 * Auth:
 * - Requires session (401 if not logged in).
 *
 * Returns:
 * - Array of objects with collected marker ids: [{ id: "marker_1" }, ...]
 */
export function getCollectedMarkers() {
  return apiRequest("/api/markers/collected");
}

/**
 * GET /api/markers/filter
 *
 * At least one filter is required, otherwise backend returns 400.
 *
 * Query params:
 * - userIdToken: "+<id>" or "-<id>" (example: "+123")
 * - underGround: true|false
 * - regionTokens: array of "+<reg_id>" / "-<reg_id>"
 * - iconTokens: array of "+<icon_id>" / "-<icon_id>"
 *
 * Nuance:
 * - regionTokens and iconTokens are repeated query params:
 *   ?regionTokens=+r1&regionTokens=-r2
 */
export function getFilteredMarkers({
  userIdToken,
  underGround,
  regionTokens,
  iconTokens,
} = {}) {
  const params = new URLSearchParams();

  if (userIdToken !== undefined && userIdToken !== null) {
    params.append("userIdToken", String(userIdToken));
  }

  if (typeof underGround === "boolean") {
    params.append("underGround", String(underGround));
  }

  for (const token of normalizeTokenArray(regionTokens)) {
    params.append("regionTokens", token);
  }
  for (const token of normalizeTokenArray(iconTokens)) {
    params.append("iconTokens", token);
  }

  return apiRequest(`/api/markers/filter?${params.toString()}`);
}

/**
 * POST /api/markers/single
 *
 * Auth/roles:
 * - Requires role: editor|moderator|admin.
 *
 * Required marker fields:
 * - id, name, icon_id, reg_id: non-empty string (<= 128)
 * - lat: number in [-90, 90]
 * - lng: number in [-180, 180]
 *
 * Optional fields:
 * - description: string|null
 * - under_ground: boolean
 * - height: number in [-10000, 10000]
 * - color_r/color_g/color_b: integer in [0, 255]
 */
export function upsertMarker(marker) {
  return apiRequest("/api/markers/single", {
    method: "POST",
    body: marker,
  });
}

/**
 * POST /api/markers/array
 *
 * Auth/roles:
 * - Requires role: editor|moderator|admin.
 *
 * Required body:
 * - Non-empty array of valid marker objects.
 * - Max array size is 500.
 */
export function upsertMarkers(markers) {
  if (!Array.isArray(markers)) {
    throw new Error("markers must be an array");
  }
  if (markers.length === 0) {
    throw new Error("markers array must not be empty");
  }
  if (markers.length > MAX_MARKERS_BATCH) {
    throw new Error(`markers array too large (max ${MAX_MARKERS_BATCH})`);
  }

  return apiRequest("/api/markers/array", {
    method: "POST",
    body: markers,
  });
}

/**
 * POST /api/markers/collected/single
 *
 * Auth:
 * - Requires session.
 *
 * Required body:
 * - markerId: non-empty string (<= 128)
 */
export function setCollectedMarker(markerId) {
  return apiRequest("/api/markers/collected/single", {
    method: "POST",
    body: { markerId },
  });
}

/**
 * POST /api/markers/collected/array
 *
 * Auth:
 * - Requires session.
 *
 * Required body:
 * - markerIds: non-empty string array
 * - Max size: 1000
 */
export function setCollectedMarkers(markerIds) {
  if (!Array.isArray(markerIds)) {
    throw new Error("markerIds must be an array");
  }
  if (markerIds.length === 0) {
    throw new Error("markerIds must not be empty");
  }
  if (markerIds.length > MAX_COLLECTED_BATCH) {
    throw new Error(`markerIds array too large (max ${MAX_COLLECTED_BATCH})`);
  }

  return apiRequest("/api/markers/collected/array", {
    method: "POST",
    body: { markerIds },
  });
}

/**
 * DELETE /api/markers/single
 *
 * Auth/roles:
 * - Requires role: moderator|admin.
 *
 * Required body:
 * - markerId: non-empty string
 */
export function deleteMarker(markerId) {
  return apiRequest("/api/markers/single", {
    method: "DELETE",
    body: { markerId },
  });
}

/**
 * DELETE /api/markers/array
 *
 * Auth/roles:
 * - Requires role: moderator|admin.
 *
 * Required body:
 * - markerIds: non-empty string array
 * - Max size: 500
 */
export function deleteMarkers(markerIds) {
  if (!Array.isArray(markerIds)) {
    throw new Error("markerIds must be an array");
  }
  if (markerIds.length === 0) {
    throw new Error("markerIds must not be empty");
  }
  if (markerIds.length > MAX_MARKERS_BATCH) {
    throw new Error(`markerIds array too large (max ${MAX_MARKERS_BATCH})`);
  }

  return apiRequest("/api/markers/array", {
    method: "DELETE",
    body: { markerIds },
  });
}

/**
 * Helper notes exported for easy display in UI/docs.
 */
export const CLIENT_NOTES = {
  corsAllowedOrigins: [
    "https://mapofthenorth.com",
    "https://www.mapofthenorth.com",
  ],
  sessionRequirements: [
    "Use HTTPS",
    "Use credentials: include",
    "Complete OAuth flow before protected routes",
  ],
  roleHints: {
    editMarkers: EDIT_ROLES_NOTE,
    deleteMarkers: DELETE_ROLES_NOTE,
  },
};

function normalizeTokenArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

