const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const redis = require('../config/redis');
const authMiddleware = require('../middleware/auth');

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/menu-images/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'menu-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  
  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('รองรับเฉพาะไฟล์รูปภาพ (JPEG, JPG, PNG, WebP)'));
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: fileFilter
});

// ============ PUBLIC ENDPOINTS (สำหรับลูกค้า) ============

// ดูเมนูทั้งหมด (สำหรับลูกค้า)
router.get('/', async (req, res) => {
  try {
    // Try cache first
    let menuData = await redis.getCachedMenu();
    
    if (!menuData) {
      const [results] = await db.execute(`
        SELECT 
          id,
          name,
          description,
          price,
          image_url,
          status,
          created_at,
          updated_at
        FROM menu_items 
        WHERE is_active = TRUE 
        ORDER BY created_at DESC
      `);

      menuData = results.map(item => ({
        id: item.id,
        name: item.name,
        description: item.description,
        price: parseFloat(item.price),
        image_url: item.image_url,
        status: item.status,
        is_available: item.status === 'available'
      }));
      
      // Cache for 30 minutes
      await redis.cacheMenu(menuData, 1800);
    }

    res.json({
      success: true,
      data: menuData
    });

  } catch (error) {
    console.error('Error getting menu:', error);
    res.status(500).json({
      success: false,
      message: 'ไม่สามารถโหลดเมนูได้'
    });
  }
});

// ดูเมนูรายการเดียว
router.get('/:id', async (req, res) => {
  try {
    const itemId = req.params.id;
    
    const [results] = await db.execute(`
      SELECT 
        id,
        name,
        description,
        price,
        image_url,
        status,
        created_at,
        updated_at
      FROM menu_items 
      WHERE id = ? AND is_active = TRUE
    `, [itemId]);

    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบเมนูนี้'
      });
    }

    const item = results[0];
    res.json({
      success: true,
      data: {
        id: item.id,
        name: item.name,
        description: item.description,
        price: parseFloat(item.price),
        image_url: item.image_url,
        status: item.status,
        is_available: item.status === 'available',
        created_at: item.created_at,
        updated_at: item.updated_at
      }
    });

  } catch (error) {
    console.error('Error getting menu item:', error);
    res.status(500).json({
      success: false,
      message: 'ไม่สามารถโหลดเมนูได้'
    });
  }
});

// ============ ADMIN ENDPOINTS ============

// ดูเมนูทั้งหมด (สำหรับ Admin)
router.get('/admin/all', authMiddleware, async (req, res) => {
  try {
    const { search, status, limit = 50, offset = 0 } = req.query;
    
    let query = `
      SELECT 
        id,
        name,
        description,
        price,
        image_url,
        status,
        is_active,
        created_at,
        updated_at
      FROM menu_items 
      WHERE 1=1
    `;
    
    const params = [];
    
    if (search) {
      query += ' AND (name LIKE ? OR description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    
    query += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    const [results] = await db.execute(query, params);
    
    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM menu_items WHERE 1=1';
    const countParams = [];
    
    if (search) {
      countQuery += ' AND (name LIKE ? OR description LIKE ?)';
      countParams.push(`%${search}%`, `%${search}%`);
    }
    
    if (status) {
      countQuery += ' AND status = ?';
      countParams.push(status);
    }
    
    const [countResults] = await db.execute(countQuery, countParams);
    
    res.json({
      success: true,
      data: results.map(item => ({
        ...item,
        price: parseFloat(item.price),
        is_available: item.status === 'available'
      })),
      pagination: {
        total: countResults[0].total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: parseInt(offset) + parseInt(limit) < countResults[0].total
      }
    });

  } catch (error) {
    console.error('Error getting admin menu:', error);
    res.status(500).json({
      success: false,
      message: 'ไม่สามารถโหลดเมนูได้'
    });
  }
});

// สร้างเมนูใหม่
router.post('/admin/create', [
  authMiddleware,
  upload.single('image'),
  body('name').trim().isLength({ min: 1, max: 200 }).withMessage('ชื่อเมนูต้องมี 1-200 ตัวอักษร'),
  body('description').optional().isString().isLength({ max: 1000 }).withMessage('รายละเอียดต้องไม่เกิน 1000 ตัวอักษร'),
  body('price').isFloat({ min: 0 }).withMessage('ราคาต้องเป็นตัวเลขและมากกว่า 0'),
  body('status').isIn(['available', 'unavailable', 'out_of_stock']).withMessage('สถานะไม่ถูกต้อง')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'ข้อมูลไม่ถูกต้อง',
        errors: errors.array()
      });
    }

    const adminId = req.admin.id;
    const { name, description, price, status } = req.body;
    
    // Handle image upload
    let imageUrl = null;
    if (req.file) {
      imageUrl = `/uploads/menu-images/${req.file.filename}`;
    }

    const [result] = await db.execute(`
      INSERT INTO menu_items 
      (name, description, price, image_url, status, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [name, description || '', parseFloat(price), imageUrl, status, adminId, adminId]);

    // Log admin action
    await db.execute(`
      INSERT INTO admin_logs (admin_id, action, target_type, target_id, details)
      VALUES (?, 'menu_created', 'menu_item', ?, ?)
    `, [adminId, result.insertId, JSON.stringify({ 
      name, 
      price: parseFloat(price), 
      status,
      image_uploaded: !!req.file 
    })]);

    // Clear cache
    await redis.invalidateCache('menu:*');

    // Broadcast to admin clients
    req.io?.to('admin_room').emit('menu_item_created', {
      id: result.insertId,
      name,
      price: parseFloat(price),
      status,
      message: `เมนูใหม่ "${name}" ถูกเพิ่มแล้ว`
    });

    res.status(201).json({
      success: true,
      message: 'สร้างเมนูสำเร็จ',
      data: {
        id: result.insertId,
        name,
        description: description || '',
        price: parseFloat(price),
        image_url: imageUrl,
        status
      }
    });

  } catch (error) {
    console.error('Error creating menu item:', error);
    
    // Delete uploaded file if database save failed
    if (req.file) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('Error deleting file:', err);
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'ไม่สามารถสร้างเมนูได้'
    });
  }
});

// แก้ไขเมนู
router.put('/admin/:id', [
  authMiddleware,
  upload.single('image'),
  body('name').optional().trim().isLength({ min: 1, max: 200 }).withMessage('ชื่อเมนูต้องมี 1-200 ตัวอักษร'),
  body('description').optional().isString().isLength({ max: 1000 }).withMessage('รายละเอียดต้องไม่เกิน 1000 ตัวอักษร'),
  body('price').optional().isFloat({ min: 0 }).withMessage('ราคาต้องเป็นตัวเลขและมากกว่า 0'),
  body('status').optional().isIn(['available', 'unavailable', 'out_of_stock']).withMessage('สถานะไม่ถูกต้อง'),
  body('remove_image').optional().isBoolean().withMessage('remove_image ต้องเป็น boolean')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'ข้อมูลไม่ถูกต้อง',
        errors: errors.array()
      });
    }

    const itemId = req.params.id;
    const adminId = req.admin.id;
    const { name, description, price, status, remove_image } = req.body;

    // Get current item
    const [currentItem] = await db.execute(
      'SELECT * FROM menu_items WHERE id = ? AND is_active = TRUE',
      [itemId]
    );

    if (currentItem.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบเมนูนี้'
      });
    }

    const current = currentItem[0];
    let oldImagePath = null;

    // Build update object
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (price !== undefined) updates.price = parseFloat(price);
    if (status !== undefined) updates.status = status;
    
    // Handle image update
    if (req.file) {
      updates.image_url = `/uploads/menu-images/${req.file.filename}`;
      if (current.image_url) {
        oldImagePath = `uploads/menu-images/${path.basename(current.image_url)}`;
      }
    } else if (remove_image === true) {
      updates.image_url = null;
      if (current.image_url) {
        oldImagePath = `uploads/menu-images/${path.basename(current.image_url)}`;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'ไม่มีข้อมูลที่ต้องอัพเดต'
      });
    }

    // Build update query
    updates.updated_by = adminId;
    updates.updated_at = new Date();
    
    const updateFields = Object.keys(updates).map(key => `${key} = ?`);
    const params = [...Object.values(updates), itemId];

    await db.execute(
      `UPDATE menu_items SET ${updateFields.join(', ')} WHERE id = ?`,
      params
    );

    // Delete old image file
    if (oldImagePath && fs.existsSync(oldImagePath)) {
      fs.unlink(oldImagePath, (err) => {
        if (err) console.error('Error deleting old image:', err);
      });
    }

    // Log admin action
    await db.execute(`
      INSERT INTO admin_logs (admin_id, action, target_type, target_id, details)
      VALUES (?, 'menu_updated', 'menu_item', ?, ?)
    `, [adminId, itemId, JSON.stringify({
      updates,
      old_name: current.name,
      image_changed: !!req.file || remove_image === true
    })]);

    // Clear cache
    await redis.invalidateCache('menu:*');

    // Broadcast update
    req.io?.to('admin_room').emit('menu_item_updated', {
      id: itemId,
      name: name || current.name,
      updates,
      message: `เมนู "${name || current.name}" ถูกอัพเดตแล้ว`
    });

    // If status changed, notify customers
    if (status && status !== current.status) {
      req.io?.emit('menu_status_updated', {
        item_id: itemId,
        item_name: name || current.name,
        old_status: current.status,
        new_status: status,
        message: `${name || current.name} - ${getStatusMessage(status)}`,
        updated_at: new Date()
      });
    }

    res.json({
      success: true,
      message: 'อัพเดตเมนูสำเร็จ',
      data: {
        id: itemId,
        ...updates
      }
    });

  } catch (error) {
    console.error('Error updating menu item:', error);
    
    // Delete uploaded file if update failed
    if (req.file) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('Error deleting file:', err);
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'ไม่สามารถอัพเดตเมนูได้'
    });
  }
});

// อัพเดตสถานะเมนู (เฉพาะสถานะ)
router.put('/admin/:id/status', [
  authMiddleware,
  body('status').isIn(['available', 'unavailable', 'out_of_stock']).withMessage('สถานะไม่ถูกต้อง'),
  body('reason').optional().isString().isLength({ max: 300 }).withMessage('เหตุผลต้องไม่เกิน 300 ตัวอักษร')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'ข้อมูลไม่ถูกต้อง',
        errors: errors.array()
      });
    }

    const itemId = req.params.id;
    const adminId = req.admin.id;
    const { status, reason } = req.body;

    // Get current item
    const [currentItem] = await db.execute(
      'SELECT * FROM menu_items WHERE id = ? AND is_active = TRUE',
      [itemId]
    );

    if (currentItem.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบเมนูนี้'
      });
    }

    const current = currentItem[0];

    if (current.status === status) {
      return res.status(400).json({
        success: false,
        message: 'สถานะเหมือนเดิม'
      });
    }

    // Update status
    await db.execute(
      'UPDATE menu_items SET status = ?, updated_by = ?, updated_at = NOW() WHERE id = ?',
      [status, adminId, itemId]
    );

    // Log status change
    await db.execute(`
      INSERT INTO admin_logs (admin_id, action, target_type, target_id, details)
      VALUES (?, 'menu_status_changed', 'menu_item', ?, ?)
    `, [adminId, itemId, JSON.stringify({
      name: current.name,
      old_status: current.status,
      new_status: status,
      reason: reason || 'ไม่ระบุ'
    })]);

    // Clear cache
    await redis.invalidateCache('menu:*');

    // Broadcast real-time update
    const statusMessage = getStatusMessage(status);
    
    req.io?.emit('menu_status_updated', {
      item_id: itemId,
      item_name: current.name,
      old_status: current.status,
      new_status: status,
      message: `${current.name} - ${statusMessage}`,
      reason: reason || '',
      updated_at: new Date()
    });

    // Send LINE notification to customers if item becomes unavailable
    if (status !== 'available' && current.status === 'available') {
      // Get subscribed users and send notification
      const notificationService = require('../services/notificationService');
      await notificationService.broadcastMenuUpdate({
        item_name: current.name,
        message: statusMessage,
        status: status,
        is_available: false
      });
    }

    res.json({
      success: true,
      message: `อัพเดตสถานะเป็น "${statusMessage}" เรียบร้อย`,
      data: {
        id: itemId,
        name: current.name,
        old_status: current.status,
        new_status: status,
        status_message: statusMessage
      }
    });

  } catch (error) {
    console.error('Error updating menu status:', error);
    res.status(500).json({
      success: false,
      message: 'ไม่สามารถอัพเดตสถานะได้'
    });
  }
});

// ลบเมนู (Soft Delete)
router.delete('/admin/:id', authMiddleware, async (req, res) => {
  try {
    const itemId = req.params.id;
    const adminId = req.admin.id;

    // Get current item
    const [currentItem] = await db.execute(
      'SELECT * FROM menu_items WHERE id = ? AND is_active = TRUE',
      [itemId]
    );

    if (currentItem.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบเมนูนี้'
      });
    }

    const current = currentItem[0];

    // Check if item is in any active orders
    const [activeOrders] = await db.execute(`
      SELECT COUNT(*) as count 
      FROM order_items oi 
      JOIN orders o ON oi.order_id = o.id 
      WHERE oi.menu_item_id = ? 
      AND o.status IN ('received', 'confirmed', 'preparing', 'ready')
    `, [itemId]);

    if (activeOrders[0].count > 0) {
      return res.status(400).json({
        success: false,
        message: 'ไม่สามารถลบเมนูที่มีในออเดอร์ที่กำลังดำเนินการได้'
      });
    }

    // Soft delete
    await db.execute(
      'UPDATE menu_items SET is_active = FALSE, updated_by = ?, updated_at = NOW() WHERE id = ?',
      [adminId, itemId]
    );

    // Log deletion
    await db.execute(`
      INSERT INTO admin_logs (admin_id, action, target_type, target_id, details)
      VALUES (?, 'menu_deleted', 'menu_item', ?, ?)
    `, [adminId, itemId, JSON.stringify({
      name: current.name,
      price: current.price,
      had_image: !!current.image_url
    })]);

    // Clear cache
    await redis.invalidateCache('menu:*');

    // Broadcast to admin clients
    req.io?.to('admin_room').emit('menu_item_deleted', {
      id: itemId,
      name: current.name,
      message: `เมนู "${current.name}" ถูกลบแล้ว`
    });

    res.json({
      success: true,
      message: 'ลบเมนูสำเร็จ',
      data: {
        id: itemId,
        name: current.name
      }
    });

  } catch (error) {
    console.error('Error deleting menu item:', error);
    res.status(500).json({
      success: false,
      message: 'ไม่สามารถลบเมนูได้'
    });
  }
});

// อัพเดตหลายรายการพร้อมกัน
router.put('/admin/bulk-update', [
  authMiddleware,
  body('item_ids').isArray({ min: 1 }).withMessage('ต้องระบุรายการที่จะอัพเดต'),
  body('item_ids.*').isInt({ min: 1 }).withMessage('ID ไม่ถูกต้อง'),
  body('status').optional().isIn(['available', 'unavailable', 'out_of_stock']).withMessage('สถานะไม่ถูกต้อง'),
  body('reason').optional().isString().isLength({ max: 300 }).withMessage('เหตุผลต้องไม่เกิน 300 ตัวอักษร')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'ข้อมูลไม่ถูกต้อง',
        errors: errors.array()
      });
    }

    const { item_ids, status, reason } = req.body;
    const adminId = req.admin.id;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'ต้องระบุสถานะที่จะอัพเดต'
      });
    }

    // Get current items
    const placeholders = item_ids.map(() => '?').join(',');
    const [currentItems] = await db.execute(
      `SELECT id, name, status FROM menu_items WHERE id IN (${placeholders}) AND is_active = TRUE`,
      item_ids
    );

    if (currentItems.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบเมนูที่ระบุ'
      });
    }

    // Update all items
    await db.execute(
      `UPDATE menu_items SET status = ?, updated_by = ?, updated_at = NOW() WHERE id IN (${placeholders}) AND is_active = TRUE`,
      [status, adminId, ...item_ids]
    );

    // Log bulk action
    await db.execute(`
      INSERT INTO admin_logs (admin_id, action, target_type, details)
      VALUES (?, 'menu_bulk_update', 'menu_item', ?)
    `, [adminId, JSON.stringify({
      item_ids,
      items: currentItems.map(item => ({ id: item.id, name: item.name, old_status: item.status })),
      new_status: status,
      reason: reason || 'ไม่ระบุ'
    })]);

    // Clear cache
    await redis.invalidateCache('menu:*');

    const statusMessage = getStatusMessage(status);

    // Broadcast bulk update
    req.io?.emit('menu_bulk_updated', {
      item_ids,
      items: currentItems.map(item => item.name),
      new_status: status,
      status_message: statusMessage,
      message: `อัพเดต ${currentItems.length} รายการเป็น "${statusMessage}"`,
      updated_at: new Date()
    });

    res.json({
      success: true,
      message: `อัพเดต ${currentItems.length} รายการเป็น "${statusMessage}" เรียบร้อย`,
      data: {
        updated_count: currentItems.length,
        items: currentItems.map(item => ({
          id: item.id,
          name: item.name,
          old_status: item.status,
          new_status: status
        }))
      }
    });

  } catch (error) {
    console.error('Error bulk updating menu items:', error);
    res.status(500).json({
      success: false,
      message: 'ไม่สามารถอัพเดตหลายรายการได้'
    });
  }
});

// ============ UTILITY FUNCTIONS ============

// Get status message in Thai
function getStatusMessage(status) {
  const messages = {
    'available': 'พร้อมขาย',
    'unavailable': 'ไม่พร้อมขาย',
    'out_of_stock': 'หมดแล้ว'
  };
  return messages[status] || status;
}

// Serve uploaded images
router.get('/uploads/:filename', (req, res) => {
  const filename = req.params.filename;
  const filepath = path.join(__dirname, '../../uploads/menu-images/', filename);
  
  if (fs.existsSync(filepath)) {
    res.sendFile(path.resolve(filepath));
  } else {
    res.status(404).json({
      success: false,
      message: 'ไม่พบไฟล์ภาพ'
    });
  }
});

module.exports = router;