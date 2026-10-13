function normalizedName_(value) {
	return String(value)
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-zA-Z0-9]+/g, ' ')
		.trim()
		.toLowerCase();
}
function previewLegacyImport(source) {
	requireAdmin_();
	var publicMemberIds = {},
		publicNames = {},
		publishedEntries = [];
	var manifestResponse = UrlFetchApp.fetch(
		'https://zaqxen.github.io/purok-attendance/data/manifest.json',
		{ muteHttpExceptions: true }
	);
	if (manifestResponse.getResponseCode() !== 200)
		throw new Error(
			'Published reports could not be read. Retry import later; no private records were changed.'
		);
	var manifest = JSON.parse(manifestResponse.getContentText());
	if (manifest.schemaVersion !== 1) throw new Error('Published report format is invalid.');
	if (!manifest.demo) {
		manifest.reports.forEach(function (item) {
			if (!/^data\/\d{4}\.json$/.test(item.path)) throw new Error('Invalid published report path.');
			var response = UrlFetchApp.fetch('https://zaqxen.github.io/purok-attendance/' + item.path, {
				muteHttpExceptions: true
			});
			if (response.getResponseCode() !== 200)
				throw new Error('A published attendance year could not be read. Retry import later.');
			var report = JSON.parse(response.getContentText());
			if (
				report.schemaVersion !== 1 ||
				report.year !== item.year ||
				report.version !== item.version
			)
				throw new Error(
					'Published attendance is being updated or is invalid. Retry import after deployment finishes.'
				);
			report.members.forEach(function (m) {
				publicMemberIds[normalizedName_(m.name)] = m.id;
				publicNames[m.id] = m.name;
			});
			report.entries.forEach(function (e) {
				publishedEntries.push({
					memberId: e.memberId,
					year: report.year,
					week: e.week,
					reason: e.reason || ''
				});
			});
		});
		(manifest.aliases || []).forEach(function (alias) {
			if (publicNames[alias.memberId])
				publicMemberIds[normalizedName_(alias.name)] = alias.memberId;
		});
	}
	var match = String(source).match(/(?:\/d\/)?([a-zA-Z0-9_-]{20,})/);
	if (!match) throw new Error('Enter the original spreadsheet URL or ID.');
	if (match[1] === PropertiesService.getScriptProperties().getProperty('DATA_SPREADSHEET_ID'))
		throw new Error('Choose the original workbook, not the new private data workbook.');
	var book = SpreadsheetApp.openById(match[1]),
		roster = book.getSheetByName('Purok2026');
	if (!roster) throw new Error('The source workbook must contain Purok2026.');
	var raw = roster.getDataRange().getValues(),
		display = roster.getDataRange().getDisplayValues();
	var members = [];
	raw.slice(2).forEach(function (row, i) {
		if (!row[6] || !row[7]) return;
		var birth =
			row[0] instanceof Date
				? Utilities.formatDate(row[0], book.getSpreadsheetTimeZone(), 'yyyy-MM-dd')
				: '';
		members.push({
			id:
				publicMemberIds[normalizedName_(row[6] + ' ' + row[7])] || 'import-' + Utilities.getUuid(),
			firstName: String(row[6]).trim(),
			lastName: String(row[7]).trim(),
			birthDate: birth,
			mobile: String(display[i + 2][1] || ''),
			address: String(row[11] || ''),
			gender: String(row[8] || ''),
			kap: String(row[9] || ''),
			status: String(row[12] || '')
		});
	});
	var candidates = [],
		markers = {};
	[2024, 2025, 2026].forEach(function (year) {
		var sheet = book.getSheetByName('3-1(' + year + ')');
		if (!sheet) return;
		var values = sheet.getDataRange().getDisplayValues(),
			notes = sheet.getDataRange().getNotes();
		values.slice(3).forEach(function (row, index) {
			if (!row[0] || /average|overall|total/i.test(row[0])) return;
			var name = String(row[0])
					.replace(/^[^\p{L}\p{N}]+/u, '')
					.trim(),
				norm = normalizedName_(name);
			var matches = members.filter(function (m) {
				var target = normalizedName_(m.firstName + ' ' + m.lastName);
				return target === norm;
			});
			if (!matches.length)
				matches = members.filter(function (m) {
					var target = normalizedName_(m.firstName + ' ' + m.lastName).split(' ');
					return (
						norm.split(' ').every(function (token) {
							return target.indexOf(token) >= 0;
						}) ||
						target.every(function (token) {
							return norm.split(' ').indexOf(token) >= 0;
						})
					);
				});
			var selected = matches.length === 1 ? matches[0].id : publicMemberIds[norm] || '';
			if (
				!selected ||
				!members.some(function (m) {
					return m.id === selected;
				})
			) {
				var canonicalName = publicNames[selected] || name;
				var split = canonicalName.indexOf(' ');
				var historical = {
					id: selected || 'import-' + Utilities.getUuid(),
					firstName: split < 0 ? canonicalName : canonicalName.slice(0, split),
					lastName: split < 0 ? '' : canonicalName.slice(split + 1),
					birthDate: '',
					mobile: '',
					address: '',
					gender: '',
					kap: '',
					status: 'Historical record'
				};
				members.push(historical);
				selected = historical.id;
			}
			var cells = [];
			for (var column = 1; column < values[0].length; column++) {
				var week = Number(values[0][column]);
				if (
					!Number.isInteger(week) ||
					week < 1 ||
					week > Attendance.weeks(year).length ||
					!values[2][column]
				)
					continue;
				var value = String(row[column] || '').trim();
				if (!/^(|1|x|Tue|Fri|Sat|Sun|T|F|S|Su)$/i.test(value)) markers[value] = true;
				cells.push({ week: week, value: value, note: notes[index + 3][column] || '' });
			}
			candidates.push({
				key: year + ':' + (index + 4),
				year: year,
				name: name,
				memberId: selected,
				cells: cells
			});
		});
	});
	var doctrine = [];
	var doctrineSheet = book.getSheetByName('Doktrina');
	if (doctrineSheet)
		doctrineSheet
			.getDataRange()
			.getDisplayValues()
			.slice(1)
			.forEach(function (row) {
				if (row[3])
					doctrine.push({
						name: row[3],
						inviter: row[6] || '',
						caretaker: row[7] || '',
						mobile: row[8] || '',
						status: row[11] || '',
						notes: row[12] || ''
					});
			});
	return {
		members: members,
		candidates: candidates,
		markers: Object.keys(markers),
		publishedEntries: publishedEntries,
		doctrine: doctrine
	};
}
function importLegacy(payload) {
	return mutate_(payload.revision, function (state) {
		if (
			state.members.length ||
			state.entries.length ||
			state.periods.length ||
			state.doctrine.length
		)
			throw new Error(
				'Legacy import requires an empty private workbook. The original workbook is never changed.'
			);
		var plan = payload.plan;
		if (
			!plan ||
			!Array.isArray(plan.members) ||
			!Array.isArray(plan.candidates) ||
			plan.members.length > 1000 ||
			plan.candidates.length > 3000
		)
			throw new Error('Invalid import plan.');
		var members = [],
			ids = {};
		plan.members.forEach(function (input) {
			if (typeof input.id !== 'string' || !/^[\w-]{1,100}$/.test(input.id) || ids[input.id])
				throw new Error('Invalid import member ID.');
			ids[input.id] = true;
			var member = {
				id: input.id,
				firstName: text_(input.firstName, 100),
				lastName: text_(input.lastName, 100),
				birthDate: text_(input.birthDate, 10),
				mobile: text_(input.mobile, 100),
				address: text_(input.address, 500),
				gender: text_(input.gender, 1),
				kap: text_(input.kap, 30),
				status: text_(input.status, 100)
			};
			if (!member.firstName) throw new Error('An imported name is missing.');
			if (member.birthDate) Attendance.date(member.birthDate);
			if (member.gender && ['B', 'L'].indexOf(member.gender) === -1)
				throw new Error('Review imported gender values.');
			members.push(member);
		});
		state.members = members;
		var lookup = {},
			periods = [],
			today = Utilities.formatDate(new Date(), 'Asia/Dubai', 'yyyy-MM-dd'),
			current = Attendance.reportYear(today);
		var days = {
			tue: 'Tue',
			fri: 'Fri',
			sat: 'Sat',
			sun: 'Sun',
			t: 'Tue',
			f: 'Fri',
			s: 'Sat',
			su: 'Sun'
		};
		var publishedReasons = {};
		(plan.publishedEntries || []).forEach(function (e) {
			publishedReasons[e.memberId + ':' + e.year + ':' + e.week] = text_(e.reason, 1500);
		});
		// A 1 between actual attendances is confirmed present by the owner. Leading
		// and trailing 1 placeholders stay excluded. X, explicit exclusions and gaps
		// separate monitoring periods, including when a person returns in another year.
		var timelines = {},
			attendanceBounds = {};
		plan.candidates.forEach(function (candidate) {
			var id = payload.assignments[candidate.key];
			if (!ids[id]) throw new Error('Match every attendance row to a member.');
			if (!timelines[id]) timelines[id] = [];
			candidate.cells.forEach(function (cell) {
				var code = String(cell.value).trim(),
					choice = payload.markerChoices[code];
				timelines[id].push({
					start: Attendance.weekStart(candidate.year, cell.week),
					day: days[code.toLowerCase()] || (Attendance.DAYS.indexOf(choice) >= 0 ? choice : ''),
					outside: /^x$/i.test(code) || choice === 'Outside'
				});
			});
		});
		Object.keys(timelines).forEach(function (id) {
			attendanceBounds[id] = [];
			var bounds = null,
				previous = '';
			timelines[id]
				.sort(function (a, b) {
					return a.start.localeCompare(b.start);
				})
				.forEach(function (cell) {
					if (cell.outside || (previous && cell.start !== Attendance.addDays(previous, 7))) {
						if (bounds) attendanceBounds[id].push(bounds);
						bounds = null;
					}
					if (cell.day && !cell.outside) {
						if (!bounds) bounds = { first: cell.start, last: cell.start };
						else bounds.last = cell.start;
					}
					previous = cell.start;
				});
			if (bounds) attendanceBounds[id].push(bounds);
		});
		plan.candidates.forEach(function (candidate) {
			var id = payload.assignments[candidate.key];
			if (!ids[id]) throw new Error('Match every attendance row to a member.');
			var span = null;
			var previousStart = '';
			candidate.cells.forEach(function (cell) {
				var start = Attendance.weekStart(candidate.year, cell.week),
					code = String(cell.value).trim();
				if (span && previousStart && start !== Attendance.addDays(previousStart, 7)) {
					span.end = Attendance.addDays(previousStart, 7);
					periods.push(span);
					span = null;
				}
				previousStart = start;
				var intermediateOne =
					code === '1' &&
					attendanceBounds[id].some(function (bounds) {
						return bounds.first < start && start < bounds.last;
					});
				var outside = (code === '1' && !intermediateOne) || /^x$/i.test(code),
					day = '';
				if (code && !outside) {
					if (intermediateOne) day = 'Recorded';
					else if (Object.prototype.hasOwnProperty.call(days, code.toLowerCase()))
						day = days[code.toLowerCase()];
					else {
						var choice = payload.markerChoices[code];
						if (Attendance.DAYS.concat(['Absent', 'Outside']).indexOf(choice) === -1)
							throw new Error('Decide how each legacy marker should be interpreted.');
						outside = choice === 'Outside';
						day = Attendance.DAYS.indexOf(choice) >= 0 ? choice : '';
					}
				}
				if (outside) {
					if (span) {
						span.end = start;
						periods.push(span);
						span = null;
					}
					return;
				}
				if (!span) span = { id: Utilities.getUuid(), memberId: id, start: start, end: '' };
				var reason = publishedReasons[id + ':' + candidate.year + ':' + cell.week] || '';
				if (day || cell.note || reason) {
					var key = id + ':' + candidate.year + ':' + cell.week;
					if (lookup[key])
						throw new Error(
							'Two source rows map to the same member and week. Review name matching.'
						);
					lookup[key] = true;
					state.entries.push({
						id: Utilities.getUuid(),
						memberId: id,
						year: candidate.year,
						week: cell.week,
						day: day,
						publicReason: '',
						privateNote: text_(
							[String(cell.note || ''), reason]
								.filter(function (note, index, notes) {
									return note && notes.indexOf(note) === index;
								})
								.join('\n'),
							2000
						)
					});
				}
			});
			if (span) {
				if (candidate.year < current) span.end = Attendance.firstWeek(candidate.year + 1);
				periods.push(span);
			}
		});
		periods
			.sort(function (a, b) {
				return a.start.localeCompare(b.start);
			})
			.forEach(function (p) {
				Attendance.validatePeriod(p, state.periods);
				state.periods.push(p);
			});
		(plan.doctrine || []).forEach(function (input, i) {
			var inviter = payload.inviterAssignments[i];
			if (!ids[inviter]) throw new Error('Match every Doktrina inviter.');
			state.doctrine.push({
				id: Utilities.getUuid(),
				name: text_(input.name, 200),
				inviterId: inviter,
				caretaker: text_(input.caretaker, 200),
				mobile: text_(input.mobile, 100),
				status: text_(input.status, 100),
				notes: text_(input.notes, 1500)
			});
		});
		// Current members with eligible classifications but no legacy attendee row are
		// intentionally left unmonitored until their first monitoring week is confirmed.
	});
}
