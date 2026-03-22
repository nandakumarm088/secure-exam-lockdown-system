// lockdown-server/server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const http = require('http'); // Needed to attach WebSocket to same server
const { authenticateToken } = require('./auth/jwtMiddleware');
const { setupWebSocket } = require('./websocket');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Railway's proxy
app.set('trust proxy', 60);

// Rate limiter
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,    // 1 minute
  max: 60,                    // limit each IP to 60 requests per minute
  standardHeaders: true,      // Return rate limit info in the headers
  legacyHeaders: false,       
  message: { success: false, message: 'Too many requests! Please wait a minute and try again.' }
});

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(helmet());
app.use(limiter);

// --- Serve static files from the 'public' directory ---
app.use(express.static(path.join(__dirname, 'public')));

// --- (Optional) Pretty URL for /admin/setup-password (no .html) ---
app.get('/admin/setup-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'setup-password.html'));
});

// --- API Routes ---
app.use('/api', require('./routes/login'));
app.use('/api', require('./routes/labs'));
app.use('/api/clients', require('./routes/clients')); // open
app.use('/api', require('./routes/exam'));
app.use('/api', require('./routes/admins'));
app.use('/api', require('./routes/pin'));

// Health check
app.get('/', (_, res) => res.sendStatus(204));

// Error handler for catch-all server errors/logging
app.use((err, req, res, next) => {
  console.error(err.stack); // Logs error to Railway logs
  res.status(err.status || 500).json({ message: err.message || 'Internal Server Error' });
});

// Start HTTP server and attach WebSocket to it
const server = http.createServer(app);
setupWebSocket(server); // <-- Attach WebSocket handling

server.listen(PORT, () => {
  console.log(`🔐 Lockdown Server running on port ${PORT}`);
});
