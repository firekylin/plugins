'use strict';

const {MarkdownService} = require('./lib/markdown-service');

module.exports = {
  register(ctx) {
    const service = new MarkdownService({
      getModel: name => think.model(name),
      now: () => think.datetime()
    });

    ctx.routes.register({
      method: ['GET', 'HEAD'],
      path: '/:slug.md',
      scope: 'site',
      csrf: false,
      async handler({ctx: request, params}) {
        const markdown = await service.find(params.slug);
        if (markdown === null) return request.throw(404, 'Published article not found');
        request.type = 'text/markdown; charset=utf-8';
        request.set('X-Content-Type-Options', 'nosniff');
        request.set('Cache-Control', 'public, max-age=60');
        return markdown;
      }
    });
  }
};
