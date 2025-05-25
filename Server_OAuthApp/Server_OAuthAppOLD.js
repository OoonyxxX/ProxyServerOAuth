const express = require('express'); // веб-сервер (API)
const axios = require('axios');     // HTTP-запросы к GitHub
const dotenv = require('dotenv');   // читаем .env
const cors = require('cors');       // разрешаем кросс-доменные запросы
const cookieParser = require('cookie-parser'); // читаем cookies

dotenv.config(); // загружаем переменные из .env

const app = express(); // создаём веб-приложение (сервер)

app.use(cors({
  origin: 'https://ooonyxxx.github.io.', // разрешённый клиент
  credentials: true                // разрешаем cookies
}));
app.use(cookieParser());          // используем cookies
app.use(express.json());          // сервер принимает JSON-тело

// Получаем переменные из .env
const CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:8000/auth/callback';

let loggedInUsers = {}; // пока что простая память (в будущем — JWT или БД)

// Редирект на GitHub авторизацию
app.get('/auth/login', (req, res) => {
  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=read:user`;
  res.redirect(githubAuthUrl);
});

// Callback от GitHub после входа
app.get('/auth/callback', async (req, res) => {
  const code = req.query.code;

  // Меняем code на access_token
  const tokenRes = await axios.post(
    'https://github.com/login/oauth/access_token',
    {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code
    },
    {
      headers: { Accept: 'application/json' }
    }
  );

  const accessToken = tokenRes.data.access_token;

  // Получаем данные пользователя
  const userRes = await axios.get('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    }
  });

  const username = userRes.data.login;

  // Храним в объекте
  loggedInUsers[username] = {
    username,
    token: accessToken
  };

  // Сохраняем имя пользователя в cookie
  res.cookie('gh_user', username, { httpOnly: false });

  // Возвращаем пользователя на карту
  res.redirect('https://ooonyxxx.github.io.'); // ← клиентская часть
});

// Проверка авторизации
app.get('/auth/me', (req, res) => {
  const username = req.cookies.gh_user;
  if (!username || !loggedInUsers[username]) {
    return res.status(401).json({ authorized: false });
  }

  res.json({
    authorized: true,
    username
  });
});

// Запуск сервера
app.listen(8000, () => {
  console.log('OAuth Proxy Server running on http://localhost:8000');
});
