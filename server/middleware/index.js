const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const session = require('express-session');
const passport = require('passport');
const rateLimit = require('express-rate-limit');

const setupMiddleware = (app, db) => {
  // Enable CORS
  app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
      ? 'https://your-production-domain.com'
      : ['http://localhost:3000', 'http://localhost:5173'],
    credentials: true
  }));

  // Security headers
  app.use(helmet());

  // Rate limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
  });
  app.use(limiter);

  // Body parsing
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  // Session configuration
  app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 1 week
    }
  }));

  // Initialize Passport and session
  app.use(passport.initialize());
  app.use(passport.session());

  // Passport configuration
  const LocalStrategy = require('passport-local').Strategy;
  const bcrypt = require('bcryptjs');

  passport.use(new LocalStrategy(
    { usernameField: 'email' },
    async (email, password, done) => {
      try {
        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
        if (!user) {
          return done(null, false, { message: 'Incorrect email or password.' });
        }
        
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
          return done(null, false, { message: 'Incorrect email or password.' });
        }
        
        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }
  ));

  // Serialize/deserialize user
  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser((id, done) => {
    try {
      const user = db.prepare('SELECT id, email, username, display_name, avatar_url FROM users WHERE id = ?').get(id);
      done(null, user);
    } catch (error) {
      done(error);
    }
  });

  // Authentication middleware
  app.use((req, res, next) => {
    res.locals.user = req.user || null;
    next();
  });
};

module.exports = setupMiddleware;
