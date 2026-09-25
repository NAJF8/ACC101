export const EMPLOYEE_DEPENDENCY_ENTITIES = [
  'payroll',
  'payroll_payments',
  'payroll_adjustments',
  'expenses',
  'cash_movements',
  'employee_advances',
  'employee_debts',
  'shifts',
  'cashier_shifts',
];

export const employeeReferenceMatches = (record = {}, employee = {}) => {
  const employeeId = String(employee.id || employee.employee_id || '');
  const employeeName = String(employee.name || employee.name_ar || '').trim().toLocaleLowerCase();
  const ids = ['employee_id', 'employeeId', 'employee'];
  if (ids.some((key) => record[key] != null && String(record[key]) === employeeId)) return true;
  const names = ['employee_name', 'employeeName', 'person_name', 'beneficiary'];
  return Boolean(employeeName && names.some((key) => String(record[key] || '').trim().toLocaleLowerCase() === employeeName));
};

export const buildEmployeeDependencySummary = (employee, collections = {}) => {
  const summary = {};
  Object.entries(collections).forEach(([entity, rows]) => {
    const matches = (rows || []).filter((row) => employeeReferenceMatches(row, employee));
    if (matches.length) summary[entity] = matches.length;
  });
  return summary;
};

export const isEmployeeOperationallyActive = (employee = {}) => employee.active !== false && employee.archived !== true && employee.enabled !== false;
