const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const redis = require('../config/redis');
const authMiddleware = require('../middleware/auth');

// Get current store status
router.get('/status', async (req, res) => {
  try {
    // Try to get from cache first
    let storeStatus = await redis.getStoreStatus();
    
    if (!storeStatus) {
      // Get from database
      const [results] = await db.execute(`
        SELECT ss.*, a1.full_name as opened_by_name, a2.full_name as closed_by_name
        FROM store_status ss
        LEFT JOIN admins a1 ON ss.opened_by = a1.id
        LEFT JOIN admins a2 ON ss.closed_by = a2.id
        ORDER BY ss.created_at DESC
        LIMIT 1
      `);
      
      storeStatus = results[0] || { is_open: false };
      
      // Cache the result
      await redis.setStoreStatus(storeStatus);
    }
    
    res.json({
      success: true,
      data: storeStatus
    });
  } catch (error) {
    console.error('Error getting store status:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Open store
router.post('/open', [
  authMiddleware,
  body('notes').optional().isString().isLength({ max: 500 })
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
    const { notes } = req.body;
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // Check if store is already open
    const [currentStatus] = await db.execute(`
      SELECT * FROM store_status ORDER BY created_at DESC LIMIT 1
    `);

    if (currentStatus[0] && currentStatus[0].is_open) {
      return res.status(400).json({
        success: false,
        message: 'Store is already open'
      });
    }

    // Start transaction
    await db.execute('START TRANSACTION');

    try {
      // Insert new store status
      const [storeResult] = await db.execute(`
        INSERT INTO store_status (is_open, opened_at, opened_by, notes)
        VALUES (TRUE, ?, ?, ?)
      `, [now, adminId, notes]);

      // Create or update daily sales record
      await db.execute(`
        INSERT INTO daily_sales (date, opened_at, opened_by, notes)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
        opened_at = VALUES(opened_at),
        opened_by = VALUES(opened_by),
        notes = VALUES(notes)
      `, [today, now, adminId, notes]);

      // Log admin action
      await db.execute(`
        INSERT INTO admin_logs (admin_id, action, target_type, details)
        VALUES (?, 'store_opened', 'store', ?)
      `, [adminId, JSON.stringify({ notes, opened_at: now })]);

      await db.execute('COMMIT');

      // Update cache
      const newStatus = {
        id: storeResult.insertId,
        is_open: true,
        opened_at: now,
        opened_by: adminId,
        notes: notes,
        opened_by_name: req.admin.full_name
      };
      
      await redis.setStoreStatus(newStatus);

      // Broadcast to all connected admin clients
      req.io.to('admin_room').emit('store_status_changed', {
        status: 'opened',
        data: newStatus,
        message: 'ร้านเปิดแล้ว'
      });

      res.json({
        success: true,
        message: 'Store opened successfully',
        data: newStatus
      });

    } catch (error) {
      await db.execute('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('Error opening store:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to open store'
    });
  }
});

// Close store
router.post('/close', [
  authMiddleware,
  body('notes').optional().isString().isLength({ max: 500 })
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
    const { notes } = req.body;
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // Check if store is open
    const [currentStatus] = await db.execute(`
      SELECT * FROM store_status ORDER BY created_at DESC LIMIT 1
    `);

    if (!currentStatus[0] || !currentStatus[0].is_open) {
      return res.status(400).json({
        success: false,
        message: 'Store is already closed'
      });
    }

    // Calculate daily totals
    const [dailyTotals] = await db.execute(`
      SELECT 
        COUNT(*) as total_orders,
        COALESCE(SUM(total_amount), 0) as total_amount
      FROM orders 
      WHERE DATE(created_at) = ? AND status IN ('completed', 'ready')
    `, [today]);

    const { total_orders, total_amount } = dailyTotals[0];

    // Start transaction
    await db.execute('START TRANSACTION');

    try {
      // Insert store close status
      const [storeResult] = await db.execute(`
        INSERT INTO store_status (is_open, closed_at, closed_by, notes)
        VALUES (FALSE, ?, ?, ?)
      `, [now, adminId, notes]);

      // Update daily sales record
      await db.execute(`
        UPDATE daily_sales 
        SET closed_at = ?, closed_by = ?, total_amount = ?, total_orders = ?, notes = ?
        WHERE date = ?
      `, [now, adminId, total_amount, total_orders, notes, today]);

      // Log admin action
      await db.execute(`
        INSERT INTO admin_logs (admin_id, action, target_type, details)
        VALUES (?, 'store_closed', 'store', ?)
      `, [adminId, JSON.stringify({ 
        notes, 
        closed_at: now, 
        total_amount, 
        total_orders 
      })]);

      await db.execute('COMMIT');

      // Update cache
      const newStatus = {
        id: storeResult.insertId,
        is_open: false,
        closed_at: now,
        closed_by: adminId,
        notes: notes,
        closed_by_name: req.admin.full_name,
        daily_summary: {
          total_orders,
          total_amount
        }
      };
      
      await redis.setStoreStatus(newStatus);

      // Broadcast to all connected admin clients
      req.io.to('admin_room').emit('store_status_changed', {
        status: 'closed',
        data: newStatus,
        message: `ร้านปิดแล้ว - ยอดขายวันนี้: ${total_amount} บาท (${total_orders} ออเดอร์)`
      });

      res.json({
        success: true,
        message: 'Store closed successfully',
        data: newStatus
      });

    } catch (error) {
      await db.execute('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('Error closing store:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to close store'
    });
  }
});

// Get daily sales report
router.get('/daily-sales', authMiddleware, async (req, res) => {
  try {
    const { date, limit = 30 } = req.query;
    
    let query = `
      SELECT ds.*, 
             a1.full_name as opened_by_name,git 
             a2.full_name as closed_by_name
      FROM daily_sales ds
      LEFT JOIN admins a1 ON ds.opened_by = a1.id
      LEFT JOIN admins a2 ON ds.closed_by = a2.id
    `;
    
    const params = [];
    
    if (date) {
      query += ' WHERE ds.date = ?';
      params.push(date);
    }
    
    query += ' ORDER BY ds.date DESC LIMIT ?';
    params.push(parseInt(limit));

    const [results] = await db.execute(query, params);

    res.json({
      success: true,
      data: results
    });

  } catch (error) {
    console.error('Error getting daily sales:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get daily sales'
    });
  }
});

// Get store statistics
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const { period = '7' } = req.query; // days
    
    const [stats] = await db.execute(`
      SELECT 
        COUNT(*) as total_days,
        SUM(total_amount) as total_revenue,
        SUM(total_orders) as total_orders,
        AVG(total_amount) as avg_daily_revenue,
        AVG(total_orders) as avg_daily_orders
      FROM daily_sales 
      WHERE date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
    `, [parseInt(period)]);

    // Get today's current stats
    const today = new Date().toISOString().split('T')[0];
    const [todayStats] = await db.execute(`
      SELECT 
        COUNT(*) as today_orders,
        COALESCE(SUM(total_amount), 0) as today_revenue
      FROM orders 
      WHERE DATE(created_at) = ? AND status IN ('completed', 'ready')
    `, [today]);

    // Get current store status
    const [currentStatus] = await db.execute(`
      SELECT is_open, opened_at FROM store_status 
      ORDER BY created_at DESC LIMIT 1
    `);

    res.json({
      success: true,
      data: {
        period_stats: stats[0],
        today_stats: todayStats[0],
        current_status: currentStatus[0] || { is_open: false }
      }
    });

  } catch (error) {
    console.error('Error getting store stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get store statistics'
    });
  }
});

module.exports = router;