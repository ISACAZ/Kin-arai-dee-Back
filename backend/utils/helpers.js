const crypto = require('crypto');
const moment = require('moment');

class Helpers {
  // Generate random string
  static generateRandomString(length = 10) {
    return crypto.randomBytes(Math.ceil(length / 2))
      .toString('hex')
      .slice(0, length);
  }

  // Generate order number
  static generateOrderNumber() {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000);
    return `ORD${timestamp}${random.toString().padStart(3, '0')}`;
  }

  // Format currency
  static formatCurrency(amount, currency = 'THB') {
    const formatted = parseFloat(amount).toFixed(2);
    return currency === 'THB' ? `${formatted}฿` : `${currency} ${formatted}`;
  }

  // Format time duration
  static formatDuration(minutes) {
    if (minutes < 60) {
      return `${minutes} นาที`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours} ชม. ${mins} นาที` : `${hours} ชม.`;
  }

  // Format Thai date
  static formatThaiDate(date, format = 'DD/MM/YYYY HH:mm') {
    moment.locale('th');
    return moment(date).format(format);
  }

  // Get Thai day name
  static getThaiDayName(date = new Date()) {
    const days = [
      'อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ',
      'พฤหัสบดี', 'ศุกร์', 'เสาร์'
    ];
    return days[new Date(date).getDay()];
  }

  // Validate email format
  static isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  // Validate phone number (Thai format)
  static isValidThaiPhone(phone) {
    const phoneRegex = /^(\+66|0)[0-9]{8,9}$/;
    return phoneRegex.test(phone.replace(/[-\s]/g, ''));
  }

  // Sanitize filename
  static sanitizeFilename(filename) {
    return filename.replace(/[^a-z0-9.-]/gi, '_').toLowerCase();
  }

  // Calculate distance between two coordinates
  static calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in kilometers
  }

  static toRadians(degrees) {
    return degrees * (Math.PI / 180);
  }

  // Paginate array
  static paginate(array, page = 1, limit = 10) {
    const offset = (page - 1) * limit;
    return {
      data: array.slice(offset, offset + limit),
      pagination: {
        page: page,
        limit: limit,
        total: array.length,
        pages: Math.ceil(array.length / limit),
        hasNext: offset + limit < array.length,
        hasPrev: page > 1
      }
    };
  }

  // Sleep function
  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Retry function with exponential backoff
  static async retry(fn, maxRetries = 3, delay = 1000) {
    let lastError;
    
    for (let i = 0; i <= maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        
        if (i === maxRetries) break;
        
        const backoffDelay = delay * Math.pow(2, i);
        console.log(`Retry ${i + 1}/${maxRetries} after ${backoffDelay}ms`);
        await this.sleep(backoffDelay);
      }
    }
    
    throw lastError;
  }

  // Deep clone object
  static deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime());
    if (obj instanceof Array) return obj.map(item => this.deepClone(item));
    if (typeof obj === 'object') {
      const clonedObj = {};
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          clonedObj[key] = this.deepClone(obj[key]);
        }
      }
      return clonedObj;
    }
  }

  // Remove empty properties from object
  static removeEmpty(obj) {
    return Object.entries(obj).reduce((acc, [key, value]) => {
      if (value !== null && value !== undefined && value !== '') {
        acc[key] = value;
      }
      return acc;
    }, {});
  }

  // Convert object to query string
  static objectToQueryString(obj) {
    return Object.entries(obj)
      .filter(([key, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');
  }

  // Parse query string to object
  static queryStringToObject(queryString) {
    const params = new URLSearchParams(queryString);
    const result = {};
    for (const [key, value] of params.entries()) {
      result[key] = value;
    }
    return result;
  }

  // Generate hash
  static generateHash(data, algorithm = 'sha256') {
    return crypto.createHash(algorithm).update(data).digest('hex');
  }

  // Validate Thai ID number
  static isValidThaiID(id) {
    if (!/^\d{13}$/.test(id)) return false;
    
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      sum += parseInt(id[i]) * (13 - i);
    }
    
    const remainder = sum % 11;
    const checkDigit = remainder < 2 ? remainder : 11 - remainder;
    
    return checkDigit === parseInt(id[12]);
  }

  // Get file extension
  static getFileExtension(filename) {
    return filename.split('.').pop().toLowerCase();
  }

  // Format file size
  static formatFileSize(bytes) {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
  }

  // Generate slug from Thai text
  static generateSlug(text) {
    return text
      .toLowerCase()
      .replace(/[^\u0E00-\u0E7Fa-z0-9\s-]/g, '') // Keep Thai, English, numbers, spaces, hyphens
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim()
      .replace(/^-+|-+$/g, '');
  }

  // Check if string contains Thai characters
  static containsThai(text) {
    return /[\u0E00-\u0E7F]/.test(text);
  }

  // Truncate text with ellipsis
  static truncate(text, length = 100, ending = '...') {
    if (text.length <= length) return text;
    return text.substring(0, length - ending.length) + ending;
  }

  // Capitalize first letter
  static capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  }

  // Generate random color
  static generateRandomColor() {
    return '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
  }

  // Get business hours status
  static getBusinessHoursStatus(openTime = '08:00', closeTime = '20:00') {
    const now = moment();
    const open = moment(openTime, 'HH:mm');
    const close = moment(closeTime, 'HH:mm');
    
    if (close.isBefore(open)) {
      // Crosses midnight
      close.add(1, 'day');
      if (now.isBefore(open)) {
        now.add(1, 'day');
      }
    }
    
    return {
      isOpen: now.isBetween(open, close),
      openTime: open.format('HH:mm'),
      closeTime: close.format('HH:mm'),
      currentTime: moment().format('HH:mm')
    };
  }
}

module.exports = Helpers;