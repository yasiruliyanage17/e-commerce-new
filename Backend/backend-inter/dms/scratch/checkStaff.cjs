const mongoose = require('mongoose');
const mongoURI = 'mongodb+srv://admin:123better@cluster0.9v7ko7p.mongodb.net/?appName=Cluster0';

async function checkStaff() {
  try {
    await mongoose.connect(mongoURI);
    const CourierStaff = mongoose.model('CourierStaff', new mongoose.Schema({}, { strict: false }), 'courierstaffs');
    const staff = await CourierStaff.find({ role: 'branch_manager' }).lean();
    console.log(JSON.stringify(staff, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkStaff();
