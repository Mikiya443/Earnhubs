function requireLogin(req, res, next) {
  if (!req.session.userId) {
    req.flash('error', 'Please log in to continue.');
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId || req.session.role !== 'admin') {
    req.flash('error', 'Admin access required.');
    return res.redirect('/login');
  }
  next();
}

function requireGuest(req, res, next) {
  if (req.session.userId) return res.redirect('/dashboard');
  next();
}

module.exports = { requireLogin, requireAdmin, requireGuest };
