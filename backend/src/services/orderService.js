const db = require('../config/database');
const redis = require('../config/redis');
const notificationService = require('./notificationService');

class OrderService {
  // Create new order
  async createOrder(orderData, io) {
    const { customer_id, line_user_id, items, customer_notes } = orderData;
    
    try {
      // Validate store is open
      const storeStatus = await redis.getStoreStatus();
      if (!storeStatus || !storeStatus.is_open) {
        throw new Error('ร้านปิดอยู่ ไม่สามารถรับออเดอร์ได้');
      }

      // Validate menu items
      const menuItemIds = items.map(item => item.menu_item_id);
      const [menuItems] = await db.execute(`
        SELECT id, name, price, is_available, stock_status, preparation_time
        FROM menu_items 
        WHERE id IN (${menuItemIds.map(() => '?').join(',')}) AND is_active = TRUE
      `, menuItemIds);

      if (menuItems.length !== menuItemIds.length) {
        throw new Error('Some menu items not found');
      }

      // Check availability
      const unavailableItems = menuItems.filter(item => 
        !item.is_available || item.stock_status === 'out_of_stock'
      );

      if (unavailableItems.length > 0) {
        throw new Error(`Items not available: ${unavailableItems.map(item => item.name).join(', ')}`);
      }

      // Calculate totals
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

      // Generate order number
      const orderNumber = `ORD${Date.now()}${Math.floor(Math.random() * 1000)}`;

      // Handle customer
      let finalCustomerId = customer_id;
      if (!customer_id && line_user_id) {
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

        // Create order response
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

        // Cache order
        await redis.setOrderInProgress(orderId, orderData);

        // Send real-time update to admin
        if (io) {
          io.to('admin_room').emit('new_order', {
            ...orderData,
            message: `ออเดอร์ใหม่ #${orderNumber} - ${totalAmount} บาท`
          });
        }

        // Send LINE notification
        if (line_user_id) {
          await notificationService.sendOrderConfirmation(line_user_id, {
            orderNumber,
            items: orderItems,
            totalAmount,
            estimatedTime: maxPrepTime
          });
        }

        return {
          success: true,
          data: {
            order_id: orderId,
            order_number: orderNumber,
            total_amount: totalAmount,
            estimated_time: maxPrepTime,
            status: 'received'
          }
        };

      } catch (error) {
        await db.execute('ROLLBACK');
        throw error;
      }

    } catch (error) {
      console.error('Error creating order:', error);
      throw error;
    }
  }

  // Update order status
  async updateOrderStatus(orderId, statusData, adminId, io) {
    const { status, notes, estimated_time } = statusData;

    try {
      // Get current order
      const [currentOrder] = await db.execute(`
        SELECT o.*, c.line_user_id, c.display_name
        FROM orders o
        LEFT JOIN customers c ON o.customer_id = c.id
        WHERE o.id = ?
      `, [orderId]);

      if (currentOrder.length === 0) {
        throw new Error('Order not found');
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
        throw new Error(`Cannot change status from ${oldStatus} to ${status}`);
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

      // Get status message
      const statusMessages = {
        'confirmed': 'ยืนยันออเดอร์แล้ว',
        'preparing': 'กำลังเตรียมอาหาร',
        'ready': 'อาหารพร้อมเสิร์ฟ',
        'completed': 'เสิร์ฟเรียบร้อย',
        'cancelled': 'ยกเลิกออเดอร์'
      };

      const statusMessage = statusMessages[status] || status;

      // Send real-time updates
      if (io) {
        io.emit('order_status_updated', {
          order_id: orderId,
          order_number: order.order_number,
          old_status: oldStatus,
          new_status: status,
          message: `ออเดอร์ #${order.order_number} - ${statusMessage}`,
          estimated_time: estimated_time || order.estimated_time
        });

        // Send to specific customer room
        if (order.customer_id) {
          io.to(`customer_${order.customer_id}`).emit('order_update', {
            order_id: orderId,
            status: status,
            message: statusMessage,
            estimated_time: estimated_time || order.estimated_time
          });
        }
      }

      // Send LINE notification
      if (order.line_user_id) {
        await notificationService.sendOrderStatusUpdate(order.line_user_id, {
          orderNumber: order.order_number,
          status: status,
          statusMessage: statusMessage,
          estimatedTime: estimated_time || order.estimated_time
        });
      }

      return {
        success: true,
        data: {
          order_id: orderId,
          old_status: oldStatus,
          new_status: status,
          message: statusMessage
        }
      };

    } catch (error) {
      console.error('Error updating order status:', error);
      throw error;
    }
  }

  // Get order by ID or order number
  async getOrder(identifier) {
    try {
      let query, params;
      
      if (isNaN(identifier)) {
        // Search by order number
        query = `
          SELECT o.*, c.line_user_id, c.display_name
          FROM orders o
          LEFT JOIN customers c ON o.customer_id = c.id
          WHERE o.order_number = ?
        `;
        params = [identifier];
      } else {
        // Search by ID
        query = `
          SELECT o.*, c.line_user_id, c.display_name
          FROM orders o
          LEFT JOIN customers c ON o.customer_id = c.id
          WHERE o.id = ?
        `;
        params = [parseInt(identifier)];
      }

      const [orderResults] = await db.execute(query, params);

      if (orderResults.length === 0) {
        return null;
      }

      const order = orderResults[0];

      // Get order items
      const [itemResults] = await db.execute(`
        SELECT oi.*, m.name as item_name
        FROM order_items oi
        JOIN menu_items m ON oi.menu_item_id = m.id
        WHERE oi.order_id = ?
      `, [order.id]);

      // Get status history
      const [statusHistory] = await db.execute(`
        SELECT osh.*, a.full_name as changed_by_name
        FROM order_status_history osh
        LEFT JOIN admins a ON osh.changed_by = a.id
        WHERE osh.order_id = ?
        ORDER BY osh.changed_at
      `, [order.id]);

      return {
        ...order,
        items: itemResults.map(item => ({
          ...item,
          unit_price: parseFloat(item.unit_price),
          total_price: parseFloat(item.total_price)
        })),
        total_amount: parseFloat(order.total_amount),
        status_history: statusHistory
      };

    } catch (error) {
      console.error('Error getting order:', error);
      throw error;
    }
  }

  // Get active orders for kitchen display
  async getActiveOrders() {
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
        
        order.items = items.map(item => ({
          ...item,
          unit_price: parseFloat(item.unit_price),
          total_price: parseFloat(item.total_price)
        }));
        order.total_amount = parseFloat(order.total_amount);
      }

      return orders;

    } catch (error) {
      console.error('Error getting active orders:', error);
      throw error;
    }
  }

  // Get order statistics
  async getOrderStats(period = 1) {
    try {
      const [stats] = await db.execute(`
        SELECT 
          COUNT(*) as total_orders,
          SUM(CASE WHEN status = 'completed' THEN total_amount ELSE 0 END) as completed_revenue,
          SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_orders,
          AVG(CASE WHEN status = 'completed' AND actual_completion_time IS NOT NULL 
              THEN TIMESTAMPDIFF(MINUTE, created_at, actual_completion_time) 
              ELSE NULL END) as avg_completion_time,
          COUNT(CASE WHEN status IN ('received', 'confirmed', 'preparing', 'ready') THEN 1 END) as active_orders
        FROM orders 
        WHERE DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      `, [parseInt(period)]);

      // Get popular items
      const [popularItems] = await db.execute(`
        SELECT 
          m.name,
          SUM(oi.quantity) as total_quantity,
          COUNT(DISTINCT oi.order_id) as order_count,
          SUM(oi.total_price) as total_revenue
        FROM order_items oi
        JOIN menu_items m ON oi.menu_item_id = m.id
        JOIN orders o ON oi.order_id = o.id
        WHERE DATE(o.created_at) >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        AND o.status = 'completed'
        GROUP BY m.id, m.name
        ORDER BY total_quantity DESC
        LIMIT 10
      `, [parseInt(period)]);

      // Get hourly stats for today
      const [hourlyStats] = await db.execute(`
        SELECT 
          HOUR(created_at) as hour,
          COUNT(*) as orders,
          SUM(total_amount) as revenue
        FROM orders 
        WHERE DATE(created_at) = CURDATE()
        GROUP BY HOUR(created_at)
        ORDER BY hour
      `);

      return {
        summary: {
          ...stats[0],
          completed_revenue: parseFloat(stats[0].completed_revenue || 0),
          avg_completion_time: parseFloat(stats[0].avg_completion_time || 0)
        },
        popular_items: popularItems.map(item => ({
          ...item,
          total_revenue: parseFloat(item.total_revenue)
        })),
        hourly_stats: hourlyStats.map(stat => ({
          ...stat,
          revenue: parseFloat(stat.revenue)
        }))
      };

    } catch (error) {
      console.error('Error getting order stats:', error);
      throw error;
    }
  }

  // Cancel order
  async cancelOrder(orderId, reason, adminId, io) {
    try {
      const order = await this.getOrder(orderId);
      
      if (!order) {
        throw new Error('Order not found');
      }

      if (!['received', 'confirmed', 'preparing'].includes(order.status)) {
        throw new Error('Cannot cancel order in current status');
      }

      // Update order status
      await this.updateOrderStatus(orderId, {
        status: 'cancelled',
        notes: reason
      }, adminId, io);

      // Remove from cache
      await redis.client.del(`order:${orderId}`);

      return {
        success: true,
        message: 'Order cancelled successfully'
      };

    } catch (error) {
      console.error('Error cancelling order:', error);
      throw error;
    }
  }
}

module.exports = new OrderService();