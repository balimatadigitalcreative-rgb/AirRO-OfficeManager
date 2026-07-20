'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/dataWipe.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireCap } = require('../middleware/auth');
const { wipeLimiter } = require('../middleware/rateLimiters');

const router = Router();
// EVERY route here needs the dedicated `dataWipe` capability, which no role has by
// default — the owner grants it deliberately in Pengguna. Never role=== based.
router.use(requireAuth, requireCap('dataWipe'));

router.get('/categories', ctrl.categories);                                                  // what can be wiped
router.get('/history', ctrl.history);                                                        // trail (survives wipes)
router.post('/preview', validate({ body: ctrl.schemas.categoriesSchema }), ctrl.preview);     // exact counts, no writes
// The wipe: rate-limited, typed "HAPUS" + password re-entry, auto-backup first.
router.post('/', wipeLimiter, validate({ body: ctrl.schemas.wipeSchema }), ctrl.wipe);

module.exports = router;
