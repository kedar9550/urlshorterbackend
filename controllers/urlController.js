const Url = require('../models/Url');
const shortid = require('shortid');

// @desc    Create short URL
// @route   POST /api/urls
exports.createUrl = async (req, res) => {
  try {
    const { longUrl, expiresAt, type } = req.body;

    if (!longUrl) {
      return res.status(400).json({ error: 'longUrl is required' });
    }

    try {
      new URL(longUrl);
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    const shortCode = shortid.generate();
    
    let expiryDate = null;
    if (expiresAt) {
      expiryDate = new Date(expiresAt);
    }

    const newUrl = await Url.create({
      longUrl,
      shortCode,
      type: type || 'short_url',
      userId: req.user.id,
      expiresAt: expiryDate
    });

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    res.status(201).json({ 
      ...newUrl.toObject(),
      shortUrl: `${baseUrl}/${shortCode}` 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// @desc    Get user's URLs
// @route   GET /api/urls/my-urls
exports.getMyUrls = async (req, res) => {
  try {
    const urls = await Url.find({ userId: req.user.id, isDeleted: false }).sort({ createdAt: -1 });
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    
    const mappedUrls = urls.map(url => ({
      ...url.toObject(),
      shortUrl: `${baseUrl}/${url.shortCode}`
    }));
    
    res.json(mappedUrls);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// @desc    Update URL (Edit longUrl, expiresAt, isActive)
// @route   PUT /api/urls/:id
exports.updateUrl = async (req, res) => {
  try {
    const { longUrl, expiresAt, isActive } = req.body;
    
    const url = await Url.findById(req.params.id);
    if (!url) {
      return res.status(404).json({ error: 'URL not found' });
    }

    // Check ownership or admin
    if (url.userId.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(401).json({ error: 'Not authorized' });
    }

    if (longUrl) url.longUrl = longUrl;
    if (expiresAt !== undefined) {
      url.expiresAt = expiresAt ? new Date(expiresAt) : null;
    }
    if (isActive !== undefined) {
      url.isActive = isActive;
    }

    await url.save();
    res.json(url);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// @desc    Soft Delete URL
// @route   DELETE /api/urls/:id
exports.deleteUrl = async (req, res) => {
  try {
    const url = await Url.findById(req.params.id);
    if (!url) {
      return res.status(404).json({ error: 'URL not found' });
    }

    // Check ownership or admin
    if (url.userId.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(401).json({ error: 'Not authorized' });
    }

    url.isDeleted = true; // Soft delete => instantly breaks the public link
    await url.save();

    res.json({ message: 'URL deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ================= ADMIN ROUTES =================

// @desc    Get ALL URLs (Admin only)
// @route   GET /api/urls/all
exports.getAllUrls = async (req, res) => {
  try {
    // Populate user to get creator info
    const urls = await Url.find().populate('userId', 'name institutionId designation').sort({ createdAt: -1 });
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    
    const mappedUrls = urls.map(url => ({
      ...url.toObject(),
      shortUrl: `${baseUrl}/${url.shortCode}`
    }));
    
    res.json(mappedUrls);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// @desc    Hard Delete URL (Admin only)
// @route   DELETE /api/urls/admin/:id
exports.hardDeleteUrl = async (req, res) => {
  try {
    const url = await Url.findByIdAndDelete(req.params.id);
    if (!url) {
      return res.status(404).json({ error: 'URL not found' });
    }
    res.json({ message: 'URL permanently deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};
