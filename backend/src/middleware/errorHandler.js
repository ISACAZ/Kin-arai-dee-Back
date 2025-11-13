// src/middleware/errorHandler.js
const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  // Default error
  let error = {
    success: false,
    message: 'Internal server error'
  };

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(val => val.message);
    error.message = 'Validation Error';
    error.errors = messages;
    return res.status(400).json(error);
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    error.message = `${field} already exists`;
    return res.status(400).json(error);
  }

  // MySQL errors
  if (err.code) {
    switch (err.code) {
      case 'ER_DUP_ENTRY':
        error.message = 'Duplicate entry';
        return res.status(400).json(error);
      case 'ER_NO_REFERENCED_ROW_2':
        error.message = 'Referenced record not found';
        return res.status(400).json(error);
      case 'ER_ROW_IS_REFERENCED_2':
        error.message = 'Cannot delete record - referenced by other records';
        return res.status(400).json(error);
      case 'ECONNREFUSED':
        error.message = 'Database connection failed';
        return res.status(500).json(error);
    }
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error.message = 'Invalid token';
    return res.status(401).json(error);
  }

  if (err.name === 'TokenExpiredError') {
    error.message = 'Token expired';
    return res.status(401).json(error);
  }

  // Custom application errors
  if (err.statusCode) {
    error.message = err.message;
    return res.status(err.statusCode).json(error);
  }

  // Default 500 error
  res.status(500).json(error);
};

module.exports = errorHandler;