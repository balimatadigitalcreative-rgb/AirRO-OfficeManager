-- Expense entry merged into "Transaksi Baru": capture the payment METHOD (tunai/transfer) and the
-- RECIPIENT / keterangan on a field expense. ADDITIVE — NOT NULL columns with a default, so existing
-- rows keep working and no data is touched. Neither column changes any cash aggregation: the
-- dashboard "Pengeluaran lapangan" / "Tunai bersih disetor" still subtract EVERY active expense
-- regardless of method — behaviour is intentionally unchanged.
ALTER TABLE "DistExpense" ADD COLUMN "method" TEXT NOT NULL DEFAULT 'tunai';
ALTER TABLE "DistExpense" ADD COLUMN "recipient" TEXT NOT NULL DEFAULT '';
