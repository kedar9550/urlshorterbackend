const User = require('../models/User');
const Otp = require('../models/Otp');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const bcrypt = require('bcryptjs');

const generateToken = (id, institutionId, role) => {
  return jwt.sign({ id, institutionId, role }, process.env.JWT_SECRET || 'supersecretkey', {
    expiresIn: '30d',
  });
};

// @desc    Send OTP to user's mobile for signup
// @route   POST /api/auth/send-otp
exports.sendOtp = async (req, res) => {
  const { institutionId, action } = req.body;

  try {
    if (!institutionId) {
      return res.status(400).json({ error: 'Please provide institutionId' });
    }

    const userExists = await User.findOne({ institutionId });
    
    if (action === 'forgot-password' && !userExists) {
      return res.status(400).json({ error: 'User does not exist. Please create an account first.' });
    }
    
    if (action !== 'forgot-password' && userExists) {
      return res.status(400).json({ error: 'User already exists' });
    }

    let employeeData;
    try {
      const response = await axios.get(`https://info.aec.edu.in/adityaAPI/API/staffdata/${institutionId}`);
      const data = response.data?.[0];
      if (!data || data.error) {
        return res.status(404).json({ error: 'Invalid Employee ID. Not found in ECAP' });
      }
      employeeData = data;
    } catch (apiError) {
      return res.status(500).json({ error: 'Failed to verify with ECAP API' });
    }

    const mobileno = employeeData.mobileno;
    if (!mobileno) {
      return res.status(400).json({ error: 'Contact admin, you don\'t have a mobile number registered in ECAP' });
    }

    const name = employeeData.employeename || employeeData.EmployeeName || 'Employee';
    const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digit OTP

    // Send SMS
    const smsUrl = `https://pgapi.vispl.in/fe/api/v1/multiSend?username=aditrpg1.trans&password=Ad1tya@1234&unicode=false&from=ADIUNV&to=${mobileno}&text=Dear+${encodeURIComponent(name)},%0AThank+you+for+reaching+out+to+us.+%0ATo+verify+your+request+and+proceed+with+further+actions,+please+use+the+following+One-Time+Password+(OTP):${otp}+@ADITYA+UNIVERSITY`;
    
    try {
      await axios.get(smsUrl);
    } catch (smsError) {
      console.error('SMS API Error:', smsError.message);
      return res.status(500).json({ error: 'Failed to send OTP SMS' });
    }

    // Save OTP to DB
    await Otp.findOneAndUpdate(
      { institutionId },
      { otp },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const maskedMobile = mobileno.slice(-4).padStart(mobileno.length, '*');
    res.status(200).json({ message: 'OTP sent successfully', maskedMobile });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

// @desc    Register a new user (ECAP employee)
// @route   POST /api/auth/signup
exports.signup = async (req, res) => {
  const { institutionId, password, otp } = req.body;

  try {
    if (!institutionId || !password || !otp) {
      return res.status(400).json({ error: 'Please provide institutionId, password and OTP' });
    }

    // Verify OTP
    const otpRecord = await Otp.findOne({ institutionId });
    if (!otpRecord) {
      return res.status(400).json({ error: 'OTP expired or not found. Please request a new one.' });
    }
    
    if (otpRecord.otp !== otp) {
      return res.status(400).json({ error: 'Invalid OTP' });
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
      employeeData = data;
    } catch (apiError) {
      return res.status(500).json({ error: 'Failed to verify with ECAP API' });
    }

    const name = employeeData.employeename || employeeData.EmployeeName || 'Employee';
    const email = employeeData.EmailId || employeeData.email || '';
    const designation = employeeData.designation || employeeData.Designation || '';

    // Create user
    const user = await User.create({
      institutionId,
      name,
      email,
      designation,
      password,
      role: 'user' // Default role
    });

    // Delete OTP record after successful registration
    await Otp.deleteOne({ institutionId });

    res.status(201).json({
      _id: user._id,
      institutionId: user.institutionId,
      name: user.name,
      designation: user.designation,
      role: user.role,
      token: generateToken(user._id, user.institutionId, user.role),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

// @desc    Reset password for existing user
// @route   POST /api/auth/reset-password
exports.resetPassword = async (req, res) => {
  const { institutionId, otp, newPassword } = req.body;

  try {
    if (!institutionId || !otp || !newPassword) {
      return res.status(400).json({ error: 'Please provide institutionId, OTP, and newPassword' });
    }

    const otpRecord = await Otp.findOne({ institutionId });
    if (!otpRecord) {
      return res.status(400).json({ error: 'OTP expired or not found. Please request a new one.' });
    }
    
    if (otpRecord.otp !== otp) {
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    const user = await User.findOne({ institutionId });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.password = newPassword;
    await user.save();

    await Otp.deleteOne({ institutionId });

    res.status(200).json({ message: 'Password reset successful' });
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
        designation: user.designation,
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

// @desc    Change password for logged in user
// @route   PUT /api/auth/change-password
exports.changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  try {
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!(await user.comparePassword(currentPassword))) {
      return res.status(401).json({ error: 'Incorrect current password' });
    }

    user.password = newPassword;
    await user.save();

    res.status(200).json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};
