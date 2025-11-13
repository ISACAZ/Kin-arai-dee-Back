// backend/src/utils/validators.js
const { body, param, query } = require('express-validator');

// Common validation patterns
const validators = {
  // Order validations
  createOrder: [
    body('customer_id').optional().isInt({ min: 1 }),
    body('line_user_id').optional().isString().isLength({ min: 1, max: 100 }),
    body('items').isArray({ min: 1 }).withMessage('Items array is required'),
    body('items.*.menu_item_id').isInt({ min: 1 }).withMessage('Valid menu item ID required'),
    body('items.*.quantity').isInt({ min: 1, max: 20 }).withMessage('Quantity must be between 1-20'),
    body('items.*.special_notes').optional().isString().isLength({ max: 200 }),
    body('customer_notes').optional().isString().isLength({ max: 500 })
  ],

  updateOrderStatus: [
    param('id').isInt({ min: 1 }).withMessage('Valid order ID required'),
    body('status').isIn(['received', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'])
      .withMessage('Invalid status'),
    body('notes').optional().isString().isLength({ max: 500 }),
    body('estimated_time').optional().isInt({ min: 1, max: 300 })
  ],

  // Menu validations
  createMenuItem: [
    body('category_id').isInt({ min: 1 }).withMessage('Valid category ID required'),
    body('name').trim().isLength({ min: 1, max: 200 }).withMessage('Name is required (1-200 chars)'),
    body('description').optional().isString().isLength({ max: 1000 }),
    body('price').isFloat({ min: 0 }).withMessage('Valid price required'),
    body('image_url').optional().isURL().withMessage('Valid image URL required'),
    body('preparation_time').optional().isInt({ min: 1, max: 300 }),
    body('sort_order').optional().isInt({ min: 0 }),
    body('is_recommended').optional().isBoolean(),
    body('is_available').optional().isBoolean()
  ],

  updateMenuItem: [
    param('id').isInt({ min: 1 }).withMessage('Valid menu item ID required'),
    body('name').optional().trim().isLength({ min: 1, max: 200 }),
    body('description').optional().isString().isLength({ max: 1000 }),
    body('price').optional().isFloat({ min: 0 }),
    body('image_url').optional().isURL(),
    body('preparation_time').optional().isInt({ min: 1, max: 300 }),
    body('sort_order').optional().isInt({ min: 0 }),
    body('is_recommended').optional().isBoolean(),
    body('is_available').optional().isBoolean()
  ],

  updateMenuStatus: [
    param('id').isInt({ min: 1 }).withMessage('Valid menu item ID required'),
    body('is_available').optional().isBoolean(),
    body('stock_status').optional().isIn(['available', 'low_stock', 'out_of_stock']),
    body('reason').optional().isString().isLength({ max: 300 })
  ],

  bulkUpdateMenuStatus: [
    body('item_ids').isArray({ min: 1 }).withMessage('Item IDs array required'),
    body('item_ids.*').isInt({ min: 1 }).withMessage('Valid item IDs required'),
    body('is_available').optional().isBoolean(),
    body('stock_status').optional().isIn(['available', 'low_stock', 'out_of_stock']),
    body('reason').optional().isString().isLength({ max: 300 })
  ],

  // Admin validations
  adminLogin: [
    body('username').trim().notEmpty().withMessage('Username is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
  ],

  createAdmin: [
    body('username').trim().isLength({ min: 3, max: 50 })
      .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username: 3-50 chars, letters/numbers/underscore only'),
    body('email').isEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('full_name').trim().isLength({ min: 1, max: 100 }).withMessage('Full name required'),
    body('role').isIn(['super_admin', 'manager', 'staff']).withMessage('Valid role required')
  ],

  updateAdminProfile: [
    body('full_name').optional().trim().isLength({ min: 1, max: 100 }),
    body('email').optional().isEmail(),
    body('current_password').if(body('new_password').exists()).notEmpty()
      .withMessage('Current password required when changing password'),
    body('new_password').optional().isLength({ min: 8 })
      .withMessage('New password must be at least 8 characters')
  ],

  // Store validations
  storeOperation: [
    body('notes').optional().isString().isLength({ max: 500 })
  ],

  // Category validations
  createCategory: [
    body('name').trim().isLength({ min: 1, max: 100 }).withMessage('Category name required'),
    body('description').optional().isString().isLength({ max: 500 }),
    body('image_url').optional().isURL(),
    body('sort_order').optional().isInt({ min: 0 })
  ],

  // Query parameter validations
  paginationQuery: [
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be 1-100'),
    query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be >= 0'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be >= 1')
  ],

  dateRangeQuery: [
    query('start_date').optional().isISO8601().withMessage('Invalid start date format'),
    query('end_date').optional().isISO8601().withMessage('Invalid end date format'),
    query('date').optional().isISO8601().withMessage('Invalid date format')
  ],

  searchQuery: [
    query('search').optional().isString().isLength({ min: 1, max: 100 })
      .withMessage('Search term must be 1-100 characters'),
    query('category_id').optional().isInt({ min: 1 }),
    query('status').optional().isString()
  ]
};

module.exports = validators;