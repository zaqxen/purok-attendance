(function () {
	'use strict';
	const $ = (id) => document.getElementById(id);
	const esc = (value) =>
		String(value ?? '').replace(
			/[&<>"']/g,
			(ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
		);
	const percent = (value) =>
		value === null || value === undefined ? '—' : Math.round(value) + '%';
	const today = () =>
		new Intl.DateTimeFormat('en-CA', {
			timeZone: 'Asia/Dubai',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}).format(new Date());
	const formatDate = (value) =>
		new Intl.DateTimeFormat('en-GB', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
			Attendance.date(value)
		);
	let manifest,
		report,
		selectedYear,
		requestNumber = 0;
	const reports = new Map();
	async function getJSON(path) {
		const response = await fetch(path, { cache: 'no-cache' });
		if (!response.ok)
			throw new Error('Published records could not be loaded. Please refresh the page.');
		return response.json();
	}
	async function loadReport(year) {
		if (reports.has(year)) return reports.get(year);
		const item = manifest.reports.find((item) => item.year === year);
		if (!item || !/^data\/\d{4}\.json$/.test(item.path))
			throw new Error('This year has not been published yet.');
		const result = await getJSON(item.path + '?v=' + encodeURIComponent(item.version));
		if (
			result.schemaVersion !== 1 ||
			result.year !== year ||
			result.version !== item.version ||
			!Array.isArray(result.members) ||
			!Array.isArray(result.entries) ||
			!Array.isArray(result.annual)
		)
			throw new Error('An update is being published. Please refresh in a moment.');
		reports.set(year, result);
		return result;
	}
	async function changeYear(year) {
		const sequence = ++requestNumber;
		$('loading').hidden = false;
		$('error').hidden = true;
		$('content').hidden = true;
		try {
			let loaded;
			if (manifest.reports.some((item) => item.year === year)) loaded = await loadReport(year);
			else {
				loaded = Attendance.snapshot(
					{
						members: manifest.roster.map((member) => ({
							id: member.id,
							firstName: member.name,
							lastName: ''
						})),
						periods: manifest.periods,
						entries: []
					},
					year,
					Attendance.firstWeek(year),
					'unpublished'
				);
				loaded.unpublished = true;
			}
			if (sequence !== requestNumber) return;
			report = loaded;
			selectedYear = year;
			$('content').hidden = false;
			$('member-total').textContent = report.members.length;
			$('week-total').textContent = report.throughWeek;
			$('week-detail').textContent = report.throughWeek
				? 'Through week ' + report.throughWeek
				: 'No completed weeks published';
			$('attendance-total').textContent = percent(report.overall.percent);
			$('attendance-detail').textContent =
				report.overall.attended + ' of ' + report.overall.monitored + ' eligible member-weeks';
			$('absence-total').textContent = report.overall.absent;
			$('published-date').textContent = report.unpublished
				? 'This year has not been published yet'
				: 'Updated ' +
					new Intl.DateTimeFormat('en-GB', {
						day: 'numeric',
						month: 'short',
						year: 'numeric',
						timeZone: 'Asia/Dubai'
					}).format(new Date(manifest.publishedAt));
			render();
			jumpToWeek();
		} catch (error) {
			if (sequence !== requestNumber) return;
			$('error').textContent = error.message;
			$('error').hidden = false;
		} finally {
			if (sequence === requestNumber) $('loading').hidden = true;
		}
	}
	function render() {
		const filter = $('search').value.toLocaleLowerCase().trim();
		const members = report.members.filter((member) =>
			member.name.toLocaleLowerCase().includes(filter)
		);
		const weeks = Attendance.weeks(selectedYear);
		const lookup = new Map(
			report.entries.map((entry) => [entry.memberId + ':' + entry.week, entry])
		);
		const stats = new Map(report.annual.map((item) => [item.memberId, item]));
		const current = selectedYear === Attendance.reportYear(today());
		let html =
			'<caption class="skip-link">Attendance for ' +
			selectedYear +
			', reported through week ' +
			report.throughWeek +
			'</caption><thead><tr><th class="name" scope="col">Member <small>Annual attendance</small></th>';
		html += weeks
			.map(
				(week) =>
					'<th scope="col" data-week="' +
					week.number +
					'" class="' +
					(current && week.start <= today() && today() <= Attendance.addDays(week.end, 1)
						? 'current'
						: '') +
					'">W' +
					week.number +
					'<small>' +
					esc(formatDate(week.start)) +
					'–' +
					esc(new Date(week.end + 'T00:00:00Z').getUTCDate()) +
					'</small></th>'
			)
			.join('');
		html += '</tr></thead><tbody>';
		for (const member of members) {
			const item = stats.get(member.id);
			html +=
				'<tr><th scope="row" class="name"><button data-member="' +
				esc(member.id) +
				'">' +
				esc(member.name) +
				'</button><small>' +
				percent(item?.percent) +
				' · ' +
				(item?.attended || 0) +
				'/' +
				(item?.monitored || 0) +
				' monitored weeks</small></th>';
			for (const week of weeks) {
				const entry = lookup.get(member.id + ':' + week.number);
				const eligible = Attendance.isEligible(report.periods, member.id, week.start);
				const status = !eligible
					? 'outside'
					: entry?.day
						? 'present'
						: week.number <= report.throughWeek
							? 'absent'
							: 'pending';
				const text =
					status === 'present'
						? entry.day === 'Recorded'
							? '✓'
							: entry.day
						: status === 'outside'
							? '—'
							: status === 'absent'
								? '·'
								: '…';
				const statusLabel = {
					outside: 'Outside monitoring',
					present: 'Attended',
					absent: 'Absent',
					pending: 'Not yet reported'
				}[status];
				html +=
					'<td><button class="cell ' +
					status +
					(entry?.reason ? ' comment' : '') +
					'" data-cell="' +
					esc(member.id) +
					':' +
					week.number +
					'" aria-label="' +
					esc(
						member.name +
							', week ' +
							week.number +
							': ' +
							statusLabel +
							(entry?.reason ? '. Explanation available.' : '')
					) +
					'">' +
					esc(text) +
					'</button></td>';
			}
			html += '</tr>';
		}
		html += '</tbody>';
		$('attendance-table').innerHTML = html;
		if (!members.length)
			$('attendance-table').innerHTML +=
				'<tfoot><tr><td colspan="' +
				(weeks.length + 1) +
				'" class="empty">No names match your search.</td></tr></tfoot>';
		$('weekly-chart').innerHTML =
			'<div class="weekly-bars">' +
			report.weekly
				.slice(0, report.throughWeek)
				.map(
					(week) =>
						'<button class="week-bar" data-chart-week="' +
						week.week +
						'" style="--height:' +
						(week.absencePercent || 0) +
						'%" aria-label="Week ' +
						week.week +
						': ' +
						(week.absencePercent === null
							? 'no monitored members'
							: percent(week.absencePercent) + ' absent') +
						'"><span>' +
						week.week +
						'</span></button>'
				)
				.join('') +
			'</div>';
		if (!report.throughWeek)
			$('weekly-chart').innerHTML =
				'<p class="empty">No completed weeks have been published for this year.</p>';
		$('annual-chart').innerHTML =
			members
				.map((member) => {
					const item = stats.get(member.id);
					return (
						'<div class="annual-item"><button data-member="' +
						esc(member.id) +
						'"><span>' +
						esc(member.name) +
						'</span><strong>' +
						percent(item?.percent) +
						'</strong></button><div class="annual-track"><div class="annual-fill" style="width:' +
						(item?.percent || 0) +
						'%"></div></div><small>' +
						(item?.monitored
							? item.attended + ' attended / ' + item.monitored + ' monitored weeks'
							: 'No completed monitored weeks') +
						'</small></div>'
					);
				})
				.join('') || '<p class="empty">No names match your search.</p>';
		$('chart-detail').textContent =
			'Select a week for its totals. Transfers change the monitored count for that week.';
	}
	function jumpToWeek() {
		if (!report) return;
		const number =
			selectedYear === Attendance.reportYear(today())
				? Math.min(report.throughWeek + 1, Attendance.weeks(selectedYear).length)
				: 1;
		const heading = $('attendance-table').querySelector('[data-week="' + number + '"]');
		if (heading) $('table-scroll').scrollLeft = Math.max(0, heading.offsetLeft - 235);
	}
	function showCell(button) {
		const key = button.dataset.cell,
			index = key.lastIndexOf(':'),
			id = key.slice(0, index),
			week = Number(key.slice(index + 1));
		const member = report.members.find((member) => member.id === id);
		const entry = report.entries.find((entry) => entry.memberId === id && entry.week === week);
		const popup = $('cell-popover');
		popup.innerHTML =
			'<strong>' +
			esc(member.name) +
			' · Week ' +
			week +
			'</strong><p>' +
			esc(
				entry?.reason ||
					(button.classList.contains('outside')
						? 'This person was outside their monitoring period.'
						: button.classList.contains('pending')
							? 'This week is not included in the published absence totals yet.'
							: button.classList.contains('present')
								? entry.day === 'Recorded'
									? 'Attendance recorded; original day not specified.'
									: 'Attended on ' + entry.day + '.'
								: 'No public absence explanation was recorded.')
			) +
			'</p>';
		popup.hidden = false;
		const box = button.getBoundingClientRect();
		popup.style.left = Math.max(12, Math.min(box.left, innerWidth - popup.offsetWidth - 12)) + 'px';
		popup.style.top =
			Math.max(12, Math.min(box.bottom + 8, innerHeight - popup.offsetHeight - 12)) + 'px';
	}
	async function showHistory(id) {
		$('history-name').textContent = report.members.find((member) => member.id === id).name;
		$('history-content').textContent = 'Loading saved years…';
		$('history-dialog').showModal();
		try {
			const history = await Promise.all(manifest.reports.map((item) => loadReport(item.year)));
			$('history-content').innerHTML =
				history
					.sort((a, b) => a.year - b.year)
					.map((year) => {
						const item = year.annual.find((item) => item.memberId === id);
						return (
							'<div class="history-row"><b>' +
							year.year +
							'</b><div><small>' +
							(item?.monitored
								? item.attended + ' attended of ' + item.monitored + ' monitored weeks'
								: 'Not monitored in completed weeks') +
							'</small><div class="annual-track"><div class="annual-fill" style="width:' +
							(item?.percent || 0) +
							'%"></div></div></div><strong>' +
							percent(item?.percent) +
							'</strong></div>'
						);
					})
					.join('') +
				'<p>Each year uses that person’s eligible monitoring weeks. Later transfers do not change earlier years.</p>';
		} catch (error) {
			$('history-content').textContent = error.message;
		}
	}
	$('year-select').addEventListener('change', (event) => changeYear(Number(event.target.value)));
	$('search').addEventListener('input', () => {
		if (report) render();
	});
	$('current-week-button').addEventListener('click', jumpToWeek);
	for (const tab of ['attendance', 'insights'])
		$('' + tab + '-tab').addEventListener('click', () => {
			for (const name of ['attendance', 'insights']) {
				$('' + name + '-tab').classList.toggle('selected', name === tab);
				$('' + name + '-tab').setAttribute('aria-selected', String(name === tab));
				$('' + name + '-view').hidden = name !== tab;
			}
		});
	document.addEventListener('click', (event) => {
		const name = event.target.closest('[data-member]');
		if (name) showHistory(name.dataset.member);
		const cell = event.target.closest('[data-cell]');
		if (cell) showCell(cell);
		else $('cell-popover').hidden = true;
		const bar = event.target.closest('[data-chart-week]');
		if (bar) {
			const week = report.weekly.find((week) => week.week === Number(bar.dataset.chartWeek));
			document
				.querySelectorAll('.week-bar')
				.forEach((button) => button.classList.toggle('selected', button === bar));
			$('chart-detail').textContent =
				'Week ' +
				week.week +
				' · ' +
				week.present +
				' attended · ' +
				week.absent +
				' absent · ' +
				week.eligible +
				' monitored · ' +
				(week.absencePercent === null ? 'No percentage' : percent(week.absencePercent) + ' absent');
		}
		if (event.target.closest('.close-dialog')) event.target.closest('dialog').close();
	});
	$('attendance-table').addEventListener('pointerover', (event) => {
		const button = event.target.closest('[data-cell]');
		if (button && event.pointerType !== 'touch') showCell(button);
	});
	$('attendance-table').addEventListener('pointerout', () => {
		$('cell-popover').hidden = true;
	});
	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') $('cell-popover').hidden = true;
	});
	$('table-scroll').addEventListener('scroll', () => {
		$('cell-popover').hidden = true;
	});
	$('admin-button').addEventListener('click', () => {
		if (
			manifest?.adminUrl &&
			/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(manifest.adminUrl)
		)
			window.open(manifest.adminUrl, '_blank', 'noopener,noreferrer');
		else $('setup-dialog').showModal();
	});
	(async () => {
		try {
			manifest = await getJSON('data/manifest.json');
			if (
				manifest.schemaVersion !== 1 ||
				!Array.isArray(manifest.reports) ||
				!manifest.reports.length
			)
				throw new Error('No attendance years have been published yet.');
			$('demo-banner').hidden = !manifest.demo;
			const current = Attendance.reportYear(today());
			const years = [...new Set([...manifest.reports.map((item) => item.year), current])].sort(
				(a, b) => b - a
			);
			$('year-select').innerHTML = years
				.map((year) => '<option value="' + year + '">' + year + '</option>')
				.join('');
			$('year-select').value = current;
			$('year-select').disabled = false;
			await changeYear(current);
		} catch (error) {
			$('loading').hidden = true;
			$('error').textContent = error.message;
			$('error').hidden = false;
		}
	})();
})();
