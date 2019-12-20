const { Expo } = require('expo-server-sdk')
var admin = require('firebase-admin');
const express = require('express');
const bodyParser = require('body-parser');
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
app.use(bodyParser.urlencoded());
app.use(bodyParser.json());
app.listen(PORT, () => console.log(`Listening on ${ PORT }`))

let respondToRequest = async (req,res)=>{
    let tokens = [];
    let emailErrs = [];
    let tokenErrs = []; 
    if(req.query.email)
        await admin.auth().getUserByEmail(req.query.email).then(async(userRecord)=>{
            return await db.collection("Users").doc(userRecord.uid).get().then(function (doc) {
                if (doc.exists) {
                    if(doc.data()["Push Tokens"])
                        tokens = tokens.concat(doc.data()["Push Tokens"])
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
        if (!await Expo.isExpoPushToken(token)) {
            tokenErrs.push(`${token} is not a valid push token`)
            console.log(`Push token ${token} is not a valid Expo push token`);
            continue;
        }
    
      // Construct a message (see https://docs.expo.io/versions/latest/guides/push-notifications.html)

      var msgObj = {
        to: token,
        sound: 'default',
        title: req.query.title,
        priority: 'high',
        body: req.query.body,
        data: { withSome: 'data' },
      }
      messages.push(msgObj)

      //console.log(msgObj)
    }
    let chunks = await expo.chunkPushNotifications(messages);
    let tickets = [];
    // Send the chunks to the Expo push notification service. There are
    // different strategies you could use. A simple one is to send one chunk at a
    // time, which nicely spreads the load out over time:
    for (let chunk of chunks) {
        try {
            let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
            tickets.push(...ticketChunk);
            // NOTE: If a ticket contains an error code in ticket.details.error, you
            // must handle it appropriately. The error codes are listed in the Expo
            // documentation:
            // https://docs.expo.io/versions/latest/guides/push-notifications#response-format
        } catch (error) {
            console.error(error);
        }
    }

    let receiptIds = [];
    let deliveryErrs = [];
    
    for (let ticket of tickets) {
        // NOTE: Not all tickets have IDs; for example, tickets for notifications
        // that could not be enqueued will have error information and no receipt ID.
        if (ticket.id) {
            receiptIds.push(ticket.id);
        }
    }

    let receiptIdChunks = await expo.chunkPushNotificationReceiptIds(receiptIds);

    let success = 0
    let total = 0;
    let loops = 0

    while(tokens.length != total||loops>60){
        loops++
        for (let chunk of receiptIdChunks) {
            try {
                let receipts = await expo.getPushNotificationReceiptsAsync(chunk);

                // The receipts specify whether Apple or Google successfully received the
                // notification and information about an error, if one occurred.
                if(receipts)
                    for (let receiptName in receipts) {
                        receipt = receipts[receiptName]
                        total++;

                        if (receipt.status === 'ok') {
                            success++
                            continue;
                        } else if (receipt.status === 'error') {
                            console.error(`There was an error sending a notification: ${receipt.message}`);
                            if (receipt.details && receipt.details.error) {
                                // The error codes are listed in the Expo documentation:
                                // https://docs.expo.io/versions/latest/guides/push-notifications#response-format
                                // You must handle the errors appropriately.
                                console.error(`The error code is ${receipt.details.error}`);
                                deliveryErrs.push(`${receipt.details.error} - ${receipt.message}`)
                            }
                        }
                    }
            } catch (error) {
            console.error(error);
            }
        }
        if(tokens.length != total)
            await sleep(1000)
    }


    res.json({'# of notifications requested to be sent':tokens.length,'# of notifications sent':success,"# of errors":emailErrs.length+tokenErrs.length+deliveryErrs.length,"Failed Emails":emailErrs,"Non-existant tokens":tokenErrs.length,"Delivery Errors":deliveryErrs});
}

app.get('/',respondToRequest);
app.post('/',respondToRequest);

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}