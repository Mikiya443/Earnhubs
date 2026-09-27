const express = require('express');
const db = require('../db');
const { getSetting } = require('../db/settings');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin);

function getUser(req) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
}

router.get('/dashboard', (req, res) => {
  const user = getUser(req);
  const recentTx = db
    .prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 8')
    .all(user.id);
  const today = new Date().toISOString().slice(0, 10);
  const checkedInToday = user.last_checkin === today;
  res.render('dashboard', {
    user,
    recentTx,
    checkedInToday,
    checkinReward: getSetting('checkin_reward', '10'),
    referralBonus: getSetting('referral_bonus', '50')
  });
});

router.post('/checkin', (req, res) => {
  const user = getUser(req);
  const today = new Date().toISOString().slice(0, 10);
  if (user.last_checkin === today) {
    req.flash('error', "You've already checked in today.");
    return res.redirect('/dashboard');
  }
  const reward = parseFloat(getSetting('checkin_reward', '10'));
  db.prepare('UPDATE users SET balance = balance + ?, last_checkin = ? WHERE id = ?').run(
    reward,
    today,
    user.id
  );
  db.prepare(
    `INSERT INTO transactions (user_id, type, amount, reason) VALUES (?, 'credit', ?, 'Daily check-in')`
  ).run(user.id, reward);
  req.flash('success', `Checked in! You earned ₦${reward}.`);
  res.redirect('/dashboard');
});

router.get('/offers', (req, res) => {
  const offers = db.prepare('SELECT * FROM offers WHERE active = 1 ORDER BY created_at DESC').all();
  const completedIds = new Set(
    db
      .prepare('SELECT offer_id FROM completions WHERE user_id = ?')
      .all(req.session.userId)
      .map((r) => r.offer_id)
  );
  res.render('offers', { offers, completedIds });
});

router.post('/offers/:id/complete', (req, res) => {
  const offer = db.prepare('SELECT * FROM offers WHERE id = ? AND active = 1').get(req.params.id);
  if (!offer) {
    req.flash('error', 'Offer not found.');
    return res.redirect('/offers');
  }
  const already = db
    .prepare('SELECT id FROM completions WHERE user_id = ? AND offer_id = ?')
    .get(req.session.userId, offer.id);
  if (already) {
    req.flash('error', 'You already completed this offer.');
    return res.redirect('/offers');
  }

  // Offers/surveys go to pending review (fraud check); videos auto-approve.
  const status = offer.type === 'video' ? 'approved' : 'pending';

  db.prepare(
    'INSERT INTO completions (user_id, offer_id, reward, status) VALUES (?, ?, ?, ?)'
  ).run(req.session.userId, offer.id, offer.reward, status);

  if (status === 'approved') {
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(
      offer.reward,
      req.session.userId
    );
    db.prepare(
      `INSERT INTO transactions (user_id, type, amount, reason) VALUES (?, 'credit', ?, ?)`
    ).run(req.session.userId, offer.reward, `Completed: ${offer.title}`);
    req.flash('success', `Earned ₦${offer.reward} for "${offer.title}"!`);
  } else {
    req.flash('success', `Submitted "${offer.title}" for review. Reward credited once approved.`);
  }
  res.redirect('/offers');
});

router.get('/referrals', (req, res) => {
  const user = getUser(req);
  const referredUsers = db
    .prepare('SELECT id, name, created_at FROM users WHERE referred_by = ?')
    .all(user.id);
  res.render('referrals', {
    user,
    referredUsers,
    referralBonus: getSetting('referral_bonus', '50')
  });
});

router.get('/withdraw', (req, res) => {
  const user = getUser(req);
  const history = db
    .prepare('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC')
    .all(user.id);
  res.render('withdraw', {
    user,
    history,
    minWithdrawal: getSetting('min_withdrawal', '500')
  });
});

router.post('/withdraw', (req, res) => {
  const user = getUser(req);
  const amount = parseFloat(req.body.amount);
  const method = req.body.method;
  const accountDetails = (req.body.account_details || '').trim();
  const min = parseFloat(getSetting('min_withdrawal', '500'));

  if (!amount || amount <= 0) {
    req.flash('error', 'Enter a valid amount.');
    return res.redirect('/withdraw');
  }
  if (amount < min) {
    req.flash('error', `Minimum withdrawal is ₦${min}.`);
    return res.redirect('/withdraw');
  }
  if (amount > user.balance) {
    req.flash('error', 'Insufficient balance.');
    return res.redirect('/withdraw');
  }
  if (!['opay', 'bank'].includes(method)) {
    req.flash('error', 'Choose a valid payout method.');
    return res.redirect('/withdraw');
  }
  if (!accountDetails) {
    req.flash('error', 'Provide your account details.');
    return res.redirect('/withdraw');
  }

  db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(amount, user.id);
  db.prepare(
    `INSERT INTO transactions (user_id, type, amount, reason) VALUES (?, 'debit', ?, 'Withdrawal request')`
  ).run(user.id, amount);
  db.prepare(
    `INSERT INTO withdrawals (user_id, amount, method, account_details) VALUES (?, ?, ?, ?)`
  ).run(user.id, amount, method, accountDetails);

  req.flash('success', 'Withdrawal request submitted. Admin will process it shortly.');
  res.redirect('/withdraw');
});

module.exports = router;
