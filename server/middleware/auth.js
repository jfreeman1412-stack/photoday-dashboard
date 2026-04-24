const authService = require('../services/authService');

/**
 * Authentication middleware.
 * Validates the session from X-Session-Id header.
 * Attaches req.user if valid.
 */
async function requireAuth(req, res, next) {
  const sessionId = req.headers['x-session-id'];

  if (!sessionId) {
    return res.status(401).json({ error: 'Authentication required', code: 'NO_SESSION' });
  }

  try {
    const user = await authService.validateSession(sessionId);
    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired session', code: 'INVALID_SESSION' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Authentication error', code: 'AUTH_ERROR' });
  }
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
 */
async function optionalAuth(req, res, next) {
  const sessionId = req.headers['x-session-id'];
  if (sessionId) {
    try {
      const user = await authService.validateSession(sessionId);
      if (user) req.user = user;
    } catch (err) { /* silent */ }
  }
  next();
}

module.exports = { requireAuth, requireRole, optionalAuth };
