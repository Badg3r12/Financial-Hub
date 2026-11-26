// Starting setup for a brand-new install (before history is imported). Everything here is editable in Settings.
import * as S from './store.js';
import { uid } from './util.js';

export const ACCOUNTS = [
  ['JMCU Checking', 'checking', 'Joplin Metro CU'], ['JMCU Savings', 'savings', 'Joplin Metro CU'],
  ['Discover Savings', 'savings', 'Discover'], ['Discover CD', 'CD', 'Discover'],
  ['Discover it card', 'credit card', 'Capital One', { isLiability: true }],
  ['Roth IRA', 'Roth IRA', 'Vanguard', { isInvestment: true }], ['Roth 401k', 'Roth 401k', 'Vanguard', { isInvestment: true }],
  ['Vanguard Brokerage', 'brokerage', 'Vanguard', { isInvestment: true }], ['Vanguard Cash Plus', 'cash', 'Vanguard'],
  ['Venmo', 'Venmo', 'Venmo'], ['Cash', 'cash', ''],
];

// [name, group, 2027 annual budget $, monthly override $ or null]
export const CATEGORIES = [
  ['Gas', 'Car', 3000], ['Groceries', 'Essentials', 3000], ['Food (Eating Out)', 'Lifestyle', 600], ['Clothes', 'Essentials', 600],
  ['Personal Hygiene', 'Essentials', 120], ['Haircuts', 'Essentials', 200], ['Cleaning/Household Supplies', 'Essentials', 240],
  ['Streaming Services', 'Lifestyle', 155.88], ['Subscriptions', 'Lifestyle', 0], ['Entertainment/Dates', 'Lifestyle', 1800], ['Gifts', 'Giving', 600],
  ['Gifts/Wants for Self', 'Lifestyle', 300, 50], ['Phone', 'Essentials', 492], ['Pickleball', 'Lifestyle', 240],
  ['Apartment Stuff', 'Essentials', 120], ['Car Maintenance', 'Car', 500], ['Car Insurance', 'Car', 800], ['Trips', 'Lifestyle', 1440],
  ['Giving/Charitable Donations', 'Giving', 200], ['Healthcare', 'Essentials', 1000], ['Degenerate Gambling', 'Lifestyle', 20],
];
export const ARCHIVED = ['School Expenses/Supplies', 'Thrift Store Resells', 'Xbox Games+Live', 'Rent', 'Utilities', 'Rental Insurance', 'Laundry'];
// [name, target $, kept as a Capital One savings bucket?]
export const FUNDS = [['Emergency Fund', 20000, true], ['Car', 30000, true], ['Vacation', 5000, true], ['Camera', 3000, true], ['Ring', 2000, true], ['Car Insurance', null, false]];

export function install() {
  const accounts = ACCOUNTS.map(([name, type, institution, extra]) => ({ id: uid(), name, type, institution, isInvestment: false, isLiability: false, ...extra }));
  const cats = CATEGORIES.map(([name, group]) => ({ id: uid(), name, group, countsAsSpending: true, archived: false }));
  cats.push({ id: uid(), name: 'Taxes', group: 'Taxes', countsAsSpending: false, archived: false });
  for (const n of ARCHIVED) cats.push({ id: uid(), name: n, group: n === 'School Expenses/Supplies' || n === 'Thrift Store Resells' || n.startsWith('Xbox') ? 'Lifestyle' : 'Shared', countsAsSpending: true, archived: true });
  const budgets = CATEGORIES.filter((c) => c[2]).map(([name, , annual, monthly]) => {
    const c = cats.find((x) => x.name === name);
    return { id: `2027-${c.id}-me`, year: 2027, catId: c.id, payer: 'me', annual: Math.round(annual * 100), monthly: monthly ? Math.round(monthly * 100) : null };
  });
  const savings = accounts.find((a) => a.name === 'Discover Savings').id;
  const funds = FUNDS.map(([name, target, bucket]) => ({ id: uid(), name, target: target ? target * 100 : null, targetDate: null, acctId: bucket ? savings : null }));
  const f = (n) => funds.find((x) => x.name === n).id;
  const checking = accounts[0].id;
  S.putMany('accounts', accounts, { silent: true });
  S.putMany('categories', cats, { silent: true });
  S.putMany('budgets', budgets, { silent: true });
  S.putMany('funds', funds, { silent: true });
  S.putMany('settings', [
    { id: 'paycheck', value: { net: 144066, k401: 104500, splits: [['Checking', 50000], ['Savings', 42500], ['Brokerage', 51566]],
      funds: [[f('Car'), 20000], [f('Vacation'), 20000], [f('Camera'), 2500], [f('Ring'), 7500], [f('Car Insurance'), 6000]] } },
    { id: 'prefs', value: { defaultAccount: checking, oilInterval: 5000 } },
  ]);
}
