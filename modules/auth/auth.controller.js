const UserModel = require("./auth.model");
const authService = require("./auth.service");
const mongoose = require('mongoose')
const axios = require('axios')

const generateToken = require("../../utils/generateToken");
const { sendOtpMail } = require("../../services/mailService");
const { sendOtpSms } = require("../../services/smsService");
const UserAppRole = require("./userAppRole.model");

const Role = require("../role/role.model");

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");

const isProd = process.env.NODE_ENV?.toLowerCase() === "production";

/* ===================================================
   REGISTER
===================================================*/

const registerUser = async (req, res) => {
    try {

        const {
            fullname, id, department, designation,
            email, phone, password, userType
        } = req.body;

        if (!fullname || !id || !department || !designation ||
            !email || !phone || !password || !userType) {
            return res.status(400).json({
                message: "All fields required"
            });
        }

        const existing = await UserModel.findOne({
            institutionId: id
        });

        if (existing) {
            return res.status(409).json({
                message: "User already exists"
            });
        }

        // Verify Identity with Institute API (Persona Check)
        try {
            let identityResponse;

            if (userType === "Employee") {
                identityResponse = await axios.get(
                    `https://info.aec.edu.in/adityaAPI/API/staffdata/${id}`
                );
            } else if (userType === "Student") {
                identityResponse = await axios.get(
                    `https://info.aec.edu.in/adityaapi/api/studentdata/${id}`
                );
            }

            const identityData = identityResponse?.data?.[0];

            if (!identityData || identityData.error) {
                return res.status(404).json({
                    message: `Invalid ${userType} ID. Not found in ECAP`
                });
            }

            // Strict Data Matching
            if (userType === "Employee") {
                const ecapName = (identityData.employeename || identityData.EmployeeName)?.trim().toLowerCase();
                const ecapDesignation = (identityData.designation || identityData.Designation || identityData.DesignationName)?.trim();

                if (ecapName && ecapName !== fullname.trim().toLowerCase()) {
                    return res.status(400).json({
                        message: "Name does not match Institute records"
                    });
                }

                if (ecapDesignation && ecapDesignation.toLowerCase() !== designation.trim().toLowerCase()) {
                    return res.status(400).json({
                        message: `Designation does not match Institute records. Expected: ${ecapDesignation}`
                    });
                }
            } else if (userType === "Student") {
                const ecapName = (identityData.studentname || identityData.StudentName)?.trim().toLowerCase();
                const ecapBranch = (identityData.branch || identityData.Branch)?.trim();

                if (ecapName && ecapName !== fullname.trim().toLowerCase()) {
                    return res.status(400).json({
                        message: "Name does not match Institute records"
                    });
                }

                if (ecapBranch && ecapBranch.toLowerCase() !== department.trim().toLowerCase()) {
                    return res.status(400).json({
                        message: `Department/Branch does not match Institute records. Expected: ${ecapBranch}`
                    });
                }
            }

        } catch (apiErr) {
            console.error("ECAP ERROR:", apiErr.message);

            return res.status(500).json({
                message: "ECAP verification failed. Try again later."
            });
        }

        // Create User
        const user = await UserModel.create({
            name: fullname,
            institutionId: id,
            department,
            designation,
            email,
            phone,
            password,
            userType
        });

        const defaultRole = await Role.findOne({
            name: "USER",
            app: process.env.APP_NAME || "DIGITAL_SERVICE_SYSTEM"
        });

        if (!defaultRole) {
            return res.status(500).json({
                message: "Default role not configured"
            });
        }

        await UserAppRole.create({
            userId: user._id,
            app: process.env.APP_NAME || "DIGITAL_SERVICE_SYSTEM",
            role: defaultRole._id,
            service: null
        });

        const roles = [{
            role: defaultRole.name,
            service: null,
            permissions: [] // New users with default role typically have no special permissions yet
        }];


        res.status(201).json({
            message: "User registered",
            user: {
                _id: user._id,
                name: user.name,
                institutionId: user.institutionId,
                email: user.email,
                phone: user.phone,
                department: user.department,
                designation: user.designation,
                userType: user.userType,
                profileImage: user.profileImage,
                roles
            }
        });

    } catch (e) {
        console.error("Register error:", e);
        res.status(500).json({ message: e.message });
    }
};
/* ===================================================
   LOGIN (NEW ENTERPRISE FLOW)
===================================================*/
const validateUser = async (req, res) => {

    try {

        const { id, password, app } = req.body;

        if (!id || !password || !app) {
            return res.status(400).json({
                message: "id,password,app required"
            });
        }

        const data =
            await authService.loginUser(
                id, password, app
            );

        generateToken({
            userId: data.user._id,
            app,
            roles: data.roles
        }, res);

        res.json({
            message: "Login success",
            user: {
                _id: data.user._id,
                name: data.user.name,
                institutionId: data.user.institutionId,
                email: data.user.email,
                roles: data.roles,
                profileImage: data.user.profileImage,
                department: data.user.department,
                designation: data.user.designation,
                userType: data.user.userType,
                phone: data.user.phone
            }
        });

    } catch (e) {
        res.status(401).json({
            message: e.message
        });
    }
};


/* ===================================================
   CHANGE PASSWORD
===================================================*/
const changePassword = async (req, res) => {
    try {

        const { oldPassword, newPassword } = req.body;

        const user =
            await UserModel.findById(req.user._id);

        if (!user)
            return res.status(404).json({
                message: "User not found"
            });

        const match =
            await user.comparePassword(oldPassword);

        if (!match)
            return res.status(400).json({
                message: "Old password wrong"
            });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        await UserModel.updateOne(
            { _id: user._id },
            { $set: { password: hashedPassword } }
        );

        res.json({
            message: "Password updated"
        });

    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};


/* ===================================================
   FORGOT PASSWORD
===================================================*/
const forgotPassword = async (req, res) => {
    try {
        const { institutionId } = req.body;

        if (!institutionId) {
            return res.status(400).json({ message: "Employee ID is required" });
        }

        const user = await UserModel.findOne({ institutionId });

        if (!user) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        // Verify user has a role in this app
        const appName = process.env.APP_NAME || "DIGITAL_SERVICE_SYSTEM";
        const appMapping = await UserAppRole.findOne({
            userId: user._id,
            app: appName
        });

        if (!appMapping) {
            return res.status(403).json({
                message: "User not authorized for this application"
            });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

        user.otp = hashedOtp;
        user.otpExpiry = Date.now() + 10 * 60 * 1000;

        await user.save();

        // Send OTP via SMS
        const lastDigits = user.phone ? user.phone.slice(-4) : "****";
        await sendOtpSms(user.phone, user.name, otp);

        res.json({
            message: `OTP sent to your registered mobile number ending in ${lastDigits}`,
            lastDigits: lastDigits
        });

    } catch (e) {
        console.error("Forgot Password Error:", e);
        res.status(500).json({ message: e.message });
    }
};


/* ===================================================
   VERIFY OTP
===================================================*/
const verifyOtp = async (req, res) => {
    try {
        const { institutionId, otp } = req.body;

        if (!institutionId || !otp) {
            return res.status(400).json({ message: "Employee ID and OTP are required" });
        }

        const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

        const user = await UserModel.findOne({
            institutionId,
            otp: hashedOtp,
            otpExpiry: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).json({
                message: "Invalid or expired OTP"
            });
        }

        res.json({
            message: "OTP verified successfully"
        });

    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};


/* ===================================================
   RESET PASSWORD
===================================================*/
const resetPasswordWithOtp = async (req, res) => {
    try {
        const { institutionId, otp, newPassword } = req.body;

        if (!institutionId || !otp || !newPassword) {
            return res.status(400).json({ message: "Employee ID, OTP, and New Password are required" });
        }

        const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

        const user = await UserModel.findOne({
            institutionId,
            otp: hashedOtp,
            otpExpiry: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).json({
                message: "Invalid or expired OTP"
            });
        }

        user.password = newPassword;
        user.otp = null;
        user.otpExpiry = null;

        await user.save();

        res.json({
            message: "Password reset successfully"
        });

    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};


/* ===================================================
   PROFILE
===================================================*/
const getMe = async (req, res) => {
    try {
        const user = await UserModel.findById(req.user._id);
        if (!user) return res.status(404).json({ message: "User not found" });

        // Lazy Sync: If designation, name, or department is missing, try to fetch from ECAP
        if (!user.designation || !user.name || !user.department) {
            try {
                let identityResponse;
                const userType = user.userType || "Employee";

                if (userType === "Employee") {
                    identityResponse = await axios.get(
                        `https://info.aec.edu.in/adityaAPI/API/staffdata/${user.institutionId}`
                    );
                } else {
                    identityResponse = await axios.get(
                        `https://info.aec.edu.in/adityaapi/api/studentdata/${user.institutionId}`
                    );
                }

                const identityData = identityResponse?.data?.[0];
                if (identityData && !identityData.error) {
                    const ecapName = (userType === "Employee" ? (identityData.employeename || identityData.EmployeeName) : (identityData.studentname || identityData.StudentName));
                    const ecapDesignation = (userType === "Employee" ? (identityData.designation || identityData.Designation || identityData.DesignationName) : "Student");
                    const ecapDepartment = (userType === "Employee" ? identityData.DepartmentName : (identityData.branch || identityData.Branch));

                    if (ecapName) user.name = ecapName;
                    if (ecapDesignation) user.designation = ecapDesignation;
                    if (ecapDepartment) user.department = ecapDepartment;

                    await user.save();
                }
            } catch (syncErr) {
                console.error("Lazy Sync Error:", syncErr.message);
            }
        }

        res.json({
            user: {
                ...user.toObject(),
                roles: req.user.roles
            }
        });
    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
};

const jwt = require("jsonwebtoken");

const logoutUser = async (req, res) => {
    try {
        const { fcmToken } = req.body;
        const token = req.cookies.token;

        if (token && fcmToken) {
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                await UserModel.findByIdAndUpdate(decoded.userId, {
                    $pull: { fcmTokens: fcmToken }
                });
            } catch (err) {
                // Token might be invalid/expired, ignore and proceed to clear cookie
                console.warn("Logout token error or expired:", err.message);
            }
        }
    } catch (error) {
        console.error("Logout Error:", error);
    }

    res.clearCookie("token", {
        httpOnly: true,
        secure: true,
        sameSite: "none"
    });

    res.json({ message: "Logged out" });
};


const updateProfile = async (req, res) => {
    try {
        const allowedFields = ["name", "phone", "department", "institutionId", "designation", "email"];

        //console.log("Update Profile Data:", req.body);

        const updates = {};
        allowedFields.forEach((field) => {
            if (req.body[field]) updates[field] = req.body[field];
        });

        const user = await UserModel.findByIdAndUpdate(
            req.user._id,
            updates,
            { new: true }
        );

        res.json({ user });
    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
};



const profileImage = async (req, res) => {
    try {
        if (!req.file) {
            console.warn("[ProfileImage] No file received in request");
            return res.status(400).json({ message: "No file uploaded" });
        }

        const user = await UserModel.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        console.log(`[ProfileImage] User ${user._id} uploading ${req.file.filename}`);

        // Delete old image if exists
        if (user.profileImage && user.profileImage !== req.file.filename) {
            const oldPath = path.join(
                __dirname,
                "..",
                "..",
                "uploads",
                "profile",
                user.profileImage
            );

            if (fs.existsSync(oldPath)) {
                try {
                    fs.unlinkSync(oldPath);
                    console.log(`[ProfileImage] Deleted old image: ${user.profileImage}`);
                } catch (unlinkErr) {
                    console.error("[ProfileImage] Failed to delete old image:", unlinkErr);
                }
            }
        }

        // Save only filename
        await UserModel.updateOne(
            { _id: user._id },
            { $set: { profileImage: req.file.filename } }
        );

        console.log(`[ProfileImage] Database updated for user ${user._id}`);

        res.json({
            message: "Image uploaded successfully",
            image: req.file.filename
        });

    } catch (err) {
        console.error("[ProfileImage] Error:", err);
        res.status(500).json({ message: "Upload failed: " + err.message });
    }
};



const createAdmin = async (req, res) => {
    try {
        const { name, email, password, serviceId } = req.body;

        const existing = await User.findOne({ email });
        if (existing)
            return res.status(400).json({ message: "Email already exists" });

        const admin = await User.create({ name, email, password });

        const adminRole = await Role.findOne({ name: "ADMIN" });

        await UserAppRole.create({
            userId: admin._id,
            app: process.env.APP_NAME || "DIGITAL_SERVICE_SYSTEM",
            role: adminRole._id,
            service: serviceId
        });

        res.status(201).json({ message: "Admin created successfully" });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
const searchUser = async (req, res) => {
    try {
        const { query } = req.query;

        if (!query) {
            return res.status(400).json({ message: "Search query required" });
        }

        const isNumeric = /^[0-9]+$/.test(query);

        let searchCondition;

        if (isNumeric) {
            // Search by institutionId
            searchCondition = { institutionId: query };
        } else {
            // Search by name
            searchCondition = {
                name: { $regex: query, $options: "i" }
            };
        }

        const users = await UserModel.find(searchCondition)
            .select("name institutionId email userType");

        if (!users.length) {
            return res.status(404).json({ message: "User not found" });
        }

        res.status(200).json(users);

    } catch (error) {
        console.error("Search Error:", error);
        res.status(500).json({ message: error.message });
    }
};




const getecapdata = async (req, res) => {
    try {
        const { institutionId, role } = req.body;

        let response;

        if (role === "Employee") {
            response = await axios.get(
                `https://info.aec.edu.in/adityaAPI/API/staffdata/${institutionId}`

            );
        } else if (role === "Student") {
            response = await axios.get(
                `https://info.aec.edu.in/adityaapi/api/studentdata/${institutionId}`

            );
        }

        const data = response.data?.[0]; // API returns array

        res.json(data);
    } catch (error) {
        console.error("API ERROR:", error.response?.data || error.message);

        res.status(500).json({
            message: "Failed to fetch data",
        });
    }
};




const getActiveUsersCount = async (req, res) => {
    try {
        const { appName, roleName } = req.query;

        if (!appName) {
            return res.status(400).json({ message: "App name is required" });
        }

        let query = { app: appName };

        // If roleName is provided, find the role ID first
        if (roleName) {
            const role = await Role.findOne({ name: roleName.toUpperCase(), app: appName });
            if (role) {
                query.role = role._id;
            } else {
                // If role doesn't exist for this app, count is 0
                return res.json({ activeUsers: 0 });
            }
        }

        const uniqueUsers = await UserAppRole.distinct("userId", query);

        res.json({
            activeUsers: uniqueUsers.length
        });
    } catch (error) {
        console.error("Active Users Count Error:", error);
        res.status(500).json({ message: error.message });
    }
};


const saveFcmToken = async (req, res) => {
    try {
        const { fcmToken } = req.body;
        const userId = req.user._id; // from authMiddleware

        if (!fcmToken) {
            return res.status(400).json({ message: "FCM token is required" });
        }

        await UserModel.findByIdAndUpdate(userId, { $addToSet: { fcmTokens: fcmToken } });

        res.json({ message: "FCM token saved successfully" });
    } catch (error) {
        console.error("Save FCM Token Error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

module.exports = {
    registerUser,
    validateUser,
    changePassword,
    forgotPassword,
    verifyOtp,
    resetPasswordWithOtp,
    logoutUser,
    getMe,
    updateProfile,
    profileImage,
    createAdmin,
    searchUser,
    getecapdata,
    getActiveUsersCount,
    saveFcmToken,
};
