const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/authRoutes');
const urlRoutes = require('./routes/urlRoutes');
const Url = require('./models/Url');

const app = express();

app.use(cors());
app.use(express.json());

// --- Connect to MongoDB ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

// --- API Routes ---
app.use('/api/auth', authRoutes);
app.use('/api/urls', urlRoutes);

// --- Health check ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});

// --- Redirect route (must be last) ---
app.get('/:code', async (req, res) => {
  try {
    const url = await Url.findOne({ shortCode: req.params.code });
    
    if (!url) {
      return res.status(404).send('Short URL not found');
    }

    // Security Check 1: Soft deleted?
    if (url.isDeleted) {
      return res.status(404).send('Link Unavailable (Deleted)');
    }

    // Security Check 2: Inactive?
    if (!url.isActive) {
      return res.status(403).send('Link Inactive');
    }

    // Security Check 3: Expired?
    if (url.expiresAt && new Date(url.expiresAt) < new Date()) {
      return res.status(410).send('Link Expired');
    }

    // Success, increment clicks and redirect
    url.clicks += 1;
    await url.save();
    return res.redirect(url.longUrl);
    
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
