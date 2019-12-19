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

app.get('/',async (req,res)=>{
    let tokens = [];
    let emailErrs = [];
    if(req.query.email)
        await admin.auth().getUserByEmail(req.query.email).then((userRecord)=>{
            console.log(userRecord.uid)
            return await db.collection("Users").doc(userRecord.uid).get().then(function(doc) {
                if (doc.exists) {
                    console.log("Tokens:", doc.data()["Push Tokens"]);
                    if(doc.data()["Push Tokens"])
                        tokens.push(doc.data()["Push Tokens"])
                    else
                        emailErrs.push(req.query.email);
                } else {
                    // doc.data() will be undefined in this case
                    console.log("No such document!");
                }
            }).catch(function(error) {
                console.log("Error getting document:", error);
                emailErrs.push(req.query.email);
            });
        }).catch((err)=>{
            console.log(err);
            emailErrs.push(req.query.email);
        })
    
    res.json({'# of notifications sent':tokens.length,"# of errors":emailErrs.length,"Failed Emails":emailErrs});
});