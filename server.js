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

    let error = null;
    let tokens = [];
    let nonCriticalErrors = [];

    // Extract query parameters
    let { project, title, email } = req.query

    // If title is missing, use default value
    if (!title)
        title = project
    if (!title)
        title = email

    // Legacy feature. Undocumented
    if (email)
        await admin.auth().getUserByEmail(email).then(async (userRecord) => {
            return await db.collection("Users").doc(userRecord.uid).get().then(function (doc) {
                if (doc.exists) {
                    if (doc.data()["Push Tokens"])
                        tokens = tokens.concat(doc.data()["Push Tokens"])
                    else {
                        // console.log(email + " has no devices connected to it");
                        error = `${email} has no devices connected to it`
                    }
                } else {
                    // console.log("No such document!");
                    error = `${email} is not a valid email`;
                }
            }).catch(function (error) {
                // console.log("Error getting document:", error);
                error = `${email} is not a valid email`;
            });
        }).catch((err) => {
            // console.log(err);
            error = `${email} is not a valid email`;
        })
    
    // If getting tokens from an email failed, stop the request
    if(error)
        return res.status(400).json({success:!error, error});

    let firebaseData = null

    if (project) {
        const timestamp = new Date().getTime()

        firebaseData = { 
            title,
            timestamp: timestamp, 
            ...(req.query.body && {body: req.query.body}), 
            ...(req.query.webhook && {webhook:req.query.webhook}), 
            ...(req.query.webhookParam == "true" && {webhookParam: true}) 
        }

        const projectRef = db.collection("Projects").doc(project.toLowerCase())
        await projectRef.get().then(async (doc) => {
            if (doc.exists) {
                projectRef.set({
                    'Notifications': admin.firestore.FieldValue.arrayUnion(firebaseData)
                }, { merge: true })

                // get all members of a project
                let pplToNotify = []
                for (let groupName of groups)
                    if (doc.data()[groupName])
                        pplToNotify = [...pplToNotify, ...doc.data()[groupName]]

                // loop through the accounts and retrieve their push tokens
                if (pplToNotify.length > 0)
                    for (let uid of pplToNotify)
                        await db.collection("Users").doc(uid).get().then(function (docUser) {
                            if (docUser.exists) {
                                if (docUser.data()["Push Tokens"])
                                    tokens = tokens.concat(docUser.data()["Push Tokens"])
                                else
                                    nonCriticalErrors.push(`${project} contains a subscriber that doesn't exist`);
                            } else {
                                console.log("No such document!");
                                nonCriticalErrors.push(`${project} contains a subscriber that doesn't exist`);
                            }
                        }).catch(function (error) {
                            console.log("Error getting document:", error);
                            nonCriticalErrors.push(`${project} contains a subscriber that doesn't exist`);
                        });
                else
                    error = `${project} has no accounts connected to it`;
            } else {
                console.log("No such document!");
                error = `${project} is not a valid project`;
            }
        }).catch(function (error) {
            console.log("Error getting document:", error);
            error = `${project} is not a valid project`;
        });
    }

    // If getting tokens for a project failed, stop the request
    if(error)
        return res.status(400).json({success:!error, error});

    // Choose the category a notification will be in. The category controls which notification actions appear with the notification.
    const category = !project?null:!req.query.webhook?"standard":req.query.webhookParam=="true"?"webhooktext":"webhookbutton"

    let messages = [];
    
    for (token of tokens) {
        if (!await Expo.isExpoPushToken(token)) {
            nonCriticalErrors.push(`${token} is not a valid push token`)
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
            data: { firebaseData, project},
        }
        messages.push(msgObj)
        
    }

    let chunks = await expo.chunkPushNotifications(messages);
    let tickets = [];
    for (let chunk of chunks) {
        try {
            let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
            tickets.push(...ticketChunk);
            // NOTE: If a ticket contains an error code in ticket.details.error, you
            // must handle it appropriately. The error codes are listed in the Expo
            // documentation:
            // https://docs.expo.io/versions/latest/guides/push-notifications#response-format
        } catch (error) {
            error = error;
            console.error(error);
        }
    }

    if(error)
        return res.status(400).json({success:!error, error});

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

    let totalSuccessfullySent = 0
    let totalSent = 0;

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
                            nonCriticalErrors.push(`${receipt.details.error} - ${receipt.message}`)
                        }
                    }
                }
        } catch (error) {
            console.error(error);
        }
    }

    res.json({ 
        success:!error,
        error,
        'notificationsSent': totalSent, 
        'notificationsSentSuccessfully': totalSuccessfullySent, 
        nonCriticalErrors
    });
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