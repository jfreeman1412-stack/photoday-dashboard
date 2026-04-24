const authService = require('../services/authService');

/**
 * Authentication middleware.
 * Validates the session from X-Session-Id header.
 * Attaches req.user if valid.
 */
function requireAuth(req, res, next) {
  const sessionId = req.headers['x-session-id'];

  if (!sessionId) {
    return res.status(401).json({ error: 'Authentication required', code: 'NO_SESSION' });
  }

  const user = authService.validateSession(sessionId);
  if (!user) {
    return res.status(401).json({ error: 'Invalid or expired session', code: 'INVALID_SESSION' });
  }

  // Attach user to request for downstream use
  req.user = user;
  next();
}

/**
 * Role-based authorization middleware.
 * Must be used after requireAuth.
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Requires ${roles.join(' or ')} role` });
    }
    next();
  };
}

/**
 * Optional auth — attaches user if session exists, but doesn't block.
 * Useful for endpoints that work with or without auth.
 */
function optionalAuth(req, res, next) {
  const sessionId = req.headers['x-session-id'];
  if (sessionId) {
    const user = authService.validateSession(sessionId);
    if (user) req.user = user;
  }
  next();
}

module.exports = { requireAuth, requireRole, optionalAuth };
