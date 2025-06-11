const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const session = require('express-session');
dotenv.config();

const app = express();

const autoDeploy = false;
const jobQueue  = []; 
let processing = false;

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

async function processNextJob() {
  if (jobQueue.length === 0) {
    processing = false;
    return;
  }
  processing = true;
  const { username, accessToken, diff } = jobQueue.shift();
  const { added, updated, deleted } = diff;
  
  const owner = username;
  const repo  = 'ooonyxxx.github.io';
  const path  = 'markers.json';
  const branch = 'main';
  
  try {
    // 1) Читаем markers.json
	const get = await axios.get(
	  `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
	  { headers: { Authorization: `Bearer ${accessToken}` },
	    params: { ref: branch }
	  }
	);
    const sha     = get.data.sha;
    const content = Buffer.from(get.data.content, 'base64').toString();
    const markers = JSON.parse(content);
	
	const newMarkers = markers
      .filter(m => !deleted.includes(m.id))
      .map(m => {
        const u = updated.find(x => x.id === m.id);
        return u ? u : m;
      });
    newMarkers.push(...added);
	
    const newContent = Buffer.from(JSON.stringify(newMarkers, null, 2)).toString('base64');
    await axios.put(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
      { message: `Update markers by ${req.session.username}`,
        content: newContent,
        sha,
        branch
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
	
	
    if (autoDeploy) {
	  await axios.post(
		`https://api.github.com/repos/${owner}/${repo}/pages/builds`,
		{},
		{ headers: { Authorization: `Bearer ${accessToken}` } }
	  );
    }
  }
    catch (err) {
    console.error('Job processing failed:', err);
    // здесь можно логировать или уведомлять об ошибке
  }
  finally {
    // идём к следующей задаче, даже если эта упала
    processNextJob();
  }
}
  
// 1) Применить diff и закоммитить markers.json
app.post('/api/update-markers', (req, res) => {
  const token = req.session.accessToken;
  if (!token) return res.status(401).json({ error: 'Not authorized' });
  
  jobQueue.push({
    username:    req.session.username,
    accessToken: req.session.accessToken,
    diff:        req.body
  });
  
  if (!processing) processNextJob();
  
  
  // 5. Ответить клиенту
  res.json({ ok: true });
});

app.post('/api/trigger-deploy', async (req, res) => {
  const token = req.session.accessToken;
  const owner = req.session.username;
  if (!token) return res.status(401).json({ error: 'Not authorized' });

  try {
    await axios.post(
      `https://api.github.com/repos/${owner}/ooonyxxx.github.io/pages/builds`,
      {},
      { headers: { Authorization: `Bearer ${token}` } }
    );
    res.json({ ok: true, message: 'Deploy started' });
  }
  catch (err) {
    console.error('Deploy trigger failed:', err);
    res.status(500).json({ error: 'Deploy failed to start' });
  }
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