import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/services/financial.js', import.meta.url), 'utf8');
const financial = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const realtimeSource = fs.readFileSync(new URL('../src/services/dashboard-realtime.js', import.meta.url), 'utf8');
const realtime = await import(`data:text/javascript;base64,${Buffer.from(realtimeSource).toString('base64')}`);

const legacySummaries = [
  { month: '2026-06', date: '2026-06-01', amount: 4818000, discount: 45000, electronic: 732000, total: 851250 },
  { month: '2026-06', date: '2026-06-02', amount: 289000, total: 289000, revenue: 30000 },
  { month: '2026-06', date: '2026-06-03', amount: 0, total: 93500, revenue: 2000 },
];
const legacyDetails = [
  { date: '2026-06-01', amount: 454750, legacy_type: 'purchase', source_sheet: 'ورقة2' },
  { date: '2026-06-02', amount: 386250, legacy_type: 'purchase', source_sheet: 'ورقة2' },
  { date: '2026-06-03', amount: 188750, legacy_type: 'expense', source_sheet: 'ورقة2' },
  { date: '2026-06-04', amount: 200000, legacy_type: 'expense', source_sheet: 'ورقة2' },
  { date: '2026-06-05', amount: 133000, legacy_type: 'expense', source_sheet: 'ورقة2' },
];
const sales = financial.getMonthlySales({ transactions: [{ month: '2026-06', revenue: 4727500, import_type: 'legacy_monthly_finance' }], legacySummaries, month: '2026-06' });
const purchases = financial.getMonthlyPurchases({ transactions: [{ month: '2026-06', total_price: 1842000, import_type: 'legacy_monthly_finance' }], legacyDetails, legacySummaries, month: '2026-06' });
const expenses = financial.getMonthlyExpenses({ transactions: [{ month: '2026-06', amount: 999999, import_type: 'legacy_monthly_finance' }], legacyDetails, legacySummaries, month: '2026-06' });
const legacyPayroll = [{ month: '2026-06', source_sheet: 'ورقة3', net: -475750, base_salary: 16666, advance: 475750 }];
const payroll = financial.getMonthlyPayrollCost({ payroll: legacyPayroll, month: '2026-06' });
const historicalPayroll = financial.getMonthlyPayrollCost({ payroll: legacyPayroll, legacyCosts: [{ month: '2026-06', amount: 1000000, source: 'manual_legacy' }], month: '2026-06' });
const otherIncomeFixture = financial.getMonthlyOtherIncome({ records: [{ id: 'oi-1', date: '2026-06-15', month: '2026-06', amount: 500000, category: 'asset_sale', payment_method: 'cash' }], legacySummaries, month: '2026-06' });
const fixtureProfit = financial.getMonthlyProfit({ sales, otherIncome: { total: 32000 }, purchases, expenses, payroll: historicalPayroll });
const fixtureProfitWithOtherIncome = financial.getMonthlyProfit({ sales, otherIncome: otherIncomeFixture, purchases, expenses, payroll: historicalPayroll });
const withdrawals = financial.getMonthlyLegacyWithdrawals({ payroll: legacyPayroll, advances: [{ month: '2026-06', amount: 479250 }], month: '2026-06' });
const salaryDue = financial.calculateSalaryDue({ baseSalarySnapshot: 500000, bonuses: 50000, deductions: 20000, openDebts: 100000 });
const partial = financial.payrollPaymentState({ due: salaryDue, payments: [{ amount: 300000 }] });
const full = financial.payrollPaymentState({ due: salaryDue, payments: [{ amount: 300000 }, { amount: 130000 }] });
const debt = { amount: 100000, status: 'open' };
const employeeRows = [
  { id: 'emp-active', employee_id: 'emp-active', name: 'TEST Active', base_salary: 500000, active: true },
  { id: 'emp-inactive', employee_id: 'emp-inactive', name: 'TEST Inactive', base_salary: 600000, active: false },
];
const payrollView = financial.calculatePayrollWithDebts({
  payroll: { id: 'pay-test', employee_id: 'emp-active', month: '2026-09' },
  employee: employeeRows[0],
  adjustments: [{ employee_id: 'emp-active', month: '2026-09', type: 'bonus', amount: 50000 }, { employee_id: 'emp-active', month: '2026-09', type: 'deduction', amount: 20000 }],
  payments: [],
  debts: [{ id: 'debt-test', employee_id: 'emp-active', month: '2026-09', date: '2026-09-05', amount: 100000, status: 'open' }],
});

const modernSalesBefore = financial.getMonthlySales({ transactions: [{ month: '2026-09', total_after_discount: 1000000, payment_method: 'cash' }], month: '2026-09' });
const modernSalesAfterCash = financial.getMonthlySales({ transactions: [{ month: '2026-09', total_after_discount: 1000000, payment_method: 'cash' }, { month: '2026-09', total_after_discount: 100000, payment_method: 'cash' }], month: '2026-09' });
const modernSalesAfterElectronic = financial.getMonthlySales({ transactions: [{ month: '2026-09', total_after_discount: 1000000, payment_method: 'cash' }, { month: '2026-09', total_after_discount: 100000, payment_method: 'electronic' }], month: '2026-09' });
const otherIncomeBefore = financial.getMonthlyOtherIncome({ records: [{ month: '2026-09', amount: 32000 }], month: '2026-09' });
const otherIncomeAfter = financial.getMonthlyOtherIncome({ records: [{ month: '2026-09', amount: 32000 }, { month: '2026-09', amount: 500000 }], month: '2026-09' });
const expensesBefore = financial.getMonthlyExpenses({ transactions: [{ month: '2026-09', amount: 521750 }], month: '2026-09' });
const expensesAfter = financial.getMonthlyExpenses({ transactions: [{ month: '2026-09', amount: 521750 }, { month: '2026-09', amount: 100000 }], month: '2026-09' });
const purchasesBefore = financial.getMonthlyPurchases({ transactions: [{ month: '2026-09', total_price: 841000 }], month: '2026-09' });
const purchasesAfter = financial.getMonthlyPurchases({ transactions: [{ month: '2026-09', total_price: 841000 }, { month: '2026-09', total_price: 100000 }], month: '2026-09' });
const differentMonthSales = financial.getMonthlySales({ transactions: [{ month: '2026-09', total_after_discount: 1000000 }, { month: '2026-08', total_after_discount: 100000 }], month: '2026-09' });
const juneWithModernSale = financial.getMonthlySales({ transactions: [{ month: '2026-06', total_after_discount: 100000, payment_method: 'electronic' }], legacySummaries, month: '2026-06' });
const dashboardFixture = {
  sales: [{ date: '2026-06-10', month: '2026-06', total_after_discount: 100000 }, { date: '2026-09-10', month: '2026-09', total_after_discount: 20000 }],
  purchases: [{ date: '2026-06-10', month: '2026-06', total_price: 30000 }, { date: '2026-09-10', month: '2026-09', total_price: 15100 }],
  payroll: [{ month: '2026-06', base_salary_snapshot: 50000 }, { month: '2026-09', base_salary_snapshot: 500000 }],
};
const dashboardMonth = (month) => ({
  sales: financial.getMonthlySales({ transactions: dashboardFixture.sales, month }).total,
  purchases: financial.getMonthlyPurchases({ transactions: dashboardFixture.purchases, month }).total,
  payroll: financial.getMonthlyPayrollCost({ payroll: dashboardFixture.payroll, month }).total,
});
const juneDashboard = dashboardMonth('2026-06');
const septemberDashboard = dashboardMonth('2026-09');
const purchaseRows = financial.resolvePurchaseRows({
  purchases: [
    { id: 'june', date: '2026-06-10', total_price: 7000 },
    ...[1000, 1800, 5500, 4800, 2000].map((total_price, index) => ({ id: `sep-${index}`, date: '2026-09-10', total_price })),
  ],
  month: '2026-09',
});
const junePurchaseRows = financial.resolvePurchaseRows({ purchases: [{ id: 'june', date: '2026-06-10', total_price: 7000 }, ...purchaseRows], month: '2026-06' });
let dashboardLoads = 0;
let dashboardDataUpdates = 0;
const scheduler = realtime.createDashboardRefreshScheduler({ load: async () => ({ load: ++dashboardLoads }), onData: () => { dashboardDataUpdates++; } });
for (let index = 0; index < 10; index++) scheduler.schedule();
await new Promise((resolve) => setTimeout(resolve, 0));
scheduler.dispose();

const cashAccounts = [{ id: 'cashier', opening_balance: 500000 }, { id: 'safe', opening_balance: 0 }];
const cashMovements = [
  { month: '2026-07', type: 'IN', amount: 4000000, cash_account_id: 'cashier', source_type: 'sale' },
  { month: '2026-07', type: 'OUT', amount: 3200000, cash_account_id: 'cashier', source_type: 'expense' },
  { month: '2026-07', type: 'OUT', amount: 500000, cash_account_id: 'cashier', internal_transfer: true },
  { month: '2026-07', type: 'IN', amount: 500000, cash_account_id: 'safe', internal_transfer: true },
];
const cashSummary = financial.getCashMonthSummary({ month: '2026-07', accounts: cashAccounts, movements: cashMovements, closing: { opening_cash: 500000 } });
const cashBalanced = financial.getCashMonthSummary({ month: '2026-07', accounts: cashAccounts, movements: cashMovements, reconciliation: { actual_counted_cash: 1300000 }, closing: { opening_cash: 500000 } });
const cashDeficit = financial.getCashMonthSummary({ month: '2026-07', accounts: cashAccounts, movements: cashMovements, reconciliation: { actual_counted_cash: 1200000 }, closing: { opening_cash: 500000 } });
const payablePartial = financial.calculatePayable({ invoice: { id: 'inv-1', total: 1000000, paid_amount: 400000 }, payments: [] });
const payablePaid = financial.calculatePayable({ invoice: { id: 'inv-1', total: 1000000, paid_amount: 400000 }, payments: [{ invoice_id: 'inv-1', amount: 600000 }] });
const tasks = financial.deriveDailyTasks({ month: '2026-07', inventory: [{ id: 'milk', name_ar: 'حليب', quantity: 2, min_stock: 5 }], invoices: [{ id: 'inv-1', total: 10, due_date: '2020-01-01' }], payroll: [{ id: 'pay-1', month: '2026-07', status: 'partial', employee_name: 'موظف' }] });
const range = financial.normalizeDateRange({ mode: 'custom', fromDate: '2026-09-05', toDate: '2026-09-10' });
const rangeRows = [{ date: '2026-09-04' }, { date: '2026-09-05' }, { date: '2026-09-07' }, { date: '2026-09-10' }, { date: '2026-09-11' }];
const crossMonth = financial.normalizeDateRange({ mode: 'custom', fromDate: '2026-08-28', toDate: '2026-09-03' });
const financialRangeFixture = {
  sales: [{ date: '2026-09-01', total_after_discount: 10000 }, { date: '2026-09-05', total_after_discount: 20000 }, { date: '2026-09-10', total_after_discount: 30000 }],
  purchases: [{ date: '2026-09-05', total_price: 5000 }, { date: '2026-09-08', total_price: 7000 }],
  expenses: [{ date: '2026-09-06', amount: 2000 }], otherIncome: [{ date: '2026-09-07', amount: 1000 }], payroll: [{ date: '2026-09-09', amount: 3000 }]
};
const fixtureInRange = (key) => financial.filterRecordsByDateRange(financialRangeFixture[key], financial.normalizeDateRange({ mode: 'custom', fromDate: '2026-09-05', toDate: '2026-09-09' }));

const dashboardOnlySales = [{ month: '2026-09', total_after_discount: 20000, payment_method: 'cash' }, { month: '2026-09', total_after_discount: 22000, payment_method: 'electronic' }];
// These two fixtures reproduce the payment and amount shapes audited in the
// live acc-101 September 2026 sales collection.  The first sale deliberately
// has no payment fields, so it must remain unclassified rather than inferred
// as cash from the difference to the card sale.
const liveProductionSales = [
  { id: '-P1IWgfGHusCYc9g7Dtr', date: '2026-09-01', month: '2026-09', total_after_discount: 20000, discount_amount: 0 },
  { id: '-P1IksdfX7bV6w-QVDFw', date: '2026-09-01', month: '2026-09', total_after_discount: 22000, discount_amount: 3000, payment_method: 'card' },
  { id: '-P1JCug_vhv79IzjTsgt', date: '2026-09-12', month: '2026-09', total_after_discount: 10000, discount_amount: 0, payment_method: 'cash' },
];
const liveProductionSalesBreakdown = financial.getMonthlySalesBreakdown({ transactions: liveProductionSales, month: '2026-09' });
const splitPaymentSalesBreakdown = financial.getMonthlySalesBreakdown({
  transactions: [{ month: '2026-09', total_after_discount: 42000, cash_amount: 20000, electronic_amount: 22000 }],
  month: '2026-09',
});
const explicitModernCashBreakdown = financial.getMonthlySalesBreakdown({ transactions: [{ month: '2026-09', total_after_discount: 20000, payment_method: 'cash' }], month: '2026-09' });
const explicitModernElectronicBreakdown = financial.getMonthlySalesBreakdown({ transactions: [{ month: '2026-09', total_after_discount: 22000, payment_method: 'card' }], month: '2026-09' });
const legacyPaymentlessBreakdown = financial.getMonthlySalesBreakdown({ legacySummaries: [{ month: '2026-09', amount: 42000, gross_sales: 42000, electronic: 22000 }], month: '2026-09' });
const dashboardOnlyPurchases = [
  { id: 'purchase-immediate', month: '2026-09', total_price: 15100, paid_amount: 5000, payment_method: 'cash' },
  { id: 'purchase-electronic', month: '2026-09', total_price: 50000, paid_amount: 50000, payment_method: 'card' },
  { id: 'purchase-credit', month: '2026-09', total_price: 100000, paid_amount: 30000, payment_method: 'cash' },
];
const dashboardSalesBreakdown = financial.getMonthlySalesBreakdown({ transactions: dashboardOnlySales, month: '2026-09' });
const dashboardPurchaseRows = financial.resolvePurchaseRows({ purchases: dashboardOnlyPurchases, month: '2026-09' });
const dashboardBeforePayroll = financial.getMonthlyProfit({ sales: { total: 42000 }, otherIncome: { total: 0 }, purchases: { total: 15100 }, expenses: { total: 0 }, payroll: { total: 0 } });
const dashboardAfterPayroll = financial.getMonthlyProfit({ sales: { total: 42000 }, otherIncome: { total: 0 }, purchases: { total: 15100 }, expenses: { total: 0 }, payroll: { total: 500000 } });
const emptyPeriod = {
  otherIncome: financial.getMonthlyOtherIncome({ month: '2026-09' }),
  purchases: financial.getMonthlyPurchases({ month: '2026-09' }),
  expenses: financial.getMonthlyExpenses({ month: '2026-09' }),
  payroll: financial.getMonthlyPayrollCost({ month: '2026-09' }),
};

const checks = {
  juneNetSales: sales.total === 5062000,
  electronicNotAdded: sales.electronic === 732000,
  otherIncome: sales.otherIncome === 32000,
  noElectronicTotalFallback: financial.getLegacyElectronic({ total: 851250 }) === 0,
  noOtherIncomeTotalFallback: financial.getLegacyOtherIncome({ total: 289000 }) === 0,
  genericRevenueNeverUsesTotal: financial.amountOf({ total: 289000 }, 'revenue') === 0,
  explicitOtherIncomeOnly: financial.getLegacyOtherIncome({ revenue: 30000, total: 289000 }) === 30000,
  explicitElectronicOnly: financial.getLegacyElectronic({ electronic: 732000, total: 999999 }) === 732000,
  grossMinusDiscountOnly: sales.gross === 5107000 && sales.discount === 45000 && sales.total === 5062000,
  junePurchasesUseDetails: purchases.total === 841000,
  juneExpensesUseDetails: expenses.total === 521750,
  legacyPayrollUnavailable: payroll.total === null,
  historicalPayrollPriority: historicalPayroll.total === 1000000 && historicalPayroll.source === 'manual_legacy',
  netProfitWithHistoricalPayroll: fixtureProfit === 2731250,
  modernOtherIncomeAddsToLegacy: otherIncomeFixture.total === 532000 && otherIncomeFixture.legacy === 32000 && otherIncomeFixture.modern === 500000,
  otherIncomeDoesNotChangeNetSales: sales.total === 5062000,
  otherIncomeRaisesNetProfit: fixtureProfitWithOtherIncome === 3231250,
  legacyPayrollAdvancePriority: withdrawals.total === 475750 && withdrawals.source === 'legacy_payroll_advance',
  salaryDebtFormula: salaryDue === 430000,
  partialPayment: partial.paidAmount === 300000 && partial.remainingAmount === 130000 && partial.status === 'partial',
  fullPayment: full.paidAmount === 430000 && full.remainingAmount === 0 && full.status === 'paid',
  paymentRowsRemainSeparate: [{ amount: 300000 }, { amount: 130000 }].length === 2,
  debtSettlesOnlyAfterFullPayment: !financial.shouldSettleDebt({ debtAmount: debt.amount, payrollDue: 530000, payments: [{ amount: 300000 }] }) && financial.shouldSettleDebt({ debtAmount: debt.amount, payrollDue: 530000, payments: [{ amount: 300000 }, { amount: 130000 }] }),
  debtNotReusedAfterSettlement: [{ ...debt, status: 'settled' }].filter((row) => row.status === 'open').length === 0,
  cashAliases: financial.isCashPayment('cash') && financial.isCashPayment('نقدي') && !financial.isCashPayment('electronic') && !financial.isCashPayment('card') && !financial.isCashPayment('transfer'),
  cashAliasNormalization: financial.resolvePaymentMethod('نقد') === 'cash' && financial.resolvePaymentMethod('visa') === 'electronic' && financial.resolvePaymentMethod('mastercard') === 'electronic',
  cashSourceKey: financial.cashSourceKey('purchase', 'p1') === 'purchase:p1',
  sameMonthSaleAdded: modernSalesBefore.total === 1000000 && modernSalesAfterCash.total === 1100000,
  electronicSaleIncludedInNetSales: modernSalesAfterElectronic.total === 1100000 && modernSalesAfterElectronic.electronic === 100000 && modernSalesAfterCash.electronic === 0,
  otherIncomeAdded: otherIncomeBefore.total === 32000 && otherIncomeAfter.total === 532000,
  expenseAdded: expensesBefore.total === 521750 && expensesAfter.total === 621750,
  purchaseAdded: purchasesBefore.total === 841000 && purchasesAfter.total === 941000,
  differentMonthExcluded: differentMonthSales.total === 1000000,
  dashboardNotificationsCoalesced: dashboardLoads === 1 && dashboardDataUpdates === 1,
  legacyAndModernSalesMergeWithoutDuplicate: juneWithModernSale.total === 5162000 && juneWithModernSale.electronic === 832000 && juneWithModernSale.source === 'legacy_plus_sales',
  dashboardJuneIsolated: JSON.stringify(juneDashboard) === JSON.stringify({ sales: 100000, purchases: 30000, payroll: 50000 }),
  dashboardSeptemberIsolated: JSON.stringify(septemberDashboard) === JSON.stringify({ sales: 20000, purchases: 15100, payroll: 500000 }),
  dashboardMonthSwitchIsolated: JSON.stringify([septemberDashboard, juneDashboard, septemberDashboard]) === JSON.stringify([septemberDashboard, juneDashboard, septemberDashboard]),
  purchasesSeptemberCanonicalRows: purchaseRows.length === 5 && purchaseRows.reduce((n, row) => n + row.total, 0) === 15100,
  purchasesJuneCanonicalRows: junePurchaseRows.length === 1 && junePurchaseRows[0].total === 7000,
  purchasesEmptyStateOnlyForEmptyRows: financial.resolvePurchaseRows({ purchases: [{ date: '2026-06-10', total_price: 7000 }], month: '2026-09' }).length === 0,
  fullReportEntitiesScopeFixed: !fs.readFileSync(new URL('../src/services/api.js', import.meta.url), 'utf8').includes('rows: entities.length'),
  cashCarryForward: cashSummary.expectedClosingCash === 1300000 && cashSummary.cashIn === 4000000 && cashSummary.cashOut === 3200000,
  internalTransferDoesNotAffectCashFlow: cashSummary.cashIn === 4000000 && cashSummary.cashOut === 3200000 && cashSummary.accountBalances.cashier === 800000 && cashSummary.accountBalances.safe === 500000,
  cashReconciliation: cashBalanced.difference === 0,
  cashDeficit: cashDeficit.difference === -100000,
  cashSurplus: financial.getCashMonthSummary({ month: '2026-07', accounts: cashAccounts, movements: cashMovements, reconciliation: { actual_counted_cash: 1400000 }, closing: { opening_cash: 500000 } }).difference === 100000,
  electronicSaleDoesNotAffectPhysicalCash: cashSummary.cashIn === 4000000,
  traderPartialPayment: payablePartial.remaining === 600000 && payablePartial.status === 'partial',
  traderFullPaymentNoPurchaseDuplication: payablePaid.remaining === 0 && payablePaid.status === 'paid' && payablePaid.total === 1000000,
  litreConversion: financial.convertQuantity({ quantity: 1, fromUnit: 'L', toUnit: 'ml', conversion: 1000 }) === 1000,
  kilogramConversion: financial.convertQuantity({ quantity: 1, fromUnit: 'kg', toUnit: 'g', conversion: 1000 }) === 1000,
  dailyTasksDerived: tasks.length === 3 && new Set(tasks.map((task) => task.type)).size === 3,
  activeEmployeeIncludedByContract: employeeRows.filter((employee) => employee.active !== false).some((employee) => employee.employee_id === 'emp-active'),
  inactiveEmployeeExcludedByContract: employeeRows.filter((employee) => employee.active !== false).every((employee) => employee.id !== 'emp-inactive'),
  employeePayrollCalculation: payrollView.resolved_base_salary === 500000 && payrollView.bonuses_total === 50000 && payrollView.deductions_total === 20000 && payrollView.debts_total === 100000 && payrollView.net_salary === 430000 && payrollView.status === 'unpaid',
  settledDebtExcluded: financial.calculatePayrollWithDebts({ payroll: { id: 'pay-test', employee_id: 'emp-active', month: '2026-10' }, employee: employeeRows[0], debts: [{ employee_id: 'emp-active', month: '2026-09', amount: 100000, status: 'settled', settled_month: '2026-09' }] }).debts_total === 0,
  rangeFromInclusive: financial.filterRecordsByDateRange(rangeRows, range).length === 3 && financial.filterRecordsByDateRange(rangeRows, range)[0].date === '2026-09-05',
  rangeToInclusive: financial.filterRecordsByDateRange(rangeRows, range).some((row) => row.date === '2026-09-10'),
  rangeOutsideExcluded: financial.filterRecordsByDateRange(rangeRows, range).every((row) => row.date >= '2026-09-05' && row.date <= '2026-09-10'),
  crossMonthRange: financial.filterRecordsByDateRange([{ date: '2026-08-27' }, { date: '2026-08-28' }, { date: '2026-09-03' }, { date: '2026-09-04' }], crossMonth).map((row) => row.date).join(',') === '2026-08-28,2026-09-03',
  financialRangeFixture: fixtureInRange('sales').reduce((n, r) => n + r.total_after_discount, 0) === 20000 && fixtureInRange('purchases').reduce((n, r) => n + r.total_price, 0) === 12000 && fixtureInRange('expenses').reduce((n, r) => n + r.amount, 0) === 2000 && fixtureInRange('otherIncome').reduce((n, r) => n + r.amount, 0) === 1000 && fixtureInRange('payroll').reduce((n, r) => n + r.amount, 0) === 3000,
  emptyFinancialCategoriesAreZero: emptyPeriod.otherIncome.total === 0 && emptyPeriod.purchases.total === 0 && emptyPeriod.expenses.total === 0 && emptyPeriod.payroll.total === 0,
  cashSalesResolvedByPaymentMethod: dashboardSalesBreakdown.cash === 20000 && dashboardSalesBreakdown.electronic === 22000,
  liveProductionMissingPaymentStaysUnclassified: liveProductionSalesBreakdown.cash === 10000 && liveProductionSalesBreakdown.electronic === 22000 && liveProductionSalesBreakdown.unclassified === 20000 && liveProductionSalesBreakdown.count === 3,
  liveProductionDiscountedCardUsesNetAmount: financial.getMonthlySales({ transactions: liveProductionSales, month: '2026-09' }).total === 52000 && liveProductionSalesBreakdown.electronic === 22000,
  explicitModernCashUsesMethod: explicitModernCashBreakdown.cash === 20000 && explicitModernCashBreakdown.electronic === 0,
  explicitModernElectronicUsesMethod: explicitModernElectronicBreakdown.cash === 0 && explicitModernElectronicBreakdown.electronic === 22000,
  splitPaymentUsesExplicitComponents: splitPaymentSalesBreakdown.cash === 20000 && splitPaymentSalesBreakdown.electronic === 22000,
  paymentBreakdownReconcilesToNet: liveProductionSalesBreakdown.cash + liveProductionSalesBreakdown.electronic + liveProductionSalesBreakdown.otherNonCash + liveProductionSalesBreakdown.unclassified === financial.getMonthlySales({ transactions: liveProductionSales, month: '2026-09' }).total,
  legacyPaymentlessRecordDoesNotInferCash: legacyPaymentlessBreakdown.cash === 0 && legacyPaymentlessBreakdown.electronic === 22000,
  unknownLegacyPaymentNeverBecomesCashBySubtraction: financial.getMonthlySalesBreakdown({ legacySummaries: [{ month: '2026-09', amount: 42000, gross_sales: 42000, electronic: 22000 }], month: '2026-09' }).cash === 0,
  cashPurchasePaymentsOnlyImmediate: financial.getImmediateCashPurchasePaid(dashboardPurchaseRows) === 35000,
  electronicPurchaseExcludedFromCash: financial.getImmediateCashPurchasePaid([dashboardPurchaseRows[1]]) === 0,
  purchaseDebtSettlementNotPurchase: dashboardPurchaseRows.reduce((n, row) => n + row.total, 0) === 165100,
  profitBeforePayroll: dashboardBeforePayroll === 26900,
  profitAfterPayroll: dashboardAfterPayroll === -473100,
  negativeProfitRemainsNumeric: dashboardAfterPayroll < 0,
  noSalesDoubleCountInProfit: dashboardBeforePayroll === 42000 - 15100,
};
if (Object.values(checks).some((value) => !value)) throw new Error(`Finance regression failed: ${JSON.stringify(checks)}`);
console.log('finance-regression: PASS');
console.log(JSON.stringify({ checks, june: { gross: sales.gross, discounts: sales.discount, net: sales.total, electronic: sales.electronic, otherIncome: sales.otherIncome, purchases: purchases.total, expenses: expenses.total, legacyWithdrawals: withdrawals.total, payrollCost: payroll.total, netProfit: financial.getMonthlyProfit({ sales, otherIncome: { total: 32000 }, purchases, expenses, payroll }) }, fixtures: { historicalPayroll: historicalPayroll.total, netProfit: fixtureProfit, otherIncome: otherIncomeFixture.total, otherIncomeCashMovement: { source_type: 'other_income', type: 'IN', amount: 500000 }, netProfitWithOtherIncome: fixtureProfitWithOtherIncome }, salaryDue }, null, 2));
