const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const A = require('../lib/attendance.js');
const clone = (value) => JSON.parse(JSON.stringify(value));
const member = {
	id: 'a',
	firstName: 'Sample',
	lastName: 'Member',
	birthDate: '1980-01-01',
	mobile: 'SECRET PHONE',
	address: 'SECRET ADDRESS',
	gender: 'L',
	kap: 'K',
	status: 'Active'
};
function harness(initial) {
	let saved = clone(
		initial || {
			revision: 'r1',
			members: [member],
			periods: [{ id: 'p1', memberId: 'a', start: A.firstWeek(2026), end: '' }],
			entries: [],
			doctrine: [],
			publication: { digests: {}, versions: {}, publishedAt: '' }
		}
	);
	const props = {
		ADMIN_EMAIL: 'admin@example.test',
		DATA_SPREADSHEET_ID: 'private',
		GITHUB_TOKEN: 'PRIVATE TOKEN',
		ADMIN_URL: 'https://script.google.com/macros/s/test/exec'
	};
	let email = props.ADMIN_EMAIL,
		serial = 0,
		released = 0;
	const context = vm.createContext({
		console,
		PropertiesService: {
			getScriptProperties: () => ({
				getProperty: (key) => props[key],
				setProperties: (values) => Object.assign(props, values)
			})
		},
		Session: { getActiveUser: () => ({ getEmail: () => email }) },
		LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => released++ }) },
		SpreadsheetApp: { openById: () => ({ getSheetByName: () => ({}) }) },
		Utilities: {
			getUuid: () => 'uuid-' + ++serial,
			formatDate: () => '2026-10-13',
			base64Encode: (value) => Buffer.from(value).toString('base64'),
			DigestAlgorithm: { SHA_256: 'sha256' },
			computeDigest: (algorithm, value) => crypto.createHash(algorithm).update(value).digest()
		}
	});
	for (const file of ['lib/attendance.js', 'google/Code.gs', 'google/Legacy.gs'])
		vm.runInContext(
			fs.readFileSync(require('node:path').join(__dirname, '..', file), 'utf8'),
			context
		);
	context.loadState_ = () => clone(saved);
	context.writeState_ = (_, value) => {
		saved = clone(value);
	};
	return {
		context,
		props,
		get state() {
			return saved;
		},
		set email(value) {
			email = value;
		},
		get released() {
			return released;
		}
	};
}
test('all exposed Google operations deny an anonymous or different account before reading or writing', () => {
	const h = harness();
	const methods = [
		'doGet',
		'getAdminState',
		'initializeWorkbook',
		'saveAttendance',
		'saveMember',
		'saveTransfer',
		'savePeriod',
		'saveDoctrine',
		'configurePublishing',
		'publishReports',
		'previewLegacyImport',
		'importLegacy'
	];
	for (const account of ['', 'visitor@example.test']) {
		h.email = account;
		for (const method of methods)
			assert.throws(() => h.context[method]({ revision: 'r1' }), /Administrator access/);
	}
	assert.equal(h.state.revision, 'r1');
});
test('stale edits and partial invalid batches do not overwrite saved records', () => {
	const h = harness();
	assert.throws(
		() => h.context.saveAttendance({ revision: 'old', year: 2026, week: 1, changes: [] }),
		/another session/
	);
	assert.throws(
		() =>
			h.context.saveAttendance({
				revision: 'r1',
				year: 2026,
				week: 1,
				changes: [
					{ memberId: 'a', day: 'Tue', publicReason: '', privateNote: '' },
					{ memberId: 'missing', day: 'Tue', publicReason: '', privateNote: '' }
				]
			}),
		/monitored period/
	);
	assert.equal(h.state.entries.length, 0);
	assert.equal(h.released, 2);
});
test('transfers retain old attendance, exclude departure, and allow later re-entry', () => {
	const h = harness();
	h.context.saveAttendance({
		revision: 'r1',
		year: 2026,
		week: 1,
		changes: [{ memberId: 'a', day: 'Fri', publicReason: '', privateNote: 'SECRET NOTE' }]
	});
	h.context.saveTransfer({
		revision: h.state.revision,
		memberId: 'a',
		type: 'out',
		year: 2026,
		week: 10
	});
	assert.equal(h.state.entries.length, 1);
	assert.equal(A.isEligible(h.state.periods, 'a', A.weekStart(2026, 10)), false);
	h.context.saveTransfer({
		revision: h.state.revision,
		memberId: 'a',
		type: 'in',
		year: 2026,
		week: 20
	});
	assert.equal(A.isEligible(h.state.periods, 'a', A.weekStart(2026, 20)), true);
	assert.equal(h.state.periods.length, 2);
	assert.throws(
		() =>
			h.context.saveTransfer({
				revision: h.state.revision,
				memberId: 'a',
				type: 'in',
				year: 2026,
				week: 21
			}),
		/overlap/
	);
});
test('classification changes affect future monitoring while preserving earlier history', () => {
	const h = harness();
	h.context.saveMember({ revision: 'r1', member: { ...member, kap: 'HDB' }, year: 2026, week: 10 });
	assert.equal(A.isEligible(h.state.periods, 'a', A.weekStart(2026, 9)), true);
	assert.equal(A.isEligible(h.state.periods, 'a', A.weekStart(2026, 10)), false);
	h.context.saveMember({
		revision: h.state.revision,
		member: { ...member, kap: 'B' },
		year: 2026,
		week: 20
	});
	assert.equal(h.state.periods.length, 2);
	assert.equal(A.snapshot(h.state, 2026, '2026-10-13', 'v').annual[0].monitored, 31);
});
test('correcting periods hides excluded entries from public exports but retains private records', () => {
	const h = harness();
	h.context.saveAttendance({
		revision: 'r1',
		year: 2026,
		week: 1,
		changes: [
			{ memberId: 'a', day: 'Fri', publicReason: 'Previously public', privateNote: 'SECRET' }
		]
	});
	h.context.savePeriod({
		revision: h.state.revision,
		id: 'p1',
		start: A.weekStart(2026, 2),
		end: ''
	});
	assert.equal(h.state.entries.length, 1);
	assert.equal(A.snapshot(h.state, 2026, '2026-10-13', 'v').entries.length, 0);
	assert.throws(
		() =>
			h.context.savePeriod({ revision: h.state.revision, id: 'p1', start: '2026-01-07', end: '' }),
		/Tuesday/
	);
});
test('publication exposes an allowlist only and a GitHub failure preserves saved private records', () => {
	const h = harness();
	h.context.saveAttendance({
		revision: 'r1',
		year: 2026,
		week: 1,
		changes: [
			{ memberId: 'a', day: '', publicReason: 'Public explanation', privateNote: 'SECRET NOTE' }
		]
	});
	let tree,
		fail = true;
	h.context.github_ = (method, path, body) => {
		if (path === 'git/ref/heads/main') return { object: { sha: 'head' } };
		if (path === 'git/commits/head') return { tree: { sha: 'base' } };
		if (path === 'git/trees') {
			tree = clone(body);
			return { sha: 'tree' };
		}
		if (path === 'git/commits') return { sha: 'commit' };
		if (path === 'git/refs/heads/main') {
			assert.equal(body.force, false);
			if (fail) throw new Error('GitHub failed');
			return {};
		}
		throw new Error('Unexpected GitHub request');
	};
	const before = clone(h.state);
	assert.throws(() => h.context.publishReports(h.state.revision), /GitHub failed/);
	assert.deepEqual(h.state, before);
	fail = false;
	const result = h.context.publishReports(h.state.revision);
	assert.equal(result.commit, 'commit');
	const json = JSON.stringify(tree);
	for (const secret of [
		'SECRET',
		'PRIVATE TOKEN',
		'birthDate',
		'mobile',
		'address',
		'gender',
		'kap',
		'privateNote',
		'doctrine'
	])
		assert.equal(json.includes(secret), false, secret);
	assert.equal(json.includes('Public explanation'), true);
	assert.equal(h.state.publication.commit, 'commit');
	// Unchanged reports are reused on the next publish; only the manifest changes.
	h.context.publishReports(h.state.revision);
	assert.deepEqual(
		tree.tree.map((item) => item.path),
		['docs/data/manifest.json']
	);
});
test('reviewed legacy import excludes 1/X, keeps notes private, and refuses undecided markers', () => {
	const h = harness({
		revision: 'r1',
		members: [],
		periods: [],
		entries: [],
		doctrine: [],
		publication: { digests: {}, versions: {}, publishedAt: '' }
	});
	const plan = {
		members: [{ ...member, id: 'import-a' }],
		candidates: [
			{
				key: 'row',
				year: 2026,
				cells: [
					{ week: 1, value: '1', note: '' },
					{ week: 2, value: 'tue', note: 'SECRET LEGACY' },
					{ week: 3, value: '?', note: '' },
					{ week: 4, value: 'X', note: '' }
				]
			}
		],
		doctrine: []
	};
	const payload = {
		revision: 'r1',
		plan,
		assignments: { row: 'import-a' },
		markerChoices: {},
		inviterAssignments: {}
	};
	assert.throws(() => h.context.importLegacy(payload), /each legacy marker/);
	assert.equal(h.state.members.length, 0);
	payload.markerChoices['?'] = 'Absent';
	h.context.importLegacy(payload);
	const snapshot = A.snapshot(h.state, 2026, '2026-10-13', 'v');
	assert.equal(snapshot.annual[0].monitored, 2);
	assert.equal(snapshot.annual[0].attended, 1);
	assert.equal(h.state.entries[0].privateNote, 'SECRET LEGACY');
	assert.equal(JSON.stringify(snapshot).includes('SECRET LEGACY'), false);
	assert.throws(
		() => h.context.importLegacy({ ...payload, revision: h.state.revision }),
		/empty private workbook/
	);
});
test('source birthdays retain the source workbook timezone during import', () => {
	const h = harness();
	const birthday = vm.runInContext("new Date('1990-05-01T16:00:00Z')", h.context);
	const row = Array(13).fill('');
	row[0] = birthday;
	row[6] = 'Sample';
	row[7] = 'Member';
	row[8] = 'L';
	row[9] = 'K';
	const range = {
		getValues: () => [[], [], row],
		getDisplayValues: () => [[], [], row.map(String)]
	};
	h.context.SpreadsheetApp.openById = () => ({
		getSpreadsheetTimeZone: () => 'Asia/Manila',
		getSheetByName: (name) => (name === 'Purok2026' ? { getDataRange: () => range } : null)
	});
	h.context.Utilities.formatDate = (value, zone) => {
		assert.equal(zone, 'Asia/Manila');
		assert.equal(value.toISOString(), '1990-05-01T16:00:00.000Z');
		return '1990-05-02';
	};
	const plan = h.context.previewLegacyImport('sourceworkbook1234567890');
	assert.equal(plan.members[0].birthDate, '1990-05-02');
});
test('private table serialization round-trips profiles without interpreting text as formulas', () => {
	let rows = [];
	const sheet = {
		getMaxRows: () => 1000,
		getLastRow: () => rows.length,
		setFrozenRows: () => {},
		getDataRange: () => ({ getValues: () => clone(rows) }),
		getRange: (start, column, count) => ({
			setNumberFormat() {
				return this;
			},
			setValues(values) {
				values.forEach((row, i) => (rows[start - 1 + i] = clone(row)));
				return this;
			},
			clearContent() {
				rows.splice(start - 1, count);
			}
		})
	};
	const context = vm.createContext({
		SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }) },
		PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'private' }) }
	});
	vm.runInContext(
		fs.readFileSync(require('node:path').join(__dirname, '../google/Code.gs'), 'utf8'),
		context
	);
	const state = {
		revision: 'r1',
		members: [{ ...member, firstName: '=IMPORTXML("https://example.test","*")' }],
		periods: [],
		entries: [],
		doctrine: [],
		publication: { digests: {}, versions: {}, publishedAt: '' }
	};
	context.writeState_(sheet, state);
	assert.equal(rows[2][2].startsWith('{'), true);
	assert.deepEqual(clone(context.loadState_()), state);
	state.members = [];
	context.writeState_(sheet, state);
	assert.equal(rows.length, 2);
	assert.equal(context.loadState_().members.length, 0);
	rows.push(['members', 'old', JSON.stringify(member)]);
	assert.equal(context.loadState_().members.length, 0);
});
test('generated Google HTML and public scripts are syntactically valid and share the calculation source', () => {
	const path = require('node:path'),
		root = path.join(__dirname, '..');
	const core = fs.readFileSync(path.join(root, 'lib/attendance.js'), 'utf8');
	for (const file of ['google/Attendance.gs', 'docs/calendar.js'])
		assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), core);
	const html = fs.readFileSync(path.join(root, 'google/Admin.html'), 'utf8');
	assert.equal(html.includes('/* CALENDAR_SOURCE */'), false);
	new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
	new vm.Script(fs.readFileSync(path.join(root, 'docs/app.js'), 'utf8'));
	const bundle = fs.readFileSync(path.join(root, 'google/Purok.gs'), 'utf8');
	const bundledContext = vm.createContext({});
	vm.runInContext(bundle, bundledContext);
	assert.equal(bundledContext.ADMIN_HTML_, html);
	assert.equal(bundledContext.Attendance.firstWeek(2026), '2025-12-30');
	assert.equal(bundle.includes('createHtmlOutputFromFile'), false);
	assert.equal(
		JSON.parse(fs.readFileSync(path.join(root, 'google/appsscript.json'), 'utf8')).webapp.access,
		'MYSELF'
	);
});
