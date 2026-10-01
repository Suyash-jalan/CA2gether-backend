/**
 * Require the authenticated user to have the 'admin' role.
 * Must be placed AFTER the `protect` middleware.
 */
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  next();
};

module.exports = { requireAdmin };
