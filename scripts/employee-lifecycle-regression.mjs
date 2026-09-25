import assert from 'node:assert/strict';
import { buildEmployeeDependencySummary, employeeReferenceMatches, isEmployeeOperationallyActive } from '../src/services/employee-lifecycle.js';
import { buildPayrollRows } from '../src/services/financial.js';

const employee = { id: 'emp-1', name: 'محمد' };
assert.equal(employeeReferenceMatches({ employee_id: 'emp-1' }, employee), true);
assert.equal(employeeReferenceMatches({ employee_name: 'محمد' }, employee), true);
assert.equal(employeeReferenceMatches({ employee_id: 'other' }, employee), false);
assert.deepEqual(buildEmployeeDependencySummary(employee, {
  payroll: [{ id: 'pay-1', employee_id: 'emp-1' }],
  payroll_payments: [{ id: 'payment-1', employee_id: 'emp-1' }],
  expenses: [{ id: 'expense-1', employee_name: 'محمد' }],
  cash_movements: [{ id: 'cash-1', employee_id: 'other' }],
  shifts: [{ id: 'shift-1', employee_id: 'emp-1' }],
}), { payroll: 1, payroll_payments: 1, expenses: 1, shifts: 1 });
assert.equal(isEmployeeOperationallyActive({ active: true, enabled: true, archived: false }), true);
assert.equal(isEmployeeOperationallyActive({ active: false, enabled: true, archived: false }), false);
assert.equal(isEmployeeOperationallyActive({ active: true, enabled: true, archived: true }), false);
const activeEmployee = { id: 'emp-active', name: 'فعال', active: true, enabled: true, archived: false, base_salary: 100 };
const archivedEmployee = { id: 'emp-archived', name: 'مؤرشف', active: false, enabled: false, archived: true, base_salary: 100 };
const payrollRows = buildPayrollRows({ month: '2026-09', employees: [activeEmployee, archivedEmployee], payroll: [
  { id: 'old-active', employee_id: 'emp-active', employee_name: 'فعال', month: '2026-09' },
  { id: 'old-archived', employee_id: 'emp-archived', employee_name: 'مؤرشف', month: '2026-09' },
] });
assert.deepEqual(payrollRows.map((row) => row.employee_id), ['emp-active']);
assert.deepEqual(buildPayrollRows({ month: '2026-09', employees: [activeEmployee, archivedEmployee], payroll: [] }).map((row) => row.employee_id), ['emp-active']);
assert.deepEqual(buildEmployeeDependencySummary(archivedEmployee, { payroll: [{ id: 'pay-1', employee_id: 'emp-archived' }] }), { payroll: 1 });
console.log('employee-lifecycle-regression: PASS');
