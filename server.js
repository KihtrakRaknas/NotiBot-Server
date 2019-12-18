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
    let emailErrs = [];
    if(req.query.email)
    admin.auth().getUserByEmail(req.query.email).then((userRecord)=>{
        console.log(req.query.email)
        console.log(userRecord.toJSON())
    }).catch((err)=>{
        console.log(err);
        emailErrs.push();
    })
        
    
    req.query.emails
    res.json({'# of notifications sent':tokens.length,});
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