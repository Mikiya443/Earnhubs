const express = require('express');
const db = require('../db');
const { getAllSettings, setSetting } = require('../db/settings');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAdmin);

router.get('/', (req, res) => {
  const stats = {
    totalUsers: db.prepare('SELECT COUNT(*) c FROM users WHERE role = ?').get('user').c,
    totalPaidOut: db
      .prepare(`SELECT COALESCE(SUM(amount),0) s FROM withdrawals WHERE status = 'paid'`)
      .get().s,
    pendingWithdrawals: db
      .prepare(`SELECT COUNT(*) c FROM withdrawals WHERE status = 'pending'`)
      .get().c,
    pendingCompletions: db
      .prepare(`SELECT COUNT(*) c FROM completions WHERE status = 'pending'`)
      .get().c,
    totalOffers: db.prepare('SELECT COUNT(*) c FROM offers WHERE active = 1').get().c
  };
  const recentUsers = db
    .prepare('SELECT id, name, email, balance, created_at FROM users WHERE role = ? ORDER BY created_at DESC LIMIT 8')
    .all('user');
  res.render('admin/dashboard', { stats, recentUsers });
});

// ---- Users ----
router.get('/users', (req, res) => {
  const q = (req.query.q || '').trim();
  let users;
  if (q) {
    users = db
      .prepare(
        `SELECT * FROM users WHERE role = 'user' AND (name LIKE ? OR email LIKE ?) ORDER BY created_at DESC`
      )
      .all(`%${q}%`, `%${q}%`);
  } else {
    users = db.prepare(`SELECT * FROM users WHERE role = 'user' ORDER BY created_at DESC`).all();
  }
  res.render('admin/users', { users, q });
});

router.post('/users/:id/ban', (req, res) => {
  db.prepare(`UPDATE users SET status = 'banned' WHERE id = ?`).run(req.params.id);
  req.flash('success', 'User banned.');
  res.redirect('/admin/users');
});

router.post('/users/:id/unban', (req, res) => {
  db.prepare(`UPDATE users SET status = 'active' WHERE id = ?`).run(req.params.id);
  req.flash('success', 'User unbanned.');
  res.redirect('/admin/users');
});

router.post('/users/:id/adjust-balance', (req, res) => {
  const amount = parseFloat(req.body.amount);
  const reason = req.body.reason || 'Admin adjustment';
  if (!amount) {
    req.flash('error', 'Enter a non-zero amount.');
    return res.redirect('/admin/users');
  }
  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amount, req.params.id);
  db.prepare(
    `INSERT INTO transactions (user_id, type, amount, reason) VALUES (?, ?, ?, ?)`
  ).run(req.params.id, amount >= 0 ? 'credit' : 'debit', Math.abs(amount), reason);
  req.flash('success', 'Balance adjusted.');
  res.redirect('/admin/users');
});

// ---- Offers ----
router.get('/offers', (req, res) => {
  const offers = db.prepare('SELECT * FROM offers ORDER BY created_at DESC').all();
  res.render('admin/offers', { offers });
});

router.post('/offers', (req, res) => {
  const { title, description, type, reward, link } = req.body;
  if (!title || !reward) {
    req.flash('error', 'Title and reward are required.');
    return res.redirect('/admin/offers');
  }
  db.prepare(
    `INSERT INTO offers (title, description, type, reward, link) VALUES (?, ?, ?, ?, ?)`
  ).run(title, description || '', type || 'offer', parseFloat(reward), link || '');
  req.flash('success', 'Offer created.');
  res.redirect('/admin/offers');
});

router.post('/offers/:id/toggle', (req, res) => {
  const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(req.params.id);
  if (offer) {
    db.prepare('UPDATE offers SET active = ? WHERE id = ?').run(offer.active ? 0 : 1, offer.id);
  }
  res.redirect('/admin/offers');
});

router.post('/offers/:id/delete', (req, res) => {
  db.prepare('DELETE FROM offers WHERE id = ?').run(req.params.id);
  req.flash('success', 'Offer deleted.');
  res.redirect('/admin/offers');
});

// ---- Completions (pending survey/offer approvals) ----
router.get('/completions', (req, res) => {
  const completions = db
    .prepare(
      `SELECT completions.*, users.name AS user_name, users.email AS user_email, offers.title AS offer_title
       FROM completions
       JOIN users ON users.id = completions.user_id
       JOIN offers ON offers.id = completions.offer_id
       WHERE completions.status = 'pending'
       ORDER BY completions.created_at ASC`
    )
    .all();
  res.render('admin/completions', { completions });
});

router.post('/completions/:id/approve', (req, res) => {
  const c = db.prepare('SELECT * FROM completions WHERE id = ?').get(req.params.id);
  if (c && c.status === 'pending') {
    db.prepare(`UPDATE completions SET status = 'approved' WHERE id = ?`).run(c.id);
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(c.reward, c.user_id);
    db.prepare(
      `INSERT INTO transactions (user_id, type, amount, reason) VALUES (?, 'credit', ?, 'Offer approved')`
    ).run(c.user_id, c.reward);
  }
  req.flash('success', 'Completion approved and paid.');
  res.redirect('/admin/completions');
});

router.post('/completions/:id/reject', (req, res) => {
  db.prepare(`UPDATE completions SET status = 'rejected' WHERE id = ?`).run(req.params.id);
  req.flash('success', 'Completion rejected.');
  res.redirect('/admin/completions');
});

// ---- Withdrawals ----
router.get('/withdrawals', (req, res) => {
  const withdrawals = db
    .prepare(
      `SELECT withdrawals.*, users.name AS user_name, users.email AS user_email
       FROM withdrawals JOIN users ON users.id = withdrawals.user_id
       ORDER BY CASE withdrawals.status WHEN 'pending' THEN 0 ELSE 1 END, withdrawals.created_at DESC`
    )
    .all();
  res.render('admin/withdrawals', { withdrawals });
});

router.post('/withdrawals/:id/approve', (req, res) => {
  db.prepare(`UPDATE withdrawals SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
    req.params.id
  );
  req.flash('success', 'Withdrawal approved.');
  res.redirect('/admin/withdrawals');
});

router.post('/withdrawals/:id/paid', (req, res) => {
  db.prepare(`UPDATE withdrawals SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
    req.params.id
  );
  req.flash('success', 'Marked as paid.');
  res.redirect('/admin/withdrawals');
});

router.post('/withdrawals/:id/reject', (req, res) => {
  const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);
  if (w && w.status === 'pending') {
    // refund balance
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(w.amount, w.user_id);
    db.prepare(
      `INSERT INTO transactions (user_id, type, amount, reason) VALUES (?, 'credit', ?, 'Withdrawal rejected - refund')`
    ).run(w.user_id, w.amount);
  }
  db.prepare(`UPDATE withdrawals SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
    req.params.id
  );
  req.flash('success', 'Withdrawal rejected and balance refunded.');
  res.redirect('/admin/withdrawals');
});

// ---- Settings ----
router.get('/settings', (req, res) => {
  res.render('admin/settings', { settings: getAllSettings() });
});

router.post('/settings', (req, res) => {
  const fields = ['checkin_reward', 'video_reward', 'referral_bonus', 'min_withdrawal', 'site_name'];
  for (const f of fields) {
    if (req.body[f] !== undefined) setSetting(f, req.body[f]);
  }
  req.flash('success', 'Settings updated.');
  res.redirect('/admin/settings');
});

module.exports = router;
