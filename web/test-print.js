const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';

async function runTest() {
  console.log('--- Starting Print Flow Test ---');

  // 1. Create a tiny dummy image (Base64 JPEG)
  const dummyImageBase64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  const dummyImagePath = path.join(__dirname, 'test-image.jpg');
  fs.writeFileSync(dummyImagePath, Buffer.from(dummyImageBase64, 'base64'));
  console.log('✅ Created dummy test-image.jpg');

  try {
    // 2. Create Guest Session
    console.log('Creating guest session...');
    let res = await fetch(`${BASE_URL}/api/auth/guest`, { method: 'POST' });
    let data = await res.json();
    if (!res.ok) throw new Error(data.error);
    const token = data.token;
    console.log('✅ Session created. Token received.');

    // 3. Upload Image
    console.log('Uploading image to R2...');
    const formData = new FormData();
    const fileBlob = new Blob([fs.readFileSync(dummyImagePath)], { type: 'image/jpeg' });
    formData.append('files', fileBlob, 'test-image.jpg');

    res = await fetch(`${BASE_URL}/api/jobs/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    data = await res.json();
    if (!res.ok) throw new Error(data.error);
    console.log('✅ Image uploaded successfully to R2.');
    console.log('   URL:', data.files[0].url);

    // 4. Submit Job
    console.log('Submitting print job to PRINTER001...');
    res = await fetch(`${BASE_URL}/api/jobs/print`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        printerId: 'PRINTER001',
        settings: { copies: 1, color: false, duplex: false, pageSize: 'A4' }
      })
    });
    data = await res.json();
    
    if (!res.ok) {
      if (res.status === 409) {
        console.error('❌ ERROR: Printer is OFFLINE! The Pi Agent is not connected to the backend.');
        console.error('         Please check the terminal running python app.py on your Raspberry Pi.');
      } else {
        throw new Error(data.error);
      }
    } else {
      console.log('✅ Job submitted successfully!');
      console.log('   Job ID:', data.jobId);
      console.log('   Status:', data.status);
      console.log('\n--> If the Pi Agent is connected, you should see "job:new" in its terminal now!');
    }

  } catch (err) {
    console.error('❌ FATAL ERROR:', err.message);
  } finally {
    fs.unlinkSync(dummyImagePath);
    console.log('--- Test Complete ---');
  }
}

runTest();
