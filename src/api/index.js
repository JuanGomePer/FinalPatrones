require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const roomsRoutes = require('./routes/rooms');

const PORT = process.env.API_PORT || 3000;
const app = express();

app.use(cors());
app.use(bodyParser.json());

app.use('/auth', authRoutes);
app.use('/rooms', roomsRoutes);

// health
app.get('/', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});
