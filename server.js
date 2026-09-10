const express = require('express');
const webpush = require('web-push');
const cors = require('cors');
const Astronomy = require('astronomy-engine');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// VAPID Configuration
const PUBLIC_VAPID_KEY = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_VAPID_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:thanosfotis3@gmail.com';

if (PUBLIC_VAPID_KEY && PRIVATE_VAPID_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, PUBLIC_VAPID_KEY, PRIVATE_VAPID_KEY);
} else {
  console.error('ΠΡΟΣΟΧΗ: Τα VAPID keys δεν βρέθηκαν!');
}

let clients = [];

// Τοποθεσία παρατήρησης
const OBSERVER = new Astronomy.Observer(40.76, 22.58, 20);

// Πλήρης λίστα ουράνιων σωμάτων
const PLANETS = [
  { body: Astronomy.Body.Mercury, name: 'ο Ερμής' },
  { body: Astronomy.Body.Venus,   name: 'η Αφροδίτη' },
  { body: Astronomy.Body.Mars,    name: 'ο Άρης' },
  { body: Astronomy.Body.Jupiter, name: 'ο Δίας' },
  { body: Astronomy.Body.Saturn,  name: 'ο Κρόνος' },
  { body: Astronomy.Body.Uranus,  name: 'ο Ουρανός' },
  { body: Astronomy.Body.Neptune, name: 'ο Ποσειδώνας' },
  { body: Astronomy.Body.Pluto,   name: 'ο Πλούτωνας' }
];

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
      console.error('Σφάλμα αποστολής:', err.statusCode || err.message);
      if (err.statusCode !== 404 && err.statusCode !== 410) {
        activeClients.push(client);
      }
    }
  }
  clients = activeClients;
}

// Αυτόματος έλεγχος ανά λεπτό
setInterval(() => {
  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);

  // 1. Καθημερινό Alert στις 20:00 (Ώρα Ελλάδας UTC+3)
  const greeceHour = (now.getUTCHours() + 3) % 24;
  const greeceMinutes = now.getUTCMinutes();
  const dailyKey = `daily-summary-${dateKey}`;

  if (greeceHour === 20 && greeceMinutes === 0 && !sentAlerts.has(dailyKey)) {
    sentAlerts.add(dailyKey);
    let summaryText = '🔭 Αποψινές ανατολές:\n';
    for (const p of PLANETS) {
      const nextRise = Astronomy.SearchRiseSet(p.body, OBSERVER, +1, now, 1);
      if (nextRise && nextRise.date) {
        const riseDate = new Date(nextRise.date.getTime() + 3 * 3600000);
        summaryText += `• ${p.name}: ${riseDate.toISOString().slice(11, 16)}\n`;
      }
    }
    broadcast(summaryText.trim());
  }

  // 2. Ειδοποιήσεις 15 λεπτά πριν & ακριβώς στην ανατολή
  for (const p of PLANETS) {
    const riseInfo = Astronomy.SearchRiseSet(p.body, OBSERVER, +1, now, 1);
    if (!riseInfo || !riseInfo.date) continue;

    const diffMinutes = Math.round((riseInfo.date.getTime() - now.getTime()) / 60000);
    const eventHour = riseInfo.date.getUTCHours();

    const preKey = `pre-15-${p.name}-${dateKey}-${eventHour}`;
    if (diffMinutes >= 14 && diffMinutes <= 16 && !sentAlerts.has(preKey)) {
      sentAlerts.add(preKey);
      broadcast(`✨ Σε 15 λεπτά ανατέλλει ${p.name}!`);
    }

    const riseKey = `rise-now-${p.name}-${dateKey}-${eventHour}`;
    if (diffMinutes >= 0 && diffMinutes <= 1 && !sentAlerts.has(riseKey)) {
      sentAlerts.add(riseKey);
      broadcast(`🪐 Ανατέλλει τώρα ${p.name}!`);
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
  console.log(`Νέα συσκευή! Σύνολο: ${clients.length}`);
  res.status(200).json({ success: true });
});

app.get('/api/check-planets', (req, res) => {
  const now = new Date();
  const results = PLANETS.map(p => {
    const riseInfo = Astronomy.SearchRiseSet(p.body, OBSERVER, +1, now, 1);
    if (!riseInfo || !riseInfo.date) {
      return { planet: p.name, error: 'Δεν βρέθηκε ανατολή' };
    }
    const diffMinutes = Math.round((riseInfo.date.getTime() - now.getTime()) / 60000);
    const greeceTime = new Date(riseInfo.date.getTime() + 3 * 3600000).toISOString().slice(11, 16);
    return {
      planet: p.name,
      riseTimeGreece: greeceTime,
      minutesUntilRise: diffMinutes
    };
  });

  res.json({
    serverTimeUTC: now.toISOString(),
    planets: results
  });
});

app.get('/api/test-notify', async (req, res) => {
  await broadcast('τεστ 123');
  res.status(200).send(`Στάλθηκε δοκιμαστική ειδοποίηση σε ${clients.length} συσκευές!`);
});

app.listen(PORT, () => {
  console.log(`Ο server του APLANUS τρέχει στη θύρα ${PORT}`);
});
