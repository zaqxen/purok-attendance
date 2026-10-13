const fs = require('node:fs');
const path = require('node:path');
const A = require('../lib/attendance.js');
const directory = path.join(__dirname, '..', 'docs', 'data');
fs.mkdirSync(directory, { recursive: true });
const names = [
	'Sample Member A',
	'Sample Member B',
	'Sample Member C',
	'Sample Member D',
	'Sample Member E',
	'Sample Member F',
	'Sample Member G',
	'Sample Member H',
	'Sample Member I',
	'Sample Member J',
	'Sample Member K',
	'Sample Member L'
];
const members = names.map((name, i) => ({ id: 'sample-' + i, firstName: name, lastName: '' }));
const periods = members.map((member, i) => ({
	id: 'p' + i,
	memberId: member.id,
	start: i === 8 ? A.weekStart(2026, 18) : i === 9 ? A.weekStart(2026, 30) : A.firstWeek(2024),
	end: i === 10 ? A.weekStart(2026, 25) : ''
}));
const entries = [];
for (const year of [2024, 2025, 2026])
	for (const member of members)
		for (const week of A.weeks(year)) {
			if (!A.isEligible(periods, member.id, week.start) || (year === 2026 && week.number > 41))
				continue;
			const index = members.indexOf(member),
				missed = (week.number + index * 3) % (7 + (index % 3)) === 0;
			entries.push({
				id: year + '-' + member.id + '-' + week.number,
				memberId: member.id,
				year,
				week: week.number,
				day: missed ? '' : A.DAYS[(index + week.number) % 4],
				publicReason: missed
					? week.number % 2
						? 'Working during the service.'
						: 'Away this week.'
					: ''
			});
		}
const reports = [];
for (const year of [2024, 2025, 2026]) {
	const version = 'fictional-preview-' + year;
	const snapshot = A.snapshot(
		{ members, periods, entries },
		year,
		year === 2026 ? '2026-10-13' : '2026-01-05',
		version
	);
	fs.writeFileSync(path.join(directory, year + '.json'), JSON.stringify(snapshot));
	reports.push({ year, path: 'data/' + year + '.json', version });
}
fs.writeFileSync(
	path.join(directory, 'manifest.json'),
	JSON.stringify({
		schemaVersion: 1,
		title: 'Purok 3',
		demo: true,
		publishedAt: '2026-10-13T08:00:00Z',
		adminUrl: '',
		reports,
		roster: members.map((m) => ({ id: m.id, name: m.firstName })),
		periods: periods.map((p) => ({ memberId: p.memberId, start: p.start, end: p.end }))
	})
);
console.log('Fictional public preview generated; no real records used.');
