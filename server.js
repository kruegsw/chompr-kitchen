const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = 3002;
const DATA_FILE = path.join(__dirname, 'data.json');
const MEAL_API = 'https://www.themealdb.com/api/json/v2/65232507';
const SITE = 'https://chompr.kitchen';

app.use(express.json({ limit: '5mb' }));

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

// ─── SEO: robots.txt ──────────────────────────────
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
`User-agent: *
Allow: /
Sitemap: ${SITE}/sitemap.xml`
  );
});

// ─── SEO: sitemap.xml ─────────────────────────────
app.get('/sitemap.xml', async (req, res) => {
  let urls = `  <url><loc>${SITE}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n`;
  urls += `  <url><loc>${SITE}/browse</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>\n`;
  urls += `  <url><loc>${SITE}/ingredients</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>\n`;

  // Add category pages
  const cats = ['Beef','Chicken','Lamb','Pork','Goat','Seafood','Pasta','Side','Starter','Breakfast','Dessert','Vegetarian','Vegan','Miscellaneous'];
  cats.forEach(c => {
    urls += `  <url><loc>${SITE}/category/${encodeURIComponent(c)}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>\n`;
  });

  // Add cuisine pages
  const cuisines = ['American','British','Canadian','Chinese','Croatian','Dutch','Egyptian','Filipino','French','Greek','Indian','Irish','Italian','Jamaican','Japanese','Kenyan','Malaysian','Mexican','Moroccan','Norwegian','Polish','Portuguese','Russian','Spanish','Thai','Turkish','Vietnamese'];
  cuisines.forEach(c => {
    urls += `  <url><loc>${SITE}/cuisine/${encodeURIComponent(c)}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>\n`;
  });

  // Fetch some popular recipes for the sitemap
  try {
    const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
    const picks = letters.sort(() => Math.random() - 0.5).slice(0, 5);
    const results = await Promise.all(picks.map(l => fetch(`${MEAL_API}/search.php?f=${l}`).then(r => r.json()).catch(() => null)));
    const seen = new Set();
    results.forEach(r => {
      if (r && r.meals) r.meals.forEach(m => {
        if (!seen.has(m.idMeal)) {
          seen.add(m.idMeal);
          const slug = m.strMeal.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/,'');
          urls += `  <url><loc>${SITE}/recipe/${m.idMeal}/${slug}</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>\n`;
        }
      });
    });
  } catch (e) { /* sitemap still works without recipe URLs */ }

  res.type('application/xml').send(
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}</urlset>`
  );
});

// ─── SEO: Recipe pages with server-side meta for crawlers ───
app.get('/recipe/:id/:slug?', async (req, res) => {
  const id = req.params.id;
  let meal = null;

  try {
    const r = await fetch(`${MEAL_API}/lookup.php?i=${id}`);
    const d = await r.json();
    if (d && d.meals) meal = d.meals[0];
  } catch (e) { /* fall through to default */ }

  if (!meal) {
    // Redirect to home if recipe not found
    return res.redirect('/');
  }

  // Build ingredients list for schema
  const ings = [];
  for (let i = 1; i <= 20; i++) {
    const g = meal['strIngredient' + i], ms = meal['strMeasure' + i];
    if (g && g.trim()) ings.push(((ms || '').trim() + ' ' + g.trim()).trim());
  }

  const name = meal.strMeal || 'Recipe';
  const desc = `How to make ${name}. ${ings.length} ingredients. ${meal.strCategory || ''} ${meal.strArea || ''} recipe.`.trim();
  const img = meal.strMealThumb || '';
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
  const canonical = `${SITE}/recipe/${id}/${slug}`;

  // Schema.org Recipe structured data
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: name,
    image: img,
    description: desc,
    recipeCategory: meal.strCategory || '',
    recipeCuisine: meal.strArea || '',
    recipeIngredient: ings,
    recipeInstructions: (meal.strInstructions || '').split(/\r?\n/).filter(s => s.trim().length > 10).map(s => ({
      '@type': 'HowToStep',
      text: s.trim()
    })),
    url: canonical
  };

  // Read the SPA index.html and inject meta tags + schema before </head>
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

  const inject = `
<title>${name} — Chompr</title>
<meta name="description" content="${desc.replace(/"/g, '&quot;')}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="article">
<meta property="og:url" content="${canonical}">
<meta property="og:title" content="${name} — Chompr">
<meta property="og:description" content="${desc.replace(/"/g, '&quot;')}">
<meta property="og:image" content="${img}">
<meta property="og:site_name" content="Chompr">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${name} — Chompr">
<meta name="twitter:description" content="${desc.replace(/"/g, '&quot;')}">
<meta name="twitter:image" content="${img}">
<script type="application/ld+json">${JSON.stringify(schema)}</script>`;

  // Replace the default meta tags with recipe-specific ones
  html = html.replace(/<title>.*?<\/title>/, '');
  html = html.replace(/<meta name="description"[^>]*>/, '');
  html = html.replace(/<link rel="canonical"[^>]*>/, '');
  html = html.replace(/<meta property="og:[^>]*>/g, '');
  html = html.replace(/<meta name="twitter:[^>]*>/g, '');
  html = html.replace('</head>', inject + '\n</head>');

  // Inject a script that auto-opens this recipe on load
  html = html.replace('</body>', `<script>window._openRecipeId="${id}";</script>\n</body>`);

  res.send(html);
});

// ─── Helper: inject meta into SPA shell ───────────
function spaWithMeta(title, desc, canonical, ogImage) {
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const inject = `
<title>${title}</title>
<meta name="description" content="${desc.replace(/"/g, '&quot;')}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonical}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc.replace(/"/g, '&quot;')}">
<meta property="og:image" content="${ogImage || SITE + '/og-image.png'}">
<meta property="og:site_name" content="Chompr">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc.replace(/"/g, '&quot;')}">
<meta name="twitter:image" content="${ogImage || SITE + '/og-image.png'}">`;
  html = html.replace(/<title>.*?<\/title>/, '');
  html = html.replace(/<meta name="description"[^>]*>/, '');
  html = html.replace(/<link rel="canonical"[^>]*>/, '');
  html = html.replace(/<meta property="og:[^>]*>/g, '');
  html = html.replace(/<meta name="twitter:[^>]*>/g, '');
  html = html.replace('</head>', inject + '\n</head>');
  return html;
}

// ─── Tab routes ───────────────────────────────────
app.get('/browse', (req, res) => {
  const html = spaWithMeta(
    'Browse Recipes by Category — Chompr',
    'Explore recipes by category: entrees, seafood, pasta, breakfast, desserts, vegetarian, vegan and more.',
    SITE + '/browse'
  );
  res.send(html);
});

// Redirect old URL
app.get('/kitchen', (req, res) => res.redirect(301, '/ingredients'));

app.get('/ingredients', (req, res) => {
  const html = spaWithMeta(
    'Find Recipes by Ingredient — Chompr',
    'Select the ingredients you have and find recipes that use them. No more wasting food — cook with what you\'ve got.',
    SITE + '/ingredients'
  );
  res.send(html);
});

// ─── Category pages ───────────────────────────────
app.get('/category/:name', async (req, res) => {
  const name = req.params.name;
  const html = spaWithMeta(
    name + ' Recipes — Chompr',
    'Browse ' + name + ' recipes. Find the best ' + name.toLowerCase() + ' dishes to cook at home.',
    SITE + '/category/' + encodeURIComponent(name)
  );
  res.send(html.replace('</body>', `<script>window._openCategory="${name.replace(/"/g, '')}";</script>\n</body>`));
});

// ─── Cuisine pages ────────────────────────────────
app.get('/cuisine/:name', async (req, res) => {
  const name = req.params.name;
  const html = spaWithMeta(
    name + ' Recipes — Chompr',
    'Explore ' + name + ' cuisine. Discover authentic ' + name.toLowerCase() + ' recipes to cook at home.',
    SITE + '/cuisine/' + encodeURIComponent(name)
  );
  res.send(html.replace('</body>', `<script>window._openCuisine="${name.replace(/"/g, '')}";</script>\n</body>`));
});

// ─── Search pages (shareable search results) ──────
app.get('/search/:query', (req, res) => {
  const q = decodeURIComponent(req.params.query);
  const html = spaWithMeta(
    'Recipes for "' + q + '" — Chompr',
    'Search results for "' + q + '". Find recipes matching ' + q + ' on Chompr.',
    SITE + '/search/' + encodeURIComponent(q)
  );
  res.send(html.replace('</body>', `<script>window._openSearch="${q.replace(/"/g, '&quot;')}";</script>\n</body>`));
});

// ─── Static files (after route handlers) ──────────
app.use(express.static(path.join(__dirname, 'public')));

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
  console.log('  Press Ctrl+C to stop the server.');
  console.log('');
});
