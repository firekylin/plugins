'use strict';

const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  title: '相关文章',
  limit: 5,
  tagWeight: 3,
  categoryWeight: 1,
  fallback: true,
  autoInject: true
});

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function normalizeSettings(value = {}) {
  return {
    enabled: value.enabled !== false,
    title: String(value.title || DEFAULT_SETTINGS.title).trim().slice(0, 100) || DEFAULT_SETTINGS.title,
    limit: integer(value.limit, DEFAULT_SETTINGS.limit, 1, 20),
    tagWeight: integer(value.tagWeight, DEFAULT_SETTINGS.tagWeight, 0, 20),
    categoryWeight: integer(value.categoryWeight, DEFAULT_SETTINGS.categoryWeight, 0, 20),
    fallback: value.fallback !== false,
    autoInject: value.autoInject !== false
  };
}

function parseOptions(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value) || {} } catch { return {} }
}

function isPasswordProtected(post) {
  return Boolean(parseOptions(post.options).postPasswordHash);
}

function escapeHtml(value) {
  return String(value === null || typeof value === 'undefined' ? '' : value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '\'': '&#39;', '\u0022': '&quot;'
  })[character]);
}

function renderRelatedPosts(posts, title = DEFAULT_SETTINGS.title) {
  if (!posts.length) return '';
  const items = posts.map(post => {
    const pathname = encodeURIComponent(String(post.pathname || ''));
    return `<li><a href="/post/${pathname}.html">${escapeHtml(post.title)}</a></li>`;
  }).join('');
  return '<aside class="firekylin-related-posts" data-firekylin-plugin="relate-post">' +
    `<h2>${escapeHtml(title)}</h2><ul>${items}</ul></aside>`;
}

function injectRelatedPosts(response, html) {
  if (!html || typeof response !== 'string' || response.includes('data-firekylin-plugin="relate-post"')) {
    return response;
  }
  const comments = response.indexOf('<div id="comments"');
  if (comments !== -1) return response.slice(0, comments) + html + response.slice(comments);
  const closing = response.lastIndexOf('</div>');
  return closing === -1 ? response : response.slice(0, closing) + html + response.slice(closing);
}

class RelatedPostService {
  constructor({getModel, now}) {
    this.getModel = getModel;
    this.now = now;
  }

  async settings() {
    const row = await this.getModel('options').where({key: 'plugin_relate_post'}).find();
    return normalizeSettings(parseOptions(row && row.value));
  }

  async saveSettings(value) {
    const settings = normalizeSettings(value);
    await this.getModel('options').updateOptions('plugin_relate_post', JSON.stringify(settings));
    return settings;
  }

  async relationIds(modelName, foreignKey, postId) {
    const rows = await this.getModel(modelName)
      .where({post_id: postId})
      .field(foreignKey)
      .select();
    return [...new Set(rows.map(row => Number(row[foreignKey])).filter(Boolean))];
  }

  async scoreRelations(modelName, foreignKey, ids, weight, currentId, scores) {
    if (!ids.length || weight <= 0) return;
    const rows = await this.getModel(modelName)
      .where({[foreignKey]: ['IN', ids]})
      .field(`post_id,${foreignKey}`)
      .limit(5000)
      .select();
    for (const row of rows) {
      const postId = Number(row.post_id);
      if (!postId || postId === currentId) continue;
      scores.set(postId, (scores.get(postId) || 0) + weight);
    }
  }

  publicPosts(where, limit) {
    return this.getModel('post').setRelation(false).where({
      ...where,
      type: 0,
      status: 3,
      is_public: 1,
      create_time: {'<=': this.now()}
    })
      .field('id,title,pathname,create_time,options')
      .order('create_time DESC')
      .limit(limit)
      .select();
  }

  async find(current, settingsValue) {
    const settings = normalizeSettings(settingsValue);
    const currentId = Number(current && current.id);
    if (!settings.enabled || !currentId || current.password_protected || isPasswordProtected(current)) return [];

    const [tagIds, categoryIds] = await Promise.all([
      Array.isArray(current.tag) ? current.tag.map(tag => Number(tag.id)).filter(Boolean) :
        this.relationIds('post_tag', 'tag_id', currentId),
      Array.isArray(current.cate) ? current.cate.map(cate => Number(cate.id)).filter(Boolean) :
        this.relationIds('post_cate', 'cate_id', currentId)
    ]);
    const scores = new Map();
    await Promise.all([
      this.scoreRelations('post_tag', 'tag_id', tagIds, settings.tagWeight, currentId, scores),
      this.scoreRelations('post_cate', 'cate_id', categoryIds, settings.categoryWeight, currentId, scores)
    ]);

    let posts;
    if (scores.size) {
      const candidateIds = [...scores.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 500)
        .map(([id]) => id);
      posts = await this.publicPosts({id: ['IN', candidateIds]}, candidateIds.length);
      posts.sort((left, right) =>
        (scores.get(Number(right.id)) || 0) - (scores.get(Number(left.id)) || 0) ||
        String(right.create_time).localeCompare(String(left.create_time))
      );
    } else if (settings.fallback) {
      posts = await this.publicPosts({id: ['!=', currentId]}, settings.limit * 3);
    } else {
      posts = [];
    }

    return posts.filter(post => !isPasswordProtected(post)).slice(0, settings.limit).map(post => ({
      id: post.id,
      title: post.title,
      pathname: post.pathname,
      create_time: post.create_time
    }));
  }
}

module.exports = {
  DEFAULT_SETTINGS,
  RelatedPostService,
  injectRelatedPosts,
  normalizeSettings,
  renderRelatedPosts
};
