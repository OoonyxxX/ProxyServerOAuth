import express from "express";
import * as Auth from "./auth_repo.js";
import crypto from "crypto";
import axios from "axios";

const router = express.Router();

// Pre-prod checklist:
// TODO(P2): добавить rate limit для /google/callback.
// TODO(P2): решить, валидируем ли id_token или удаляем его из потока.
// TODO(P2): добавить аудит-лог успешного/неуспешного входа без утечки чувствительных данных.


// GET /api/auth/me
// Проверка сессии авторизации.
router.get('/me', (req, res) => {
  if (!req.session.user_id) {
    return res.status(401).json({ authorized: false });
  }

  const new_user_data = Auth.getAuthData(req.session.user_id)
  const new_role = new_user_data.role
  const new_display_name = new_user_data.display_name

  req.session.role = new_role;
  req.session.display_name = new_display_name;

  // 4. Явно сохраняем, потом отвечаем
  req.session.save((err) => {
    if (err) return next(err);
    return res.json({
      authorized: true,
      user_id: req.session.user_id,
      display_name: new_role,
      role: new_display_name,
      provider: req.session.provider,
      email: req.session.email
    });;
  });
});


// GET /api/auth/google/login
// Переадресация на Google OAuth.
router.get("/google/login", (req, res, next) => {
  const state = crypto.randomBytes(16).toString("hex");
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    state,
  });

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  req.session.save((err) => {
    if (err) return next(err);
    return res.redirect(googleAuthUrl);
  });
});

// GET /api/auth/google/callback
router.get("/google/callback", async (req, res, next) => {
  try {
    const code = String(req.query.code || "");
    const state = String(req.query.state || "");
    // TODO(P2): добавить ограничения на длину/формат code/state.

    if (!code) return res.status(400).json({ error: "code is required" });

    // 1) Проверяем state (CSRF защита)
    if (!state || state !== req.session.oauthState) {
      return res.status(400).json({ error: "Invalid state" });
    }
    delete req.session.oauthState;

    // 2) Меняем code на токены
    const tokenRes = await axios.post(
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const { access_token, id_token } = tokenRes.data;
    // TODO(P2): id_token извлекается, но пока не используется.
    if (!access_token) return res.status(400).json({ error: "No access_token returned" });

    // 3) Получаем профиль пользователя
    const userRes = await axios.get("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const profile = userRes.data;
    // TODO(P2): явно зафиксировать политику для email_verified и отсутствующего email.

    const googleSub = String(profile.sub || "");
    if (!googleSub) return res.status(400).json({ error: "No sub in userinfo" });

    // 4) upsert в БД и получить internal user_id
    const user = await Auth.getUID("Google", googleSub, profile.email || null);
    // 5) сохранить user_id в session
    req.session.regenerate((err) => {
      if (err) return next(err);

      // 3. Записываем уже новые auth-данные в новую сессию
      req.session.user_id = user.user_id;
      req.session.role = user.role;
      req.session.display_name = user.display_name;
      req.session.provider = user.provider;
      req.session.email = user.email;

      // 4. Явно сохраняем, потом отвечаем
      req.session.save((err) => {
        if (err) return next(err);
        return res.redirect("https://mapofthenorth.com");
      });
    });

  } catch (e) {
    next(e);
  }
});

export default router;
