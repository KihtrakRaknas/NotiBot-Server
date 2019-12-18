var admin = require('firebase-admin');
const express = require('express');
const PORT = process.env.PORT || 5000
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

var app=express();
app.listen(PORT, () => console.log(`Listening on ${ PORT }`))

app.get('/',(req,res)=>{
    let tokens = [];
    if(req.query.email)
        console.log(admin.auth().getUserByEmail(req.query.email))
    
    req.query.emails
    res.send('Hello World!');
});

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