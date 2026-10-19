// Run: cd frontend && npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCsv, buildTable, matchColumns, buildRows, withNameColumn, splitName, cellToString, fieldForHeader,
} from './fileImport.ts';

const STATES = [
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MO', name: 'Missouri' },
  { code: 'TX', name: 'Texas' },
];
const run = (csv) => {
  const table = buildTable(parseCsv(csv));
  const match = matchColumns(table, STATES);
  return { table, match, rows: buildRows(table, match, STATES) };
};

test('parseCsv: quotes, escaped quotes, newlines in cells, CRLF, BOM', () => {
  const rows = parseCsv('﻿Name,Notes\r\n"Smith, Jane","said ""hi""\nthen left"\r\nBob,\r\n');
  assert.deepEqual(rows, [['Name', 'Notes'], ['Smith, Jane', 'said "hi"\nthen left'], ['Bob', '']]);
});

test('parseCsv: sniffs semicolon and tab delimiters', () => {
  assert.deepEqual(parseCsv('a;b;c\n1;2;3'), [['a', 'b', 'c'], ['1', '2', '3']]);
  assert.deepEqual(parseCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
});

test('headers in any wording are matched; School District is a district, not a school', () => {
  assert.equal(fieldForHeader('Work Email'), 'email');
  assert.equal(fieldForHeader('Mobile'), 'phone');
  assert.equal(fieldForHeader('Surname'), 'lastName');
  assert.equal(fieldForHeader('School District'), 'district');
  assert.equal(fieldForHeader('School Name'), 'school');
  assert.equal(fieldForHeader('Badge ID'), null);
  assert.equal(fieldForHeader('Interested In'), null);
});

test('typical export: matched fields fill, everything else becomes a labelled note', () => {
  const { rows, match } = run(
    'First Name,Last Name,Work Email,Mobile,School,Badge ID,Comments\n' +
    'Jane,Smith,JSmith@Lincoln.org,555-123-4567,Lincoln HS,48213,wants pricing\n',
  );
  assert.equal(match.needsName, false);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].firstName, 'Jane');
  assert.equal(rows[0].lastName, 'Smith');
  assert.equal(rows[0].email, 'JSmith@Lincoln.org'); // the server lower-cases it
  assert.equal(rows[0].phone, '555-123-4567');
  assert.equal(rows[0].schoolName, 'Lincoln HS');
  assert.equal(rows[0].interactionNotes, 'Badge ID: 48213\nComments: wants pricing');
  assert.equal(rows[0].row, 2); // spreadsheet row, header is row 1
});

test('a Name column is split, including "Last, First"', () => {
  assert.deepEqual(splitName('Jane Q Smith'), { firstName: 'Jane', lastName: 'Q Smith' });
  assert.deepEqual(splitName('Smith, Jane'), { firstName: 'Jane', lastName: 'Smith' });
  assert.deepEqual(splitName('Cher'), { firstName: 'Cher', lastName: '' });
  const { rows } = run('Name,Email\nJane Smith,j@x.org\n');
  assert.equal(rows[0].firstName, 'Jane');
  assert.equal(rows[0].lastName, 'Smith');
});

test('state codes and names become the full state name; unknown text is left for the server', () => {
  const { rows } = run('First,Last,State\nA,B,ma\nC,D,Texas\nE,F,Narnia\n');
  assert.deepEqual(rows.map((r) => r.state), ['Massachusetts', 'Texas', 'Narnia']);
});

test('no header row: columns are found by what the cells look like', () => {
  const { table, match, rows } = run(
    'Jane Smith,jsmith@lincoln.org,(555) 123-4567,MA,Lincoln High\nBob Ortiz,bortiz@lincoln.org,555.987.6543,MA,Lincoln High\n',
  );
  assert.equal(table.hasHeader, false);
  assert.equal(match.needsName, false);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].firstName, 'Jane');
  assert.equal(rows[0].email, 'jsmith@lincoln.org');
  assert.equal(rows[0].phone, '(555) 123-4567');
  assert.equal(rows[0].state, 'Massachusetts');
  assert.equal(rows[0].row, 1);
  // The leftover column is kept as a note rather than dropped.
  assert.equal(rows[0].interactionNotes, 'Column 5: Lincoln High');
});

test('a second email column goes to notes, not over the first', () => {
  const { rows } = run('Name,Work Email,Personal Email\nJane Smith,a@x.org,b@y.org\n');
  assert.equal(rows[0].email, 'a@x.org');
  assert.equal(rows[0].interactionNotes, 'Personal Email: b@y.org');
});

test('no recognisable name: needsName is set, and picking a column fixes it', () => {
  const { table, match } = run('Who,Email\nxx1,a@x.org\nxx2,b@x.org\n');
  assert.equal(match.needsName, true);
  const fixed = withNameColumn(match, 0);
  assert.equal(fixed.needsName, false);
  const rows = buildRows(table, fixed, STATES);
  assert.equal(rows[0].firstName, 'xx1');
});

test('row numbers point at the spreadsheet line even after blank rows are dropped', () => {
  const { rows } = run('First Name,Last Name\nJane,Smith\n,,\n\n,Ortiz\n');
  assert.deepEqual(rows.map((r) => r.row), [2, 5]);
});

test('blank rows are ignored; a surname-only row is still filed as a person', () => {
  const { rows } = run('First Name,Last Name\nJane,Smith\n,,\n,Ortiz\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[1].firstName, 'Ortiz');
  assert.equal(rows[1].lastName, '');
});

test('numbers and dates from Excel read as the person saw them', () => {
  assert.equal(cellToString(15551234567), '15551234567');
  assert.equal(cellToString(new Date(Date.UTC(2026, 9, 19))), '2026-10-19');
  assert.equal(cellToString(null), '');
  assert.equal(cellToString(true), 'true');
});

test('a long note value is cut so one cell cannot bury the rest', () => {
  const { rows } = run(`Name,Comments\nJane Smith,${'x'.repeat(900)}\n`);
  assert.ok(rows[0].interactionNotes.length < 530);
  assert.ok(rows[0].interactionNotes.endsWith('…'));
});
