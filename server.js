const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const shortid = require('shortid');
require('dotenv').config();

const app = express();

app.use(cors()); // for testing, allows all origins. Restrict later if needed.
app.use(express.json());

// --- Connect to MongoDB ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

// --- Schema ---
const urlSchema = new mongoose.Schema({
  longUrl: { type: String, required: true },
  shortCode: { type: String, required: true, unique: true },
  clicks: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});
const Url = mongoose.model('Url', urlSchema);

// --- Health check (use this to test if backend is alive) ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});

// --- Create short URL ---
app.post('/api/shorten', async (req, res) => {
  try {
    const { longUrl } = req.body;

    if (!longUrl) {
      return res.status(400).json({ error: 'longUrl is required' });
    }

    // basic URL validation
    try {
      new URL(longUrl);
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    const shortCode = shortid.generate();
    const newUrl = new Url({ longUrl, shortCode });
    await newUrl.save();

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    res.json({ shortUrl: `${baseUrl}/${shortCode}`, shortCode });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// --- List all URLs (optional, useful for testing) ---
app.get('/api/urls', async (req, res) => {
  const urls = await Url.find().sort({ createdAt: -1 });
  res.json(urls);
});

// --- Redirect route (must be last) ---
app.get('/:code', async (req, res) => {
  try {
    const url = await Url.findOne({ shortCode: req.params.code });
    if (url) {
      url.clicks += 1;
      await url.save();
      return res.redirect(url.longUrl);
    }
    res.status(404).send('Short URL not found');
  } catch (err) {
    res.status(500).send('Server error');
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
