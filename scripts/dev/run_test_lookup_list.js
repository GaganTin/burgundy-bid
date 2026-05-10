const fetch = global.fetch || (await import('node-fetch')).default;

const BASE = 'http://localhost:3001';

async function signupOrSignin() {
  const signinRes = await fetch(`${BASE}/auth/signin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'devtest+1@example.com', password: 'password123' })
  });
  if (signinRes.ok) return signinRes.json();
  const signupRes = await fetch(`${BASE}/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_name: 'Dev Test', email: 'devtest+1@example.com', password: 'password123' })
  });
  if (!signupRes.ok) throw new Error('Signup failed: ' + await signupRes.text());
  return signupRes.json();
}

async function createBatch(token, batchId) {
  const records = [
    { wine_name: 'Chateau Margaux', vintage: '2015', size: '750ml', batch_id: batchId, status: 'pending' },
    { wine_name: 'Domaine de la Romanée-Conti La Tâche', vintage: '2016', size: '750ml', batch_id: batchId, status: 'pending' }
  ];
  const res = await fetch(`${BASE}/entities/WineLookup/bulk`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(records)
  });
  const json = await res.json();
  return json;
}

async function runLookup(token, batchId) {
  await fetch(`${BASE}/lookup/${batchId}/run`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
}

async function pollStatuses(token, batchId, timeoutMs = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await new Promise(r => setTimeout(r, 3000));
    const res = await fetch(`${BASE}/entities/WineLookup?batch_id=${encodeURIComponent(batchId)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { console.log('Failed to fetch batch rows:', await res.text()); continue; }
    const rows = await res.json();
    console.log('Statuses:', rows.map(r => `${r.wine_name} -> ${r.status}`).join(', '));
    if (rows.every(r => r.status && r.status !== 'pending')) return rows;
  }
  throw new Error('Timeout waiting for batch to complete');
}

(async () => {
  try {
    const auth = await signupOrSignin();
    const token = auth.token;
    console.log('Got token for user', auth.user?.id);

    const batchId = `list_test_${Date.now()}_${Math.floor(Math.random()*9000+1000)}`;
    console.log('Creating batch', batchId);
    const created = await createBatch(token, batchId);
    console.log('Created records:', created.length || created);

    console.log('Starting lookup');
    await runLookup(token, batchId);

    console.log('Polling statuses...');
    const final = await pollStatuses(token, batchId, 120000);
    console.log('Final rows:', final);

    // check batches endpoint to ensure it shows up under paste tab
    const bres = await fetch(`${BASE}/batches?tab=paste`, { headers: { Authorization: `Bearer ${token}` } });
    console.log('/batches?tab=paste ->', await bres.json());
  } catch (err) {
    console.error('Error:', err);
    process.exitCode = 1;
  }
})();
