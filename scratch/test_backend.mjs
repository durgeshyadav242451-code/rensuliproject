async function test() {
  console.log('Sending request to https://wa-api.pgbuilderss.online/api/status?ownerId=123 ...');
  try {
    const start = Date.now();
    const res = await fetch('https://wa-api.pgbuilderss.online/api/status?ownerId=123');
    const duration = (Date.now() - start) / 1000;
    console.log(`Response received in ${duration} seconds.`);
    console.log('Status Code:', res.status);
    const body = await res.text();
    console.log('Response Body:', body);
  } catch (err) {
    console.error('Error fetching backend:', err);
  }
}

test();
