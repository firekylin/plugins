'use strict';

const {Registry, DEFAULT_REGISTRY, trustedUrl} = require('./lib/registry');

const SETTINGS_KEY = 'plugin_marketplace_config';

async function settings() {
  const options = await think.model('options').getOptions(true);
  try { return {...JSON.parse(options[SETTINGS_KEY] || '{}'), registryUrl: JSON.parse(options[SETTINGS_KEY] || '{}').registryUrl || DEFAULT_REGISTRY} } catch {
    return {registryUrl: DEFAULT_REGISTRY};
  }
}

async function packages() {
  return new Registry({url: (await settings()).registryUrl}).list();
}

module.exports = {
  register(ctx) {
    if (!ctx.packages) throw new Error('Marketplace requires Firekylin package management support');
    ctx.admin.registerPanel({id: 'marketplace', title: '扩展市场', icon: 'plugin', order: 90});
    ctx.admin.registerPage({
      id: 'browse', panel: 'marketplace', title: '浏览扩展', order: 10,
      load: async() => {
        const [items, installed] = await Promise.all([packages(), ctx.packages.list()]);
        const installedNames = new Set(installed.plugins.map(item => item.name));
        return {sections: [{type: 'table', rowKey: 'name', columns: [
          {key: 'title', title: '名称'}, {key: 'type', title: '类型'},
          {key: 'version', title: '版本'}, {key: 'description', title: '说明'},
          {key: 'operations', title: '操作', type: 'actions'}
        ], rows: items.map(item => ({...item, operations: [{
          label: installedNames.has(item.name) ? '重新安装' : '安装', action: 'marketplace-install', input: item
        }]}))}]};
      }
    });
    ctx.admin.registerPage({
      id: 'installed', panel: 'marketplace', title: '已安装', order: 20,
      load: async() => {
        const result = await ctx.packages.list();
        return {sections: [
          {type: 'table', title: '插件', rowKey: 'name', columns: [
            {key: 'name', title: '包名'}, {key: 'version', title: '版本'},
            {key: 'status', title: '状态'}, {key: 'operations', title: '操作', type: 'actions'}
          ], rows: result.plugins.map(item => ({...item, operations: [{
            label: '卸载', action: 'marketplace-uninstall', type: 'danger', input: {name: item.name}
          }]}))},
          {type: 'table', title: '主题', rowKey: 'id', columns: [
            {key: 'name', title: '名称'}, {key: 'version', title: '版本'}, {key: 'active', title: '已启用'}
          ], rows: result.themes}
        ]};
      }
    });
    ctx.admin.registerPage({id: 'settings', panel: 'marketplace', title: '市场设置', order: 30,
      load: async() => ({sections: [{type: 'form', id: 'marketplace-settings'}]})});
    ctx.admin.registerForm({
      id: 'marketplace-settings', page: 'settings', title: 'Registry', fields: [
        {name: 'registryUrl', type: 'url', label: 'Registry URL', required: true}
      ], load: settings,
      submit: async values => {
        trustedUrl(values.registryUrl);
        await think.model('options').updateOptions(SETTINGS_KEY, JSON.stringify(values));
        return {message: '市场设置已保存'};
      }
    });
    ctx.admin.registerAction({
      id: 'marketplace-install', page: 'browse', label: '安装', type: 'primary', confirm: '确认安装该扩展？',
      handler: async item => {
        const available = (await packages()).find(candidate => candidate.name === item.name &&
          candidate.version === item.version && candidate.type === item.type);
        if (!available) throw new Error('扩展不在当前 Registry 中');
        const compatibility = ctx.packages.check({...available, firekylin: {type: available.type},
          engines: available.engines || {}});
        if (!compatibility.compatible) throw new Error(`版本不兼容：${compatibility.reasons.join(', ')}`);
        if (ctx.packages.mutationMode === 'deployment') {
          const change = available.type === 'plugin'
            ? {operation: 'plugin.install', name: available.name, version: available.version}
            : {operation: 'theme.install', id: available.id || available.name, version: available.version,
              download: available.download, integrity: available.integrity};
          await ctx.packages.deploy(change);
          return {message: '已提交仓库变更请求；合并生成的 PR 后将自动部署'};
        }
        const result = available.type === 'plugin'
          ? await ctx.packages.installPlugin(available.name, available.version)
          : await ctx.packages.installTheme(await new Registry({url: (await settings()).registryUrl})
            .themeArchive(available), {replace: true});
        return {message: result.restartRequired ? '安装完成，请重启 Firekylin' : '安装完成'};
      }
    });
    ctx.admin.registerAction({
      id: 'marketplace-uninstall', page: 'installed', label: '卸载', type: 'danger', confirm: '确认卸载该插件？',
      handler: async input => {
        if (ctx.packages.mutationMode === 'deployment') {
          await ctx.packages.deploy({operation: 'plugin.uninstall', name: input.name});
          return {message: '已提交仓库变更请求；合并生成的 PR 后将自动部署'};
        }
        await ctx.packages.uninstallPlugin(input.name);
        return {message: '卸载完成，请重启 Firekylin'};
      }
    });
  }
};
