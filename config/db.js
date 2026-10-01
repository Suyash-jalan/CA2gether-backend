const mongoose = require('mongoose');
const logger = require('../utils/logger');

const connectionOptions = () => ({
  serverSelectionTimeoutMS: parseInt(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS, 10) || 15000,
});

const buildDirectConnectionUri = () => {
  const source = process.env.MONGO_URI || '';
  const hosts = process.env.MONGO_FALLBACK_HOSTS;
  const replicaSet = process.env.MONGO_REPLICA_SET;
  const match = source.match(/^mongodb\+srv:\/\/([^@]+)@[^/]+(\/[^?]*)(?:\?(.*))?$/);

  if (!hosts || !replicaSet || !match) return null;

  const params = new URLSearchParams(match[3] || '');
  params.set('authSource', params.get('authSource') || 'admin');
  params.set('replicaSet', replicaSet);
  params.set('tls', 'true');
  return `mongodb://${match[1]}@${hosts}${match[2]}?${params.toString()}`;
};

const connectDB = async () => {
  const directUri = buildDirectConnectionUri();
  const initialUri = directUri || process.env.MONGO_URI;
  try {
    const conn = await mongoose.connect(initialUri, connectionOptions());
    logger.info(`MongoDB connected: ${conn.connection.host}`);
  } catch (error) {
    if (!directUri && /querySrv|ETIMEOUT|ENOTFOUND/i.test(error.message || '')) {
      logger.warn('MongoDB SRV lookup failed; retrying with direct Atlas hosts');
      try {
        await mongoose.disconnect();
        const conn = await mongoose.connect(directUri, connectionOptions());
        logger.info(`MongoDB connected through direct hosts: ${conn.connection.host}`);
        return;
      } catch (fallbackError) {
        logger.error(`MongoDB direct-host connection error: ${fallbackError.message}`);
        throw fallbackError;
      }
    }
    logger.error(`MongoDB connection error: ${error.message}`);
    throw error;
  }
};

module.exports = connectDB;
