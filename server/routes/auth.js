const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const passport = require('passport');

module.exports = (db) => {
  const router = express.Router();

  // Register route
  router.post('/register', async (req, res, next) => {
    try {
      const { email, password, username } = req.body;
      
      if (!email || !password || !username) {
        return res.status(400).json({ message: 'Email, username and password are required' });
      }

      // Check if user already exists
      const existingUser = db.prepare('SELECT * FROM users WHERE email = ? OR username = ?').get(email, username);
      if (existingUser) {
        return res.status(400).json({ message: 'User already exists' });
      }

      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      // Create user
      const result = db.prepare(
        'INSERT INTO users (email, password_hash, username, display_name) VALUES (?, ?, ?, ?)'
      ).run(email, hashedPassword, username, username);

      const user = db.prepare('SELECT id, email, username, display_name, avatar_url FROM users WHERE id = ?').get(result.lastInsertRowid);
      
      // Generate JWT
      const token = jwt.sign(
        { id: user.id, email: user.email },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '7d' }
      );

      res.status(201).json({ user, token });
    } catch (error) {
      next(error);
    }
  });

  // Login route
  router.post('/login', (req, res, next) => {
    passport.authenticate('local', (err, user, info) => {
      if (err) return next(err);
      if (!user) {
        return res.status(401).json({ message: info.message });
      }
      
      req.logIn(user, (err) => {
        if (err) return next(err);
        
        // Generate JWT
        const token = jwt.sign(
          { id: user.id, email: user.email },
          process.env.JWT_SECRET || 'your-secret-key',
          { expiresIn: '7d' }
        );
        
        return res.json({ 
          user: {
            id: user.id,
            email: user.email,
            username: user.username,
            display_name: user.display_name,
            avatar_url: user.avatar_url
          },
          token 
        });
      });
    })(req, res, next);
  });

  // Logout route
  router.post('/logout', (req, res) => {
    req.logout();
    res.json({ message: 'Logged out successfully' });
  });

  // Get current user
  router.get('/me', (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Not authenticated' });
    }
    res.json(req.user);
  });

  return router;
};
