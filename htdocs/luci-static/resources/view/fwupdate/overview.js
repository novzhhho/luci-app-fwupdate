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
	if (n < 1073741824)
		return (Math.round(n / 1048576 * 10) / 10) + ' MB';

	return (Math.round(n / 1073741824 * 10) / 10) + ' GB';
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

/* 秒数 → 人话。刷完到开机通常几十秒到几分钟，所以只做到分钟。 */
function fmtDur(s) {
	s = Math.max(0, +s || 0);

	if (s < 60)
		return s + ' 秒';
	if (s < 3600)
		return Math.floor(s / 60) + ' 分 ' + (s % 60) + ' 秒';

	return Math.floor(s / 3600) + ' 时 ' + Math.floor(s % 3600 / 60) + ' 分';
}

/* 构建 tag 形如 r25.12.2-lucky2.27.2-bandix0.12.11-bandixweb0.12.12-fw924dec8，
   每段是「名字 + 版本」。原始串直接摊给用户没人看得懂（luci0.12.12 到底是哪个插件的
   哪个部分？），所以这里把已知前缀翻译成人话再显示。
   luci / ui 是旧版 tag 的写法，保留映射以便老 Release 也能正常显示。 */
var SEG_LABEL = {
	lucky:     'lucky',
	bandix:    'bandix',
	luci:      'bandix 面板',
	bandixweb: 'bandix 面板',
	ui:        '升级插件',
	fw:        '升级插件'
};

/* 与 /usr/bin/fwupdate 输出的 "#step N state 说明" 一一对应。
   顺序就是后端执行顺序，改后端时要同步改这里。 */
var CHECKS = [
	'检查更新', '下载镜像', '校验镜像', '兼容性预检',
	'生成配置备份', '容量预检', '刷写'
];

/* 七步映射到步骤条的五段：预检三小步合并成一段 */
function phaseOf(n) {
	if (n >= 7)
		return 4;
	if (n >= 4)
		return 3;

	return n - 1;
}

function parseTag(tag) {
	tag = (tag || '').replace(/^r(?=[0-9])/, '');

	if (!tag)
		return { main: '', items: [] };

	var p = tag.split('-'),
	    items = [],
	    i, m;

	for (i = 1; i < p.length; i++) {
		if (!p[i])
			continue;

		m = /^([a-z]+)([0-9].*)$/.exec(p[i]);

		if (m)
			items.push({ label: SEG_LABEL[m[1]] || m[1], ver: m[2] });
		else
			items.push({ label: '', ver: p[i] });
	}

	return { main: p[0] || '', items: items };
}

/* 25.12.1-r37978-cd0a06bfd3fd → { main: '25.12.1', sub: 'r37978 · cd0a06bfd3fd' } */
function parseCurrent(v) {
	var m = /^([0-9][^-]*)(?:-(.*))?$/.exec(v || '');

	if (!m)
		return { main: v || '', sub: '' };

	return {
		main: m[1],
		sub:  (m[2] || '').split('-').filter(Boolean).join(' · ')
	};
}

/* 样式说明：
   1. 整页只有一张卡片：所有内容按「分隔线」分区，而不是每块内容各占一张
      .cbi-section —— 内容本来就不多，五张空卡片既费纵向空间又显得空洞。
   2. 字号从主题正文 14px 抬到 16px，版本号 28px，标题 20px，标签 15px。
   3. 卡片/按钮/进度条/输入框仍用主题原生类，颜色取主题变量，深浅色自动跟随。 */
var CSS = `
.fwup{font-size:1rem;line-height:1.6}
.fwup .cbi-section{padding:0;overflow:hidden}
.fwup .fw-sec{border-top:1px solid var(--border-color,#dee2e6)}

/* ---------- 顶部：标题 + 状态 + 操作 ---------- */
.fwup .fw-head{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;
  padding:1rem 1.25rem;border-bottom:1px solid var(--border-color,#dee2e6)}
.fwup .fw-head h3{margin:0;padding:0;display:block;width:auto;background:none;
  font-size:1.25rem;font-weight:700;line-height:1.4;color:inherit}
.fwup .fw-head .fw-btns{margin-left:auto;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}

/* ---------- 状态徽章 ---------- */
.fwup .fw-badge{display:inline-flex;align-items:center;gap:.4rem;padding:.15rem .7rem;
  border-radius:1rem;font-size:.9375rem;font-weight:600;line-height:1.7;
  border:1px solid transparent;white-space:nowrap}
.fwup .fw-badge .fw-dot{flex:0 0 auto;width:.45rem;height:.45rem;border-radius:50%;background:currentColor}
.fwup .fw-badge.ok{color:var(--success,#2dce89);background:rgba(45,206,137,.12);border-color:rgba(45,206,137,.3)}
.fwup .fw-badge.new{color:var(--orange,#fb6340);background:rgba(251,99,64,.12);border-color:rgba(251,99,64,.3)}
.fwup .fw-badge.run{color:var(--primary,#5e72e4);background:rgba(94,114,228,.12);border-color:rgba(94,114,228,.3)}
.fwup .fw-badge.err{color:var(--danger,#f5365c);background:rgba(245,54,92,.12);border-color:rgba(245,54,92,.3)}

/* ---------- 版本对比 ---------- */
.fwup .fw-vers{display:flex;align-items:flex-start;gap:1rem;padding:1rem 1.25rem .875rem}
.fwup .fw-v{flex:1 1 0;min-width:0}
.fwup .fw-k{display:block;margin-bottom:.1rem;font-size:.9375rem;line-height:1.5;
  color:var(--gray,#8898aa)}
.fwup .fw-num{font-size:1.75rem;font-weight:700;line-height:1.25;letter-spacing:-.015em;
  word-break:break-word}
.fwup .fw-sub{margin-top:.2rem;font-size:.9375rem;line-height:1.5;color:var(--gray,#8898aa);
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-word}
.fwup .fw-arrow{align-self:center;padding-top:1.15rem;font-size:1.25rem;
  color:var(--gray,#8898aa);opacity:.65}

/* ---------- 组件标签 ---------- */
.fwup .fw-comps{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;
  padding:0 1.25rem .65rem;font-size:.9375rem}
.fwup .fw-comps .fw-k2{color:var(--gray,#8898aa)}
.fwup .fw-chips{display:flex;flex-wrap:wrap;gap:.35rem .4rem}
.fwup .fw-chip{display:inline-flex;align-items:baseline;gap:.3rem;padding:.05rem .5rem;
  border-radius:.25rem;font-size:.9375rem;line-height:1.7;white-space:nowrap;
  background:rgba(136,152,170,.15)}
.fwup .fw-chip b{font-weight:600}
.fwup .fw-chip i{font-style:normal;color:var(--gray,#8898aa)}

/* ---------- 元信息 ---------- */
.fwup .fw-meta{display:flex;align-items:center;flex-wrap:wrap;gap:.3rem .55rem;
  padding:0 1.25rem 1rem;font-size:.9375rem;color:var(--gray,#8898aa)}
.fwup .fw-meta .fw-sep{opacity:.5}

/* ---------- 进度 ---------- */
.fwup .fw-prog{padding:1rem 1.25rem}
.fwup .fw-steps{display:flex;margin:0 0 1rem;padding:0;list-style:none}
.fwup .fw-step{position:relative;flex:1;text-align:center;font-size:.9375rem;
  color:var(--gray,#8898aa);line-height:1.5}
.fwup .fw-step i{display:block;width:1.9rem;height:1.9rem;margin:0 auto .4rem;
  border:1px solid var(--border-color,#dee2e6);border-radius:50%;
  font-style:normal;font-size:.9375rem;font-weight:700;line-height:1.75rem;text-align:center}
.fwup .fw-step:not(:last-child):after{content:"";position:absolute;top:.9rem;
  left:calc(50% + 1.2rem);right:calc(-50% + 1.2rem);height:2px;
  background:var(--border-color,#dee2e6)}
.fwup .fw-step.on{color:var(--primary,#5e72e4);font-weight:600}
.fwup .fw-step.on i{border-color:var(--primary,#5e72e4);background:var(--primary,#5e72e4);color:#fff}
.fwup .fw-step.done{color:var(--success,#2dce89)}
.fwup .fw-step.done i{border-color:var(--success,#2dce89);background:var(--success,#2dce89);color:#fff}
.fwup .fw-step.done:not(:last-child):after{background:var(--success,#2dce89)}
.fwup .fw-dlinfo{display:flex;align-items:baseline;gap:.6rem;margin:.5rem 0 .75rem;
  font-size:.9375rem;color:var(--gray,#8898aa)}
.fwup .fw-dlinfo .fw-pct{font-size:1.25rem;font-weight:700;color:inherit}
.fwup .fw-console{margin:0;padding:.75rem .875rem;max-height:13rem;overflow:auto;
  white-space:pre-wrap;word-break:break-word;font-size:.875rem;line-height:1.65;
  border:1px solid var(--border-color,#dee2e6);border-radius:.25rem;
  background:rgba(136,152,170,.08);color:inherit;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}

/* ---------- 折叠分区（更新说明 / 高级设置） ---------- */
.fwup .fw-sec>summary{display:flex;align-items:center;gap:.5rem;cursor:pointer;
  padding:.875rem 1.25rem;font-size:1.0625rem;font-weight:600;line-height:1.5;list-style:none}
.fwup .fw-sec>summary::-webkit-details-marker{display:none}
.fwup .fw-sec>summary:before{content:"\\25B8";flex:0 0 auto;font-size:.9rem;
  color:var(--gray,#8898aa);transition:transform .2s ease}
.fwup .fw-sec[open]>summary:before{transform:rotate(90deg)}
.fwup .fw-sec>summary .fw-sumb{margin-left:auto;font-size:.9375rem;font-weight:400;
  color:var(--gray,#8898aa)}
.fwup .fw-secbody{padding:0 1.25rem 1rem}

/* ---------- 插件行 ---------- */
.fwup .fw-plug{display:flex;align-items:center;gap:.5rem 1rem;flex-wrap:wrap;
  padding:.875rem 1.25rem;border-top:1px solid var(--border-color,#dee2e6)}
.fwup .fw-plug-k{font-size:.9375rem;color:var(--gray,#8898aa)}
.fwup .fw-plug-v{display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;
  font-size:.9375rem;line-height:1.6}
.fwup .fw-plug .fw-btns{margin-left:auto;display:flex;gap:.5rem;flex-wrap:wrap}

/* ---------- 设置行 ---------- */
.fwup .fw-row{display:flex;align-items:center;gap:1rem;padding:.3rem 0}
.fwup .fw-row-k{flex:0 0 9.5rem;font-size:.9375rem;color:var(--gray,#8898aa)}
.fwup .fw-row-v{flex:1 1 auto;min-width:0}
.fwup .fw-hint{font-size:.9375rem;line-height:1.6;color:var(--gray,#8898aa)}
.fwup .fwup-note{margin-top:.5rem}

/* ---------- 原生件微调 ---------- */
.fwup .btn{font-size:.9375rem}
.fwup .btn:not(.cbi-button-apply){color:inherit}
.fwup .btn:disabled,.fwup .cbi-button:disabled{cursor:not-allowed;pointer-events:none;opacity:.5}
.fwup .cbi-input-text{font-size:1rem;height:2.5rem}

/* ---------- 上次升级结果 ---------- */
.fwup .fw-res{display:flex;align-items:flex-start;gap:.6rem;padding:.8rem 1.25rem;
  font-size:.9375rem;line-height:1.6;border-bottom:1px solid var(--border-color,#dee2e6)}
.fwup .fw-res-i{flex:0 0 auto;width:1.15rem;height:1.15rem;margin-top:.12rem;border-radius:50%;
  font-size:.75rem;font-weight:700;line-height:1.15rem;text-align:center;color:#fff}
.fwup .fw-res.ok .fw-res-i{background:var(--success,#2dce89)}
.fwup .fw-res.warn .fw-res-i{background:var(--orange,#fb6340)}
.fwup .fw-res.err .fw-res-i{background:var(--danger,#f5365c)}
.fwup .fw-res-b{flex:1 1 auto;min-width:0}
.fwup .fw-res-x{flex:0 0 auto;padding:0 .2rem;font-size:1.1rem;line-height:1;
  background:none;border:0;color:inherit;opacity:.5;cursor:pointer}
.fwup .fw-res-x:hover{opacity:1}

/* ---------- 预检清单 ---------- */
.fwup .fw-checks{margin:0 0 1rem;padding:0;list-style:none;font-size:.9375rem}
.fwup .fw-checks li{display:flex;align-items:baseline;gap:.55rem;padding:.18rem 0;
  color:var(--gray,#8898aa);line-height:1.55}
.fwup .fw-ck-i{flex:0 0 auto;width:1rem;text-align:center;font-weight:700}
.fwup .fw-ck-n{flex:0 0 6.8rem}
.fwup .fw-ck-d{flex:1 1 auto;min-width:0;word-break:break-word}
.fwup .fw-checks li.run{color:var(--primary,#5e72e4);font-weight:600}
.fwup .fw-checks li.ok{color:var(--success,#2dce89)}
.fwup .fw-checks li.fail{color:var(--danger,#f5365c);font-weight:600}

/* ---------- 更新说明正文 ---------- */
.fwup .fw-notes{max-height:15rem;overflow:auto;padding:.875rem 1rem;
  border:1px solid var(--border-color,#dee2e6);border-radius:.25rem;
  background:rgba(136,152,170,.07);color:inherit;font-size:.9375rem;line-height:1.7}
.fwup .fw-md-h{margin:1rem 0 .4rem;font-size:1rem;font-weight:700;line-height:1.5}
.fwup .fw-md-h:first-child{margin-top:0}
.fwup .fw-md-p{margin:.2rem 0 .6rem}
.fwup .fw-md-p:last-child{margin-bottom:0}
.fwup .fw-md-ul{margin:.2rem 0 .6rem;padding-left:1.25rem;list-style:disc}
.fwup .fw-md-ul li{margin:.15rem 0}
.fwup .fw-md-table{width:100%;margin:.4rem 0 .8rem;border-collapse:collapse;font-size:.9375rem}
.fwup .fw-md-table th:first-child,
.fwup .fw-md-table td:first-child{width:99%}
.fwup .fw-md-table th,.fwup .fw-md-table td{padding:.35rem .6rem;text-align:left;
  border-bottom:1px solid var(--border-color,#dee2e6)}
.fwup .fw-md-table th{font-weight:600;color:var(--gray,#8898aa);font-size:.875rem}
.fwup .fw-md-table tr:last-child td{border-bottom:0}
.fwup .fw-md-empty{margin:0;color:var(--gray,#8898aa)}
.fwup code{color:inherit;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:.9375rem;padding:.05rem .3rem;border-radius:.25rem;
  background:rgba(136,152,170,.16)}

@media screen and (max-width:700px){
  .fwup .fw-vers{flex-wrap:wrap;gap:.5rem}
  .fwup .fw-v{flex:1 1 100%}
  .fwup .fw-arrow{display:none}
  .fwup .fw-step{font-size:.875rem}
  .fwup .fw-head .fw-btns,.fwup .fw-plug .fw-btns{margin-left:0;width:100%}
  .fwup .fw-row{flex-wrap:wrap;gap:.15rem}
  .fwup .fw-row-k{flex:1 1 100%}
  /* 手机上嵌套滚动很难用，更新说明直接展开 */
  .fwup .fw-notes{max-height:none}
}
`;

return view.extend({
	load: function() {
		var fail = function() { return null; };

		return Promise.all([
			callStatus().then(function(r) { return r; }, fail),
			callSelfStatus().then(function(r) { return r; }, fail),
			callLog().then(function(r) { return r; }, fail)
		]).then(function(r) {
			return { st: r[0], self: r[1], lg: r[2] };
		});
	},

	/* ---------------- 小工具 ---------------- */

	shortSha: function(s) {
		s = (s || '').replace(/[^0-9a-f]/g, '');
		return s ? s.substring(0, 7) : '';
	},

	field: function(k, v) {
		return E('div', { class: 'fw-row' }, [
			E('label', { class: 'fw-row-k' }, k),
			E('div', { class: 'fw-row-v' }, v)
		]);
	},

	setBadge: function(kind, text) {
		if (!this.refs)
			return;

		this.refs.badge.className = 'fw-badge ' + kind;
		this.refs.badgeTxt.textContent = text;
	},

	chips: function(items) {
		var box = E('div', { class: 'fw-chips' });

		items.forEach(function(it) {
			box.appendChild(E('span', { class: 'fw-chip' },
				it.label
					? [ E('i', {}, it.label), E('b', {}, it.ver) ]
					: [ E('b', {}, it.ver) ]));
		});

		return box;
	},

	setVersions: function(current, latest) {
		if (!this.refs)
			return;

		var a = parseCurrent(current),
		    b = parseTag(latest);

		this.refs.curMain.textContent = a.main || '未知';
		this.refs.curSub.textContent = a.sub || ' ';
		this.refs.newMain.textContent = b.main || '—';

		while (this.refs.newChips.firstChild)
			this.refs.newChips.removeChild(this.refs.newChips.firstChild);

		if (b.items.length) {
			var c = this.chips(b.items);

			while (c.firstChild)
				this.refs.newChips.appendChild(c.firstChild);

			this.refs.comps.style.display = '';
		}
		else {
			this.refs.comps.style.display = 'none';
		}

		if (this.refs.rawtag)
			this.refs.rawtag.textContent = latest || '—';
	},

	setMeta: function(o) {
		var box = this.refs.meta,
		    items = [];

		o = o || {};

		if (o.size)
			items.push('大小 ' + fmtSize(o.size));
		if (o.published)
			items.push('发布于 ' + String(o.published).replace('T', ' ').substring(0, 16));

		items.push('上次检查 ' + (o.checked ? fmtTime(o.checked) : '—') +
			(o.stale ? '（已过期，请重新检查）' : ''));

		if (o.store)
			items.push('持久分区可用 ' + fmtSize(o.storeFree));

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
		this.refs.notes.open = true;
		this.refs.notesSum.textContent = '';
	},

	hideNotes: function() {
		if (!this.refs)
			return;

		this.refs.notes.style.display = 'none';
		this.refs.notes.open = false;
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

	/* 上次升级的自证结论。数据来自开机脚本写的 result.json，
	   由后端 status 的 last_* 字段带上来。没有就整行不显示。 */
	renderLast: function(s) {
		var st = s && s.last_status;

		if (!st || !this.refs || !this.refs.fwRes)
			return;

		var kind, icon, body = [];

		if (st === 'ok') {
			kind = 'ok'; icon = '✓';
			body.push(E('b', {}, '上次升级成功'), '：' + (s.last_from || '?') + ' → ' + (s.last_to || '?'));

			if (s.last_total)
				body.push(' · 配置 ' + s.last_ok + '/' + s.last_total + ' 项全部到位');
			if (s.last_changed)
				body.push('（其中 ' + s.last_changed + ' 项被服务启动时改写，属正常）');
			if (s.last_store)
				body.push(' · 完整资源已从持久分区补回');
		}
		else if (st === 'partial') {
			kind = 'warn'; icon = '!';
			body.push(E('b', {}, '上次升级已完成，但有 ' + s.last_missing + ' 项配置没能恢复'),
				'：' + (s.last_from || '?') + ' → ' + (s.last_to || '?'));
		}
		else if (st === 'notapplied') {
			kind = 'err'; icon = '×';
			body.push(E('b', {}, '上次升级没有生效'), '：版本仍是 ' + (s.last_from || '?') +
				'，建议重新执行一次升级');
		}
		else {
			kind = 'warn'; icon = '?';
			body.push(E('b', {}, '上次升级后的版本与预期不一致'),
				'：期望 ' + (s.last_to || '?') + '，当前 ' + (s.current || '?'));
		}

		if (s.last_elapsed)
			body.push(' · 从写入到开机用时 ' + fmtDur(s.last_elapsed));

		this.refs.fwRes.className = 'fw-res ' + kind;
		this.refs.fwResI.textContent = icon;
		this.refs.fwResT.textContent = '';

		body.forEach(function(x) {
			this.refs.fwResT.appendChild(typeof x === 'string' ? document.createTextNode(x) : x);
		}, this);

		this.refs.fwRes.style.display = '';
	},

	/* ---------------- 预检清单 ---------------- */

	paintChecks: function() {
		if (!this.refs || !this.refs.checks)
			return;

		for (var i = 0; i < this.refs.checks.length; i++) {
			var n = i + 1,
			    el = this.refs.checks[i],
			    st = this._ckState[n] || '',
			    msg = this._ckMsg[n] || '等待';

			el.className = st;
			el.children[0].textContent =
				st === 'ok' ? '✓' : (st === 'fail' ? '✗' : (st === 'running' ? '…' : '·'));
			el.children[2].textContent = msg;
		}
	},

	/* 从日志里解析 "#step N state 说明"。
	   这是后端与界面之间唯一的进度契约，比在文本里搜关键字可靠得多。 */
	applyMarkers: function(txt) {
		var re = /#step (\d+) (running|ok|fail)(?: ([^\n]*))?/g,
		    m, changed = false, last = 0, lastState = '';

		while ((m = re.exec(txt)) !== null) {
			var n = +m[1],
			    st = m[2],
			    msg = (m[3] || '').trim();

			if (n < 1 || n > CHECKS.length)
				continue;

			/* 一步可能有多条 ok（比如校验步骤先报 sha256 再报 gzip）。
			   保留第一条更有信息量的，失败/进行中的则始终覆盖。 */
			if (msg && (st !== 'ok' || !this._ckMsg[n] || this._ckState[n] !== 'ok'))
				this._ckMsg[n] = msg;

			if (this._ckState[n] !== st) {
				this._ckState[n] = st;
				changed = true;
			}

			if (n >= last) {
				last = n;
				lastState = st;
			}
		}

		if (changed)
			this.paintChecks();

		if (last) {
			this.setSteps(last === CHECKS.length && lastState === 'ok' ? 5 : phaseOf(last));

			if (last === CHECKS.length && lastState === 'running')
				this._flashing = true;
		}
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

	/* ---------------- 渲染 ---------------- */

	render: function(data) {
		var st = (data && data.st) || null,
		    sf = (data && data.self) || null,
		    lg = (data && data.lg) || null,
		    s = st || {},
		    self = this;

		this.status = s;
		this.latestTag = s.latest || '';
		this.lastLog = '';
		this._phase = -1;
		this._ckState = {};
		this._ckMsg = {};
		this._flashing = false;

		/* 整页只有一张卡片，内容用分隔线分区 */
		var card = E('div', { class: 'cbi-section' }, [

			/* 顶部 */
			E('div', { class: 'fw-head' }, [
				E('h3', {}, '固件升级'),
				E('span', { class: 'fw-badge ok', id: 'fw-badge' }, [
					E('span', { class: 'fw-dot' }),
					E('span', { id: 'fw-badge-txt' }, '待检查')
				]),
				E('div', { class: 'fw-btns' }, [
					E('button', {
						class: 'btn', id: 'fw-ck',
						click: ui.createHandlerFn(this, 'handleCheck')
					}, '检查更新'),
					E('button', {
						class: 'btn cbi-button cbi-button-apply', id: 'fw-up',
						disabled: true,
						click: ui.createHandlerFn(this, 'handleUpgrade')
					}, '立即升级')
				])
			]),

			/* 上次升级结果（开机自证的结论，没有就整行隐藏） */
			E('div', { class: 'fw-res', id: 'fw-res', style: 'display:none' }, [
				E('span', { class: 'fw-res-i', id: 'fw-res-i' }, '✓'),
				E('div', { class: 'fw-res-b', id: 'fw-res-t' }),
				E('button', {
					class: 'fw-res-x', id: 'fw-res-x', title: '关闭',
					click: function() { this.parentNode.style.display = 'none'; }
				}, '×')
			]),

			/* 版本 */
			E('div', { class: 'fw-vers' }, [
				E('div', { class: 'fw-v' }, [
					E('span', { class: 'fw-k' }, '当前固件'),
					E('div', { class: 'fw-num', id: 'fw-cur-main' }, '—'),
					E('div', { class: 'fw-sub', id: 'fw-cur-sub' }, ' ')
				]),
				E('div', { class: 'fw-arrow' }, '→'),
				E('div', { class: 'fw-v' }, [
					E('span', { class: 'fw-k' }, '最新版本'),
					E('div', { class: 'fw-num', id: 'fw-new-main' }, '—')
				])
			]),

			/* 镜像里编了哪些插件 —— 整行铺开，别挤在右半栏里折成两行 */
			E('div', { class: 'fw-comps', id: 'fw-comps' }, [
				E('span', { class: 'fw-k2' }, '包含组件'),
				E('div', { class: 'fw-chips', id: 'fw-new-chips' })
			]),

			/* 元信息 */
			E('div', { class: 'fw-meta', id: 'fw-meta' }),

			/* 升级进度（升级时显示） */
			E('div', { class: 'fw-prog fw-sec', id: 'fw-progress', style: 'display:none' }, [
				E('ol', { class: 'fw-steps', id: 'fw-steps' }, [
					E('li', { class: 'fw-step', 'data-i': 0 }, [ E('i', {}, '1'), E('span', {}, '检查更新') ]),
					E('li', { class: 'fw-step', 'data-i': 1 }, [ E('i', {}, '2'), E('span', {}, '下载镜像') ]),
					E('li', { class: 'fw-step', 'data-i': 2 }, [ E('i', {}, '3'), E('span', {}, '校验镜像') ]),
					E('li', { class: 'fw-step', 'data-i': 3 }, [ E('i', {}, '4'), E('span', {}, '预检备份') ]),
					E('li', { class: 'fw-step', 'data-i': 4 }, [ E('i', {}, '5'), E('span', {}, '刷写重启') ])
				]),
				E('ul', { class: 'fw-checks', id: 'fw-checks' }, CHECKS.map(function(name, i) {
					return E('li', { 'data-n': i + 1 }, [
						E('span', { class: 'fw-ck-i' }, '·'),
						E('span', { class: 'fw-ck-n' }, name),
						E('span', { class: 'fw-ck-d' }, '等待')
					]);
				})),
				E('div', { class: 'cbi-progressbar', id: 'fw-bar', title: '' }, [
					E('div', { id: 'fw-bar-fill', style: 'width:0%' })
				]),
				E('div', { class: 'fw-dlinfo', id: 'fw-dlinfo' }, [
					E('span', { class: 'fw-pct', id: 'fw-pct' }, '0%'),
					E('span', { id: 'fw-dl' }, '等待开始')
				]),
				E('pre', { class: 'fw-console', id: 'fw-log' }, '')
			]),

			/* 更新说明 */
			E('details', { class: 'fw-sec', id: 'fw-notes', style: 'display:none' }, [
				E('summary', {}, [ '更新说明', E('span', { class: 'fw-sumb', id: 'fw-notes-sum' }, '') ]),
				E('div', { class: 'fw-secbody' }, [
					E('div', { class: 'fw-notes', id: 'fw-notes-body' })
				])
			]),

			/* 插件自身：一行搞定 */
			E('div', { class: 'fw-plug' }, [
				E('span', { class: 'fw-plug-k' }, '升级插件'),
				E('div', { class: 'fw-plug-v' }, [
					E('code', { id: 'fw-self-local' }, this.shortSha(sf && sf.local) || 'dev'),
					E('span', { class: 'fw-plug-k' }, '→'),
					E('code', { id: 'fw-self-remote' }, this.shortSha(sf && sf.remote) || '未检查'),
					E('span', { class: 'fw-plug-k', id: 'fw-self-state' }, '—')
				]),
				E('div', { class: 'fw-btns' }, [
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

			/* 高级设置 */
			E('details', { class: 'fw-sec' }, [
				E('summary', {}, [ '高级设置', E('span', { class: 'fw-sumb' }, '仓库 / 加速 / 构建标识') ]),
				E('div', { class: 'fw-secbody' }, [
					this.field('GitHub 仓库', E('input', {
						class: 'cbi-input-text', id: 'fw-repo',
						placeholder: 'owner/repo', value: s.repo || ''
					})),
					this.field('下载加速前缀', E('input', {
						class: 'cbi-input-text', id: 'fw-mirror',
						placeholder: 'https://ghfast.top/', value: s.mirror || ''
					})),
					this.field('构建标识', E('code', { id: 'fw-rawtag' }, '—')),
					E('div', { class: 'fw-hint', style: 'margin:.5rem 0 .75rem' },
						'升级走标准 sysupgrade，配置由本插件自行打包后用 -f 指定，' +
						'不再使用系统默认备份（那会把 /etc/openclash 的 55 MB 资源一起打进去，' +
						'超过 p1 分区 9 MB 的可用空间）。'),
					E('div', { class: 'cbi-page-actions', style: 'padding:0;justify-content:flex-start' }, [
						E('button', {
							class: 'btn cbi-button cbi-button-apply',
							click: ui.createHandlerFn(this, 'handleSaveConfig')
						}, '保存设置')
					])
				])
			])
		]);

		this.node = E('div', { class: 'cbi-map fwup' }, [
			E('style', {}, CSS),
			card
		]);

		this.refs = {
			badge:     this.node.querySelector('#fw-badge'),
			badgeTxt:  this.node.querySelector('#fw-badge-txt'),
			fwRes:     this.node.querySelector('#fw-res'),
			fwResI:    this.node.querySelector('#fw-res-i'),
			fwResT:    this.node.querySelector('#fw-res-t'),
			checks:    this.node.querySelectorAll('#fw-checks li'),
			curMain:   this.node.querySelector('#fw-cur-main'),
			curSub:    this.node.querySelector('#fw-cur-sub'),
			newMain:   this.node.querySelector('#fw-new-main'),
			newChips:  this.node.querySelector('#fw-new-chips'),
			comps:     this.node.querySelector('#fw-comps'),
			meta:      this.node.querySelector('#fw-meta'),
			upBtn:     this.node.querySelector('#fw-up'),
			ckBtn:     this.node.querySelector('#fw-ck'),
			notes:     this.node.querySelector('#fw-notes'),
			notesSum:  this.node.querySelector('#fw-notes-sum'),
			notesBody: this.node.querySelector('#fw-notes-body'),
			progCard:  this.node.querySelector('#fw-progress'),
			bar:       this.node.querySelector('#fw-bar'),
			dlInfo:    this.node.querySelector('#fw-dlinfo'),
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
			mirror:    this.node.querySelector('#fw-mirror'),
			rawtag:    this.node.querySelector('#fw-rawtag')
		};

		/* ------- 初始状态 ------- */
		/* 检查结果有保鲜期。过期了就不能再拿它当「有新版本」的依据 ——
		   真正的升级动作会重新问 GitHub，界面上的旧 tag 和实际要刷的东西
		   对不上，是最容易让人点错的一种状态。 */
		var fwStale = !s.checked_at ||
			(Date.now() - s.checked_at * 1000) > 24 * 3600 * 1000;
		var selfStale = !sf || !sf.checked_at ||
			(Date.now() - sf.checked_at * 1000) > 30 * 60 * 1000;

		this.setVersions(s.current, s.latest);
		this.setMeta({
			size: s.size, published: s.published_at, checked: s.checked_at,
			stale: fwStale && !!s.checked_at,
			store: s.store, storeFree: s.store_free
		});
		this.renderLast(s);

		if (!st)
			this.setBadge('err', '接口未响应');
		else if (!s.repo)
			this.setBadge('new', '未配置仓库');
		else if (s.running) {
			this.setBadge('run', '升级中');
			this.refs.ckBtn.disabled = true;
			this.refs.upBtn.disabled = true;
			this.showProgress();
			this.startPolling();
		}
		else if (s.has_update && !fwStale) {
			this.setBadge('new', '有新版本');
			this.showNotes(s.body);
			this.refs.upBtn.disabled = false;
		}
		else if (fwStale) {
			this.setBadge('ok', '待检查');
			this.refs.upBtn.disabled = true;
		}
		else if (s.latest)
			this.setBadge('ok', '已是最新');
		else
			this.setBadge('ok', '待检查');

		if (!sf) {
			this.refs.selfState.textContent = '接口未响应';
		}
		else if (selfStale) {
			this.refs.selfState.textContent = '待检查';
			this.refs.selfUp.disabled = true;
		}
		else if (sf.has_update) {
			this.refs.selfState.textContent = '有新版可更新';
			this.refs.selfUp.disabled = false;
		}
		else if (sf.remote) {
			this.refs.selfState.textContent = '已是最新';
			this.refs.selfUp.disabled = true;
		}
		else {
			this.refs.selfState.textContent = '未检查';
			this.refs.selfUp.disabled = true;
		}

		/* 上一次尝试如果停在中途，日志还在 /tmp 里。刷新页面后必须能看见它
		   停在哪一步、为什么停 —— 否则用户只知道「点了没反应」。 */
		if (!s.running && lg && lg.log && /#step /.test(lg.log)) {
			this.refs.log.textContent = lg.log;
			this.lastLog = lg.log;
			this.applyMarkers(lg.log);

			var bad = this.failedStep();
			if (bad) {
				this.showProgress();
				/* 历史日志里没有本次的下载进度，显示「0%」只会误导 */
				this.refs.bar.style.display = 'none';
				this.refs.dlInfo.style.display = 'none';
				this.setBadge('err', '上次升级未通过：第 ' + bad + ' 步');
				this.refs.upBtn.disabled = true;
			}
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
		this.setBadge('run', '检查中…');

		return callCheck().then(function(res) {
			self.refs.ckBtn.disabled = false;

			if (!res || res.ok === false) {
				self.setBadge('err', '检查失败');
				ui.addNotification(null,
					E('p', {}, '检查失败：' + ((res && res.error) || '未知错误')), 'error');
				return;
			}

			self.latestTag = res.tag;
			self.setVersions(self.status && self.status.current, res.tag);
			self.setMeta({
				size: res.size,
				published: res.published_at,
				checked: res.checked_at,
				store: self.status && self.status.store,
				storeFree: self.status && self.status.store_free
			});

			if (res.has_update) {
				self.setBadge('new', '有新版本');
				self.showNotes(res.body);
				self.refs.upBtn.disabled = false;
			}
			else {
				self.setBadge('ok', '已是最新');
				self.hideNotes();
				self.refs.upBtn.disabled = true;
			}
		}, function(e) {
			self.refs.ckBtn.disabled = false;
			self.setBadge('err', '检查失败');
			ui.addNotification(null, E('p', {}, '检查失败：' + e), 'error');
		});
	},

	handleUpgrade: function() {
		var self = this,
		    tag = this.latestTag || '新版本';

		ui.showModal('确认升级固件', [
			E('p', {}, '即将刷写 ' + tag + '。过程中会断网并自动重启，请全程不要断电。'),
			E('p', {}, '刷写前会依次完成 7 项检查：下载、双源 sha256、机型与分区表匹配、' +
				'配置备份、p1 容量校验。任何一项不过都会自动中止，不会动你的系统。'),
			E('p', {}, '现有配置会被完整保留；OpenClash 的规则与订阅也在其中。'),
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
				self.setBadge('err', '启动失败');
				ui.addNotification(null,
					E('p', {}, '启动失败：' + ((res && res.error) || '未知错误')), 'error');
				return;
			}

			self.refs.upBtn.disabled = true;
			self.refs.log.textContent = '';
			self.refs.bar.style.display = '';
			self.refs.dlInfo.style.display = '';
			self.setBadge('run', '升级中');
			self.showProgress();
			self.setSteps(0);
			self.startPolling();
		}, function(e) {
			self.setBadge('err', '启动失败');
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

				/* 日志是 tail 出来的，刷写开始后 sysupgrade 会刷一大堆输出，
				   可能把 "#step 7" 那行挤掉；所以再按关键字兜一次底 */
				var txt = self.lastLog || '';
				var flashing = self._flashing ||
					/Commencing upgrade|刷写期间不要断电/.test(txt);

				if (flashing) {
					/* 刷写已经开始，设备随时会断。别报「失败」，直接进入重连探测 */
					self.setSteps(4);
					self.setBadge('run', '刷写中，设备即将重启');
					self.startReconnect();
				}
				else if (self.failedStep()) {
					self.setBadge('err', '预检未通过，见下方原因');
				}
				else
					self.setBadge('ok', '任务已结束');
			}
		}, function() {
			/* ubus 调不通：多半是设备正在重启。若已在刷写阶段，转为探测重连 */
			self.stopPolling();

			if (self._flashing) {
				self.setBadge('run', '设备正在重启…');
				self.startReconnect();
			}
		});
	},

	/* 哪一步失败了（有 fail 标记就返回步号，否则 0） */
	failedStep: function() {
		for (var i = 1; i <= CHECKS.length; i++)
			if (this._ckState[i] === 'fail')
				return i;

		return 0;
	},

	/* 刷写后设备会重启、会话会失效，所以这里只负责「发现它回来了」，
	   不自动跳转 —— 直接刷新会落到登录页，看起来像出错。 */
	startReconnect: function() {
		var self = this;

		if (this._probe)
			return;

		this._probe = window.setInterval(function() {
			fetch(window.location.pathname + '?_=' + Date.now(), {
				method: 'GET', cache: 'no-store', credentials: 'same-origin'
			}).then(function(r) {
				if (!r.ok)
					return;

				window.clearInterval(self._probe);
				self._probe = null;

				self.setBadge('ok', '设备已重启完成');
				ui.addNotification(null, E('p', {}, [
					'固件已刷写完成，设备重新上线。',
					E('br'),
					'刷新页面并重新登录，即可看到本次升级的自证结果（恢复了多少项配置）。'
				]), 'info');
			}).catch(function() { /* 还没起来，下次再试 */ });
		}, 5000);
	},

	renderLog: function(res) {
		var txt = res.log || '';

		if (this.lastLog !== txt) {
			this.lastLog = txt;
			this.refs.log.textContent = txt || '（暂无输出）';
			this.refs.log.scrollTop = this.refs.log.scrollHeight;

			this.applyMarkers(txt);
		}

		if (res.total > 0) {
			var pct = Math.min(100, Math.round((res.downloaded || 0) / res.total * 100));

			this.refs.pct.textContent = pct + '%';
			this.refs.dl.textContent = fmtSize(res.downloaded) + ' / ' + fmtSize(res.total);
			this.refs.barFill.style.width = pct + '%';
		}
		else if (/Commencing upgrade|刷写期间不要断电/.test(this.lastLog)) {
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

			self.refs.selfState.textContent = '已更新，刷新页面生效';
			ui.addNotification(null,
				E('p', {}, '插件已更新，页面将在 2 秒后刷新'), 'info');

			window.setTimeout(function() { location.reload(); }, 2000);
		}, function(e) {
			/* ubus 调用有超时；万一超时了但包其实已经装上，补查一次本地指纹确认 */
			return callSelfStatus().then(function(r) {
				if (r && r.local && self.shortSha(r.local) !== self.shortSha(prev)) {
					self.refs.selfState.textContent = '已更新，刷新页面生效';
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

			self.hideNotes();
			self.refs.upBtn.disabled = true;
			self.setMeta({});
			self.setBadge('ok', '设置已更新，请重新检查');
		}, function(e) {
			ui.addNotification(null, E('p', {}, '保存失败：' + e), 'error');
		});
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
