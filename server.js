const express = require('express');
const webpush = require('web-push');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Ρύθμιση VAPID
const PUBLIC_VAPID_KEY = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_VAPID_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:thanosfotis3@gmail.com';

if (PUBLIC_VAPID_KEY && PRIVATE_VAPID_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, PUBLIC_VAPID_KEY, PRIVATE_VAPID_KEY);
} else {
  console.error('ΠΡΟΣΟΧΗ: Τα VAPID keys δεν βρέθηκαν!');
}

let clients = [];
// Αποθήκευση του ενιαίου προγράμματος ανατολών από το frontend
// Format κάθε αντικειμένου: { name: 'ο Δίας', riseTimestamp: 1726010000000 }
let celestialSchedule = [];
const sentAlerts = new Set();

async function broadcast(bodyText) {
  if (clients.length === 0) return;

  const payload = JSON.stringify({
    title: 'APLANUS',
    body: bodyText
  });

  const activeClients = [];
  for (const client of clients) {
    try {
      await webpush.sendNotification(client, payload);
      activeClients.push(client);
    } catch (err) {
      if (err.statusCode !== 404 && err.statusCode !== 410) {
        activeClients.push(client);
      }
    }
  }
  clients = activeClients;
}

// Αυτόνομος έλεγχος ανά λεπτό για ειδοποιήσεις
setInterval(() => {
  const now = Date.now();
  const todayKey = new Date().toISOString().slice(0, 10);

  // 1. Καθημερινό Alert στις 20:00 (Ώρα Ελλάδας UTC+3)
  const greeceHour = (new Date().getUTCHours() + 3) % 24;
  const greeceMinutes = new Date().getUTCMinutes();
  const dailyKey = `daily-summary-${todayKey}`;

  if (greeceHour === 20 && greeceMinutes === 0 && !sentAlerts.has(dailyKey) && celestialSchedule.length > 0) {
    sentAlerts.add(dailyKey);
    let summaryText = '🔭 Αποψινές ανατολές:\n';
    celestialSchedule.forEach(item => {
      const d = new Date(item.riseTimestamp + 3 * 3600000);
      summaryText += `• ${item.name}: ${d.toISOString().slice(11, 16)}\n`;
    });
    broadcast(summaryText.trim());
  }

  // 2. Έλεγχος συμβάντων (-15 λεπτά και 0 λεπτά)
  for (const item of celestialSchedule) {
    const diffMinutes = Math.round((item.riseTimestamp - now) / 60000);

    // 15 λεπτά πριν
    const preKey = `pre-15-${item.name}-${todayKey}-${Math.floor(item.riseTimestamp / 3600000)}`;
    if (diffMinutes >= 14 && diffMinutes <= 16 && !sentAlerts.has(preKey)) {
      sentAlerts.add(preKey);
      broadcast(`✨ Σε 15 λεπτά ανατέλλει ${item.name}!`);
    }

    // Ακριβώς στην ανατολή
    const riseKey = `rise-now-${item.name}-${todayKey}-${Math.floor(item.riseTimestamp / 3600000)}`;
    if (diffMinutes >= 0 && diffMinutes <= 1 && !sentAlerts.has(riseKey)) {
      sentAlerts.add(riseKey);
      broadcast(`🪐 Ανατέλλει τώρα ${item.name}!`);
    }
  }

  if (sentAlerts.size > 300) sentAlerts.clear();
}, 60000);

// Endpoints
app.get('/ping', (req, res) => res.status(200).send('Pong!'));

app.post('/api/subscribe', (req, res) => {
  const subscription = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Μη έγκυρο subscription' });
  }
  if (!clients.some(c => c.endpoint === subscription.endpoint)) {
    clients.push(subscription);
  }
  res.status(200).json({ success: true, count: clients.length });
});

// Νέο Endpoint: Συγχρονισμός ωρών από το frontend
app.post('/api/sync-schedule', (req, res) => {
  const { schedule } = req.body;
  if (!Array.isArray(schedule)) {
    return res.status(400).json({ error: 'Απαιτείται πίνακας schedule' });
  }

  celestialSchedule = schedule;
  console.log(`Συγχρονίστηκαν επιτυχώς ${celestialSchedule.length} σώματα από το frontend.`);
  res.status(200).json({ success: true, total: celestialSchedule.length });
});

// Έλεγχος τρέχοντος προγράμματος
app.get('/api/check-planets', (req, res) => {
  const now = Date.now();
  const preview = celestialSchedule.map(item => ({
    name: item.name,
    riseTimeGreece: new Date(item.riseTimestamp + 3 * 3600000).toISOString().slice(11, 16),
    minutesUntilRise: Math.round((item.riseTimestamp - now) / 60000)
  }));

  res.json({
    totalTracked: celestialSchedule.length,
    planets: preview
  });
});

app.get('/api/test-notify', async (req, res) => {
  await broadcast('τεστ 123');
  res.status(200).send(`Στάλθηκε δοκιμαστική ειδοποίηση σε ${clients.length} συσκευές!`);
});

app.listen(PORT, () => {
  console.log(`Ο server του APLANUS τρέχει στη θύρα ${PORT}`);
});
