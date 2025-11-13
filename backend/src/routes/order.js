const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const redis = require('../config/redis');
const authMiddleware = require('../middleware/auth');
const lineService = require('../services/lineService');

// Customer: Create new order
router.post('/', [
  body('customer_id').optional().isInt(),
  body('line_user_id').optional().isString(),
  body('items').isArray({ min: 1 }),
  body('items.*.menu_item_id').isInt({ min: 1 }),
  body('items.*.quantity').isInt({ min: 1 }),
  body('customer_notes').optional().isString()
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

    // Check if store is open
    const storeStatus = await redis.getStoreStatus();
    if (!storeStatus || !storeStatus.is_open) {
      return res.status(400).json({
        success: false,
        message: 'ร้านปิดอยู่ ไม่สามารถรับออเดอร์ได้'
      });
    }

    const { customer_id, line_user_id, items, customer_notes } = req.body;
    const orderNumber = `ORD${Date.now()}${Math.floor(Math.random() * 1000)}`;

    // Get menu items details and validate availability
    const menuItemIds = items.map(item => item.menu_item_id);
    const placeholders = menuItemIds.map(() => '?').join(',');
    
    const [menuItems] = await db.execute(`
      SELECT id, name, price, is_available, stock_status, preparation_time
      FROM menu_items 
      WHERE id IN (${placeholders}) AND is_active = TRUE
    `, menuItemIds);

    if (menuItems.length !== menuItemIds.length) {
      return res.status(400).json({
        success: false,
        message: 'Some menu items not found'
      });
    }

    // Check availability
    const unavailableItems = menuItems.filter(item => 
      !item.is_available || item.stock_status === 'out_of_stock'
    );

    if (unavailableItems.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Some items are not available',
        unavailable_items: unavailableItems.map(item => item.name)
      });
    }

    // Calculate total amount and estimated time
    let totalAmount = 0;
    let maxPrepTime = 0;
    
    const orderItems = items.map(orderItem => {
      const menuItem = menuItems.find(m => m.id === orderItem.menu_item_id);
      const itemTotal = parseFloat(menuItem.price) * orderItem.quantity;
      totalAmount += itemTotal;
      maxPrepTime = Math.max(maxPrepTime, menuItem.preparation_time);
      
      return {
        menu_item_id: orderItem.menu_item_id,
        quantity: orderItem.quantity,
        unit_price: menuItem.price,
        total_price: itemTotal,
        name: menuItem.name
      };
    });

    // Handle customer creation if needed
    let finalCustomerId = customer_id;
    if (!customer_id && line_user_id) {
      // Try to find existing customer or create new one
      const [existingCustomer] = await db.execute(
        'SELECT id FROM customers WHERE line_user_id = ?',
        [line_user_id]
      );
      
      if (existingCustomer.length > 0) {
        finalCustomerId = existingCustomer[0].id;
      } else {
        const [newCustomer] = await db.execute(
          'INSERT INTO customers (line_user_id) VALUES (?)',
          [line_user_id]
        );
        finalCustomerId = newCustomer.insertId;
      }
    }

    // Start transaction
    await db.execute('START TRANSACTION');

    try {
      // Create order
      const [orderResult] = await db.execute(`
        INSERT INTO orders 
        (order_number, customer_id, total_amount, status, customer_notes, estimated_time)
        VALUES (?, ?, ?, 'received', ?, ?)
      `, [orderNumber, finalCustomerId, totalAmount, customer_notes, maxPrepTime]);

      const orderId = orderResult.insertId;

      // Insert order items
      for (const item of orderItems) {
        await db.execute(`
          INSERT INTO order_items 
          (order_id, menu_item_id, quantity, unit_price, total_price)
          VALUES (?, ?, ?, ?, ?)
        `, [orderId, item.menu_item_id, item.quantity, item.unit_price, item.total_price]);
      }

      // Log order status
      await db.execute(`
        INSERT INTO order_status_history 
        (order_id, new_status, notes)
        VALUES (?, 'received', 'Order created')
      `, [orderId]);

      await db.execute('COMMIT');

      // Cache order for quick access
      const orderData = {
        id: orderId,
        order_number: orderNumber,
        customer_id: finalCustomerId,
        total_amount: totalAmount,
        status: 'received',
        items: orderItems,
        estimated_time: maxPrepTime,
        created_at: new Date()
      };

      await redis.setOrderInProgress(orderId, orderData);

      // Send to admin dashboard
      req.io.to('admin_room').emit('new_order', {
        ...orderData,
        message: `ออเดอร์ใหม่ #${orderNumber} - ${totalAmount} บาท`
      });

      // Send LINE notification if customer has line_user_id
      if (line_user_id) {
        await lineService.sendOrderConfirmation(line_user_id, {
          orderNumber,
          items: orderItems,
          totalAmount,
          estimatedTime: maxPrepTime
        });
      }

      res.status(201).json({
        success: true,
        message: 'Order created successfully',
        data: {
          order_id: orderId,
          order_number: orderNumber,
          total_amount: totalAmount,
          estimated_time: maxPrepTime,
          status: 'received'
        }
      });

    } catch (error) {
      await db.execute('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create order'
    });
  }
});

// Customer: Get order status
router.get('/:id/status', async (req, res) => {
  try {
    const orderId = req.params.id;
    
    // Try cache first
    let orderData = await redis.getOrderInProgress(orderId);
    
    if (!orderData) {
      // Get from database
      const [orderResults] = await db.execute(`
        SELECT o.*, c.line_user_id, c.display_name
        FROM orders o
        LEFT JOIN customers c ON o.customer_id = c.id
        WHERE o.id = ?
      `, [orderId]);

      if (orderResults.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Order not found'
        });
      }

      const [itemResults] = await db.execute(`
        SELECT oi.*, m.name as item_name
        FROM order_items oi
        JOIN menu_items m ON oi.menu_item_id = m.id
        WHERE oi.order_id = ?
      `, [orderId]);

      orderData = {
        ...orderResults[0],
        items: itemResults
      };
    }

    // Get status history
    const [statusHistory] = await db.execute(`
      SELECT osh.*, a.full_name as changed_by_name
      FROM order_status_history osh
      LEFT JOIN admins a ON osh.changed_by = a.id
      WHERE osh.order_id = ?
      ORDER BY osh.changed_at
    `, [orderId]);

    res.json({
      success: true,
      data: {
        ...orderData,
        status_history: statusHistory
      }
    });

  } catch (error) {
    console.error('Error getting order status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get order status'
    });
  }
});

// Admin: Get all orders with filters
router.get('/admin/all', authMiddleware, async (req, res) => {
  try {
    const { 
      status, 
      date, 
      customer_id, 
      limit = 50, 
      offset = 0 
    } = req.query;

    let query = `
      SELECT o.*, c.display_name, c.line_user_id
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      WHERE 1=1
    `;
    
    const params = [];

    if (status) {
      query += ' AND o.status = ?';
      params.push(status);
    }

    if (date) {
      query += ' AND DATE(o.created_at) = ?';
      params.push(date);
    }

    if (customer_id) {
      query += ' AND o.customer_id = ?';
      params.push(customer_id);
    }

    query += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [orders] = await db.execute(query, params);

    // Get items for each order
    for (let order of orders) {
      const [items] = await db.execute(`
        SELECT oi.*, m.name as item_name
        FROM order_items oi
        JOIN menu_items m ON oi.menu_item_id = m.id
        WHERE oi.order_id = ?
      `, [order.id]);
      
      order.items = items;
      order.total_amount = parseFloat(order.total_amount);
    }

    res.json({
      success: true,
      data: orders
    });

  } catch (error) {
    console.error('Error getting orders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get orders'
    });
  }
});

// Admin: Get active orders (kitchen view)
router.get('/admin/active', authMiddleware, async (req, res) => {
  try {
    const [orders] = await db.execute(`
      SELECT o.*, c.display_name, c.line_user_id
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      WHERE o.status IN ('received', 'confirmed', 'preparing', 'ready')
      ORDER BY 
        CASE 
          WHEN o.status = 'received' THEN 1
          WHEN o.status = 'confirmed' THEN 2
          WHEN o.status = 'preparing' THEN 3
          WHEN o.status = 'ready' THEN 4
        END,
        o.created_at ASC
    `);

    // Get items for each order
    for (let order of orders) {
      const [items] = await db.execute(`
        SELECT oi.*, m.name as item_name, m.preparation_time
        FROM order_items oi
        JOIN menu_items m ON oi.menu_item_id = m.id
        WHERE oi.order_id = ?
      `, [order.id]);
      
      order.items = items;
      order.total_amount = parseFloat(order.total_amount);
    }

    res.json({
      success: true,
      data: orders
    });

  } catch (error) {
    console.error('Error getting active orders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get active orders'
    });
  }
});

// Admin: Update order status
router.put('/admin/:id/status', [
  authMiddleware,
  body('status').isIn(['received', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled']),
  body('notes').optional().isString(),
  body('estimated_time').optional().isInt({ min: 1 })
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

    const orderId = req.params.id;
    const adminId = req.admin.id;
    const { status, notes, estimated_time } = req.body;

    // Get current order
    const [currentOrder] = await db.execute(`
      SELECT o.*, c.line_user_id, c.display_name
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      WHERE o.id = ?
    `, [orderId]);

    if (currentOrder.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const order = currentOrder[0];
    const oldStatus = order.status;

    // Validate status transition
    const validTransitions = {
      'received': ['confirmed', 'cancelled'],
      'confirmed': ['preparing', 'cancelled'],
      'preparing': ['ready', 'cancelled'],
      'ready': ['completed', 'cancelled'],
      'completed': [],
      'cancelled': []
    };

    if (!validTransitions[oldStatus].includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot change status from ${oldStatus} to ${status}`
      });
    }

    // Update order
    const updateFields = ['status = ?', 'updated_at = NOW()'];
    const params = [status];

    if (estimated_time) {
      updateFields.push('estimated_time = ?');
      params.push(estimated_time);
    }

    if (status === 'completed') {
      updateFields.push('actual_completion_time = NOW()');
    }

    params.push(orderId);

    await db.execute(`
      UPDATE orders SET ${updateFields.join(', ')} WHERE id = ?
    `, params);

    // Log status change
    await db.execute(`
      INSERT INTO order_status_history 
      (order_id, old_status, new_status, changed_by, notes)
      VALUES (?, ?, ?, ?, ?)
    `, [orderId, oldStatus, status, adminId, notes]);

    // Update cache
    const orderData = await redis.getOrderInProgress(orderId);
    if (orderData) {
      orderData.status = status;
      if (estimated_time) orderData.estimated_time = estimated_time;
      await redis.setOrderInProgress(orderId, orderData);
    }

    // Get status message in Thai
    const statusMessages = {
      'confirmed': 'ยืนยันออเดอร์แล้ว',
      'preparing': 'กำลังเตรียมอาหาร',
      'ready': 'อาหารพร้อมเสิร์ฟ',
      'completed': 'เสิร์ฟเรียบร้อย',
      'cancelled': 'ยกเลิกออเดอร์'
    };

    const statusMessage = statusMessages[status] || status;

    // Send real-time updates
    req.io.emit('order_status_updated', {
      order_id: orderId,
      order_number: order.order_number,
      old_status: oldStatus,
      new_status: status,
      message: `ออเดอร์ #${order.order_number} - ${statusMessage}`,
      estimated_time: estimated_time || order.estimated_time
    });

    // Send to specific customer room
    if (order.customer_id) {
      req.io.to(`customer_${order.customer_id}`).emit('order_update', {
        order_id: orderId,
        status: status,
        message: statusMessage,
        estimated_time: estimated_time || order.estimated_time
      });
    }

    // Send LINE notification
    if (order.line_user_id) {
      await lineService.sendOrderStatusUpdate(order.line_user_id, {
        orderNumber: order.order_number,
        status: status,
        statusMessage: statusMessage,
        estimatedTime: estimated_time || order.estimated_time
      });
    }

    res.json({
      success: true,
      message: 'Order status updated successfully',
      data: {
        order_id: orderId,
        old_status: oldStatus,
        new_status: status
      }
    });

  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update order status'
    });
  }
});

// Admin: Get order statistics
router.get('/admin/stats', authMiddleware, async (req, res) => {
  try {
    const { period = '1' } = req.query; // days
    
    const [stats] = await db.execute(`
      SELECT 
        COUNT(*) as total_orders,
        SUM(CASE WHEN status = 'completed' THEN total_amount ELSE 0 END) as completed_revenue,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_orders,
        AVG(CASE WHEN status = 'completed' AND actual_completion_time IS NOT NULL 
            THEN TIMESTAMPDIFF(MINUTE, created_at, actual_completion_time) 
            ELSE NULL END) as avg_completion_time
      FROM orders 
      WHERE DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
    `, [parseInt(period)]);

    // Get popular items
    const [popularItems] = await db.execute(`
      SELECT 
        m.name,
        SUM(oi.quantity) as total_quantity,
        COUNT(DISTINCT oi.order_id) as order_count
      FROM order_items oi
      JOIN menu_items m ON oi.menu_item_id = m.id
      JOIN orders o ON oi.order_id = o.id
      WHERE DATE(o.created_at) >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      AND o.status = 'completed'
      GROUP BY m.id, m.name
      ORDER BY total_quantity DESC
      LIMIT 10
    `, [parseInt(period)]);

    res.json({
      success: true,
      data: {
        summary: stats[0],
        popular_items: popularItems
      }
    });

  } catch (error) {
    console.error('Error getting order stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get order statistics'
    });
  }
});

module.exports = router;