import admin from 'firebase-admin';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf-8'));

admin.initializeApp({
  projectId: firebaseConfig.projectId
});

const db = admin.firestore();
if (firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)') {
  db.settings({ databaseId: firebaseConfig.firestoreDatabaseId });
}

db.collection('candidates').limit(1).get()
  .then(snap => {
    console.log("SUCCESS:", snap.size);
    process.exit(0);
  })
  .catch(err => {
    console.error("ERROR:", err.message);
    process.exit(1);
  });
