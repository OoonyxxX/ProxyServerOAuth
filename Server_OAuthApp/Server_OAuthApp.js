const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const session = require('express-session');

dotenv.config();

const app = express();

app.use(cors({
  origin: [
    'https://ooonyxxx.github.io',
    'https://ooonyxxx.github.io.'
  ],
  credentials: true
}));

app.use(cookieParser());         

app.set('trust proxy', 1);

app.use(session({
  name: 'sotn.sid',
  secret: process.env.SESSION_SECRET || 'fallback-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
	domain: 'sotn2-auth-proxy.onrender.com'
  }
}));

app.use(express.json());        


const CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const REDIRECT_URI = 'https://sotn2-auth-proxy.onrender.com/auth/callback';

app.get('/auth/login', (req, res) => {
  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=read:user,public_repo`;
  res.redirect(githubAuthUrl);
});

app.get('/auth/callback', async (req, res) => {
  const code = req.query.code;

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


  const userRes = await axios.get('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    }
  });

  const username = userRes.data.login;

  //req.session.username = username;
  //res.redirect('https://ooonyxxx.github.io.');
  console.log("Received code:", req.query.code);
  console.log("Access token:", accessToken);
  console.log("GitHub user:", username);
  console.log("Session before saving:", req.session);
  req.session.username = username;
  req.session.accessToken = accessToken;
  console.log("Session after saving:", req.session);
  req.session.save(err => {
    if (err) console.error(err);
    res.redirect('https://ooonyxxx.github.io');
  });
  
});

app.get('/auth/me', (req, res) => {
  if (!req.session.username) {
    return res.status(401).json({ authorized: false });
  }
  res.json({
    authorized: true,
    username: req.session.username
  });
});

// 1) Применить diff и закоммитить markers.json
app.post('/api/update-markers', async (req, res) => {
  const token = req.session.accessToken;
  if (!token) return res.status(401).json({ error: 'Not authorized' });

  const { added, updated, deleted } = req.body;
  const owner = req.session.username;      // или жёстко 'OoonyxxX'
  const repo  = 'ooonyxxx.github.io';
  const path  = 'markers.json';
  const branch = 'main';

  // 1. Получить файл
  const get = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    { headers: { Authorization: `Bearer ${token}` },
      params: { ref: branch }
    }
  );
  const sha     = get.data.sha;
  const content = Buffer.from(get.data.content, 'base64').toString();
  const markers = JSON.parse(content);

  // 2. Применить diff
  let newMarkers = markers
    .filter(m => !deleted.includes(m.id))
    .map(m => {
      const u = updated.find(x => x.id === m.id);
      return u ? u : m;
    });
  newMarkers.push(...added);

  // 3. Закоммитить обратно
  const newContent = Buffer.from(JSON.stringify(newMarkers, null, 2)).toString('base64');
  await axios.put(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    { message: `Update markers by ${req.session.username}`,
      content: newContent,
      sha,
      branch
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  // 4. Запустить Pages-сборку
  await axios.post(
    `https://api.github.com/repos/${owner}/${repo}/pages/builds`,
    {},
    { headers: { Authorization: `Bearer ${token}` } }
  );

  // 5. Ответить клиенту
  res.json({ ok: true });
});

// 2) Проверить статус сборки
app.get('/api/deploy-status', async (req, res) => {
  const token = req.session.accessToken;
  const owner = req.session.username;
  const repo  = 'ooonyxxx.github.io';
  // Получим последний билд
  const builds = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/pages/builds`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const latest = builds.data[0];  // самый свежий
  res.json({ status: latest.status }); // 'queued' | 'building' | 'built' | 'errored'
});

const PORT = process.env.PORT;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});