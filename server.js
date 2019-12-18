var admin = require('firebase-admin');
var serviceAccount;

if(process.env.firebaseKey)
    serviceAccount = JSON.parse(process.env.firebaseKey)
else
    serviceAccount = require("./secureContent/serviceAccountKey.json");
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://notibotapp.firebaseio.com"
  });

  let db = admin.firestore();

  db.collection("cities").doc("SF").get().then(function(doc) {
    if (doc.exists) {
        console.log("Document data:", doc.data());
    } else {
        // doc.data() will be undefined in this case
        console.log("No such document!");
    }
}).catch(function(error) {
    console.log("Error getting document:", error);
});