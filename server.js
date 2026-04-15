const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = 3002;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Data helpers ───────────────────────────────────
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading data:', e.message);
  }
  return { saved: [], ratings: {} };
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ─── API: Get all data ─────────────────────────────
app.get('/api/data', (req, res) => {
  const data = loadData();
  res.json(data);
});

// ─── API: Save a recipe ────────────────────────────
app.post('/api/save', (req, res) => {
  const recipe = req.body;
  if (!recipe || (!recipe.aid && !recipe.name)) {
    return res.status(400).json({ error: 'Invalid recipe.' });
  }

  const data = loadData();
  // Don't duplicate
  const exists = recipe.aid
    ? data.saved.some(s => s.aid === recipe.aid)
    : data.saved.some(s => s.name === recipe.name && !s.aid);
  if (!exists) {
    data.saved.push(recipe);
    saveData(data);
  }
  res.json({ ok: true, saved: data.saved });
});

// ─── API: Remove a saved recipe ────────────────────
app.delete('/api/save/:id', (req, res) => {
  const id = req.params.id;
  const data = loadData();
  data.saved = data.saved.filter(s => s.aid !== id);
  saveData(data);
  res.json({ ok: true, saved: data.saved });
});

// ─── API: Rate a recipe ────────────────────────────
app.post('/api/rate', (req, res) => {
  const { recipeId, stars } = req.body;
  if (!recipeId) return res.status(400).json({ error: 'Missing recipeId.' });

  const data = loadData();
  if (stars && stars >= 1 && stars <= 5) {
    data.ratings[recipeId] = stars;
  } else {
    delete data.ratings[recipeId];
  }
  saveData(data);
  res.json({ ok: true, ratings: data.ratings });
});

// ─── Start ─────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ================================');
  console.log('  CHOMPR.KITCHEN - Server');
  console.log('  ================================');
  console.log('');
  console.log(`  Local:    http://localhost:${PORT}`);

  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`  Network:  http://${net.address}:${PORT}`);
      }
    }
  }

  console.log('');
  console.log('  Share the Network link with');
  console.log('  anyone on your Wi-Fi!');
  console.log('');
  console.log('  Press Ctrl+C to stop the server.');
  console.log('');
});
