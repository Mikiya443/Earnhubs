const express = require('express');
const bcrypt = require('bcryptjs');
const { nanoid } = require('nanoid');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { getSetting } = require('../db/settings');
const { requireGuest } = require('../middleware/auth');

const router = express.Router();

router.get('/register', requireGuest, (req, res) => {
  res.render('register', { ref: req.query.ref || '' });
});

router.post(
  '/register',
  requireGuest,
  [
    body('name').trim().isLength({ min: 2 }).withMessage('Name is too short'),
    body('email').trim().isEmail().withMessage('Enter a valid email'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array()[0].msg);
      return res.redirect('/register');
    }

    const { name, email, password, referral_code } = req.body;
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) {
      req.flash('error', 'An account with that email already exists.');
      return res.redirect('/register');
    }

    const hash = bcrypt.hashSync(password, 10);
    const myCode = nanoid(8).toUpperCase();

    let referrer = null;
    if (referral_code) {
      referrer = db.prepare('SELECT id FROM users WHERE referral_code = ?').get(referral_code.trim());
    }

    const info = db
      .prepare(
        `INSERT INTO users (name, email, password, referral_code, referred_by) VALUES (?, ?, ?, ?, ?)`
      )
      .run(name, email.toLowerCase(), hash, myCode, referrer ? referrer.id : null);

    const newUserId = info.lastInsertRowid;

    if (referrer) {
      const bonus = parseFloat(getSetting('referral_bonus', '50'));
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(bonus, referrer.id);
      db.prepare(
        `INSERT INTO transactions (user_id, type, amount, reason) VALUES (?, 'credit', ?, 'Referral bonus')`
      ).run(referrer.id, bonus);
    }

    req.session.userId = newUserId;
    req.session.role = 'user';
    req.flash('success', 'Account created! Welcome to EarnHub.');
    res.redirect('/dashboard');
  }
);

router.get('/login', requireGuest, (req, res) => {
  res.render('login');
});

router.post('/login', requireGuest, (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase());

  if (!user || !bcrypt.compareSync(password || '', user.password)) {
    req.flash('error', 'Invalid email or password.');
    return res.redirect('/login');
  }
  if (user.status === 'banned') {
    req.flash('error', 'This account has been suspended. Contact support.');
    return res.redirect('/login');
  }

  req.session.userId = user.id;
  req.session.role = user.role;
  res.redirect(user.role === 'admin' ? '/admin' : '/dashboard');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
