const { Expo } = require('expo-server-sdk')
var admin = require('firebase-admin');
const express = require('express');
const PORT = process.env.PORT || 5000
var serviceAccount;

if(process.env.firebaseKey)
    serviceAccount = JSON.parse(process.env.firebaseKey)
else
    serviceAccount = require("./secureContent/serviceAccountKey.json");

let expo = new Expo();

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
    let tokenErrs = []; 
    if(req.query.email)
        await admin.auth().getUserByEmail(req.query.email).then(async(userRecord)=>{
            console.log(userRecord.uid)
            return await db.collection("Users").doc(userRecord.uid).get().then(function (doc) {
                if (doc.exists) {
                    console.log("Tokens:", doc.data()["Push Tokens"]);
                    if(doc.data()["Push Tokens"])
                        tokens.push(doc.data()["Push Tokens"])
                    else
                        emailErrs.push(req.query.email+" has no devices connected to it");
                } else {
                    // doc.data() will be undefined in this case
                    console.log("No such document!");
                    emailErrs.push(req.query.email+" is not a valid email");
                }
            }).catch(function(error) {
                console.log("Error getting document:", error);
                emailErrs.push(req.query.email+" is not a valid email");
            });
        }).catch((err)=>{
            console.log(err);
            emailErrs.push(req.query.email+" is not a valid email");
        })
    let messages = [];
    for(token of tokens){
        console.log(Expo.isExpoPushToken(token))
        console.log(token)
        if (!await Expo.isExpoPushToken(token)) {
            tokenErrs.push(`${token} is not a valid push token`)
            console.log(`Push token ${token} is not a valid Expo push token`);
            continue;
        }
    
      // Construct a message (see https://docs.expo.io/versions/latest/guides/push-notifications.html)
      messages.push({
        to: token,
        sound: 'default',
        body: req.query.body,
        data: { withSome: 'data' },
      })
    }

    let chunks = await expo.chunkPushNotifications(messages);
    let tickets = [];
    // Send the chunks to the Expo push notification service. There are
    // different strategies you could use. A simple one is to send one chunk at a
    // time, which nicely spreads the load out over time:
    for (let chunk of chunks) {
        try {
            let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
            console.log(ticketChunk);
            tickets.push(...ticketChunk);
            // NOTE: If a ticket contains an error code in ticket.details.error, you
            // must handle it appropriately. The error codes are listed in the Expo
            // documentation:
            // https://docs.expo.io/versions/latest/guides/push-notifications#response-format
        } catch (error) {
            console.error(error);
        }
    }

    res.json({'# of notifications sent':tokens.length,"# of errors":emailErrs.length,"Failed Emails":emailErrs,"Non-existant tokens":tokenErrs.length});
});