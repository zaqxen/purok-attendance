const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', 'docs');
const types = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml'
};
http
	.createServer((req, res) => {
		let name;
		try {
			name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
		} catch {
			res.writeHead(400).end();
			return;
		}
		if (name === '/__admin-preview') {
			const report = JSON.parse(fs.readFileSync(path.join(root, 'data', '2026.json'), 'utf8'));
			const state = {
				revision: 'preview',
				configuredPublishing: false,
				publication: { publishedAt: '' },
				members: report.members.map((m, index) => ({
					id: m.id,
					firstName: m.name,
					lastName: '',
					birthDate: index === 0 ? '1980-10-18' : '',
					mobile: '',
					address: 'Fictional address',
					gender: '',
					kap: 'K',
					status: 'Preview'
				})),
				periods: report.periods.map((p, i) => ({ ...p, id: 'p' + i })),
				entries: report.entries.map((e, index) => ({
					...e,
					year: 2026,
					publicReason: '',
					privateNote: index === 0 ? 'Fictional private comment for local layout verification.' : ''
				})),
				doctrine: []
			};
			const mock =
				'const google={script:{run:new Proxy({}, {get(target,key){if(key==="withSuccessHandler")return callback=>{target.success=callback;return google.script.run;};if(key==="withFailureHandler")return callback=>{target.failure=callback;return google.script.run;};return ()=>{if(key==="getAdminState")target.success(' +
				JSON.stringify(state) +
				');else target.failure(new Error("Local layout preview only. Editing requires your private Google deployment."));};}})}};';
			const html = fs
				.readFileSync(path.join(root, '..', 'google', 'Admin.html'), 'utf8')
				.replace('<script>', '<script>' + mock);
			res
				.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' })
				.end(html);
			return;
		}
		const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
		if (!file.startsWith(root + path.sep)) {
			res.writeHead(403).end();
			return;
		}
		fs.readFile(file, (error, data) => {
			if (error) {
				res.writeHead(404).end('Not found');
				return;
			}
			res
				.writeHead(200, {
					'Content-Type': types[path.extname(file)] || 'application/octet-stream',
					'Cache-Control': 'no-cache'
				})
				.end(data);
		});
	})
	.listen(4173, '127.0.0.1', () => console.log('Local: http://127.0.0.1:4173/'));
