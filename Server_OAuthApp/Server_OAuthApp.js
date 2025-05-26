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

app.use(session({
  name: 'sotn.sid',
  secret: process.env.SESSION_SECRET || 'fallback-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'none',
    secure: true
  }
}));

app.use(express.json());        


const CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const REDIRECT_URI = 'https://sotn2-auth-proxy.onrender.com/auth/callback';

app.get('/auth/login', (req, res) => {
  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=read:user`;
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
  console.log("Session after saving:", req.session);
  req.session.save(() => {
  res.send(`
    <html>
      <body>
        <script>
          window.location.href = "https://ooonyxxx.github.io";
        </script>
      </body>
    </html>
  `);
});
  
});

console.log(req.headers.origin, res.getHeader('Access-Control-Allow-Origin1'));

app.get('/auth/me', (req, res) => {
  if (!req.session.username) {
    return res.status(401).json({ authorized: false });
  }

  res.json({
    authorized: true,
    username: req.session.username
  });
});

console.log(req.headers.origin, res.getHeader('Access-Control-Allow-Origin2'));

const PORT = process.env.PORT;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});