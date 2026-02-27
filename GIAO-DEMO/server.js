// 1️⃣ 依赖
const express   = require('express');
const cors      = require('cors');
const sqlite3   = require('sqlite3').verbose();
const bodyParser = require('body-parser');

// 2️⃣ 创建 Express 应用
const app = express();

// 3️⃣ 让后端可以接受跨域请求（可选，但不失礼）
app.use(cors());

// 4️⃣ 解析请求体（JSON 格式）
app.use(bodyParser.json());

// 5️⃣ 让浏览器直接访问 /public 里的文件（HTML / CSS / JS）
app.use(express.static('public'));

// 6️⃣ 初始化数据库（文件 go.db，会自动创建）
const db = new sqlite3.Database('./go.db');

// 7️⃣ 第一次运行时，创建存放落子记录的表
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS moves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      color INTEGER NOT NULL,
      time DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// 8️⃣ GET /state —— 读取棋盘
app.get('/state', (req, res) => {
  db.all('SELECT x, y, color FROM moves', (err, rows) => {
    if (err) return res.status(500).json({error: err.message});
    // 先创建 9×9 的空白棋盘
    const board = Array.from({length: 9}, () => Array(9).fill(0));
    rows.forEach(r => board[r.y][r.x] = r.color);
    res.json({board});
  });
});

// 9️⃣ POST /move —— 记录落子
app.post('/move', (req, res) => {
  const {x, y, color} = req.body;

  // 参数校验
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(color)) {
    return res.status(400).json({error: '参数必须是整数'});
  }
  if (x < 0 || x >= 9 || y < 0 || y >= 9 || (color !== 1 && color !== 2)) {
    return res.status(400).json({error: '坐标或颜色越界'});
  }

  // 判断该位置是否已被占用
  db.get('SELECT 1 FROM moves WHERE x = ? AND y = ?', [x, y], (err, row) => {
    if (err) return res.status(500).json({error: err.message});
    if (row) return res.status(400).json({error: '该点已落子'});

    // 写入数据库
    db.run('INSERT INTO moves (x, y, color) VALUES (?, ?, ?)', [x, y, color], function(err) {
      if (err) return res.status(500).json({error: err.message});
      res.json({success: true});
    });
  });
});

// 🔟 POST /reset —— 清空棋盘
app.post('/reset', (req, res) => {
  db.run('DELETE FROM moves', err => {
    if (err) return res.status(500).json({error: err.message});
    res.json({success: true});
  });
});

// 1️⃣1️⃣ 开始监听
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`围棋 Demo 服务器已启动，地址：http://localhost:${PORT}`));
