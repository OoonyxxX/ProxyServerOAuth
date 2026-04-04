import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";

import markerRouter from "./markers_routes.js";
import authRouter from "./auth_routes.js";
import userRouter from "./users_routes.js";
import { pool } from "./db.js";

const app = express();
const PgStore = connectPgSimple(session);

const WEEK = 60 * 60 * 24 * 7;

app.use(express.json());

app.use(cors({
  origin: ["https://mapofthenorth.com", "https://www.mapofthenorth.com"],
  credentials: true,
}));

app.set("trust proxy", 1);

if (!process.env.SESSION_SECRET) {
  console.error("SESSION_SECRET is not set");
  process.exit(1);
}

app.use(session({
  name: "sotn.sid",
  store: new PgStore({
    pool,
    tableName: "session",
    createTableIfMissing: false,
    pruneSessionInterval: 60 * 15, // раз в 15 минут чистить истекшие
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "none",
    secure: true,
    maxAge: WEEK * 1000,
  },
}));

app.use("/api/markers", markerRouter);
app.use("/api/auth", authRouter);
app.use("/api/users", userRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});