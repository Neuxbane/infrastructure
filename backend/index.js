const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const basicAuth = require('basic-auth');
const fs = require('fs');
const crypto = require('crypto');

// Create a .env with credentials if it doesn't exist, then load it.
const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  const pass = crypto.randomBytes(8).toString('hex'); // 16 hex chars
  const envContents = `AUTH_USER=root\nAUTH_PASS=${pass}\n`;
  try {
    fs.writeFileSync(envPath, envContents, { mode: 0o600 });
    console.log('.env created with AUTH_USER=root and generated AUTH_PASS:', pass);
  } catch (err) {
    console.error('Failed to create .env file:', err);
  }
}
require('dotenv').config();

const dockerRoutes = require('./routes/docker');
const nginxRoutes = require('./routes/nginx');
const sslRoutes = require('./routes/ssl');
const streamRoutes = require('./routes/streams');

const app = express();
const PORT = process.env.PORT || 4000;

// Basic Auth Credentials (from .env or defaults)
const AUTH_USER = process.env.AUTH_USER || 'root';
const AUTH_PASS = process.env.AUTH_PASS || crypto.randomBytes(8).toString('hex');

// Basic Authentication Middleware
const authenticate = (req, res, next) => {
    const user = basicAuth(req);
    
    if (!user || user.name !== AUTH_USER || user.pass !== AUTH_PASS) {
        res.set('WWW-Authenticate', 'Basic realm="Authorization Required"');
        return res.status(401).send('Authentication required');
    }
    
    next();
};

// CORS + Private Network Access support
app.use((req, res, next) => {
  const origin = req.get('Origin');
  if (origin) {
    // reflect origin to allow same-origin and proxied requests
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Access-Control-Request-Private-Network');

    // Browser preflight for Private Network Access will include
    // `Access-Control-Request-Private-Network: true` — respond accordingly
    if (req.method === 'OPTIONS') {
      if (req.headers['access-control-request-private-network']) {
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
      }
      return res.sendStatus(204);
    }
  }
  next();
});
app.use(bodyParser.json());

// API routes without authentication
app.get('/api/health', (req, res) => {
    res.json({ status: 'up' });
});

app.use('/api/docker', dockerRoutes);
app.use('/api/nginx', nginxRoutes);
app.use('/api/ssl', sslRoutes);
app.use('/api/streams', streamRoutes);

// Serve frontend static files with authentication
app.use(authenticate);
app.use(express.static(path.join(__dirname, 'frontend', 'dist')));

// Handle client-side routing - serve index.html for all non-API routes
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'dist', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Backend server running on port ${PORT}`);
});
