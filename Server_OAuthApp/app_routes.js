import express from "express";
import * as App from "./app_repo.js"

const router = express.Router();

const VALID_ROLES = ["admin"];


router.get("/status", async (req, res, next) => {
  try {
    const userRole = req.session.role;
    const row = await App.getMaintenanceMode();
    const maintenance = row.mode === 'maintenance' ? (VALID_ROLES.includes(userRole) ? 'admin_maintenance' : 'maintenance') : 'normal';
    res.json({ maintenance: maintenance });
  } catch (err) {
    next(err);
  }
});

export default router;
