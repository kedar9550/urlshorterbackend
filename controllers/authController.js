const User = require('../models/User');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const bcrypt = require('bcryptjs');

const generateToken = (id, institutionId, role) => {
  return jwt.sign({ id, institutionId, role }, process.env.JWT_SECRET || 'supersecretkey', {
    expiresIn: '30d',
  });
};

// @desc    Register a new user (ECAP employee)
// @route   POST /api/auth/signup
exports.signup = async (req, res) => {
  const { institutionId, password } = req.body;

  try {
    if (!institutionId || !password) {
      return res.status(400).json({ error: 'Please provide institutionId and password' });
    }

    // Check if user already exists
    const userExists = await User.findOne({ institutionId });
    if (userExists) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Verify against ECAP API
    let employeeData;
    try {
      const response = await axios.get(`https://info.aec.edu.in/adityaAPI/API/staffdata/${institutionId}`);
      
      const data = response.data?.[0];
      if (!data || data.error) {
        return res.status(404).json({ error: 'Invalid Employee ID. Not found in ECAP' });
      }
      
      // We only allow employees, if this endpoint returns staff data successfully, we proceed.
      // Get the name
      employeeData = data;
    } catch (apiError) {
      console.error('ECAP API Error:', apiError.message);
      return res.status(500).json({ error: 'Failed to verify with ECAP API' });
    }

    const name = employeeData.employeename || employeeData.EmployeeName || 'Employee';
    const email = employeeData.EmailId || employeeData.email || '';

    // Create user
    const user = await User.create({
      institutionId,
      name,
      email,
      password,
      role: 'user' // Default role
    });

    res.status(201).json({
      _id: user._id,
      institutionId: user.institutionId,
      name: user.name,
      role: user.role,
      token: generateToken(user._id, user.institutionId, user.role),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

// @desc    Login user
// @route   POST /api/auth/login
exports.login = async (req, res) => {
  const { institutionId, password } = req.body;

  try {
    const user = await User.findOne({ institutionId });

    if (user && (await user.comparePassword(password))) {
      res.json({
        _id: user._id,
        institutionId: user.institutionId,
        name: user.name,
        role: user.role,
        token: generateToken(user._id, user.institutionId, user.role),
      });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

// @desc    Get current user profile
// @route   GET /api/auth/me
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};
