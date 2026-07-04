const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const {
  createUrl,
  getMyUrls,
  updateUrl,
  deleteUrl,
  getAllUrls,
  hardDeleteUrl
} = require('../controllers/urlController');

// All URL routes require authentication
router.use(protect);

router.post('/', createUrl);
router.get('/my-urls', getMyUrls);
router.put('/:id', updateUrl);
router.delete('/:id', deleteUrl);

// Admin only routes
router.get('/all', authorize('admin'), getAllUrls);
router.delete('/admin/:id', authorize('admin'), hardDeleteUrl);

module.exports = router;
