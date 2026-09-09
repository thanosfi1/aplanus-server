const express = require('express');
const webpush = require('web-push');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Ανάγνωση στοιχείων από τα Environment Variables του Render
const PUBLIC_VAPID_KEY = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_VAPID_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:thanosfotis3@gmail.com';

if (PUBLIC_VAPID_KEY && PRIVATE_VAPID_KEY) {
  webpush.setVapidDetails(
    VAPID_SUBJECT,
    PUBLIC_VAPID_KEY,
    PRIVATE_VAPID_KEY
  );
} else {
  console.error('ΠΡΟΣΟΧΗ: Τα VAPID_PUBLIC_KEY ή VAPID_PRIVATE_KEY δεν έχουν οριστεί στο Render!');
}

let clients = [];

// Keep-Alive endpoint για UptimeRobot
app.get('/ping', (req, res) => {
  res.status(200).send('Pong!');
});

// Endpoint εγγραφής συσκευής
app.post('/api/subscribe', (req, res) => {
  const subscription = req.body;

  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Μη έγκυρο subscription object' });
  }

  const alreadySubscribed = clients.some(c => c.endpoint === subscription.endpoint);
  if (!alreadySubscribed) {
    clients.push(subscription);
  }

  console.log(`Νέα συσκευή συνδέθηκε! Σύνολο συσκευών: ${clients.length}`);
  res.status(200).json({ success: true });
});

// Endpoint δοκιμαστικής αποστολής
app.get('/api/test-notify', async (req, res) => {
  const payload = JSON.stringify({
    title: 'APLANUS',
    body: 'τεστ 123'
  });

  let sent = 0;
  const activeClients = [];

  for (const client of clients) {
    try {
      await webpush.sendNotification(client, payload);
      activeClients.push(client);
      sent++;
    } catch (err) {
      console.error('Αποτυχία αποστολής σε client:', err.statusCode || err.message || err);
      if (err.statusCode !== 404 && err.statusCode !== 410) {
        activeClients.push(client);
      }
    }
  }

  clients = activeClients;
  res.status(200).send(`Στάλθηκε δοκιμαστική ειδοποίηση σε ${sent} συσκευές!`);
});

app.listen(PORT, () => {
  console.log(`Ο server του APLANUS τρέχει στη θύρα ${PORT}`);
});
