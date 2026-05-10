const fetch = global.fetch || (await import('node-fetch')).default;
const BASE = 'http://localhost:3001';

async function signin() {
  const res = await fetch(`${BASE}/auth/signin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'devtest+1@example.com', password: 'password123' }) });
  if (!res.ok) throw new Error('Signin failed: ' + await res.text());
  return res.json();
}

(async () => {
  try {
    const auth = await signin();
    const token = auth.token;
    console.log('Token acquired for user', auth.user?.id);
    for (const tab of ['single','paste','upload']) {
      const res = await fetch(`${BASE}/batches?tab=${tab}`, { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      console.log(tab, JSON.stringify(json));
    }
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
})();