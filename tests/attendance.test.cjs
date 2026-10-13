const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../lib/attendance.js');
const members = [
	{
		id: 'a',
		firstName: 'Sample',
		lastName: 'Member',
		birthDate: '1980-01-01',
		mobile: 'PRIVATE',
		address: 'PRIVATE',
		gender: 'L',
		kap: 'B'
	}
];
test('calendar matches the existing Tuesday to Sunday reporting periods, including 53-week years', () => {
	assert.equal(A.firstWeek(2026), '2025-12-30');
	assert.equal(A.weekStart(2024, 13), '2024-03-26');
	assert.equal(A.weeks(2028).length, 53);
	assert.equal(A.completedThrough(2026, '2026-10-13'), 41);
	assert.equal(A.completedThrough(2026, '2026-10-12'), 41);
	assert.equal(A.reportYear('2026-12-29'), 2027);
});
test('arrival is included and departure is excluded from both reports', () => {
	const periods = [
		{ id: 'p', memberId: 'a', start: A.weekStart(2026, 10), end: A.weekStart(2026, 15) }
	];
	const entries = [10, 11, 13, 14].map((week) => ({ memberId: 'a', year: 2026, week, day: 'Tue' }));
	const s = A.snapshot({ members, periods, entries }, 2026, '2027-01-05', 'v1');
	assert.equal(s.annual[0].monitored, 5);
	assert.equal(s.annual[0].attended, 4);
	assert.equal(s.annual[0].percent, 80);
	assert.equal(s.weekly[8].eligible, 0);
	assert.equal(s.weekly[9].eligible, 1);
	assert.equal(s.weekly[11].absencePercent, 100);
	assert.equal(s.weekly[14].eligible, 0);
});
test('open and future weeks are not absences; no monitored weeks is not zero percent', () => {
	const periods = [{ id: 'p', memberId: 'a', start: A.weekStart(2026, 42), end: '' }];
	const s = A.snapshot({ members, periods, entries: [] }, 2026, '2026-10-13', 'v1');
	assert.equal(s.annual[0].percent, null);
	assert.equal(s.weekly[41].absencePercent, null);
	assert.equal(s.overall.percent, null);
});
test('a later departure does not alter previous annual history and re-entry may create another period', () => {
	const periods = [
		{ id: 'p1', memberId: 'a', start: A.firstWeek(2025), end: A.weekStart(2026, 15) },
		{ id: 'p2', memberId: 'a', start: A.weekStart(2026, 30), end: '' }
	];
	A.validatePeriod(periods[1], periods);
	assert.equal(
		A.snapshot({ members, periods, entries: [] }, 2025, '2027-01-01', 'v').annual[0].monitored,
		52
	);
	assert.throws(
		() =>
			A.validatePeriod({ id: 'p3', memberId: 'a', start: A.weekStart(2026, 10), end: '' }, periods),
		/overlap/
	);
});
test('public export excludes all private profile fields and private absence notes', () => {
	const s = A.snapshot(
		{
			members,
			periods: [{ memberId: 'a', start: A.firstWeek(2026), end: '' }],
			entries: [
				{
					memberId: 'a',
					year: 2026,
					week: 1,
					day: '',
					publicReason: 'Public explanation',
					privateNote: 'SECRET'
				}
			]
		},
		2026,
		'2026-10-13',
		'v'
	);
	const json = JSON.stringify(s);
	for (const value of [
		'PRIVATE',
		'SECRET',
		'birthDate',
		'mobile',
		'address',
		'gender',
		'kap',
		'privateNote'
	])
		assert.equal(json.includes(value), false);
	assert.equal(s.entries[0].reason, 'Public explanation');
});
test('owner attendance counts as an ordinary explicit record; no phantom +1', () => {
	const s = A.snapshot(
		{ members, periods: [{ memberId: 'a', start: A.firstWeek(2026), end: '' }], entries: [] },
		2026,
		'2026-01-05',
		'v'
	);
	assert.equal(s.weekly[0].eligible, 1);
	assert.equal(s.weekly[0].present, 0);
	assert.equal(s.weekly[0].absencePercent, 100);
});
test('duplicate records and invalid days are rejected rather than inflating attendance', () => {
	const state = {
		members,
		periods: [{ memberId: 'a', start: A.firstWeek(2026), end: '' }],
		entries: [{ memberId: 'a', year: 2026, week: 1, day: '1' }]
	};
	assert.throws(() => A.snapshot(state, 2026, '2026-10-13', 'v'), /Invalid attendance/);
	state.entries[0].day = 'Tue';
	state.entries.push({ ...state.entries[0] });
	assert.throws(() => A.snapshot(state, 2026, '2026-10-13', 'v'), /Duplicate/);
});
