const axios = require('axios');

const API_BASE = 'http://localhost:3000/api/dms';
const email = 'center01.manager@dms-sample.lk';
const password = 'Center01@123';

async function testDashboard() {
  try {
    console.log('Logging in...');
    const loginRes = await axios.post('http://localhost:3000/api/auth/login/password', { email, password });
    const token = loginRes.data.token;
    console.log('Login successful');

    const headers = { Authorization: `Bearer ${token}` };

    console.log('Testing /portal/me...');
    const portalRes = await axios.get(`${API_BASE}/portal/me`, { headers });
    console.log('Portal Profile OK');

    console.log('Testing /center/dashboard...');
    const dashboardRes = await axios.get(`${API_BASE}/center/dashboard`, { headers });
    console.log('Dashboard Summary OK');

    console.log('Testing /center/shipments...');
    const shipmentsRes = await axios.get(`${API_BASE}/center/shipments?view=active`, { headers });
    console.log('Shipments OK');

    console.log('Testing /center/rider-queue...');
    const queueRes = await axios.get(`${API_BASE}/center/rider-queue`, { headers });
    console.log('Rider Queue OK');

    const branchId = portalRes.data.branch.id;
    console.log(`Testing /staff for branch ${branchId}...`);
    const staffRes = await axios.get(`${API_BASE}/staff?assignedBranchId=${branchId}&role=delivery_rider`, { headers });
    console.log('Staff OK');

    console.log('All requests passed!');
    process.exit(0);
  } catch (err) {
    console.error('Request failed!');
    if (err.response) {
      console.error('Status:', err.response.status);
      console.error('Data:', JSON.stringify(err.response.data, null, 2));
    } else {
      console.error('Error:', err.message);
    }
    process.exit(1);
  }
}

testDashboard();
