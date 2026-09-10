const express = require('express');
const webpush = require('web-push');
const cors = require('cors');
const Astronomy = require('astronomy-engine');

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

// Προεπιλεγμένη τοποθεσία παρατήρησης (Κεντρική Μακεδονία / Θεσσαλονίκη)
const OBSERVER = new Astronomy.Observer(40.76, 22.58, 20);

// Πλανήτες προς παρακολούθηση
const PLANETS = [
  { body: Astronomy.Body.Venus, name: 'η Αφροδίτη' },
  { body: Astronomy.Body.Mars, name: 'ο Άρης' },
  { body: Astronomy.Body.Jupiter, name: 'ο Δίας' },
  { body: Astronomy.Body.Saturn, name: 'ο Κρόνος' }
];

// Αποφυγή διπλών ειδοποιήσεων
const sentAlerts = new Set();

// Συνάρτηση αποστολής push notification
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

// Αυτόνομος ελεγκτής: Εκτελείται κάθε 60 δευτερόλεπτα
setInterval(() => {
  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);

  // 1. Καθημερινό Alert στις 20:00 Ώρα Ελλάδας (UTC+3)
  const greeceHour = (now.getUTCHours() + 3) % 24;
  const greeceMinutes = now.getUTCMinutes();
  const dailyKey = `daily-summary-${dateKey}`;

  if (greeceHour === 20 && greeceMinutes === 0 && !sentAlerts.has(dailyKey)) {
    sentAlerts.add(dailyKey);
    let summaryText = '🔭 Αποψινές ανατολές πλανητών:\n';
    for (const p of PLANETS) {
      const nextRise = Astronomy.SearchRiseSet(p.body, OBSERVER, +1, now, 1);
      if (nextRise && nextRise.date) {
        const riseDate = new Date(nextRise.date.getTime() + 3 * 3600000); // ώρα Ελλάδας
        const timeStr = riseDate.toISOString().slice(11, 16);
        summaryText += `• ${p.name}: ${timeStr}\n`;
      }
    }
    broadcast(summaryText.trim());
  }

  // 2. Έλεγχος σε πραγματικό χρόνο για κάθε πλανήτη (-15 λεπτά & 0 λεπτά)
  for (const p of PLANETS) {
    const riseInfo = Astronomy.SearchRiseSet(p.body, OBSERVER, +1, now, 1);
    if (!riseInfo || !riseInfo.date) continue;

    const diffMinutes = Math.round((riseInfo.date.getTime() - now.getTime()) / 60000);
    const eventHour = riseInfo.date.getUTCHours();

    // Ειδοποίηση 15 λεπτά πριν
    const preKey = `pre-15-${p.name}-${dateKey}-${eventHour}`;
    if (diffMinutes >= 14 && diffMinutes <= 16 && !sentAlerts.has(preKey)) {
      sentAlerts.add(preKey);
      broadcast(`✨ Σε 15 λεπτά ανατέλλει ${p.name}!`);
    }

    // Ειδοποίηση ακριβώς στην ανατολή
    const riseKey = `rise-now-${p.name}-${dateKey}-${eventHour}`;
    if (diffMinutes >= 0 && diffMinutes <= 1 && !sentAlerts.has(riseKey)) {
      sentAlerts.add(riseKey);
      broadcast(`🪐 Ανατέλλει τώρα ${p.name}!`);
    }
  }

  // Καθαρισμός παλιών εγγραφών
  if (sentAlerts.size > 200) sentAlerts.clear();
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
  console.log(`Νέα συσκευή συνδέθηκε! Σύνολο συσκευών: ${clients.length}`);
  res.status(200).json({ success: true });
});

// Endpoint δοκιμής
app.get('/api/test-notify', async (req, res) => {
  await broadcast('τεστ 123');
  res.status(200).send(`Στάλθηκε δοκιμαστική ειδοποίηση σε ${clients.length} συσκευές!`);
});

app.listen(PORT, () => {
  console.log(`Ο server του APLANUS τρέχει στη θύρα ${PORT}`);
});
