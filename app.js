const express = require('express');
const bodyParser = require('body-parser');
const xml2js = require('xml2js');
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
      const existingRecord = await collection.findOne({ _id: userID });
      if (existingRecord) {
        await collection.updateOne({ _id: userID }, { $inc: { amount: 2 } });
      } else {
        await collection.insertOne({
          _id: userID,
          amount: 2,
          status: true,
        //   ...syncOrderRelation
        });
      }
    } else if (updateType === '2') {
    //   Handle unsubscription
      await collection.updateOne({ _id: userID }, { $set: { status: false } });
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


app.post('/api/update', async (req, res) => {
  const { ID, status, amount } = req.body;

  try {
    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection('subscriptions');

    const updateResult = await collection.updateOne(
      { _id: ID },
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

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
