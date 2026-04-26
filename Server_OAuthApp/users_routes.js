import express from "express";
import * as Users from "./users_repo.js";

const router = express.Router();

const VALID_ROLES = ["user", "editor", "moderator", "admin"];
const ROLE_POLICY = {
  moderator: ["user", "editor"],
  admin: ["user", "editor", "moderator", "admin"],
};
const VALID_OPTIONS = {
  METVisible: "boolean",
  customCursor: "boolean",
  instantFilter: "boolean",
  theme: ["White", "Dark", "Northern Lights", "Red Death"],
};

function isValidDisplayName(value) {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 32;
}

function parsePositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

router.patch("/me/name", async (req, res, next) => {
  try {
    const userId = req.session.user_id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { newName } = req.body;
    if (!isValidDisplayName(newName)) {
      return res.status(400).json({ error: "newName must be a non-empty string up to 32 chars" });
    }

    const row = await Users.updateUserName(userId, newName.trim());
    if (!row) return res.status(404).json({ error: "User profile not found" });

    req.session.display_name = row.display_name;
    res.json(row);
  } catch (err) {
    next(err);
  }
});

router.patch("/user/role", async (req, res, next) => {
  try {
    const meUserId = req.session.user_id;
    const meRole = req.session.role;
    const { userId: rawUserId, newRole } = req.body;

    if (!meUserId) return res.status(401).json({ error: "Unauthorized" });
    if (!(meRole in ROLE_POLICY)) return res.status(403).json({ error: "Forbidden" });

    const userId = parsePositiveInt(rawUserId);
    if (!userId) return res.status(400).json({ error: "userId must be a positive integer" });

    if (!VALID_ROLES.includes(newRole)) {
      return res.status(400).json({ error: "newRole must be one of: user, editor, moderator, admin" });
    }

    const oldRole = await Users.getUserRole(userId);
    if (!oldRole) return res.status(404).json({ error: "User profile not found" });

    const allowedRoles = ROLE_POLICY[meRole];
    if (!allowedRoles.includes(newRole) || !allowedRoles.includes(oldRole)) {
      return res.status(403).json({ error: "Role change not allowed" });
    }

    const row = await Users.updateUserRole(userId, newRole);
    if (!row) return res.status(404).json({ error: "User profile not found" });

    res.json(row);
  } catch (err) {
    next(err);
  }
});

router.patch("/user/options", async (req, res, next) => {
  try {
    const userId = req.session.user_id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const incomingOptions = req.body;

    const cleanOptions = {};
    for (const [key, value] of Object.entries(incomingOptions)) {
      const rule = VALID_OPTIONS[key];

      if (!rule) {
        return res.status(400).json({
          error: `Unknown option: ${key}`,
        });
      }

      if (Array.isArray(rule)) {
        if (!rule.includes(value)) {
          return res.status(400).json({
            error: `Invalid value for ${key}`,
          });
        }

        cleanOptions[key] = value;
        continue;
      }

      if (typeof value !== rule) {
        return res.status(400).json({
          error: `Invalid type for ${key}`,
        });
      }

      cleanOptions[key] = value;
    }

    const row = await Users.updateUserOptions(userId, JSON.stringify(cleanOptions));

    res.json(row);
  } catch (err) {
    next(err);
  }
});

router.get("/user/options", async (req, res, next) => {
  const userId = req.session.user_id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const row = await Users.getUserOptions(userId);

  const defaultOptions = {
    METVisible: true,
    customCursor: true,
    instantFilter: true,
    theme: "Northern Lights"
  };

  const dbOptions = row?.options ?? {};

  res.json({
    options: {
      ...defaultOptions,
      ...dbOptions,
    },
  });
});

export default router;
