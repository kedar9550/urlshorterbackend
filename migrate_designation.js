require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const User = require('./models/User');

const DB_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/url-shortener';

async function run() {
  try {
    await mongoose.connect(DB_URI);
    console.log('Connected to MongoDB');
    
    // Find all users who don't have a designation or whose designation is empty
    const users = await User.find({
      $or: [
        { designation: { $exists: false } },
        { designation: '' }
      ]
    });
    
    console.log(`Found ${users.length} users to update.`);
    
    for (const user of users) {
      try {
        console.log(`Fetching data for ${user.institutionId}...`);
        const response = await axios.get(`https://info.aec.edu.in/adityaAPI/API/staffdata/${user.institutionId}`);
        const data = response.data?.[0];
        
        if (data && (data.designation || data.Designation)) {
          const designation = data.designation || data.Designation;
          user.designation = designation;
          await user.save();
          console.log(`✅ Updated ${user.institutionId} -> ${designation}`);
        } else {
          console.log(`⚠️ No designation found for ${user.institutionId} from API.`);
        }
      } catch (err) {
        console.error(`❌ Failed to fetch/update for ${user.institutionId}:`, err.message);
      }
    }
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
    process.exit(0);
  }
}

run();
