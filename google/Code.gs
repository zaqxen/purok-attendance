/* The deployed web app must be restricted to MYSELF. Never deploy anonymously. */
function requireAdmin_() {
	var configured = PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL');
	var actual = Session.getActiveUser().getEmail();
	if (!configured || !actual || actual.toLowerCase() !== configured.trim().toLowerCase())
		throw new Error(
			'Administrator access required. Set ADMIN_EMAIL and deploy with access Only myself.'
		);
}
function doGet() {
	requireAdmin_();
	return HtmlService.createHtmlOutputFromFile('Admin').setTitle('Purok 3 · Administrator');
}
function getAdminState() {
	requireAdmin_();
	var props = PropertiesService.getScriptProperties();
	if (!props.getProperty('DATA_SPREADSHEET_ID'))
		return {
			setupRequired: true,
			repository: 'zaqxen/purok-attendance',
			configuredPublishing: !!props.getProperty('GITHUB_TOKEN')
		};
	var state = loadState_();
	state.configuredPublishing = !!props.getProperty('GITHUB_TOKEN');
	return state;
}
function initializeWorkbook() {
	requireAdmin_();
	var lock = LockService.getScriptLock();
	lock.waitLock(10000);
	try {
		var props = PropertiesService.getScriptProperties();
		if (props.getProperty('DATA_SPREADSHEET_ID')) return getAdminState();
		var book = SpreadsheetApp.create('Purok attendance · Private records');
		book.setSpreadsheetTimeZone('Asia/Dubai');
		book.getSheets()[0].setName('Records');
		var state = {
			revision: Utilities.getUuid(),
			members: [],
			periods: [],
			entries: [],
			doctrine: [],
			publication: { digests: {}, versions: {}, publishedAt: '' }
		};
		writeState_(book.getSheetByName('Records'), state);
		props.setProperty('DATA_SPREADSHEET_ID', book.getId());
		return getAdminState();
	} finally {
		lock.releaseLock();
	}
}
function loadState_() {
	var id = PropertiesService.getScriptProperties().getProperty('DATA_SPREADSHEET_ID');
	if (!id) throw new Error('Initialize the private workbook first.');
	var sheet = SpreadsheetApp.openById(id).getSheetByName('Records');
	if (!sheet) throw new Error('The private workbook is missing its Records table.');
	var rows = sheet.getDataRange().getValues();
	if (rows[0].join('|') !== 'record_type|id|record_json' || rows[1][0] !== 'meta')
		throw new Error('The private workbook format is invalid.');
	var meta = JSON.parse(rows[1][2]);
	var state = {
		revision: meta.revision,
		publication: meta.publication,
		members: [],
		periods: [],
		entries: [],
		doctrine: []
	};
	if (!Number.isInteger(meta.recordCount) || rows.length < meta.recordCount + 2)
		throw new Error('The private record table is incomplete.');
	var seen = {};
	rows.slice(2, meta.recordCount + 2).forEach(function (row) {
		if (!Object.prototype.hasOwnProperty.call(state, row[0]) || !Array.isArray(state[row[0]]))
			throw new Error('Unknown private record type.');
		var record = JSON.parse(row[2]);
		var key = row[0] + ':' + row[1];
		if (record.id !== row[1] || seen[key])
			throw new Error('Duplicate or invalid private record ID.');
		seen[key] = true;
		state[row[0]].push(record);
	});
	return state;
}
function writeState_(sheet, state) {
	var records = [];
	['members', 'periods', 'entries', 'doctrine'].forEach(function (type) {
		state[type].forEach(function (record) {
			records.push([type, record.id, JSON.stringify(record)]);
		});
	});
	var meta = {
		revision: state.revision,
		recordCount: records.length,
		publication: state.publication
	};
	var rows = [
		['record_type', 'id', 'record_json'],
		['meta', 'revision', JSON.stringify(meta)]
	].concat(records);
	if (rows.length > sheet.getMaxRows())
		sheet.insertRowsAfter(sheet.getMaxRows(), rows.length - sheet.getMaxRows());
	var previous = sheet.getLastRow();
	// One setValues operation writes the revision and all records together. JSON begins with {,
	// so profile text cannot become a spreadsheet formula. recordCount ignores stale tail rows.
	sheet.getRange(1, 1, rows.length, 3).setNumberFormat('@').setValues(rows);
	if (previous > rows.length)
		sheet.getRange(rows.length + 1, 1, previous - rows.length, 3).clearContent();
	sheet.setFrozenRows(1);
}
function mutate_(revision, change) {
	requireAdmin_();
	var lock = LockService.getScriptLock();
	lock.waitLock(10000);
	try {
		var state = loadState_();
		if (state.revision !== revision)
			throw new Error('Records changed in another session. Reload before saving.');
		change(state);
		state.revision = Utilities.getUuid();
		writeState_(
			SpreadsheetApp.openById(
				PropertiesService.getScriptProperties().getProperty('DATA_SPREADSHEET_ID')
			).getSheetByName('Records'),
			state
		);
		state.configuredPublishing =
			!!PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
		return state;
	} finally {
		lock.releaseLock();
	}
}
function text_(value, max) {
	if (typeof value !== 'string' || value.length > max)
		throw new Error('Invalid or overly long text.');
	return value.trim();
}
function saveAttendance(payload) {
	return mutate_(payload.revision, function (state) {
		var start = Attendance.weekStart(payload.year, payload.week);
		if (!Array.isArray(payload.changes) || payload.changes.length > 1000)
			throw new Error('Invalid attendance batch.');
		var seen = {};
		payload.changes.forEach(function (change) {
			if (
				seen[change.memberId] ||
				!state.members.some(function (m) {
					return m.id === change.memberId;
				}) ||
				!Attendance.isEligible(state.periods, change.memberId, start)
			)
				throw new Error('Attendance is outside a member’s monitored period.');
			seen[change.memberId] = true;
			if (change.day !== '' && Attendance.DAYS.indexOf(change.day) === -1)
				throw new Error('Select a valid attendance day.');
			var publicReason = text_(change.publicReason, 500),
				privateNote = text_(change.privateNote, 1500);
			var existing = state.entries.find(function (e) {
				return e.memberId === change.memberId && e.year === payload.year && e.week === payload.week;
			});
			var record = {
				id: existing ? existing.id : Utilities.getUuid(),
				memberId: change.memberId,
				year: payload.year,
				week: payload.week,
				day: change.day,
				publicReason: publicReason,
				privateNote: privateNote
			};
			if (existing) Object.assign(existing, record);
			else if (change.day || publicReason || privateNote) state.entries.push(record);
		});
	});
}
function saveMember(payload) {
	return mutate_(payload.revision, function (state) {
		var input = payload.member,
			existing = state.members.find(function (m) {
				return m.id === input.id;
			});
		if (input.id && !existing) throw new Error('Member not found.');
		var member = {
			id: existing ? existing.id : Utilities.getUuid(),
			firstName: text_(input.firstName, 100),
			lastName: text_(input.lastName, 100),
			birthDate: text_(input.birthDate, 10),
			mobile: text_(input.mobile, 100),
			address: text_(input.address, 500),
			gender: text_(input.gender, 1),
			kap: text_(input.kap, 30),
			status: text_(input.status, 100)
		};
		if (!member.firstName || !member.lastName) throw new Error('Enter first and last names.');
		if (member.birthDate) Attendance.date(member.birthDate);
		if (member.gender && ['B', 'L'].indexOf(member.gender) === -1)
			throw new Error('Gender must be B or L.');
		var eligible = ['K', 'B'].indexOf(member.kap) >= 0,
			previousEligible = existing && ['K', 'B'].indexOf(existing.kap) >= 0;
		if (!existing || eligible !== previousEligible) {
			var effective = Attendance.weekStart(payload.year, payload.week);
			var active = state.periods.filter(function (p) {
				return p.memberId === member.id && p.start <= effective && (!p.end || effective < p.end);
			});
			if (!eligible)
				active.forEach(function (p) {
					if (effective === p.start)
						state.periods = state.periods.filter(function (item) {
							return item.id !== p.id;
						});
					else p.end = effective;
				});
			else if (!active.length) {
				var period = { id: Utilities.getUuid(), memberId: member.id, start: effective, end: '' };
				Attendance.validatePeriod(period, state.periods);
				state.periods.push(period);
			}
		}
		if (existing) Object.assign(existing, member);
		else state.members.push(member);
	});
}
function saveTransfer(payload) {
	return mutate_(payload.revision, function (state) {
		var member = state.members.find(function (m) {
			return m.id === payload.memberId;
		});
		if (!member) throw new Error('Member not found.');
		var effective = Attendance.weekStart(payload.year, payload.week);
		if (payload.type === 'in') {
			if (['K', 'B'].indexOf(member.kap) === -1)
				throw new Error('Only Kap K or B is monitored. Update the member classification first.');
			var period = { id: Utilities.getUuid(), memberId: member.id, start: effective, end: '' };
			Attendance.validatePeriod(period, state.periods);
			state.periods.push(period);
			member.status = 'Active';
		} else if (payload.type === 'out') {
			var period = state.periods.find(function (p) {
				return p.memberId === member.id && p.start <= effective && (!p.end || effective < p.end);
			});
			if (!period) throw new Error('No monitored period covers the departure week.');
			if (effective === period.start)
				state.periods = state.periods.filter(function (p) {
					return p.id !== period.id;
				});
			else period.end = effective;
			member.status = 'Transferred out';
		} else throw new Error('Choose transfer in or transfer out.');
	});
}
function saveDoctrine(payload) {
	return mutate_(payload.revision, function (state) {
		var input = payload.record,
			existing = state.doctrine.find(function (d) {
				return d.id === input.id;
			});
		if (input.id && !existing) throw new Error('Doktrina record not found.');
		if (
			!state.members.some(function (m) {
				return m.id === input.inviterId;
			})
		)
			throw new Error('Select the inviting member.');
		var record = {
			id: existing ? existing.id : Utilities.getUuid(),
			name: text_(input.name, 200),
			inviterId: input.inviterId,
			caretaker: text_(input.caretaker, 200),
			mobile: text_(input.mobile, 100),
			status: text_(input.status, 100),
			notes: text_(input.notes, 1500)
		};
		if (!record.name) throw new Error('Enter the Doktrina name.');
		if (existing) Object.assign(existing, record);
		else state.doctrine.push(record);
	});
}
function savePeriod(payload) {
	return mutate_(payload.revision, function (state) {
		var existing = state.periods.find(function (p) {
			return p.id === payload.id;
		});
		if (!existing) throw new Error('Monitoring period not found.');
		var period = {
			id: existing.id,
			memberId: existing.memberId,
			start: text_(payload.start, 10),
			end: text_(payload.end, 10)
		};
		Attendance.validatePeriod(period, state.periods);
		Object.assign(existing, period);
	});
}
function configurePublishing(payload) {
	requireAdmin_();
	if (typeof payload.token !== 'string' || payload.token.length < 20 || payload.token.length > 500)
		throw new Error('Enter your repository-scoped GitHub token.');
	if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(payload.adminUrl))
		throw new Error('Enter the deployed administrator /exec URL.');
	PropertiesService.getScriptProperties().setProperties({
		GITHUB_TOKEN: payload.token,
		ADMIN_URL: payload.adminUrl
	});
	return { configured: true };
}
function github_(method, path, body, token) {
	var options = {
		method: method,
		muteHttpExceptions: true,
		headers: {
			Authorization: 'Bearer ' + token,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28'
		}
	};
	if (body) {
		options.contentType = 'application/json';
		options.payload = JSON.stringify(body);
	}
	var response = UrlFetchApp.fetch(
		'https://api.github.com/repos/zaqxen/purok-attendance/' + path,
		options
	);
	if (response.getResponseCode() < 200 || response.getResponseCode() >= 300)
		throw new Error(
			'GitHub publishing failed (' +
				response.getResponseCode() +
				'). Check repository token permissions. Saved Google records are intact.'
		);
	return JSON.parse(response.getContentText());
}
function publishReports(revision) {
	requireAdmin_();
	var lock = LockService.getScriptLock();
	lock.waitLock(10000);
	try {
		var props = PropertiesService.getScriptProperties(),
			token = props.getProperty('GITHUB_TOKEN'),
			adminUrl = props.getProperty('ADMIN_URL');
		if (!token || !adminUrl)
			throw new Error('Connect publishing in Setup first. Your records are saved privately.');
		var state = loadState_();
		if (state.revision !== revision)
			throw new Error('Records changed in another session. Reload before publishing.');
		var today = Utilities.formatDate(new Date(), 'Asia/Dubai', 'yyyy-MM-dd'),
			current = Attendance.reportYear(today);
		var years = [current];
		state.entries.forEach(function (e) {
			if (years.indexOf(e.year) < 0) years.push(e.year);
		});
		state.periods.forEach(function (p) {
			var start = Attendance.reportYear(p.start),
				end = p.end ? Attendance.reportYear(Attendance.addDays(p.end, -1)) : current;
			for (var y = start; y <= Math.max(current, end); y++) if (years.indexOf(y) < 0) years.push(y);
		});
		years.sort(function (a, b) {
			return a - b;
		});
		var version = Utilities.getUuid(),
			files = [],
			reports = [],
			digests = {},
			versions = {};
		years.forEach(function (year) {
			var cutoff =
				year < current ? Attendance.addDays(Attendance.weeks(year).slice(-1)[0].end, 1) : today;
			var snapshot = Attendance.snapshot(state, year, cutoff, '');
			if (year < current)
				snapshot.periods.forEach(function (p) {
					if (!p.end || p.end > Attendance.firstWeek(year + 1))
						p.end = Attendance.firstWeek(year + 1);
				});
			var canonical = JSON.parse(JSON.stringify(snapshot));
			delete canonical.asOf;
			var digest = Utilities.base64Encode(
				Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(canonical))
			);
			var changed = state.publication.digests[year] !== digest;
			digests[year] = digest;
			versions[year] = changed ? version : state.publication.versions[year];
			snapshot.version = versions[year];
			if (changed)
				files.push({
					path: 'docs/data/' + year + '.json',
					mode: '100644',
					type: 'blob',
					content: JSON.stringify(snapshot)
				});
			reports.push({ year: year, path: 'data/' + year + '.json', version: snapshot.version });
		});
		var roster = state.members
			.filter(function (m) {
				return state.periods.some(function (p) {
					return p.memberId === m.id && (!p.end || p.end > Attendance.firstWeek(current + 1));
				});
			})
			.map(function (m) {
				return { id: m.id, name: m.firstName + ' ' + m.lastName };
			});
		var manifest = {
			schemaVersion: 1,
			title: 'Purok 3',
			demo: false,
			publishedAt: new Date().toISOString(),
			adminUrl: adminUrl,
			reports: reports,
			roster: roster,
			periods: state.periods
				.filter(function (p) {
					return roster.some(function (m) {
						return m.id === p.memberId;
					});
				})
				.map(function (p) {
					return { memberId: p.memberId, start: p.start, end: p.end || '' };
				})
		};
		files.push({
			path: 'docs/data/manifest.json',
			mode: '100644',
			type: 'blob',
			content: JSON.stringify(manifest)
		});
		var ref = github_('get', 'git/ref/heads/main', null, token);
		var base = github_('get', 'git/commits/' + ref.object.sha, null, token);
		var tree = github_('post', 'git/trees', { base_tree: base.tree.sha, tree: files }, token);
		var commit = github_(
			'post',
			'git/commits',
			{ message: 'Publish attendance reports ' + today, tree: tree.sha, parents: [ref.object.sha] },
			token
		);
		// A normal fast-forward update preserves concurrent repository changes. Retry from
		// the latest branch if GitHub rejects the update; never force-push public reports.
		github_('patch', 'git/refs/heads/main', { sha: commit.sha, force: false }, token);
		state.publication = {
			digests: digests,
			versions: versions,
			publishedAt: manifest.publishedAt,
			commit: commit.sha
		};
		state.revision = Utilities.getUuid();
		writeState_(
			SpreadsheetApp.openById(props.getProperty('DATA_SPREADSHEET_ID')).getSheetByName('Records'),
			state
		);
		state.configuredPublishing = true;
		return {
			state: state,
			commit: commit.sha,
			url: 'https://zaqxen.github.io/purok-attendance/',
			message:
				'Published to GitHub. Pages may take a few minutes to deploy; the previous public version remains visible until then.'
		};
	} finally {
		lock.releaseLock();
	}
}
