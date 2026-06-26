import fs from 'fs';
import path from 'path';

const content = fs.readFileSync('e:\\neew pg projected\\src\\js\\owner-dashboard.js', 'utf8');
const lines = content.split('\n');

const terms = [
  'initTenantsTransactionFilters',
  'renderTenantsTransactionsTable',
  'tenants-transactions'
];

terms.forEach(term => {
  console.log(`\nSearching for "${term}":`);
  lines.forEach((line, index) => {
    if (line.includes(term)) {
      console.log(`Line ${index + 1}: ${line.trim()}`);
    }
  });
});
