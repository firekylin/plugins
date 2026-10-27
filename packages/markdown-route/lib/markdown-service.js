'use strict';

function protectedPost(options) {
  if (!options) return false;
  let parsed = options;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) || {} } catch { return false }
  }
  return Boolean(parsed.postPasswordHash);
}

class MarkdownService {
  constructor({getModel, now}) {
    this.getModel = getModel;
    this.now = now;
  }

  async find(slug) {
    const pathname = String(slug || '').trim();
    if (!pathname) return null;
    const post = await this.getModel('post').where({
      pathname,
      type: 0,
      status: 3,
      is_public: 1,
      create_time: {'<=': this.now()}
    }).field('id,pathname,markdown_content,options')
      .setRelation(false)
      .find();
    if (!post || !post.id || protectedPost(post.options)) return null;
    return String(post.markdown_content || '');
  }
}

module.exports = {MarkdownService, protectedPost};
