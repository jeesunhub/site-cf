const http = require('http');

const userId = 1; // Assuming 1 exists as landlord1
const options = {
    hostname: 'localhost',
    port: 3000,
    path: `/api/users/${userId}`,
    method: 'GET',
};

const req = http.request(options, (res) => {
    console.log(`STATUS: ${res.statusCode}`);
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    res.on('end', () => {
        console.log(`BODY: ${data}`);
    });
});

req.on('error', (e) => {
    console.error(`problem with request: ${e.message}`);
});

req.end();
