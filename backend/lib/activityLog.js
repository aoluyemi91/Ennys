const db = require('../db');

const insertStmt = db.prepare('INSERT INTO activity_log (message, dot_color) VALUES (?, ?)');

function logActivity(message, dotColor = '#e65c00') {
  insertStmt.run(message, dotColor);
}

module.exports = logActivity;
