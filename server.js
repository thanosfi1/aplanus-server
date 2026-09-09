const express = require('express');
const webpush = require('web-push');
const cors = require('cors');
const cron = require('node-cron');
const Astronomy = require('astronomy-engine');

const app = express();
app.use(cors());
app.use(express.json());

// Εισαγωγή των κλειδιών VAPID
const PUBLIC_VAPID = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
const PRIVATE_VAPID = "UUx118h5-rXzD0W4_rM8n9f0Wk4J9KzL2Q0_kZkX0-A";
webpush.setVapidDetails('mailto:aplanus@app.com', PUBLIC_VAPID, PRIVATE_VAPID);


let clients = [];

// Endpoint για keep-alive (UptimeRobot)
app.get('/ping', (req, res) => res.send('Pong!'));

// Endpoint εγγραφής συνδρομητή
app.post('/api/subscribe', (req, res) => {
  const { subscription, coords } = req.body;
  clients = clients.filter(c => c.subscription.endpoint !== subscription.endpoint);
  clients.push({ subscription, coords });
  res.status(200).json({ status: 'ok' });
});

// Έλεγχος κάθε 5 λεπτά για επερχόμενες ανατολές
cron.schedule('*/5 * * * *', () => {
  const now = new Date();
  const bodies = [
    { name: "Σελήνη", body: Astronomy.Body.Moon },
    { name: "Δίας", body: Astronomy.Body.Jupiter },
    { name: "Κρόνος", body: Astronomy.Body.Saturn },
    { name: "Άρης", body: Astronomy.Body.Mars },
    { name: "Αφροδίτη", body: Astronomy.Body.Venus }
  ];

  clients.forEach(client => {
    const obs = new Astronomy.Observer(client.coords.lat, client.coords.lon, 0);
    bodies.forEach(b => {
      const rise = Astronomy.SearchRiseSet(b.body, obs, +1, now, 1);
      if (rise && rise.date) {
        const diffMins = Math.round((rise.date.getTime() - now.getTime()) / 60000);
        
        // Ειδοποίηση 10 έως 15 λεπτά πριν την ανατολή
        if (diffMins >= 10 && diffMins <= 15) {
          const payload = JSON.stringify({
            title: `Επερχόμενη Ανατολή: ${b.name}`,
            body: `Το σώμα ${b.name} ανατέλλει σε ${diffMins} λεπτά στον ανατολικό ορίζοντα!`
          });

          webpush.sendNotification(client.subscription, payload).catch(err => {
            if (err.statusCode === 410 || err.statusCode === 404) {
              clients = clients.filter(c => c.subscription.endpoint !== client.subscription.endpoint);
            }
          });
        }
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));
