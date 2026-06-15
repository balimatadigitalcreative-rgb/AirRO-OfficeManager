'use strict';
const { PrismaClient } = require('@prisma/client');

// Single shared client across the app (avoids exhausting connections).
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

module.exports = prisma;
