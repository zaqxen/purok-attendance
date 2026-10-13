/* Shared by the private Google publisher and the public attendance calendar. */
var Attendance = (function () {
	'use strict';
	var DAYS = ['Tue', 'Fri', 'Sat', 'Sun', 'Recorded'];
	var DAY_MS = 86400000;
	function date(value) {
		if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
			throw new Error('Use a date in YYYY-MM-DD format.');
		var result = new Date(value + 'T00:00:00Z');
		if (!Number.isFinite(result.getTime()) || result.toISOString().slice(0, 10) !== value)
			throw new Error('Invalid date.');
		return result;
	}
	function iso(value) {
		return value.toISOString().slice(0, 10);
	}
	function addDays(value, days) {
		return iso(new Date(date(value).getTime() + days * DAY_MS));
	}
	function firstWeek(year) {
		if (!Number.isInteger(year) || year < 1999 || year > 2101)
			throw new Error('Year is outside the supported calendar.');
		var first = new Date(Date.UTC(year, 0, 1));
		return iso(new Date(first.getTime() + (2 - first.getUTCDay()) * DAY_MS));
	}
	function weeks(year) {
		var start = firstWeek(year);
		var count = Math.round((date(firstWeek(year + 1)) - date(start)) / DAY_MS / 7);
		return Array.from({ length: count }, function (_, i) {
			var from = addDays(start, i * 7);
			return { number: i + 1, start: from, end: addDays(from, 5) };
		});
	}
	function reportYear(today) {
		var year = date(today).getUTCFullYear();
		if (today >= firstWeek(year + 1)) return year + 1;
		if (today < firstWeek(year)) return year - 1;
		return year;
	}
	function completedThrough(year, today) {
		date(today);
		return weeks(year).filter(function (week) {
			return today > week.end;
		}).length;
	}
	function weekStart(year, number) {
		var list = weeks(year);
		if (!Number.isInteger(number) || number < 1 || number > list.length)
			throw new Error('Invalid monitoring week.');
		return list[number - 1].start;
	}
	function isEligible(periods, memberId, start) {
		return periods.some(function (p) {
			return p.memberId === memberId && p.start <= start && (!p.end || start < p.end);
		});
	}
	function validatePeriod(period, periods) {
		if (date(period.start).getUTCDay() !== 2) throw new Error('Monitoring starts on a Tuesday.');
		if (period.end && (date(period.end).getUTCDay() !== 2 || period.end <= period.start))
			throw new Error('Departure must be a later monitoring week.');
		if (
			periods.some(function (p) {
				return (
					p.id !== period.id &&
					p.memberId === period.memberId &&
					period.start < (p.end || '9999-12-31') &&
					p.start < (period.end || '9999-12-31')
				);
			})
		)
			throw new Error('Monitoring periods cannot overlap.');
	}
	function snapshot(state, year, today, version) {
		var calendar = weeks(year);
		var through = completedThrough(year, today);
		var members = state.members
			.filter(function (member) {
				return calendar.some(function (week) {
					return isEligible(state.periods, member.id, week.start);
				});
			})
			.map(function (member) {
				return {
					id: member.id,
					name: [member.firstName, member.lastName].filter(Boolean).join(' ')
				};
			});
		var ids = new Set(
			members.map(function (member) {
				return member.id;
			})
		);
		var periods = state.periods
			.filter(function (p) {
				return (
					ids.has(p.memberId) &&
					p.start < firstWeek(year + 1) &&
					(!p.end || p.end > calendar[0].start)
				);
			})
			.map(function (p) {
				return { memberId: p.memberId, start: p.start, end: p.end || '' };
			});
		var entries = state.entries
			.filter(function (entry) {
				return entry.year === year && ids.has(entry.memberId);
			})
			.map(function (entry) {
				if (
					!Number.isInteger(entry.week) ||
					entry.week < 1 ||
					entry.week > calendar.length ||
					(entry.day && DAYS.indexOf(entry.day) === -1)
				)
					throw new Error('Invalid attendance record.');
				return {
					memberId: entry.memberId,
					week: entry.week,
					day: entry.day || ''
				};
			})
			.filter(function (entry) {
				return isEligible(periods, entry.memberId, calendar[entry.week - 1].start);
			});
		var lookup = new Map();
		entries.forEach(function (entry) {
			var key = entry.memberId + ':' + entry.week;
			if (lookup.has(key)) throw new Error('Duplicate attendance record.');
			lookup.set(key, entry);
		});
		var weekly = calendar.map(function (week) {
			if (week.number > through)
				return { week: week.number, eligible: 0, present: 0, absent: 0, absencePercent: null };
			var eligible = 0,
				present = 0;
			members.forEach(function (member) {
				if (!isEligible(periods, member.id, week.start)) return;
				eligible++;
				if ((lookup.get(member.id + ':' + week.number) || {}).day) present++;
			});
			return {
				week: week.number,
				eligible: eligible,
				present: present,
				absent: eligible - present,
				absencePercent: eligible ? ((eligible - present) / eligible) * 100 : null
			};
		});
		var annual = members.map(function (member) {
			var monitored = 0,
				attended = 0;
			calendar.slice(0, through).forEach(function (week) {
				if (!isEligible(periods, member.id, week.start)) return;
				monitored++;
				if ((lookup.get(member.id + ':' + week.number) || {}).day) attended++;
			});
			return {
				memberId: member.id,
				monitored: monitored,
				attended: attended,
				absent: monitored - attended,
				percent: monitored ? (attended / monitored) * 100 : null
			};
		});
		var possible = weekly.reduce(function (sum, week) {
			return sum + week.eligible;
		}, 0);
		var present = weekly.reduce(function (sum, week) {
			return sum + week.present;
		}, 0);
		return {
			schemaVersion: 1,
			year: year,
			version: version,
			asOf: today,
			throughWeek: through,
			members: members,
			periods: periods,
			entries: entries,
			weekly: weekly,
			annual: annual,
			overall: {
				monitored: possible,
				attended: present,
				absent: possible - present,
				percent: possible ? (present / possible) * 100 : null
			}
		};
	}
	return {
		DAYS: DAYS,
		date: date,
		addDays: addDays,
		firstWeek: firstWeek,
		weeks: weeks,
		reportYear: reportYear,
		completedThrough: completedThrough,
		weekStart: weekStart,
		isEligible: isEligible,
		validatePeriod: validatePeriod,
		snapshot: snapshot
	};
})();
if (typeof module !== 'undefined') module.exports = Attendance;
