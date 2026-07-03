const jwt = require("jsonwebtoken");

const usermodel = require('../modules/auth/auth.model');

module.exports = async (req, res, next) => {

    const token = req.cookies.token;

    if (!token)
        return res.status(401).json({ message: "No token" });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const userdata = await usermodel.findById(decoded.userId);

        req.user = {
            _id: decoded.userId,
            roles: decoded.roles,
            name: userdata.name,
            institutionId: userdata.institutionId,
            department: userdata.department,
            designation: userdata.designation,
            phone: userdata.phone,
            profileImage: userdata.profileImage
        };

        next();

    } catch (err) {
        return res.status(401).json({ message: "Invalid token" });
    }
};
