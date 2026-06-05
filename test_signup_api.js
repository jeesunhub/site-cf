const fetch = require('node-fetch'); // Ensure node-fetch is available or use http

async function testSignup() {
    const payload = {
        login_id: 'test_landlord_' + Date.now(),
        password: 'Password123!',
        nickname: '테스트임대인',
        birth_date: '1980-01-01',
        phone_number: '01012345678',
        role: 'landlord',
        building_id: '',
        room_number: ''
    };

    try {
        const res = await fetch('http://localhost:3000/api/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        console.log('Status:', res.status);
        const data = await res.json();
        console.log('Response:', data);
    } catch (err) {
        console.error('Fetch Error:', err.message);
    }
}

testSignup();
