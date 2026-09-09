const express = require('express');
const webpush = require('web-push');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Ρυθμίσεις CORS & JSON parsing
app.use(cors());
app.use(express.json());

// VAPID Κλειδιά
const PUBLIC_VAPID_KEY = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
const PRIVATE_VAPID_KEY = "UUx118h5-rXzD0W4_rM8n9f0Wk4J9KzL2Q0_kZkX0-A";

webpush.setVapidDetails(
  'mailto:aplanus@app.com',
  PUBLIC_VAPID_KEY,
  PRIVATE_VAPID_KEY
);

// Αποθήκευση συνδρομητών στη μνήμη
let clients = [];

// Endpoint για UptimeRobot (Keep-Alive)
app.get('/ping', (req, res) => {
  res.status(200).send('Pong!');
});

// Endpoint εγγραφής νέας συσκευής
app.post('/api/subscribe', (req, res) => {
  const subscription = req.body;

  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Μη έγκυρο subscription object' });
  }

  // Αποφυγή διπλότυπων εγγραφών για την ίδια συσκευή
  const alreadySubscribed = clients.some(c => c.endpoint === subscription.endpoint);
  if (!alreadySubscribed) {
    clients.push(subscription);
  }

  console.log(`Νέα συσκευή συνδέθηκε! Σύνολο συσκευών: ${clients.length}`);
  res.status(200).json({ success: true });
});

// Endpoint δοκιμαστικής αποστολής push notification
app.get('/api/test-notify', async (req, res) => {
  const payload = JSON.stringify({
    title: 'APLANUS Test',
    body: 'Η ειδοποίηση λειτουργεί άψογα!'
  });

  let sent = 0;
  const activeClients = [];

  for (const client of clients) {
    try {
      await webpush.sendNotification(client, payload);
      activeClients.push(client);
      sent++;
    } catch (err) {
      console.error('Αποτυχία αποστολής σε client:', err.statusCode || err);
      // Αν το endpoint έληξε (404/410), δεν το κρατάμε
      if (err.statusCode !== 404 && err.statusCode !== 410) {
        activeClients.push(client);
      }
    }
  }

  clients = activeClients;
  res.status(200).send(`Στάλθηκε δοκιμαστική ειδοποίηση σε ${sent} συσκευές!`);
});

// Εκκίνηση Server
app.listen(PORT, () => {
  console.log(`Ο server του APLANUS τρέχει στη θύρα ${PORT}`);
});
