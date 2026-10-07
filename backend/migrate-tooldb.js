import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import fs from 'node:fs';
dotenv.config();
const source = process.env.DB_NAME;
const quote = name => '`' + name.replaceAll('`', '``') + '`';
const db = await mysql.createConnection({host:process.env.DB_HOST,port:process.env.DB_PORT,user:process.env.DB_USER,password:process.env.DB_PASS});
try {
  await db.query('CREATE DATABASE IF NOT EXISTS tooldb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  if (source !== 'tooldb') {
    const [tables] = await db.execute("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'", [source]);
    const names = tables.map(t=>t.TABLE_NAME).filter(n=>n==='trip_users'||n.startsWith('trip_tools_'));
    if (!names.includes('trip_users')) throw new Error('Source trip_users missing; no tables moved.');
    const [existing] = await db.execute('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', ['tooldb']);
    if (existing.length) throw new Error('Target schema already contains tables; refusing to overwrite.');
    await db.query('RENAME TABLE '+names.map(n=>`${quote(source)}.${quote(n)} TO tooldb.${quote(n)}`).join(', '));
    console.log(`Moved ${names.length} trip tables to tooldb.`);
  }
  await db.query(`CREATE TABLE IF NOT EXISTS tooldb.trip_tools_photos (
    id CHAR(36) PRIMARY KEY, trip_id INT NOT NULL, uploaded_by INT NULL,
    s3_key VARCHAR(512) NOT NULL, url VARCHAR(1024) NOT NULL,
    content_type VARCHAR(40) NOT NULL, size_bytes INT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_photo_trip (trip_id),
    CONSTRAINT fk_photo_trip FOREIGN KEY (trip_id) REFERENCES tooldb.trip_tools_trips(id) ON DELETE CASCADE,
    CONSTRAINT fk_photo_user FOREIGN KEY (uploaded_by) REFERENCES tooldb.trip_users(id) ON DELETE SET NULL
  )`);
  fs.writeFileSync('.env', fs.readFileSync('.env','utf8').replace(/^DB_NAME=.*$/m,'DB_NAME=tooldb'));
  console.log('Photo table ready; local DB_NAME updated to tooldb.');
} finally { await db.end(); }
