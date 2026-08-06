const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const routes = require('./routes');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');
const { UPLOAD_ROOT } = require('./middleware/upload');

const app = express();

app.use(helmet());
app.use(cors());
app.use(
  '/api/webhooks/paystack',
  express.raw({ type: 'application/json' }),
  require('./routes/paystackWebhookRoutes')
);
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use('/uploads', express.static(UPLOAD_ROOT));

app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
