const express = require('express');
const webpush = require('web-push');
const cors = require('cors');
const Astronomy = require('astronomy-engine');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Ανάγνωση στοιχείων VAPID από τα Environment Variables του Render
const PUBLIC_VAPID_KEY = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_VAPID_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:thanosfotis3@gmail.com';

if (PUBLIC_VAPID_KEY && PRIVATE_VAPID_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, PUBLIC_VAPID_KEY, PRIVATE_VAPID_KEY);
} else {
  console.error('ΠΡΟΣΟΧΗ: Τα VAPID_PUBLIC_KEY ή VAPID_PRIVATE_KEY δεν έχουν οριστεί στο Render!');
}

// Αποθήκευση συνδρομών (subscriptions) με τοποθεσία και ιστορικό απεσταλμένων
let clients = [];

// Keep-Alive endpoint για UptimeRobot / Cron-job
app.get('/ping', (req, res) => {
  res.status(200).send('Pong! APLANUS server is active.');
});

// Endpoint εγγραφής συσκευής (δέχεται subscription και προαιρετικά συντεταγμένες)
app.post('/api/subscribe', (req, res) => {
  const body = req.body;
  const sub = body.subscription || (body.endpoint ? body : null);
  const lat = Number(body.lat) || 40.9376; // Προεπιλογή: Καβάλα / Ελλάδα
  const lon = Number(body.lon) || 24.4071;

  if (!sub || !sub.endpoint) {
    return res.status(400).json({ error: 'Μη έγκυρο subscription object' });
  }

  // Ανανέωση αν υπάρχει ήδη
  clients = clients.filter(c => (c.sub ? c.sub.endpoint : c.endpoint) !== sub.endpoint);
  clients.push({
    sub: sub,
    lat: lat,
    lon: lon,
    sentKeys: new Set()
  });

  console.log(`Νέα συσκευή συνδέθηκε! [lat: ${lat}, lon: ${lon}] - Σύνολο συσκευών: ${clients.length}`);
  res.status(200).json({ success: true, message: 'Εγγραφή επιτυχής!' });
});

// --- ΑΣΤΡΟΝΟΜΙΚΟΙ ΥΠΟΛΟΓΙΣΜΟΙ ΣΤΟΝ SERVER ---

const MINOR_BODIES = {
  Ceres: { a: 2.767, e: 0.076, I: 10.59, L0: 102.8, w: 73.6, node: 80.3, periodDays: 1680.5 },
  Vesta: { a: 2.362, e: 0.089, I: 7.14,  L0: 20.9,  w: 150.7, node: 103.8, periodDays: 1325.8 }
};

function solveKepler(M, e) {
  let E = M;
  for (let i = 0; i < 15; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-6) break;
  }
  return E;
}

function getMinorBodyAltitude(id, date, observer) {
  const p = MINOR_BODIES[id];
  if (!p) return -90;
  const deg2rad = Math.PI / 180;
  const rad2deg = 180 / Math.PI;

  const d = (date.getTime() - Date.UTC(2000, 0, 1, 12, 0, 0)) / 86400000;
  const n = 360 / p.periodDays;
  const M = ((p.L0 + n * d - p.w) % 360 + 360) % 360 * deg2rad;
  const E = solveKepler(M, p.e);

  const xOrb = p.a * (Math.cos(E) - p.e);
  const yOrb = p.a * Math.sqrt(1 - p.e * p.e) * Math.sin(E);
  const rHelio = Math.sqrt(xOrb * xOrb + yOrb * yOrb);
  const v = Math.atan2(yOrb, xOrb);

  const u = v + (p.w - p.node) * deg2rad;
  const nodeRad = p.node * deg2rad;
  const incRad = p.I * deg2rad;

  const xH = rHelio * (Math.cos(nodeRad) * Math.cos(u) - Math.sin(nodeRad) * Math.cos(u) * Math.cos(incRad));
  const yH = rHelio * (Math.sin(nodeRad) * Math.cos(u) + Math.cos(nodeRad) * Math.sin(u) * Math.cos(incRad));
  const zH = rHelio * (Math.sin(u) * Math.sin(incRad));

  const sunVec = Astronomy.GeoVector(Astronomy.Body.Sun, date, true);
  const xG = xH + sunVec.x;
  const yG = yH + sunVec.y;
  const zG = zH + sunVec.z;
  const delta = Math.sqrt(xG * xG + yG * yG + zG * zG);

  const obl = 23.4392911 * deg2rad;
  const xEq = xG;
  const yEq = yG * Math.cos(obl) - zG * Math.sin(obl);
  const zEq = yG * Math.sin(obl) + zG * Math.cos(obl);

  let ra = Math.atan2(yEq, xEq) * rad2deg / 15;
  if (ra < 0) ra += 24;
  const dec = Math.asin(zEq / delta) * rad2deg;

  const hor = Astronomy.Horizon(date, observer, ra, dec, 'normal');
  return hor.altitude;
}

// Εύρεση της ΕΠΟΜΕΝΗΣ ανατολής στο μέλλον
function findNextRise(bodyId, isMinor, observer, refDate) {
  if (isMinor) {
    const t0 = refDate.getTime();
    let prevAlt = null;
    for (let m = 0; m <= 2880; m += 5) {
      const testD = new Date(t0 + m * 60000);
      const alt = getMinorBodyAltitude(bodyId, testD, observer);
      if (prevAlt !== null && prevAlt < 0 && alt >= 0) {
        const hit = new Date(testD.getTime() - 2.5 * 60000);
        if (hit > refDate) return hit;
      }
      prevAlt = alt;
    }
    return null;
  } else {
    try {
      const b = Astronomy.Body[bodyId];
      const rs = Astronomy.SearchRiseSet(b, observer, +1, refDate, 2);
      if (rs && rs.date && rs.date > refDate) {
        return rs.date;
      }
    } catch (e) {}
    return null;
  }
}

const CELESTIAL_TARGETS = [
  { id: 'Moon',    name: 'Σελήνη',     isMinor: false },
  { id: 'Mercury', name: 'Ερμής',      isMinor: false },
  { id: 'Venus',   name: 'Αφροδίτη',   isMinor: false },
  { id: 'Mars',    name: 'Άρης',       isMinor: false },
  { id: 'Jupiter', name: 'Δίας',       isMinor: false },
  { id: 'Saturn',  name: 'Κρόνος',     isMinor: false },
  { id: 'Uranus',  name: 'Ουρανός',    isMinor: false },
  { id: 'Neptune', name: 'Ποσειδώνας', isMinor: false },
  { id: 'Ceres',   name: 'Δήμητρα',    isMinor: true },
  { id: 'Vesta',   name: '4 Εστία',    isMinor: true },
  { id: 'Pluto',   name: 'Πλούτωνας',  isMinor: false }
];

function formatTimeString(date) {
  return date.toLocaleTimeString('el-GR', {
    timeZone: 'Europe/Athens',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

// Αποστολή Push Notification
async function sendPush(clientSub, title, bodyText) {
  const payload = JSON.stringify({
    title: title,
    body: bodyText
  });

  try {
    await webpush.sendNotification(clientSub, payload);
    return true;
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      // Αν η συσκευή διέγραψε την εφαρμογή, αφαιρούμε το subscription
      clients = clients.filter(c => (c.sub ? c.sub.endpoint : c.endpoint) !== clientSub.endpoint);
    }
    return false;
  }
}

// --- ΑΥΤΟΜΑΤΟ ΡΟΛΟΙ ΕΛΕΓΧΟΥ ΑΝΑΤΟΛΩΝ (ΚΑΘΕ 60 ΔΕΥΤΕΡΟΛΕΠΤΑ) ---
async function checkPlanetaryRises() {
  if (clients.length === 0) return;

  const now = new Date();

  for (const client of clients) {
    const sub = client.sub || client;
    const lat = client.lat || 40.9376;
    const lon = client.lon || 24.4071;
    const observer = new Astronomy.Observer(lat, lon, 0);

    if (!client.sentKeys) client.sentKeys = new Set();

    for (const target of CELESTIAL_TARGETS) {
      try {
        const nextRise = findNextRise(target.id, target.isMinor, observer, now);
        if (!nextRise) continue;

        const diffMs = nextRise.getTime() - now.getTime();
        const diffMins = diffMs / 60000;
        const riseTimeStr = formatTimeString(nextRise);
        const eventId = Math.round(nextRise.getTime() / (10 * 60000)); // Μοναδικό κλειδί ανά 10λεπτο

        // 1. Ειδοποίηση 15 λεπτά ΠΡΙΝ (μεταξύ 14.0 και 15.5 λεπτών)
        const key15m = `${target.id}_15m_${eventId}`;
        if (diffMins <= 15.5 && diffMins >= 13.8 && !client.sentKeys.has(key15m)) {
          client.sentKeys.add(key15m);
          console.log(`[PUSH 15'] ${target.name} σε 15 λεπτά (${riseTimeStr})`);
          await sendPush(
            sub,
            'APLANUS',
            `Το ουράνιο σώμα ${target.name} ανατέλλει σε 15 λεπτά (στις ${riseTimeStr})!`
          );
        }

        // 2. Ειδοποίηση ΑΚΡΙΒΩΣ στην ανατολή (μεταξύ -0.5 και +0.9 λεπτών)
        const keyExact = `${target.id}_exact_${eventId}`;
        if (diffMins <= 0.9 && diffMins >= -0.5 && !client.sentKeys.has(keyExact)) {
          client.sentKeys.add(keyExact);
          console.log(`[PUSH ΤΩΡΑ] ${target.name} ανατέλλει τώρα!`);
          await sendPush(
            sub,
            'APLANUS',
            `Το ουράνιο σώμα ${target.name} ανατέλλει τώρα στον ορίζοντα!`
          );
        }
      } catch (err) {
        console.error(`Σφάλμα ελέγχου για ${target.name}:`, err);
      }
    }
  }
}

// Εκτέλεση ελέγχου κάθε 60 δευτερόλεπτα
setInterval(checkPlanetaryRises, 60000);

// --- TEST & STATUS ENDPOINTS ---

// Δοκιμαστικό απλό τεστ (όπως το είχατε)
app.get('/api/test-notify', async (req, res) => {
  let sent = 0;
  for (const client of clients) {
    const sub = client.sub || client;
    const ok = await sendPush(sub, 'APLANUS', 'Δοκιμαστική ειδοποίηση επιτυχής!');
    if (ok) sent++;
  }
  res.status(200).send(`Στάλθηκε δοκιμαστική ειδοποίηση σε ${sent} συσκευές!`);
});

// Δοκιμαστικό τεστ ανατολής πλανήτη (προσομοίωση)
app.get('/api/test-planet-notify', async (req, res) => {
  let sent = 0;
  for (const client of clients) {
    const sub = client.sub || client;
    const ok = await sendPush(
      sub,
      'APLANUS',
      'Το ουράνιο σώμα Δίας ανατέλλει σε 15 λεπτά (στις 21:45)!'
    );
    if (ok) sent++;
  }
  res.status(200).send(`Στάλθηκε προσομοίωση ανατολής πλανήτη σε ${sent} συσκευές!`);
});

// Επισκόπηση προγράμματος ανατολών (για να βλέπετε πότε θα χτυπήσουν)
app.get('/api/schedule', (req, res) => {
  const now = new Date();
  const observer = new Astronomy.Observer(40.9376, 24.4071, 0); // Καβάλα
  const schedule = CELESTIAL_TARGETS.map(t => {
    const rise = findNextRise(t.id, t.isMinor, observer, now);
    return {
      name: t.name,
      nextRise: rise ? rise.toISOString() : null,
      localTime: rise ? formatTimeString(rise) : null,
      minutesFromNow: rise ? Math.round((rise.getTime() - now.getTime()) / 60000) : null
    };
  }).sort((a, b) => (a.minutesFromNow || 9999) - (b.minutesFromNow || 9999));

  res.json({
    currentTime: formatTimeString(now),
    registeredClients: clients.length,
    schedule: schedule
  });
});

app.listen(PORT, () => {
  console.log(`Ο server του APLANUS τρέχει στη θύρα ${PORT}`);
});
