-- database/init.sql
CREATE DATABASE IF NOT EXISTS food_ordering CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE food_ordering;

-- Admin users table
CREATE TABLE admins (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role ENUM('super_admin', 'manager', 'staff') DEFAULT 'staff',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Store status table
CREATE TABLE store_status (
    id INT PRIMARY KEY AUTO_INCREMENT,
    is_open BOOLEAN DEFAULT FALSE,
    opened_at TIMESTAMP NULL,
    closed_at TIMESTAMP NULL,
    opened_by INT,
    closed_by INT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (opened_by) REFERENCES admins(id),
    FOREIGN KEY (closed_by) REFERENCES admins(id)
);

-- Daily sales summary
CREATE TABLE daily_sales (
    id INT PRIMARY KEY AUTO_INCREMENT,
    date DATE UNIQUE NOT NULL,
    total_amount DECIMAL(10,2) DEFAULT 0,
    total_orders INT DEFAULT 0,
    opened_at TIMESTAMP NULL,
    closed_at TIMESTAMP NULL,
    opened_by INT,
    closed_by INT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (opened_by) REFERENCES admins(id),
    FOREIGN KEY (closed_by) REFERENCES admins(id)
);

-- Food categories
CREATE TABLE categories (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    image_url VARCHAR(500),
    sort_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Menu items
CREATE TABLE menu_items (
    id INT PRIMARY KEY AUTO_INCREMENT,
    category_id INT NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    price DECIMAL(8,2) NOT NULL,
    image_url VARCHAR(500),
    is_available BOOLEAN DEFAULT TRUE,
    is_recommended BOOLEAN DEFAULT FALSE,
    stock_status ENUM('available', 'low_stock', 'out_of_stock') DEFAULT 'available',
    preparation_time INT DEFAULT 15, -- minutes
    sort_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by INT,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by) REFERENCES admins(id)
);

-- Featured/Recommended items
CREATE TABLE featured_items (
    id INT PRIMARY KEY AUTO_INCREMENT,
    menu_item_id INT NOT NULL,
    priority INT DEFAULT 0,
    promotion_text VARCHAR(200),
    start_date DATE,
    end_date DATE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INT,
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES admins(id)
);

-- Customers
CREATE TABLE customers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    line_user_id VARCHAR(100) UNIQUE,
    display_name VARCHAR(100),
    phone VARCHAR(20),
    email VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Orders
CREATE TABLE orders (
    id INT PRIMARY KEY AUTO_INCREMENT,
    order_number VARCHAR(20) UNIQUE NOT NULL,
    customer_id INT,
    total_amount DECIMAL(10,2) NOT NULL,
    status ENUM('received', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled') DEFAULT 'received',
    payment_status ENUM('pending', 'paid', 'failed', 'refunded') DEFAULT 'pending',
    payment_method VARCHAR(50),
    customer_notes TEXT,
    estimated_time INT, -- minutes
    actual_completion_time TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
);

-- Order items
CREATE TABLE order_items (
    id INT PRIMARY KEY AUTO_INCREMENT,
    order_id INT NOT NULL,
    menu_item_id INT NOT NULL,
    quantity INT NOT NULL,
    unit_price DECIMAL(8,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,
    item_status ENUM('pending', 'preparing', 'ready', 'served') DEFAULT 'pending',
    special_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
);

-- Order status history
CREATE TABLE order_status_history (
    id INT PRIMARY KEY AUTO_INCREMENT,
    order_id INT NOT NULL,
    old_status VARCHAR(50),
    new_status VARCHAR(50) NOT NULL,
    changed_by INT,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (changed_by) REFERENCES admins(id)
);

-- Menu item status logs
CREATE TABLE item_status_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    menu_item_id INT NOT NULL,
    old_status VARCHAR(50),
    new_status VARCHAR(50) NOT NULL,
    old_stock_status VARCHAR(20),
    new_stock_status VARCHAR(20),
    changed_by INT NOT NULL,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reason TEXT,
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE,
    FOREIGN KEY (changed_by) REFERENCES admins(id)
);

-- Admin activity logs
CREATE TABLE admin_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    admin_id INT NOT NULL,
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50), -- 'store', 'menu_item', 'order', etc.
    target_id INT,
    details JSON,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_id) REFERENCES admins(id)
);

-- Notifications
CREATE TABLE notifications (
    id INT PRIMARY KEY AUTO_INCREMENT,
    customer_id INT,
    order_id INT,
    type VARCHAR(50) NOT NULL, -- 'order_status', 'promotion', etc.
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    sent_via ENUM('line', 'web', 'email') DEFAULT 'line',
    sent_at TIMESTAMP NULL,
    read_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (order_id) REFERENCES orders(id)
);

-- Insert default admin user
INSERT INTO admins (username, email, password_hash, full_name, role) 
VALUES ('admin', 'admin@restaurant.com', '$2b$10$example_hash_here', 'System Administrator', 'super_admin');

-- Insert sample categories
INSERT INTO categories (name, description, sort_order) VALUES
('อาหารจานเดียว', 'ข้าวผัด ข้าวคลุกกะปิ และอาหารจานเดียวอื่นๆ', 1),
('ก๋วยเตี๋ยว', 'ก๋วยเตี๋ยวทุกชนิด', 2),
('อาหารตามสั่ง', 'ผัดกะเพรา ผัดซีอิ๊ว และอาหารตามสั่งต่างๆ', 3),
('ของหวาน', 'ไอศกรีม เค้ก และของหวานต่างๆ', 4),
('เครื่องดื่ม', 'น้ำผลไม้ กาแฟ ชา', 5);

-- Insert sample menu items
INSERT INTO menu_items (category_id, name, description, price, is_recommended) VALUES
(1, 'ข้าวผัดกุ้ง', 'ข้าวผัดกุ้งสดใหญ่ หอมอร่อย', 80.00, TRUE),
(1, 'ข้าวคลุกกะปิ', 'ข้าวคลุกกะปิพร้อมเครื่องเคียง', 70.00, FALSE),
(2, 'ก๋วยเตี๋ยวหมูน้ำใส', 'ก๋วยเตี๋ยวหมูน้ำใสชามใหญ่', 50.00, TRUE),
(2, 'ก๋วยเตี๋ยวเรือ', 'ก๋วยเตี๋ยวเรือรสจัดจ้าน', 60.00, FALSE),
(3, 'กะเพราหมูกรอบ', 'กะเพราหมูกรอบไข่ดาว รสจัดจ้าน', 65.00, TRUE),
(4, 'ไอศกรีมกะทิ', 'ไอศกรีมกะทิหอมอร่อย', 25.00, FALSE),
(5, 'น้ำส้มคั้นสด', 'น้ำส้มคั้นสด 100%', 35.00, FALSE);

-- Initialize store as closed
INSERT INTO store_status (is_open) VALUES (FALSE);