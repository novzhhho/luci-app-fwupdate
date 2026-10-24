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

var RING_LEN = 163.4;   /* 2 * PI * 26 */

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

/* 把 r25.12.2-lucky2.27.2-bandix0.12.11-luci0.12.12-uiabc1234 拆成
   主版本 + 若干组件，界面上分层展示会清爽很多 */
function verParts(tag) {
	tag = (tag || '').replace(/^r(?=[0-9])/, '');

	if (!tag)
		return { main: '', subs: [] };

	var p = tag.split('-');

	return { main: p[0] || '', subs: p.slice(1) };
}

var CSS = `
.fwup{--p:#2f6fed;--p2:#7c5cff;--ok:#12a150;--line:rgba(140,150,170,.30);
  --bg:rgba(140,150,170,.10);--bg2:rgba(140,150,170,.055);--mut:.62;--r:14px;font-size:13.5px}
.fwup *{box-sizing:border-box}
.fwup .hero{position:relative;padding:18px 20px 16px;border:1px solid var(--line);border-radius:var(--r);
  margin-bottom:16px;overflow:hidden;
  background:linear-gradient(135deg,rgba(47,111,237,.13),rgba(124,92,255,.07) 55%,transparent 88%)}
.fwup .hero:before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;
  background:linear-gradient(180deg,var(--p),var(--p2))}
.fwup .vrow{display:flex;align-items:flex-start;gap:20px;flex-wrap:wrap}
.fwup .vh{font-size:11px;letter-spacing:.6px;opacity:var(--mut);margin-bottom:5px}
.fwup .ver{font-size:17px;font-weight:700;letter-spacing:-.3px;line-height:1.25;
  font-family:ui-monospace,Menlo,Consolas,monospace}
.fwup .sub{font-size:11.5px;opacity:var(--mut);margin-top:4px;line-height:1.5;max-width:380px;
  font-family:ui-monospace,Menlo,Consolas,monospace}
.fwup .arw{opacity:.28;font-size:18px;margin-top:20px}
.fwup .chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:15px;align-items:center}
.fwup .chip{font-size:11.5px;padding:4px 9px;border-radius:8px;background:var(--bg);
  border:1px solid var(--line);opacity:.85}
.fwup .pill{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;
  padding:4px 11px;border-radius:999px;letter-spacing:.2px}
.fwup .pill .dot{width:7px;height:7px;border-radius:50%;background:currentColor}
.fwup .pill.ok{background:rgba(18,161,80,.15);color:#12995a}
.fwup .pill.new{background:rgba(217,130,22,.17);color:#c07816}
.fwup .pill.run{background:rgba(47,111,237,.16);color:#3b76e8}
.fwup .pill.err{background:rgba(200,60,60,.15);color:#cd4040}
.fwup .acts{display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;align-items:center}
.fwup .btn{padding:8px 17px;border-radius:9px;font-size:13px;font-weight:600;
  border:1px solid transparent;cursor:pointer;font-family:inherit;
  transition:transform .12s,box-shadow .12s,opacity .12s}
.fwup .btn:active{transform:translateY(1px)}
.fwup .btn-pri{background:linear-gradient(135deg,var(--p),var(--p2));color:#fff;
  box-shadow:0 6px 18px -9px rgba(47,111,237,.95)}
.fwup .btn-pri[disabled]{opacity:.4;box-shadow:none;cursor:not-allowed}
.fwup .btn-gh{background:transparent;color:inherit;border-color:var(--line)}
.fwup .btn-gh[disabled]{opacity:.45;cursor:not-allowed}
.fwup .btn-sm{padding:5px 13px;font-size:12px;border-radius:8px}
.fwup .card{border:1px solid var(--line);border-radius:var(--r);background:var(--bg2);
  margin-bottom:16px;overflow:hidden}
.fwup .hd{display:flex;align-items:center;gap:9px;padding:11px 18px;border-bottom:1px solid var(--line);
  font-weight:700;font-size:13px}
.fwup .bd{padding:16px 18px}
.fwup pre.notes{margin:0;max-height:190px;overflow:auto;white-space:pre-wrap;font-size:12px;
  line-height:1.66;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:11px 13px;
  font-family:ui-monospace,Menlo,Consolas,monospace}
.fwup .steps{display:flex;margin:2px 0 20px}
.fwup .st{flex:1;text-align:center;position:relative;font-size:11px;opacity:.45}
.fwup .st b{position:relative;z-index:1;display:block;width:24px;height:24px;line-height:23px;
  border-radius:50%;margin:0 auto 6px;background:var(--bg);border:1px solid var(--line);
  font-weight:700;font-size:11px}
.fwup .st:after{content:"";position:absolute;top:12px;left:50%;width:100%;height:2px;background:var(--line)}
.fwup .st:last-child:after{display:none}
.fwup .st.on{opacity:1;font-weight:700}
.fwup .st.on b{background:var(--p);border-color:transparent;color:#fff;
  box-shadow:0 0 0 4px rgba(47,111,237,.18)}
.fwup .st.done{opacity:.92}
.fwup .st.done b{background:var(--ok);border-color:transparent;color:#fff}
.fwup .st.done:after{background:var(--ok)}
.fwup .prog{display:flex;align-items:center;gap:16px;margin-bottom:14px}
.fwup .prog .num{font-size:19px;font-weight:700;letter-spacing:-.5px}
.fwup .prog .lab{font-size:11.5px;opacity:var(--mut);margin-top:3px}
.fwup pre.con{margin:0;background:#0e1520;color:#c9d7ea;border-radius:10px;padding:11px 13px;
  font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5px;line-height:1.62;
  max-height:200px;overflow:auto;white-space:pre-wrap}
.fwup .row{display:flex;align-items:center;gap:12px;padding:10px 0;
  border-bottom:1px solid var(--line);flex-wrap:wrap}
.fwup .row:first-child{padding-top:0}
.fwup .row:last-child{border-bottom:0;padding-bottom:0}
.fwup .row .k{width:100px;flex:0 0 auto;opacity:var(--mut);font-size:12.5px}
.fwup .row .v{flex:1;min-width:140px}
.fwup code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5px;background:var(--bg);
  border:1px solid var(--line);border-radius:6px;padding:1px 6px}
.fwup details.settings{border:1px solid var(--line);border-radius:var(--r);
  background:var(--bg2);overflow:hidden}
.fwup details.settings summary{padding:12px 18px;cursor:pointer;font-weight:700;font-size:13px;
  list-style:none;outline:none}
.fwup details.settings summary::-webkit-details-marker{display:none}
.fwup details.settings summary:before{content:"\\2699";margin-right:8px;opacity:.55}
.fwup details.settings[open] summary{border-bottom:1px solid var(--line)}
.fwup .fld{margin-bottom:13px}
.fwup .fld label{display:block;font-size:12px;opacity:var(--mut);margin-bottom:5px}
.fwup .fld input{width:100%;max-width:430px;padding:8px 10px;border-radius:9px;
  border:1px solid var(--line);background:transparent;color:inherit;
  font-family:inherit;font-size:13px}
.fwup .fld input:focus{outline:none;border-color:var(--p)}
.fwup .hint{font-size:11.5px;opacity:var(--mut);margin-top:10px;line-height:1.6}
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

	verBlock: function(tag, fallback) {
		var p = verParts(tag);

		if (!p.main)
			return [
				E('div', { class: 'ver' }, fallback),
				E('div', { class: 'sub' }, ' ')
			];

		return [
			E('div', { class: 'ver' }, p.main),
			E('div', { class: 'sub' }, p.subs.length ? p.subs.join(' · ') : ' ')
		];
	},

	row: function(k, v) {
		return E('div', { class: 'row' }, [
			E('span', { class: 'k' }, k),
			E('span', { class: 'v' }, v)
		]);
	},

	render: function(data) {
		var st = (data && data.st) || null,
		    sf = (data && data.self) || null,
		    s = st || {},
		    self = this;

		this.status = s;
		this.latestTag = s.latest || '';
		this.lastLog = '';
		this._phase = -1;

		var cur = this.verBlock(s.current, '未知'),
		    newv = this.verBlock(s.latest, '尚未检查');

		var nodes = [
			E('style', {}, CSS),

			/* ---------- 头部：版本对比 ---------- */
			E('div', { class: 'hero' }, [
				E('div', { class: 'vrow' }, [
					E('div', {}, [ E('div', { class: 'vh' }, '当前版本') ].concat(cur)),
					E('div', { class: 'arw' }, '→'),
					E('div', {}, [ E('div', { class: 'vh' }, '可升级到') ].concat(newv))
				]),
				E('div', { class: 'chips' }, [
					E('span', { class: 'pill ok', id: 'fw-pill' }, [
						E('span', { class: 'dot' }), E('span', { id: 'fw-pill-txt' }, '待检查')
					]),
					E('span', { class: 'chip', id: 'fw-chip-size', style: 'display:none' }, ''),
					E('span', { class: 'chip', id: 'fw-chip-pub', style: 'display:none' }, ''),
					E('span', { class: 'chip', id: 'fw-chip-time' }, '上次检查：—')
				]),
				E('div', { class: 'acts' }, [
					E('button', {
						class: 'btn btn-pri', id: 'fw-up',
						disabled: true,
						click: ui.createHandlerFn(this, 'handleUpgrade')
					}, '立即升级'),
					E('button', {
						class: 'btn btn-gh', id: 'fw-ck',
						click: ui.createHandlerFn(this, 'handleCheck')
					}, '检查更新')
				])
			]),

			/* ---------- 更新说明 ---------- */
			E('div', { class: 'card', id: 'fw-notes', style: 'display:none' }, [
				E('div', { class: 'hd' }, '更新说明'),
				E('div', { class: 'bd' }, [
					E('pre', { class: 'notes', id: 'fw-notes-body' }, '')
				])
			]),

			/* ---------- 升级进度：四步 + 进度环 + 控制台 ---------- */
			E('div', { class: 'card', id: 'fw-progress', style: 'display:none' }, [
				E('div', { class: 'hd' }, '升级进度'),
				E('div', { class: 'bd' }, [
					E('div', { class: 'steps', id: 'fw-steps' }, [
						E('div', { class: 'st', 'data-i': 0 }, [ E('b', {}, '1'), '检查更新' ]),
						E('div', { class: 'st', 'data-i': 1 }, [ E('b', {}, '2'), '下载镜像' ]),
						E('div', { class: 'st', 'data-i': 2 }, [ E('b', {}, '3'), '校验镜像' ]),
						E('div', { class: 'st', 'data-i': 3 }, [ E('b', {}, '4'), '刷写重启' ])
					]),
					E('div', { class: 'prog' }, [
						E('svg', { width: 62, height: 62, viewBox: '0 0 62 62' }, [
							E('circle', {
								cx: 31, cy: 31, r: 26, fill: 'none',
								stroke: 'rgba(140,150,170,.3)', 'stroke-width': 6
							}),
							E('circle', {
								id: 'fw-ring', cx: 31, cy: 31, r: 26, fill: 'none',
								stroke: '#2f6fed', 'stroke-width': 6, 'stroke-linecap': 'round',
								'stroke-dasharray': RING_LEN, 'stroke-dashoffset': RING_LEN,
								transform: 'rotate(-90 31 31)'
							})
						]),
						E('div', {}, [
							E('div', { class: 'num', id: 'fw-pct' }, '0%'),
							E('div', { class: 'lab', id: 'fw-dl' }, '等待开始')
						])
					]),
					E('pre', { class: 'con', id: 'fw-log' }, '')
				])
			]),

			/* ---------- 插件自身 ---------- */
			E('div', { class: 'card' }, [
				E('div', { class: 'hd' }, '插件版本'),
				E('div', { class: 'bd' }, [
					this.row('本地构建', E('code', { id: 'fw-self-local' }, this.shortSha(sf && sf.local))),
					this.row('远端最新', E('code', { id: 'fw-self-remote' }, this.shortSha(sf && sf.remote) || '未检查')),
					this.row('状态', E('span', { id: 'fw-self-state' }, '—')),
					this.row('', E('div', { style: 'display:flex;gap:9px;flex-wrap:wrap' }, [
						E('button', {
							class: 'btn btn-gh btn-sm', id: 'fw-self-ck',
							click: ui.createHandlerFn(this, 'handleSelfCheck')
						}, '检查插件更新'),
						E('button', {
							class: 'btn btn-pri btn-sm', id: 'fw-self-up', disabled: true,
							click: ui.createHandlerFn(this, 'handleSelfUpdate')
						}, '更新插件')
					]))
				])
			]),

			/* ---------- 高级设置 ---------- */
			E('details', { class: 'settings' }, [
				E('summary', {}, '高级设置'),
				E('div', { class: 'bd' }, [
					E('div', { class: 'fld' }, [
						E('label', {}, 'GitHub 仓库（owner/repo）'),
						E('input', { id: 'fw-repo', placeholder: 'owner/repo', value: s.repo || '' })
					]),
					E('div', { class: 'fld' }, [
						E('label', {}, '下载加速前缀（可选）'),
						E('input', { id: 'fw-mirror', placeholder: 'https://ghfast.top/', value: s.mirror || '' })
					]),
					E('button', {
						class: 'btn btn-gh btn-sm',
						click: ui.createHandlerFn(this, 'handleSaveConfig')
					}, '保存设置'),
					E('div', { class: 'hint' },
						'升级走标准 sysupgrade，默认保留配置；下载完成后会校验 sha256 与 gzip 魔数。')
				])
			])
		];

		this.node = E('div', { class: 'fwup' }, nodes);

		this.refs = {
			pill:     this.node.querySelector('#fw-pill'),
			pillTxt:  this.node.querySelector('#fw-pill-txt'),
			chipSize: this.node.querySelector('#fw-chip-size'),
			chipPub:  this.node.querySelector('#fw-chip-pub'),
			chipTime: this.node.querySelector('#fw-chip-time'),
			upBtn:    this.node.querySelector('#fw-up'),
			ckBtn:    this.node.querySelector('#fw-ck'),
			notes:    this.node.querySelector('#fw-notes'),
			notesBody:this.node.querySelector('#fw-notes-body'),
			progCard: this.node.querySelector('#fw-progress'),
			steps:    this.node.querySelectorAll('#fw-steps .st'),
			ring:     this.node.querySelector('#fw-ring'),
			pct:      this.node.querySelector('#fw-pct'),
			dl:       this.node.querySelector('#fw-dl'),
			log:      this.node.querySelector('#fw-log'),
			selfLocal:this.node.querySelector('#fw-self-local'),
			selfRemote:this.node.querySelector('#fw-self-remote'),
			selfState:this.node.querySelector('#fw-self-state'),
			selfUp:   this.node.querySelector('#fw-self-up'),
			selfCk:   this.node.querySelector('#fw-self-ck'),
			repo:     this.node.querySelector('#fw-repo'),
			mirror:   this.node.querySelector('#fw-mirror')
		};

		/* 初始状态 */
		if (!st)
			this.setPill('err', '接口未响应');
		else if (!s.repo)
			this.setPill('new', '未配置仓库');
		else if (s.running) {
			this.setPill('run', '升级中');
			this.showProgress();
			this.startPolling();
		}
		else if (s.has_update) {
			this.setPill('new', '有新版本');
			this.showNotes(s.body);
			this.refs.upBtn.disabled = false;
		}
		else if (s.latest)
			this.setPill('ok', '已是最新');
		else
			this.setPill('ok', '待检查');

		if (s.checked_at)
			this.refs.chipTime.textContent = '上次检查：' + fmtTime(s.checked_at);
		if (s.latest && s.size) {
			this.refs.chipSize.textContent = '镜像 ' + fmtSize(s.size);
			this.refs.chipSize.style.display = '';
		}
		if (s.published_at) {
			this.refs.chipPub.textContent = '发布 ' + s.published_at.replace('T', ' ').substring(0, 16);
			this.refs.chipPub.style.display = '';
		}

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

	shortSha: function(s) {
		s = (s || '').replace(/[^0-9a-f]/g, '');
		return s ? s.substring(0, 7) : '';
	},

	setPill: function(kind, text) {
		if (!this.refs || !this.refs.pill)
			return;

		this.refs.pill.className = 'pill ' + kind;
		this.refs.pillTxt.textContent = text;
	},

	showNotes: function(body) {
		if (!this.refs)
			return;

		this.refs.notesBody.textContent = (body || '').trim() || '（该 Release 没有写更新说明）';
		this.refs.notes.style.display = '';
	},

	showProgress: function() {
		if (this.refs)
			this.refs.progCard.style.display = '';
	},

	/* phase: -1 未开始, 0..3 当前进行到第几步, 4 全部完成（已开始刷写） */
	setSteps: function(phase) {
		if (!this.refs || !this.refs.steps || this._phase === phase)
			return;

		this._phase = phase;

		for (var i = 0; i < this.refs.steps.length; i++) {
			var el = this.refs.steps[i],
			    cls = 'st';

			if (i < phase)
				cls += ' done';
			else if (i === phase)
				cls += ' on';

			el.className = cls;
			el.querySelector('b').textContent = (i < phase) ? '✓' : (i + 1);
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

	handleCheck: function() {
		var self = this;

		this.refs.ckBtn.disabled = true;
		this.setPill('run', '检查中…');

		return callCheck().then(function(res) {
			self.refs.ckBtn.disabled = false;

			if (!res || res.ok === false) {
				self.setPill('err', '检查失败');
				ui.addNotification(null,
					E('p', {}, '检查失败：' + ((res && res.error) || '未知错误')), 'error');
				return;
			}

			self.latestTag = res.tag;
			self.refs.chipTime.textContent = '上次检查：' + fmtTime(res.checked_at);

			if (res.size) {
				self.refs.chipSize.textContent = '镜像 ' + fmtSize(res.size);
				self.refs.chipSize.style.display = '';
			}
			if (res.published_at) {
				self.refs.chipPub.textContent = '发布 ' + res.published_at.replace('T', ' ').substring(0, 16);
				self.refs.chipPub.style.display = '';
			}

			/* 版本块用服务端返回的 tag 刷新 */
			var box = self.node.querySelector('.vrow'),
			    blocks = box.querySelectorAll('div > div.ver'),
			    subs = box.querySelectorAll('div > div.sub'),
			    p = verParts(res.tag);

			if (blocks.length > 1) {
				blocks[1].textContent = p.main;
				subs[1].textContent = p.subs.length ? p.subs.join(' · ') : ' ';
			}

			if (res.has_update) {
				self.setPill('new', '有新版本');
				self.showNotes(res.body);
				self.refs.upBtn.disabled = false;
			}
			else {
				self.setPill('ok', '已是最新');
				self.refs.notes.style.display = 'none';
				self.refs.upBtn.disabled = true;
			}
		}, function(e) {
			self.refs.ckBtn.disabled = false;
			self.setPill('err', '检查失败');
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
				E('button', { class: 'btn btn-gh', click: ui.hideModal }, '取消'),
				' ',
				E('button', {
					class: 'btn btn-pri',
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
				self.setPill('err', '启动失败');
				ui.addNotification(null,
					E('p', {}, '启动失败：' + ((res && res.error) || '未知错误')), 'error');
				return;
			}

			self.refs.upBtn.disabled = true;
			self.refs.log.textContent = '';
			self.setPill('run', '升级中');
			self.showProgress();
			self.setSteps(0);
			self.startPolling();
		}, function(e) {
			self.setPill('err', '启动失败');
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
					self.setPill('run', '刷写中，即将重启');
				}
				else if (self.lastLog.indexOf('错误') >= 0) {
					self.setPill('err', '升级失败');
				}
				else {
					self.setPill('ok', '任务已结束');
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
			this.refs.ring.setAttribute('stroke-dashoffset', RING_LEN * (1 - pct / 100));
		}
		else if (this.lastLog.indexOf('开始刷写') >= 0) {
			this.refs.pct.textContent = '100%';
			this.refs.dl.textContent = '镜像已就绪，正在刷写';
			this.refs.ring.setAttribute('stroke-dashoffset', 0);
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
			ui.addNotification(null, E('p', {}, '检查插件更新失败：' + e), 'error');
		});
	},

	handleSelfUpdate: function() {
		var self = this;

		ui.showModal('更新插件', [
			E('p', {}, '将从 GitHub 下载最新构建的插件包并覆盖安装，只需几秒。'),
			E('p', {}, '不动固件、不重启、不改配置。'),
			E('div', { class: 'right' }, [
				E('button', { class: 'btn btn-gh', click: ui.hideModal }, '取消'),
				' ',
				E('button', {
					class: 'btn btn-pri',
					click: function() {
						ui.hideModal();
						self.doSelfUpdate();
					}
				}, '开始更新')
			])
		]);
	},

	doSelfUpdate: function() {
		var self = this;

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
			self.refs.selfState.textContent = '更新失败';
			self.refs.selfUp.disabled = false;
			ui.addNotification(null, E('p', {}, '更新失败：' + e), 'error');
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
			self.refs.chipTime.textContent = '上次检查：—';
			self.setPill('ok', '设置已更新，请重新检查');
		}, function(e) {
			ui.addNotification(null, E('p', {}, '保存失败：' + e), 'error');
		});
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
