const { Expo } = require('expo-server-sdk')
var admin = require('firebase-admin');
const express = require('express');
const bodyParser = require('body-parser');
const PORT = process.env.PORT || 5000
var serviceAccount;

const cors = require('cors')

const corsOptions = {
    origin: ['http://localhost:19006', 'https://notibot-server.herokuapp.com'],
    optionsSuccessStatus: 200
}

if (process.env.firebaseKey)
    serviceAccount = JSON.parse(process.env.firebaseKey)
else
    serviceAccount = require("./secureContent/serviceAccountKey.json");

let expo = new Expo();

const groups = ["Owner", "Manager", "Subscriber"]

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://notibotapp.firebaseio.com"
});

const db = admin.firestore();

var app = express();
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(bodyParser.json());
app.use(cors(corsOptions))
app.listen(PORT, () => console.log(`Listening on ${PORT}`))
app.use(express.static(__dirname + '/static', { dotfiles: 'allow' }))

let respondToRequest = async (req, res) => {
    console.log(req.query)
    let tokens = [];
    let emailErrs = [];
    let tokenErrs = [];

    // let data = {}
    // if (req.query.data && JSON.parse(req.query.data))
    //     data = JSON.parse(req.query.data)
    // else
    //     data = req.body

    let title = req.query.title
    if (!title)
        title = req.query.project
    if (!title)
        title = req.query.email

    if (req.query.email)
        await admin.auth().getUserByEmail(req.query.email).then(async (userRecord) => {
            return await db.collection("Users").doc(userRecord.uid).get().then(function (doc) {
                if (doc.exists) {
                    if (doc.data()["Push Tokens"])
                        tokens = tokens.concat(doc.data()["Push Tokens"])
                    else
                        emailErrs.push(req.query.email + " has no devices connected to it");
                } else {
                    console.log("No such document!");
                    emailErrs.push(req.query.email + " is not a valid email");
                }
            }).catch(function (error) {
                console.log("Error getting document:", error);
                emailErrs.push(req.query.email + " is not a valid email");
            });
        }).catch((err) => {
            console.log(err);
            emailErrs.push(req.query.email + " is not a valid email");
        })

    const timestamp = new Date().getTime()

    const firebaseData = { title, /*data, */...(req.query.body && {body: req.query.body}), timestamp: timestamp, ...(req.query.webhook && {webhook:req.query.webhook}), ...(req.query.webhookParam == "true" && {webhookParam: true}) }

    if (req.query.project) {
        const projectRef = db.collection("Projects").doc(req.query.project.toLowerCase())
        await projectRef.get().then(async (doc) => {
            if (doc.exists) {
                projectRef.set({
                    'Notifications': admin.firestore.FieldValue.arrayUnion(firebaseData)
                }, { merge: true })
                let pplToNotify = []
                for (let groupName of groups)
                    if (doc.data()[groupName])
                        pplToNotify = [...pplToNotify, ...doc.data()[groupName]]
                if (pplToNotify.length > 0)
                    for (let uid of pplToNotify)
                        await db.collection("Users").doc(uid).get().then(function (docUser) {
                            if (docUser.exists) {
                                if (docUser.data()["Push Tokens"])
                                    tokens = tokens.concat(docUser.data()["Push Tokens"])
                                else
                                    emailErrs.push(req.query.project + " contains a subscriber that has no devices connected to it");
                            } else {
                                console.log("No such document!");
                                emailErrs.push(req.query.project + " contains a subscriber that doesn't exist");
                            }
                        }).catch(function (error) {
                            console.log("Error getting document:", error);
                            emailErrs.push(req.query.project + " contains a subscriber that doesn't exist");
                        });
                else
                    emailErrs.push(req.query.project + " has no accounts connected to it");
            } else {
                console.log("No such document!");
                emailErrs.push(req.query.project + " is not a valid project");
            }
        }).catch(function (error) {
            console.log("Error getting document:", error);
            emailErrs.push(req.query.project + " is not a valid project");
        });
    }

    let messages = [];
    const category = !req.query.project?null:!req.query.webhook?"standard":req.query.webhookParam=="true"?"webhooktext":"webhookbutton"
    for (token of tokens) {
        if (!await Expo.isExpoPushToken(token)) {
            tokenErrs.push(`${token} is not a valid push token`)
            console.log(`Push token ${token} is not a valid Expo push token`);
            continue;
        }

        // Construct a message (see https://docs.expo.io/versions/latest/guides/push-notifications.html)

        var msgObj = {
            to: token,
            sound: 'default',
            title: title,
            priority: 'high',
            categoryId:category,
            categoryIdentifier:category,
            // _category:category,
            _category:`@kihtrakraknas/NotiBot-${category}`,
            body: req.query.body,
            data: { firebaseData, project: req.query.project},
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

    // while (tokens.length != total || loops > 60) {
    //     loops++
        for (let chunk of receiptIdChunks) {
            try {
                let receipts = await expo.getPushNotificationReceiptsAsync(chunk);

                // The receipts specify whether Apple or Google successfully received the
                // notification and information about an error, if one occurred.
                if (receipts)
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
        // if(tokens.length != total)
        //     await sleep(1000)
    // }

    res.json({ '# of notifications requested to be sent': tokens.length, '# of notifications sent': success, "# of errors": emailErrs.length + tokenErrs.length + deliveryErrs.length, "Failed Emails/Projects/Accounts": emailErrs, "Non-existant tokens": tokenErrs.length, "Delivery Errors": deliveryErrs });
}

app.post('/getProfileInfo', (req, res) => {
    console.log(`uid: ${req.body.uid}`)
    admin.auth().getUser(req.body.uid).then((userRecord) => {
        console.log(`Successfully fetched user data: ${userRecord.toJSON()}`);
        res.json(userRecord)
    }).catch((error) => {
        res.status(400).json({ error: `Firebase couldn't find the user` })
    });
});

app.post('/getProfileByEmail', (req, res) => {
    console.log(`email: ${req.body.email}`)
    admin.auth().getUserByEmail(req.body.email).then((userRecord) => {
        console.log(`Successfully fetched user data: ${userRecord.toJSON()}`);
        res.json(userRecord)
    }).catch((error) => {
        res.status(400).json({ error: `Firebase couldn't find the user` })
    });
});

app.post('/deleteProject', (req, res) => {
    console.log(`data: ${req.body}`)
    admin.auth().verifyIdToken(req.body.idToken).then((decodedToken) => {
        const uid = decodedToken.uid;
        const project = req.body.project;
        db.collection("Projects").doc(project).get().then((doc) => {
            const deletedValue = doc.data()
            if (deletedValue[groups[0]] && deletedValue[groups[0]].includes(uid)) {
                const updates = []
                for (let groupName of groups)
                    if (deletedValue[groupName])
                        for (let uid of deletedValue[groupName]) {
                            updates.push(db.collection('Users').doc(uid).update({
                                'Projects': admin.firestore.FieldValue.arrayRemove(project)
                            }))
                        }
                Promise.all(updates).finally(async () => {
                    await db.collection("Projects").doc(project).delete()
                    res.json({ status: 'success' })
                })
            } else {
                res.status(400).json({ error: `Could not delete (you are not the project owner)` })
            }
        })
    }).catch((error) => {
        console.log(error)
        res.status(400).json({ error: `Could not delete` })
    });
});

app.post('/addUserToProject', (req, res) => {
    console.log(`data: ${req.body}`)
    admin.auth().verifyIdToken(req.body.idToken).then((decodedToken) => {
        const callerUid = decodedToken.uid;
        const { project, uid } = req.body;
        db.collection("Projects").doc(project).get().then((doc) => {
            const deletedValue = doc.data()
            if (deletedValue[groups[0]] && deletedValue[groups[0]].includes(callerUid)) { // check if caller is owner of project
                const updates = []
                updates.push(db.collection("Projects").doc(project).update({
                    [groups[2]]: admin.firestore.FieldValue.arrayUnion(uid)
                }))
                updates.push(db.collection('Users').doc(uid).update({
                    'Projects': admin.firestore.FieldValue.arrayUnion(project)
                }))
                Promise.all(updates).then(async () => {
                    res.json({ status: 'success' })
                })
            } else {
                res.status(400).json({ error: `Could not add user (you are not the project owner)` })
            }
        })
    }).catch((error) => {
        console.log(error)
        res.status(400).json({ error: `Could not add user` })
    });
});

app.post('/removeUserFromProject', (req, res) => {
    console.log(`data: ${req.body}`)
    admin.auth().verifyIdToken(req.body.idToken).then((decodedToken) => {
        const callerUid = decodedToken.uid;
        const { project, uid } = req.body;
        db.collection("Projects").doc(project).get().then((doc) => {
            const deletedValue = doc.data()
            if (deletedValue[groups[0]] && deletedValue[groups[0]].includes(callerUid)) { // check if caller is owner of project
                const updates = []
                const updateObj = {}
                groups.forEach(el => { updateObj[el] = admin.firestore.FieldValue.arrayRemove(uid) })
                updates.push(db.collection("Projects").doc(project).update(updateObj))
                updates.push(db.collection('Users').doc(uid).update({
                    'Projects': admin.firestore.FieldValue.arrayRemove(project)
                }))
                Promise.all(updates).then(async () => {
                    res.json({ status: 'success' })
                })
            } else {
                res.status(400).json({ error: `Could not remove user (you are not the project owner)` })
            }
        })
    }).catch((error) => {
        console.log(error)
        res.status(400).json({ error: `Could not remove user` })
    });
});



app.get('/', cors({ origin: true }), respondToRequest);
app.post('/', cors({ origin: true }), respondToRequest);

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}