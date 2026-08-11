const express = require('express');
const router = express.Router();

const setupRoutes = (app, db, io) => {
  // API routes
  app.use('/api/auth', require('./auth')(db, io));
  app.use('/api/users', require('./users')(db, io));
  app.use('/api/servers', require('./servers')(db, io));
  app.use('/api/channels', require('./channels')(db, io));
  app.use('/api/messages', require('./messages')(db, io));
  
  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
  });
};

module.exports = setupRoutes;
