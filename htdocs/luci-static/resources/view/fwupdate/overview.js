'use strict';
'require view';
'require rpc';
'require ui';

var callStatus = rpc.declare({ object: 'luci.fwupdate', method: 'status' });
var callCheck  = rpc.declare({ object: 'luci.fwupdate', method: 'check' });
var callLog    = rpc.declare({ object: 'luci.fwupdate', method: 'log' });
var callStart  = rpc.declare({ object: 'luci.fwupdate', method: 'start' });
var callSave   = rpc.declare({ object: 'luci.fwupdate', method: 'setconfig', params: [ 'repo', 'mirror' ] });

function fmtSize(n) {
	n = +n || 0;
	return n > 0 ? (Math.round(n / 1048576 * 10) / 10) + ' MB' : '未知';
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

return view.extend({
	load: function() {
		return callStatus().then(function(res) { return res; }, function() { return null; });
	},

	row: function(label, value) {
		return E('div', { class: 'cbi-value' }, [
			E('label', { class: 'cbi-value-title' }, label),
			E('div', { class: 'cbi-value-field' }, value)
		]);
	},

	render: function(st) {
		var s = st || {};

		this.status = s;
		this.latestTag = s.latest || '';
		this.lastLog = '';

		this.node = E('div', { class: 'cbi-map' }, [
			E('h2', {}, '固件升级'),
			E('div', { class: 'cbi-map-descr' },
				'从 GitHub Release 检查新固件并一键刷写。下载、sha256 校验与刷写都在路由器本地完成，配置默认保留。'),

			E('fieldset', { class: 'cbi-section' }, [
				E('legend', {}, '当前状态'),
				E('div', { class: 'cbi-section-node' }, [
					this.row('当前版本', E('code', { id: 'fw-cur' }, s.current || '未知（尚未从本仓库刷写过）')),
					this.row('最新版本', E('span', { id: 'fw-latest' }, s.latest || '尚未检查')),
					this.row('检查时间', E('span', { id: 'fw-time' }, s.checked_at ? fmtTime(s.checked_at) : '—')),
					this.row('状态', E('strong', { id: 'fw-state' }, '')),
					this.row('操作', E('div', {}, [
						E('button', {
							class: 'cbi-button cbi-button-action',
							id: 'fw-btn-check',
							click: ui.createHandlerFn(this, 'handleCheck')
						}, '检查更新'),
						' ',
						E('button', {
							class: 'cbi-button cbi-button-apply',
							id: 'fw-btn-upgrade',
							disabled: true,
							click: ui.createHandlerFn(this, 'handleUpgrade')
						}, '立即升级')
					]))
				])
			]),

			E('fieldset', { class: 'cbi-section', id: 'fw-update-box', style: 'display:none' }, [
				E('legend', {}, '发现新版本'),
				E('div', { class: 'cbi-section-node', id: 'fw-update-detail' })
			]),

			E('fieldset', { class: 'cbi-section', id: 'fw-log-box', style: 'display:none' }, [
				E('legend', {}, '升级进度'),
				E('div', { class: 'cbi-section-node' }, [
					E('div', { id: 'fw-progress' }),
					E('pre', {
						id: 'fw-log',
						style: 'max-height:260px;overflow:auto;padding:8px;font-size:12px;' +
						       'background:rgba(127,127,127,.12);border-radius:4px;white-space:pre-wrap;'
					}, '')
				])
			]),

			E('fieldset', { class: 'cbi-section' }, [
				E('legend', {}, '设置'),
				E('div', { class: 'cbi-section-node' }, [
					this.row('GitHub 仓库',
						E('input', {
							class: 'cbi-input-text', id: 'fw-repo',
							placeholder: 'owner/repo', value: s.repo || ''
						})),
					this.row('下载加速前缀（可选）',
						E('input', {
							class: 'cbi-input-text', id: 'fw-mirror',
							placeholder: 'https://ghfast.top/', value: s.mirror || ''
						})),
					this.row('', E('button', {
						class: 'cbi-button cbi-button-save',
						click: ui.createHandlerFn(this, 'handleSaveConfig')
					}, '保存设置'))
				])
			]),

			E('div', { class: 'cbi-page-actions' })
		]);

		this.refs = {
			latest:   this.node.querySelector('#fw-latest'),
			time:     this.node.querySelector('#fw-time'),
			state:    this.node.querySelector('#fw-state'),
			checkBtn: this.node.querySelector('#fw-btn-check'),
			upBtn:    this.node.querySelector('#fw-btn-upgrade'),
			box:      this.node.querySelector('#fw-update-box'),
			detail:   this.node.querySelector('#fw-update-detail'),
			logBox:   this.node.querySelector('#fw-log-box'),
			log:      this.node.querySelector('#fw-log'),
			prog:     this.node.querySelector('#fw-progress'),
			repo:     this.node.querySelector('#fw-repo'),
			mirror:   this.node.querySelector('#fw-mirror')
		};

		if (!st)
			this.setStatus('读不到 luci.fwupdate 接口，请重启 rpcd 或检查插件是否装好', true);
		else if (!s.repo)
			this.setStatus('还没配置仓库，先在下面填 owner/repo', true);
		else if (s.running) {
			this.setStatus('正在升级中…', false);
			this.refs.logBox.style.display = '';
			this.startPolling();
		}
		else if (s.has_update) {
			this.setStatus('发现新版本，可以升级', false);
			this.showUpdate(s);
		}
		else if (s.latest)
			this.setStatus('已是最新', false);
		else
			this.setStatus('点「检查更新」查询 GitHub', false);

		return this.node;
	},

	setStatus: function(text, isError) {
		if (!this.refs || !this.refs.state)
			return;

		this.refs.state.textContent = text;
		this.refs.state.style.color = isError ? '#c0392b' : '';
	},

	setBusy: function(busy) {
		if (this.refs && this.refs.checkBtn)
			this.refs.checkBtn.disabled = !!busy;
	},

	showUpdate: function(res) {
		var size = fmtSize(res.size);

		this.latestTag = res.tag || res.latest || this.latestTag;

		if (this.latestTag)
			this.refs.latest.textContent = this.latestTag;

		if (res.checked_at)
			this.refs.time.textContent = fmtTime(res.checked_at);

		this.refs.upBtn.disabled = false;

		var pre = E('pre', {
			style: 'max-height:220px;overflow:auto;padding:8px;font-size:12px;' +
			       'background:rgba(127,127,127,.12);border-radius:4px;white-space:pre-wrap;'
		}, (res.body || '').trim() || '（该 Release 没有写更新说明）');

		this.refs.detail.innerHTML = '';
		this.refs.detail.appendChild(this.row('版本', E('code', {}, this.latestTag || '未知')));
		this.refs.detail.appendChild(this.row('固件大小', E('span', {}, size)));
		this.refs.detail.appendChild(this.row('发布时间', E('span', {}, res.published_at || '—')));
		this.refs.detail.appendChild(this.row('更新说明', pre));
		this.refs.box.style.display = '';
	},

	handleCheck: function() {
		var self = this;

		this.setBusy(true);
		this.setStatus('正在检查…', false);

		return callCheck().then(function(res) {
			self.setBusy(false);

			if (!res || res.ok === false) {
				self.setStatus('检查失败：' + ((res && res.error) || '未知错误'), true);
				return;
			}

			if (res.has_update) {
				self.setStatus('发现新版本，可以升级', false);
				self.showUpdate(res);
			}
			else {
				self.latestTag = res.tag;
				self.refs.latest.textContent = res.tag;
				self.refs.time.textContent = fmtTime(res.checked_at);
				self.refs.box.style.display = 'none';
				self.refs.upBtn.disabled = true;
				self.setStatus('已是最新', false);
			}
		}, function(e) {
			self.setBusy(false);
			self.setStatus('检查失败：' + e, true);
		});
	},

	handleUpgrade: function() {
		var self = this,
		    tag = this.latestTag || '新版本';

		ui.showModal('确认升级固件', [
			E('p', {}, '即将刷写 ' + tag + '。过程中会断网并自动重启，请全程不要断电。'),
			E('p', {}, '默认保留现有配置（/etc/config、已装插件的设置）。'),
			E('div', { class: 'right' }, [
				E('button', { class: 'cbi-button', click: ui.hideModal }, '取消'),
				' ',
				E('button', {
					class: 'cbi-button cbi-button-negative',
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
				self.setStatus('启动失败：' + ((res && res.error) || '未知错误'), true);
				return;
			}

			self.refs.logBox.style.display = '';
			self.refs.log.textContent = '';
			self.refs.prog.innerHTML = '';
			self.refs.upBtn.disabled = true;
			self.setStatus('正在升级…', false);
			self.startPolling();
		}, function(e) {
			self.setStatus('启动失败：' + e, true);
		});
	},

	startPolling: function() {
		var self = this;

		if (this._timer)
			return;

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

		/* 页面被切走就停掉轮询；首次渲染时节点还没挂到 body 上，所以只在
		   曾经挂载过之后才判定「已离开」 */
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
				if (self.lastLog.indexOf('开始刷写') >= 0)
					self.setStatus('刷写已开始，设备马上重启，页面会自动断开', false);
				else
					self.setStatus('升级任务已结束，详情见下方日志', false);
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
		}

		if (res.total > 0) {
			var pct = Math.min(100, Math.round((res.downloaded || 0) / res.total * 100));

			this.refs.prog.innerHTML = '';
			this.refs.prog.appendChild(E('progress', { value: pct, max: 100, style: 'width:100%' }));
			this.refs.prog.appendChild(E('div', { class: 'cbi-value-description' },
				'下载进度：' + fmtSize(res.downloaded) + ' / ' + fmtSize(res.total) + '（' + pct + '%）'));
		}
	},

	handleSaveConfig: function() {
		var self = this,
		    repo = (this.refs.repo.value || '').trim(),
		    mirror = (this.refs.mirror.value || '').trim();

		return callSave(repo, mirror).then(function(res) {
			if (!res || res.ok === false) {
				ui.addNotification(null, E('p', {}, '保存失败：' + ((res && res.error) || '未知错误')), 'error');
				return;
			}

			ui.addNotification(null, E('p', {}, '设置已保存'), 'info');

			self.refs.box.style.display = 'none';
			self.refs.upBtn.disabled = true;
			self.refs.latest.textContent = '尚未检查';
			self.refs.time.textContent = '—';
			self.setStatus('设置已更新，请重新检查', false);
		}, function(e) {
			ui.addNotification(null, E('p', {}, '保存失败：' + e), 'error');
		});
	}
});
