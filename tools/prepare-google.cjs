const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'lib', 'attendance.js'), 'utf8');
fs.writeFileSync(path.join(root, 'google', 'Attendance.gs'), core);
fs.writeFileSync(path.join(root, 'docs', 'calendar.js'), core);
const template = fs.readFileSync(path.join(root, 'google', 'Admin.template.html'), 'utf8');
fs.writeFileSync(
	path.join(root, 'google', 'Admin.html'),
	template.replace('/* CALENDAR_SOURCE */', core)
);
console.log('Shared calendar prepared for Google and GitHub Pages.');
