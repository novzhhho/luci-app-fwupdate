'use strict';
'require view';
'require rpc';
'require ui';

var callStatus = rpc.declare({ object: 'luci.fwupdate', method: 'status' });
var callCheck  = rpc.declare({ object: 'luci.fwupdate', method: 'check' });
var callLog    = rpc.declare({ object: 'luci.fwupdate', method: 'log' });
var callStart  = rpc.declare({ object: 'luci.fwupdate', method: 'start' });
var callSave   = rpc.declare({ object: 'luci.fwupdate', method: 'setconfig', params: [ 'repo', 'mirror' ] });

var callSelfStatus = rpc.declare({ object: 'luci.fwupdate', method: 'selfstatus' });
var callSelfCheck  = rpc.declare({ object: 'luci.fwupdate', method: 'selfcheck' });
var callSelfUpdate = rpc.declare({ object: 'luci.fwupdate', method: 'selfupdate' });

function fmtSize(n) {
	n = +n || 0;

	if (!n)
		return '未知';
	if (n < 1048576)
		return (Math.round(n / 1024 * 10) / 10) + ' KB';

	return (Math.round(n / 1048576 * 10) / 10) + ' MB';
}

function fmtTime(ts) {
	ts = +ts || 0;
	if (!ts)
		return '—';

	var d = new Date(ts * 1000),
	    p = function(x) { return (x < 10 ? '0' : '') + x; };

	return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
	       p(d.getHours()) + ':' + p(d.getMinutes());
}

/* r25.12.2-lucky2.27.2-bandix0.12.11-luci0.12.12-uiabc1234
   → { main: '25.12.2', subs: ['lucky2.27.2', ...] } */
function verParts(tag) {
	tag = (tag || '').replace(/^r(?=[0-9])/, '');

	if (!tag)
		return { main: '', subs: [] };

	var p = tag.split('-');

	return { main: p[0] || '', subs: p.slice(1) };
}

/* 样式说明：
   1. 卡片的背景/圆角/投影全部交给主题的 .cbi-section，行布局交给 .cbi-value，
      进度条交给 .cbi-progressbar —— 这样在 Argon / Bootstrap / Material 下都原生一致。
   2. 自定义部分只做「主题没提供的东西」：状态徽章、版本大字、步骤条、日志框。
      颜色一律取主题变量并带兜底值，深色主题会自动跟随。
   3. 字号跟主题正文对齐（.875rem = 14px），不再用 11px 这类小字。 */
var CSS = `
.fwup{font-size:.875rem;line-height:1.6}
.fwup .fw-statusline{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;padding:1.25rem 1.25rem 0}
.fwup .fw-badge{display:inline-flex;align-items:center;gap:.45rem;padding:.2rem .7rem;border-radius:1rem;
  font-size:.8125rem;font-weight:600;line-height:1.6;border:1px solid transparent;white-space:nowrap}
.fwup .fw-badge .fw-dot{flex:0 0 auto;width:.4rem;height:.4rem;border-radius:50%;background:currentColor}
.fwup .fw-badge.ok{color:var(--success,#2dce89);background:rgba(45,206,137,.12);border-color:rgba(45,206,137,.3)}
.fwup .fw-badge.new{color:var(--orange,#fb6340);background:rgba(251,99,64,.12);border-color:rgba(251,99,64,.3)}
.fwup .fw-badge.run{color:var(--primary,#5e72e4);background:rgba(94,114,228,.12);border-color:rgba(94,114,228,.3)}
.fwup .fw-badge.err{color:var(--danger,#f5365c);background:rgba(245,54,92,.12);border-color:rgba(245,54,92,.3)}
.fwup .fw-hint{font-size:.875rem;color:var(--gray,#8898aa)}
.fwup .fw-vers{display:flex;align-items:flex-start;gap:1.25rem;flex-wrap:wrap;padding:1rem 1.25rem 0}
.fwup .fw-vblock{flex:1 1 15rem;min-width:0}
.fwup .fw-vlabel{font-size:.875rem;color:var(--gray,#8898aa);margin-bottom:.25rem}
.fwup .fw-vmain{font-size:1.5rem;font-weight:700;line-height:1.35;letter-spacing:-.01em;word-break:break-word}
.fwup .fw-vsub{margin-top:.25rem;font-size:.875rem;line-height:1.6;color:var(--gray,#8898aa);
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-word}
.fwup .fw-arrow{align-self:center;padding-top:1.2rem;font-size:1.125rem;color:var(--gray,#8898aa);opacity:.7}
.fwup .fw-meta{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;padding:.875rem 1.25rem 0;
  font-size:.875rem;color:var(--gray,#8898aa)}
.fwup .fw-meta .fw-sep{opacity:.55}
.fwup .fw-acts{display:flex;align-items:center;gap:.625rem;flex-wrap:wrap;margin-top:1rem;
  padding:1.125rem 1.25rem;border-top:1px solid var(--border-color,#dee2e6)}
.fwup .fw-body{padding:1.25rem}
/* 主题的次要按钮是 #f0f0f0 底 + #8898aa 字，对比度偏低；文字改为继承正文色 */
.fwup .btn:not(.cbi-button-apply){color:inherit}
.fwup .btn[disabled]{opacity:.5;cursor:not-allowed}
.fwup .fw-notes{margin:0;padding:1rem 1.125rem;max-height:20rem;overflow:auto;
  border:1px solid var(--border-color,#dee2e6);border-radius:.25rem;
  background:rgba(136,152,170,.07);color:inherit;font-size:.875rem;line-height:1.7}
.fwup .fw-md-h{margin:1.125rem 0 .5rem;font-size:.9375rem;font-weight:700;line-height:1.5}
.fwup .fw-md-h:first-child{margin-top:0}
.fwup .fw-md-p{margin:.25rem 0 .75rem}
.fwup .fw-md-p:last-child{margin-bottom:0}
.fwup .fw-md-ul{margin:.25rem 0 .75rem;padding-left:1.25rem;list-style:disc}
.fwup .fw-md-ul li{margin:.2rem 0}
.fwup .fw-md-table{width:100%;margin:.5rem 0 1rem;border-collapse:collapse;font-size:.875rem}
.fwup .fw-md-table th:first-child,
.fwup .fw-md-table td:first-child{width:99%}
.fwup .fw-md-table th,.fwup .fw-md-table td{padding:.45rem .75rem;text-align:left;
  border-bottom:1px solid var(--border-color,#dee2e6)}
.fwup .fw-md-table th{font-weight:600;color:var(--gray,#8898aa);font-size:.8125rem}
.fwup .fw-md-table tr:last-child td{border-bottom:0}
.fwup .fw-md-empty{margin:0;color:var(--gray,#8898aa)}
.fwup .fw-steps{display:flex;margin:0 0 1.25rem;padding:0;list-style:none}
.fwup .fw-step{position:relative;flex:1;text-align:center;font-size:.8125rem;
  color:var(--gray,#8898aa);line-height:1.5}
.fwup .fw-step i{display:block;width:1.75rem;height:1.75rem;margin:0 auto .5rem;
  border:1px solid var(--border-color,#dee2e6);border-radius:50%;
  font-style:normal;font-size:.8125rem;font-weight:700;line-height:1.6rem;text-align:center}
.fwup .fw-step:not(:last-child):after{content:"";position:absolute;top:.8125rem;
  left:calc(50% + 1.125rem);right:calc(-50% + 1.125rem);height:2px;
  background:var(--border-color,#dee2e6)}
.fwup .fw-step.on{color:var(--primary,#5e72e4);font-weight:600}
.fwup .fw-step.on i{border-color:var(--primary,#5e72e4);background:var(--primary,#5e72e4);color:#fff}
.fwup .fw-step.done{color:var(--success,#2dce89)}
.fwup .fw-step.done i{border-color:var(--success,#2dce89);background:var(--success,#2dce89);color:#fff}
.fwup .fw-step.done:not(:last-child):after{background:var(--success,#2dce89)}
.fwup .fw-dlinfo{display:flex;align-items:baseline;gap:.625rem;margin:.625rem 0 1.125rem;
  font-size:.875rem;color:var(--gray,#8898aa)}
.fwup .fw-dlinfo .fw-pct{font-size:1.125rem;font-weight:700;color:inherit}
.fwup .fw-console{margin:0;padding:.875rem 1rem;max-height:15rem;overflow:auto;
  white-space:pre-wrap;word-break:break-word;font-size:.8125rem;line-height:1.7;
  border:1px solid var(--border-color,#dee2e6);border-radius:.25rem;
  background:rgba(136,152,170,.08);color:inherit;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
/* 主题给 code 用了 --dark / --lighter，深色主题下会变成深字浅底，这里显式继承 */
.fwup code{color:inherit;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:.8125rem;padding:.1rem .35rem;border-radius:.25rem;
  background:rgba(136,152,170,.16)}
/* 主题默认把行标签排成 23rem 宽右对齐的列，在只有短值的卡片里会显得中空，
   这里收窄并左对齐；依然沿用主题的字号、行高与配色 */
.fwup .cbi-value-title{width:11rem;padding-right:1rem;text-align:left;float:none;
  display:inline-block;vertical-align:middle}
.fwup .cbi-value-field{display:inline-block;vertical-align:middle;max-width:calc(100% - 11.5rem)}
.fwup .cbi-value{padding:0 1.25rem}
.fwup .fw-in{width:100%;max-width:34rem}
.fwup .fw-details{overflow:hidden}
.fwup .fw-details>summary{display:flex;align-items:center;gap:.5rem;cursor:pointer;
  padding:.875rem 1.25rem;font-size:1.1rem;font-weight:700;line-height:1.4;list-style:none}
.fwup .fw-details>summary::-webkit-details-marker{display:none}
.fwup .fw-details>summary:before{content:"\\25B8";flex:0 0 auto;font-size:.9rem;
  color:var(--gray,#8898aa);transition:transform .2s ease}
.fwup .fw-details[open]>summary:before{transform:rotate(90deg)}
.fwup .fw-details[open]>summary{border-bottom:1px solid var(--border-color,#dee2e6)}
@media screen and (max-width:600px){
  .fwup .fw-arrow{display:none}
  .fwup .fw-vblock{flex:1 1 100%}
  .fwup .fw-step{font-size:.75rem}
  .fwup .cbi-value-title,
  .fwup .cbi-value-field{display:block;width:100%;max-width:100%;padding-right:0}
}
`;

return view.extend({
	load: function() {
		var fail = function() { return null; };

		return Promise.all([
			callStatus().then(function(r) { return r; }, fail),
			callSelfStatus().then(function(r) { return r; }, fail)
		]).then(function(r) {
			return { st: r[0], self: r[1] };
		});
	},

	/* ---------------- 小工具 ---------------- */

	shortSha: function(s) {
		s = (s || '').replace(/[^0-9a-f]/g, '');
		return s ? s.substring(0, 7) : '';
	},

	row: function(k, v) {
		return E('div', { class: 'cbi-value' }, [
			E('label', { class: 'cbi-value-title' }, k),
			E('div', { class: 'cbi-value-field' }, v)
		]);
	},

	setBadge: function(kind, text, hint) {
		if (!this.refs)
			return;

		this.refs.badge.className = 'fw-badge ' + kind;
		this.refs.badgeTxt.textContent = text;
		this.refs.hint.textContent = hint || '';
	},

	setVersions: function(current, latest) {
		if (!this.refs)
			return;

		var a = verParts(current),
		    b = verParts(latest);

		this.refs.curMain.textContent = a.main || '未知';
		this.refs.curSub.textContent = a.subs.length ? a.subs.join(' · ') : ' ';

		this.refs.newMain.textContent = b.main || '—';
		this.refs.newSub.textContent = b.main
			? (b.subs.length ? b.subs.join(' · ') : ' ')
			: '尚未检查';
	},

	setMeta: function(o) {
		var box = this.refs.meta,
		    items = [];

		o = o || {};

		if (o.size)
			items.push('镜像 ' + fmtSize(o.size));
		if (o.published)
			items.push('发布于 ' + String(o.published).replace('T', ' ').substring(0, 16));

		items.push('上次检查 ' + (o.checked ? fmtTime(o.checked) : '—'));

		while (box.firstChild)
			box.removeChild(box.firstChild);

		items.forEach(function(t, i) {
			if (i)
				box.appendChild(E('span', { class: 'fw-sep' }, '·'));
			box.appendChild(E('span', {}, t));
		});
	},

	showNotes: function(body) {
		if (!this.refs)
			return;

		this.renderNotes(body);
		this.refs.notes.style.display = '';
	},

	/* Release 说明是 markdown，直接塞进 <pre> 会是一大坨原始符号。
	   这里只处理实际会出现的几种结构：标题、表格、列表、行内 **加粗** 与 `代码`。 */
	mdInline: function(text) {
		var out = [],
		    re = /(\*\*[^*]+\*\*|`[^`]+`)/g,
		    last = 0,
		    m;

		while ((m = re.exec(text)) !== null) {
			if (m.index > last)
				out.push(text.substring(last, m.index));

			var tok = m[0];

			if (tok.charAt(0) === '*')
				out.push(E('strong', {}, tok.slice(2, -2)));
			else
				out.push(E('code', {}, tok.slice(1, -1)));

			last = m.index + tok.length;
		}

		if (last < text.length)
			out.push(text.substring(last));

		return out;
	},

	mdCells: function(line) {
		return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|')
			.map(function(c) { return c.trim(); });
	},

	renderNotes: function(body) {
		var box = this.refs.notesBody,
		    lines = String(body || '').replace(/\r/g, '').split('\n'),
		    self = this,
		    i = 0,
		    meaningful = false;

		while (box.firstChild)
			box.removeChild(box.firstChild);

		while (i < lines.length) {
			var t = lines[i].trim();

			if (!t) {
				i++;
				continue;
			}

			meaningful = true;

			/* 表格：| a | b | 后面紧跟 |---|---| */
			if (t.charAt(0) === '|' && i + 1 < lines.length &&
			    /^\|?[\s:|-]+\|?$/.test(lines[i + 1].trim())) {
				var head = this.mdCells(t),
				    rows = [],
				    table;

				i += 2;

				while (i < lines.length && lines[i].trim().charAt(0) === '|') {
					rows.push(this.mdCells(lines[i].trim()));
					i++;
				}

				table = E('table', { class: 'fw-md-table' }, [
					E('thead', {}, E('tr', {}, head.map(function(c) {
						return E('th', {}, c);
					})))
				]);

				if (rows.length)
					table.appendChild(E('tbody', {}, rows.map(function(r) {
						return E('tr', {}, r.map(function(c) {
							return E('td', {}, self.mdInline(c));
						}));
					})));

				box.appendChild(table);
				continue;
			}

			/* 标题 */
			if (/^#{1,6}\s+/.test(t)) {
				box.appendChild(E('div', { class: 'fw-md-h' },
					t.replace(/^#{1,6}\s+/, '')));
				i++;
				continue;
			}

			/* 无序列表 */
			if (/^[-*]\s+/.test(t)) {
				var ul = E('ul', { class: 'fw-md-ul' });

				while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
					ul.appendChild(E('li', {},
						this.mdInline(lines[i].trim().replace(/^[-*]\s+/, ''))));
					i++;
				}

				box.appendChild(ul);
				continue;
			}

			/* 普通段落 */
			box.appendChild(E('p', { class: 'fw-md-p' }, this.mdInline(t)));
			i++;
		}

		if (!meaningful)
			box.appendChild(E('p', { class: 'fw-md-empty' }, '（该 Release 没有写更新说明）'));
	},

	setSteps: function(phase) {
		if (!this.refs || this._phase === phase)
			return;

		this._phase = phase;

		for (var i = 0; i < this.refs.steps.length; i++) {
			var el = this.refs.steps[i],
			    cls = 'fw-step';

			if (i < phase)
				cls += ' done';
			else if (i === phase)
				cls += ' on';

			el.className = cls;
			el.querySelector('i').textContent = (i < phase) ? '✓' : (i + 1);
		}
	},

	phaseFromLog: function(t) {
		if (t.indexOf('开始刷写') >= 0)
			return 4;
		if (t.indexOf('sha256') >= 0 || t.indexOf('gzip:') >= 0)
			return 2;
		if (t.indexOf('下载:') >= 0 || t.indexOf('固件大小') >= 0)
			return 1;
		if (t.indexOf('最新版本') >= 0)
			return 1;
		if (t.indexOf('仓库:') >= 0)
			return 0;
		return -1;
	},

	/* ---------------- 渲染 ---------------- */

	render: function(data) {
		var st = (data && data.st) || null,
		    sf = (data && data.self) || null,
		    s = st || {};

		this.status = s;
		this.latestTag = s.latest || '';
		this.lastLog = '';
		this._phase = -1;

		var nodes = [
			E('style', {}, CSS),

			/* ---------- 状态与版本 ---------- */
			E('div', { class: 'cbi-section' }, [
				E('h3', {}, '固件升级'),

				E('div', { class: 'fw-statusline' }, [
					E('span', { class: 'fw-badge ok', id: 'fw-badge' }, [
						E('span', { class: 'fw-dot' }),
						E('span', { id: 'fw-badge-txt' }, '待检查')
					]),
					E('span', { class: 'fw-hint', id: 'fw-hint' }, '')
				]),

				E('div', { class: 'fw-vers' }, [
					E('div', { class: 'fw-vblock' }, [
						E('div', { class: 'fw-vlabel' }, '当前版本'),
						E('div', { class: 'fw-vmain', id: 'fw-cur-main' }, '—'),
						E('div', { class: 'fw-vsub', id: 'fw-cur-sub' }, ' ')
					]),
					E('div', { class: 'fw-arrow' }, '→'),
					E('div', { class: 'fw-vblock' }, [
						E('div', { class: 'fw-vlabel' }, '可升级到'),
						E('div', { class: 'fw-vmain', id: 'fw-new-main' }, '—'),
						E('div', { class: 'fw-vsub', id: 'fw-new-sub' }, ' ')
					])
				]),

				E('div', { class: 'fw-meta', id: 'fw-meta' }),

				E('div', { class: 'fw-acts' }, [
					E('button', {
						class: 'btn cbi-button cbi-button-apply', id: 'fw-up',
						disabled: true,
						click: ui.createHandlerFn(this, 'handleUpgrade')
					}, '立即升级'),
					E('button', {
						class: 'btn', id: 'fw-ck',
						click: ui.createHandlerFn(this, 'handleCheck')
					}, '检查更新')
				])
			]),

			/* ---------- 更新说明 ---------- */
			E('div', { class: 'cbi-section', id: 'fw-notes', style: 'display:none' }, [
				E('h3', {}, '更新说明'),
				E('div', { class: 'fw-body' }, [
					E('div', { class: 'fw-notes', id: 'fw-notes-body' })
				])
			]),

			/* ---------- 升级进度 ---------- */
			E('div', { class: 'cbi-section', id: 'fw-progress', style: 'display:none' }, [
				E('h3', {}, '升级进度'),
				E('div', { class: 'fw-body' }, [
					E('ol', { class: 'fw-steps', id: 'fw-steps' }, [
						E('li', { class: 'fw-step', 'data-i': 0 }, [ E('i', {}, '1'), E('span', {}, '检查更新') ]),
						E('li', { class: 'fw-step', 'data-i': 1 }, [ E('i', {}, '2'), E('span', {}, '下载镜像') ]),
						E('li', { class: 'fw-step', 'data-i': 2 }, [ E('i', {}, '3'), E('span', {}, '校验镜像') ]),
						E('li', { class: 'fw-step', 'data-i': 3 }, [ E('i', {}, '4'), E('span', {}, '刷写重启') ])
					]),
					E('div', { class: 'cbi-progressbar', id: 'fw-bar', title: '' }, [
						E('div', { id: 'fw-bar-fill', style: 'width:0%' })
					]),
					E('div', { class: 'fw-dlinfo' }, [
						E('span', { class: 'fw-pct', id: 'fw-pct' }, '0%'),
						E('span', { id: 'fw-dl' }, '等待开始')
					]),
					E('pre', { class: 'fw-console', id: 'fw-log' }, '')
				])
			]),

			/* ---------- 插件自身 ---------- */
			E('div', { class: 'cbi-section' }, [
				E('h3', {}, '插件版本'),
				E('div', { class: 'cbi-section-descr' },
					'插件可以单独更新，只需要几秒钟，不会动固件、不会重启。'),
				this.row('本地构建', E('code', { id: 'fw-self-local' }, this.shortSha(sf && sf.local) || 'dev')),
				this.row('远端最新', E('code', { id: 'fw-self-remote' }, this.shortSha(sf && sf.remote) || '未检查')),
				this.row('状态', E('span', { id: 'fw-self-state' }, '—')),
				E('div', { class: 'cbi-page-actions' }, [
					E('button', {
						class: 'btn', id: 'fw-self-ck',
						click: ui.createHandlerFn(this, 'handleSelfCheck')
					}, '检查插件更新'),
					E('button', {
						class: 'btn cbi-button cbi-button-apply', id: 'fw-self-up', disabled: true,
						click: ui.createHandlerFn(this, 'handleSelfUpdate')
					}, '更新插件')
				])
			]),

			/* ---------- 高级设置 ---------- */
			E('details', { class: 'cbi-section fw-details' }, [
				E('summary', {}, '高级设置'),
				E('div', { class: 'fw-body' }, [
					this.row('GitHub 仓库', E('input', {
						class: 'cbi-input-text fw-in', id: 'fw-repo',
						placeholder: 'owner/repo', value: s.repo || ''
					})),
					this.row('下载加速前缀', E('input', {
						class: 'cbi-input-text fw-in', id: 'fw-mirror',
						placeholder: 'https://ghfast.top/', value: s.mirror || ''
					})),
					E('div', { class: 'fw-hint', style: 'margin-top:.75rem' },
						'升级走标准 sysupgrade，默认保留配置；下载完成后会校验 sha256 与 gzip 魔数。'),
					E('div', { class: 'cbi-page-actions', style: 'padding-left:0;padding-right:0' }, [
						E('button', {
							class: 'btn cbi-button cbi-button-apply',
							click: ui.createHandlerFn(this, 'handleSaveConfig')
						}, '保存设置')
					])
				])
			])
		];

		this.node = E('div', { class: 'cbi-map fwup' }, nodes);

		this.refs = {
			badge:     this.node.querySelector('#fw-badge'),
			badgeTxt:  this.node.querySelector('#fw-badge-txt'),
			hint:      this.node.querySelector('#fw-hint'),
			curMain:   this.node.querySelector('#fw-cur-main'),
			curSub:    this.node.querySelector('#fw-cur-sub'),
			newMain:   this.node.querySelector('#fw-new-main'),
			newSub:    this.node.querySelector('#fw-new-sub'),
			meta:      this.node.querySelector('#fw-meta'),
			upBtn:     this.node.querySelector('#fw-up'),
			ckBtn:     this.node.querySelector('#fw-ck'),
			notes:     this.node.querySelector('#fw-notes'),
			notesBody: this.node.querySelector('#fw-notes-body'),
			progCard:  this.node.querySelector('#fw-progress'),
			steps:     this.node.querySelectorAll('#fw-steps .fw-step'),
			barFill:   this.node.querySelector('#fw-bar-fill'),
			pct:       this.node.querySelector('#fw-pct'),
			dl:        this.node.querySelector('#fw-dl'),
			log:       this.node.querySelector('#fw-log'),
			selfLocal: this.node.querySelector('#fw-self-local'),
			selfRemote:this.node.querySelector('#fw-self-remote'),
			selfState: this.node.querySelector('#fw-self-state'),
			selfUp:    this.node.querySelector('#fw-self-up'),
			selfCk:    this.node.querySelector('#fw-self-ck'),
			repo:      this.node.querySelector('#fw-repo'),
			mirror:    this.node.querySelector('#fw-mirror')
		};

		/* ------- 初始状态 ------- */
		this.setVersions(s.current, s.latest);
		this.setMeta({ size: s.size, published: s.published_at, checked: s.checked_at });

		if (!st)
			this.setBadge('err', '接口未响应', '');
		else if (!s.repo)
			this.setBadge('new', '未配置仓库', '请先在下方「高级设置」里填写 GitHub 仓库');
		else if (s.running) {
			this.setBadge('run', '升级中', '正在后台执行，页面会实时刷新进度');
			this.showProgress();
			this.startPolling();
		}
		else if (s.has_update) {
			this.setBadge('new', '有新版本', '建议升级到最新固件');
			this.showNotes(s.body);
			this.refs.upBtn.disabled = false;
		}
		else if (s.latest)
			this.setBadge('ok', '已是最新', '当前已是最新版本，无需升级');
		else
			this.setBadge('ok', '待检查', '点击「检查更新」查询是否有新版本');

		if (sf) {
			if (sf.has_update) {
				this.refs.selfState.textContent = '有新版可更新（' + this.shortSha(sf.remote) + '）';
				this.refs.selfUp.disabled = false;
			}
			else if (sf.remote)
				this.refs.selfState.textContent = '已是最新';
			else
				this.refs.selfState.textContent = '点「检查插件更新」查询';
		}
		else {
			this.refs.selfState.textContent = '接口未响应';
		}

		return this.node;
	},

	showProgress: function() {
		if (this.refs)
			this.refs.progCard.style.display = '';
	},

	/* ---------------- 交互 ---------------- */

	handleCheck: function() {
		var self = this;

		this.refs.ckBtn.disabled = true;
		this.setBadge('run', '检查中…', '');

		return callCheck().then(function(res) {
			self.refs.ckBtn.disabled = false;

			if (!res || res.ok === false) {
				self.setBadge('err', '检查失败', '');
				ui.addNotification(null,
					E('p', {}, '检查失败：' + ((res && res.error) || '未知错误')), 'error');
				return;
			}

			self.latestTag = res.tag;
			self.setVersions(self.status && self.status.current, res.tag);
			self.setMeta({
				size: res.size,
				published: res.published_at,
				checked: res.checked_at
			});

			if (res.has_update) {
				self.setBadge('new', '有新版本', '建议升级到最新固件');
				self.showNotes(res.body);
				self.refs.upBtn.disabled = false;
			}
			else {
				self.setBadge('ok', '已是最新', '当前已是最新版本，无需升级');
				self.refs.notes.style.display = 'none';
				self.refs.upBtn.disabled = true;
			}
		}, function(e) {
			self.refs.ckBtn.disabled = false;
			self.setBadge('err', '检查失败', '');
			ui.addNotification(null, E('p', {}, '检查失败：' + e), 'error');
		});
	},

	handleUpgrade: function() {
		var self = this,
		    tag = this.latestTag || '新版本';

		ui.showModal('确认升级固件', [
			E('p', {}, '即将刷写 ' + tag + '。过程中会断网并自动重启，请全程不要断电。'),
			E('p', {}, '默认保留现有配置（/etc/config、已装插件的设置）。'),
			E('div', { class: 'right' }, [
				E('button', { class: 'btn', click: ui.hideModal }, '取消'),
				' ',
				E('button', {
					class: 'btn cbi-button cbi-button-apply',
					click: function() {
						ui.hideModal();
						self.doStart();
					}
				}, '开始升级')
			])
		]);
	},

	doStart: function() {
		var self = this;

		return callStart().then(function(res) {
			if (!res || res.ok === false) {
				self.setBadge('err', '启动失败', '');
				ui.addNotification(null,
					E('p', {}, '启动失败：' + ((res && res.error) || '未知错误')), 'error');
				return;
			}

			self.refs.upBtn.disabled = true;
			self.refs.log.textContent = '';
			self.setBadge('run', '升级中', '正在后台执行，页面会实时刷新进度');
			self.showProgress();
			self.setSteps(0);
			self.startPolling();
		}, function(e) {
			self.setBadge('err', '启动失败', '');
			ui.addNotification(null, E('p', {}, '启动失败：' + e), 'error');
		});
	},

	startPolling: function() {
		var self = this;

		if (this._timer)
			return;

		this.pollOnce();
		this._timer = window.setInterval(function() { self.pollOnce(); }, 1500);
	},

	stopPolling: function() {
		if (this._timer) {
			window.clearInterval(this._timer);
			this._timer = null;
		}
	},

	pollOnce: function() {
		var self = this;

		/* 页面被切走就停掉轮询；首次渲染时节点还没挂到 body 上，
		   所以只在曾经挂载过之后才判定「已离开」 */
		if (document.body.contains(this.node))
			this._attached = true;
		else if (this._attached) {
			this.stopPolling();
			return;
		}

		return callLog().then(function(res) {
			if (!res)
				return;

			self.renderLog(res);

			if (!res.running) {
				self.stopPolling();

				if (self.lastLog.indexOf('开始刷写') >= 0) {
					self.setSteps(4);
					self.setBadge('run', '刷写中，即将重启', '设备会自动重启，约 2 分钟后恢复');
				}
				else if (self.lastLog.indexOf('错误') >= 0) {
					self.setBadge('err', '升级失败', '请查看下方日志');
				}
				else {
					self.setBadge('ok', '任务已结束', '');
				}
			}
		}, function() {
			self.stopPolling();
		});
	},

	renderLog: function(res) {
		var txt = res.log || '';

		if (this.lastLog !== txt) {
			this.lastLog = txt;
			this.refs.log.textContent = txt || '（暂无输出）';
			this.refs.log.scrollTop = this.refs.log.scrollHeight;

			var ph = this.phaseFromLog(txt);
			if (ph >= 0)
				this.setSteps(ph);
		}

		if (res.total > 0) {
			var pct = Math.min(100, Math.round((res.downloaded || 0) / res.total * 100));

			this.refs.pct.textContent = pct + '%';
			this.refs.dl.textContent = fmtSize(res.downloaded) + ' / ' + fmtSize(res.total);
			this.refs.barFill.style.width = pct + '%';
		}
		else if (this.lastLog.indexOf('开始刷写') >= 0) {
			this.refs.pct.textContent = '100%';
			this.refs.dl.textContent = '镜像已就绪，正在刷写';
			this.refs.barFill.style.width = '100%';
		}
	},

	handleSelfCheck: function() {
		var self = this;

		this.refs.selfCk.disabled = true;
		this.refs.selfState.textContent = '检查中…';

		return callSelfCheck().then(function(res) {
			self.refs.selfCk.disabled = false;

			if (!res || res.ok === false) {
				self.refs.selfState.textContent = '检查失败';
				ui.addNotification(null,
					E('p', {}, '检查插件更新失败：' + ((res && res.error) || '未知错误')), 'error');
				return;
			}

			self.refs.selfLocal.textContent = self.shortSha(res.local) || 'dev';
			self.refs.selfRemote.textContent = self.shortSha(res.remote) || '—';

			if (res.has_update) {
				self.refs.selfState.textContent = '有新版可更新';
				self.refs.selfUp.disabled = false;
			}
			else {
				self.refs.selfState.textContent = '已是最新';
				self.refs.selfUp.disabled = true;
			}
		}, function(e) {
			self.refs.selfCk.disabled = false;
			self.refs.selfState.textContent = '检查失败';
			ui.addNotification(null,
				E('p', {}, '检查插件更新失败：' + e), 'error');
		});
	},

	handleSelfUpdate: function() {
		var self = this;

		ui.showModal('更新插件', [
			E('p', {}, '将从 GitHub 下载最新构建的插件包并覆盖安装，只需几秒。'),
			E('p', {}, '不动固件、不重启、不改配置。'),
			E('div', { class: 'right' }, [
				E('button', { class: 'btn', click: ui.hideModal }, '取消'),
				' ',
				E('button', {
					class: 'btn cbi-button cbi-button-apply',
					click: function() {
						ui.hideModal();
						self.doSelfUpdate();
					}
				}, '开始更新')
			])
		]);
	},

	doSelfUpdate: function() {
		var self = this,
		    prev = (this.refs.selfLocal.textContent || '').trim();

		this.refs.selfUp.disabled = true;
		this.refs.selfState.textContent = '正在更新…';

		return callSelfUpdate().then(function(res) {
			if (!res || res.ok === false) {
				self.refs.selfState.textContent = '更新失败';
				self.refs.selfUp.disabled = false;
				ui.addNotification(null,
					E('p', {}, '更新失败：' + ((res && res.error) || '未知错误')), 'error');
				return;
			}

			self.refs.selfState.textContent = '已更新到 ' + (self.shortSha(res.after) || 'dev') + '，刷新页面生效';
			ui.addNotification(null,
				E('p', {}, '插件已更新，页面将在 2 秒后刷新'), 'info');

			window.setTimeout(function() { location.reload(); }, 2000);
		}, function(e) {
			/* ubus 调用有超时；万一超时了但包其实已经装上，补查一次本地指纹确认 */
			return callSelfStatus().then(function(r) {
				if (r && r.local && self.shortSha(r.local) !== self.shortSha(prev)) {
					self.refs.selfState.textContent = '已更新到 ' + self.shortSha(r.local) + '，刷新页面生效';
					ui.addNotification(null,
						E('p', {}, '插件已更新，页面将在 2 秒后刷新'), 'info');
					window.setTimeout(function() { location.reload(); }, 2000);
					return;
				}

				self.refs.selfState.textContent = '更新失败';
				self.refs.selfUp.disabled = false;
				ui.addNotification(null, E('p', {}, '更新失败：' + e), 'error');
			});
		});
	},

	handleSaveConfig: function() {
		var self = this,
		    repo = (this.refs.repo.value || '').trim(),
		    mirror = (this.refs.mirror.value || '').trim();

		return callSave(repo, mirror).then(function(res) {
			if (!res || res.ok === false) {
				ui.addNotification(null,
					E('p', {}, '保存失败：' + ((res && res.error) || '未知错误')), 'error');
				return;
			}

			ui.addNotification(null, E('p', {}, '设置已保存'), 'info');

			self.refs.notes.style.display = 'none';
			self.refs.upBtn.disabled = true;
			self.setMeta({});
			self.setBadge('ok', '设置已更新', '请重新点击「检查更新」');
		}, function(e) {
			ui.addNotification(null, E('p', {}, '保存失败：' + e), 'error');
		});
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
