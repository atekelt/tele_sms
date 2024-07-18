const express = require('express');
const bodyParser = require('body-parser');
const xml2js = require('xml2js');
const smpp = require('smpp');
const { MongoClient } = require('mongodb');
require('dotenv').config(); // Load environment variables

const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse XML and JSON
app.use(bodyParser.text({ type: 'text/xml' }));
app.use(bodyParser.json());

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
const dbName = process.env.DB_NAME;

app.get('/', async (req, res) => {
    res.send('SMS Server running');
});

app.post('/api/data', async (req, res) => {
  const parser = new xml2js.Parser({ explicitArray: false });

  try {
    const result = await parser.parseStringPromise(req.body);
    const syncOrderRelation = result['soapenv:Envelope']['soapenv:Body']['ns1:syncOrderRelation'];
    const updateType = syncOrderRelation['ns1:updateType'];
    const userID = syncOrderRelation['ns1:userID']['ID'];

    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection('subscriptions');

    if (updateType === '1') {
      // Handle subscription
      const existingRecord = await collection.findOne({ ID: userID });
      if (existingRecord) {
        await collection.updateOne({ ID: userID }, { $inc: { amount: 2 } });
      } else {
        await collection.insertOne({
          ID: userID,
          amount: 2,
          status: true,
        });
      }
    } else if (updateType === '2') {
      //  Handle unsubscription
      await collection.updateOne({ ID: userID }, { $set: { status: false } });
    }

    res.status(200).send('Success');
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  } finally {
    await client.close();
  }
});

// New POST route to check status and amount by phone number (ID)
app.post('/status', async (req, res) => {
  const { phoneNumber } = req.body;

  try {
    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection('subscriptions');

    const record = await collection.findOne({ ID: phoneNumber });

    if (record) {
      res.status(200).json({
        ID: record.ID,
        amount: record.amount,
        status: record.status
      });
    } else {
      res.status(404).send('Record not found');
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  } finally {
    await client.close();
  }
});

// New POST route to update status and amount by ID
app.post('/api/update', async (req, res) => {
  const { ID, status, amount } = req.body;

  try {
    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection('subscriptions');

    const updateResult = await collection.updateOne(
      { ID: ID },
      { $set: { status: status, amount: amount } }
    );

    if (updateResult.matchedCount > 0) {
      res.status(200).send('Update successful');
    } else {
      res.status(404).send('Record not found');
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  } finally {
    await client.close();
  }
});

function sendSMS(destination, message, callback) {
  const session = new smpp.Session({
      host: process.env.SMPP_HOST,
      port: process.env.SMPP_PORT
  });

  session.on('connect', () => {
      console.log('Connected to SMPP server');

      // Bind to the SMPP server
      session.bind_transceiver({
          system_id: process.env.SMPP_SYSTEM_ID,
          password: process.env.SMPP_PASSWORD
      }, (pdu) => {
          if (pdu.command_status === 0) {
              console.log('Successfully bound to SMPP server');

              // Send SMS
              session.submit_sm({
                  destination_addr: destination,
                  short_message: message,
                  source_addr: process.env.SOURCE_ADDR
              }, (pdu) => {
                  if (pdu.command_status === 0) {
                      console.log('Message successfully sent');
                      callback(null, 'Message successfully sent');
                  } else {
                      console.log('Failed to send message');
                      callback(new Error('Failed to send message'));
                  }
                  session.close();
              });
          } else {
              console.log('Failed to bind to SMPP server');
              callback(new Error('Failed to bind to SMPP server'));
              session.close();
          }
      });
  });

  session.on('close', () => {
      console.log('SMPP session closed');
  });

  session.on('error', (error) => {
      console.error('SMPP session error:', error);
      callback(error);
  });
}

// Route to send SMS
app.post('/send-sms', (req, res) => {
  const { destination, message } = req.body;

  sendSMS(destination, message, (error, result) => {
      if (error) {
          return res.status(500).send({ error: error.message });
      }
      res.send({ message: result });
  });
});

app.listen(port, () => {
  console.log(`Server running`);
});
