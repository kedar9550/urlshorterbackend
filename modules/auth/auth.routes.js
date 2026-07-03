const router = require("express").Router();

const controller = require("./auth.controller");
const authorize = require('../../middlewares/permission.middleware')

const profileUpload = require("../../middlewares/profileimag.middleware");


// middleware (you already have or create later)
const authMiddleware =
    require("../../middlewares/auth.middleware");

/* ======================
   PUBLIC ROUTES
====================== */

// register
router.post("/register", controller.registerUser);

// login
router.post("/login", controller.validateUser);

// forgot password
router.post("/forgot-password", controller.forgotPassword);

// verify otp
router.post("/verify-otp", controller.verifyOtp);

// reset password
router.post("/reset-password", controller.resetPasswordWithOtp);


/* ======================
   PROTECTED ROUTES
====================== */

const jwt = require("jsonwebtoken");

router.get("/me", async (req, res, next) => {
    const token = req.cookies.token;
    if (!token) {
        return res.status(200).json({ user: null, message: "Not authenticated" });
    }
    try {
        jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (err) {
        return res.status(200).json({ user: null, message: "Invalid token" });
    }
}, authMiddleware, controller.getMe);

router.put(
    "/change-password",
    authMiddleware,
    controller.changePassword
);

router.put(
    "/update-profile",
    authMiddleware,
    controller.updateProfile
);

router.post(
    "/save-fcm-token",
    authMiddleware,
    controller.saveFcmToken
);

router.post(
    "/profile-change",
    authMiddleware,
    profileUpload.single("image"),
    controller.profileImage
);

router.post(
    "/logout",

    controller.logoutUser
);

router.post(
    "/create-admin",
    authMiddleware,
    authorize("MANAGE_SUBADMINS"),
    controller.createAdmin
);

router.post('/get-ecap-data', controller.getecapdata)

// router.get("/search", authMiddleware, authorize(["MANAGE_SUBADMINS", "MANAGE_TEAM_MEMBERS"]), controller.searchUser);
router.get("/search", authMiddleware, controller.searchUser);

router.get("/active-users-count", authMiddleware, controller.getActiveUsersCount);

module.exports = router;
