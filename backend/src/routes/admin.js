const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const authMiddleware = require('../middleware/auth');
const { requireRole } = require('../middleware/auth');

// Admin login
router.post('/login', [
  body('username').trim().notEmpty().withMessage('Username is required'),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const { username, password } = req.body;

    // Get admin from database
    const [adminResults] = await db.execute(`
      SELECT id, username, email, password_hash, full_name, role, is_active
      FROM admins 
      WHERE username = ? OR email = ?
    `, [username, username]);

    if (adminResults.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const admin = adminResults[0];

    if (!admin.is_active) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, admin.password_hash);
    
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        adminId: admin.id, 
        role: admin.role 
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Log admin login
    await db.execute(`
      INSERT INTO admin_logs (admin_id, action, ip_address, user_agent)
      VALUES (?, 'login', ?, ?)
    `, [admin.id, req.ip, req.get('User-Agent')]);

    // Remove password from response
    delete admin.password_hash;

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        admin: admin,
        token: token,
        expires_in: '24h'
      }
    });

  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed'
    });
  }
});

// Get current admin profile
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const admin = { ...req.admin };
    delete admin.password_hash;
    
    res.json({
      success: true,
      data: admin
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get profile'
    });
  }
});

// Update admin profile
router.put('/profile', [
  authMiddleware,
  body('full_name').optional().trim().isLength({ min: 1, max: 100 }),
  body('email').optional().isEmail(),
  body('current_password').if(body('new_password').exists()).notEmpty(),
  body('new_password').optional().isLength({ min: 6 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const adminId = req.admin.id;
    const { full_name, email, current_password, new_password } = req.body;

    // Build update query
    const updates = {};
    if (full_name) updates.full_name = full_name;
    if (email) updates.email = email;

    // Handle password change
    if (new_password && current_password) {
      // Verify current password
      const [currentAdmin] = await db.execute(
        'SELECT password_hash FROM admins WHERE id = ?',
        [adminId]
      );

      const isValidPassword = await bcrypt.compare(current_password, currentAdmin[0].password_hash);
      
      if (!isValidPassword) {
        return res.status(400).json({
          success: false,
          message: 'Current password is incorrect'
        });
      }

      // Hash new password
      updates.password_hash = await bcrypt.hash(new_password, 12);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    // Update admin
    const updateFields = Object.keys(updates).map(key => `${key} = ?`);
    const params = [...Object.values(updates), adminId];

    await db.execute(
      `UPDATE admins SET ${updateFields.join(', ')} WHERE id = ?`,
      params
    );

    // Log admin action
    await db.execute(`
      INSERT INTO admin_logs (admin_id, action, details)
      VALUES (?, 'profile_updated', ?)
    `, [adminId, JSON.stringify(Object.keys(updates))]);

    res.json({
      success: true,
      message: 'Profile updated successfully'
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
});

// Create new admin (super_admin only)
router.post('/create', [
  authMiddleware,
  requireRole(['super_admin']),
  body('username').trim().isLength({ min: 3, max: 50 }).matches(/^[a-zA-Z0-9_]+$/),
  body('email').isEmail(),
  body('password').isLength({ min: 6 }),
  body('full_name').trim().isLength({ min: 1, max: 100 }),
  body('role').isIn(['super_admin', 'manager', 'staff'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const { username, email, password, full_name, role } = req.body;
    const createdBy = req.admin.id;

    // Check if username or email already exists
    const [existingAdmin] = await db.execute(`
      SELECT id FROM admins WHERE username = ? OR email = ?
    `, [username, email]);

    if (existingAdmin.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Username or email already exists'
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create admin
    const [result] = await db.execute(`
      INSERT INTO admins (username, email, password_hash, full_name, role)
      VALUES (?, ?, ?, ?, ?)
    `, [username, email, passwordHash, full_name, role]);

    // Log admin creation
    await db.execute(`
      INSERT INTO admin_logs (admin_id, action, target_type, target_id, details)
      VALUES (?, 'admin_created', 'admin', ?, ?)
    `, [createdBy, result.insertId, JSON.stringify({ username, role })]);

    res.status(201).json({
      success: true,
      message: 'Admin created successfully',
      data: { id: result.insertId }
    });

  } catch (error) {
    console.error('Create admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create admin'
    });
  }
});

// Get all admins (super_admin and manager only)
router.get('/', [
  authMiddleware,
  requireRole(['super_admin', 'manager'])
], async (req, res) => {
  try {
    const [admins] = await db.execute(`
      SELECT id, username, email, full_name, role, is_active, created_at
      FROM admins
      ORDER BY created_at DESC
    `);

    res.json({
      success: true,
      data: admins
    });

  } catch (error) {
    console.error('Get admins error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get admins'
    });
  }
});

// Update admin status (super_admin only)
router.put('/:id/status', [
  authMiddleware,
  requireRole(['super_admin']),
  body('is_active').isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const targetAdminId = req.params.id;
    const currentAdminId = req.admin.id;
    const { is_active } = req.body;

    // Prevent self-deactivation
    if (targetAdminId == currentAdminId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot change your own status'
      });
    }

    // Get target admin
    const [targetAdmin] = await db.execute(
      'SELECT username FROM admins WHERE id = ?',
      [targetAdminId]
    );

    if (targetAdmin.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    // Update status
    await db.execute(
      'UPDATE admins SET is_active = ? WHERE id = ?',
      [is_active, targetAdminId]
    );

    // Log action
    await db.execute(`
      INSERT INTO admin_logs (admin_id, action, target_type, target_id, details)
      VALUES (?, 'admin_status_changed', 'admin', ?, ?)
    `, [currentAdminId, targetAdminId, JSON.stringify({ 
      username: targetAdmin[0].username, 
      is_active 
    })]);

    res.json({
      success: true,
      message: `Admin ${is_active ? 'activated' : 'deactivated'} successfully`
    });

  } catch (error) {
    console.error('Update admin status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update admin status'
    });
  }
});

// Get admin activity logs
router.get('/logs', [
  authMiddleware,
  requireRole(['super_admin', 'manager'])
], async (req, res) => {
  try {
    const { admin_id, action, limit = 100, offset = 0 } = req.query;

    let query = `
      SELECT al.*, a.full_name, a.username
      FROM admin_logs al
      JOIN admins a ON al.admin_id = a.id
      WHERE 1=1
    `;
    
    const params = [];

    if (admin_id) {
      query += ' AND al.admin_id = ?';
      params.push(admin_id);
    }

    if (action) {
      query += ' AND al.action LIKE ?';
      params.push(`%${action}%`);
    }

    query += ' ORDER BY al.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [logs] = await db.execute(query, params);

    res.json({
      success: true,
      data: logs
    });

  } catch (error) {
    console.error('Get admin logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get admin logs'
    });
  }
});

// Logout (optional - mainly for logging purposes)
router.post('/logout', authMiddleware, async (req, res) => {
  try {
    const adminId = req.admin.id;

    // Log admin logout
    await db.execute(`
      INSERT INTO admin_logs (admin_id, action, ip_address, user_agent)
      VALUES (?, 'logout', ?, ?)
    `, [adminId, req.ip, req.get('User-Agent')]);

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('Admin logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed'
    });
  }
});

module.exports = router;