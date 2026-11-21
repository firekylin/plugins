'use strict';

const listUrl = '/says';
const detailUrl = id => `${listUrl}/${Number(id)}`;
const tagUrl = tag => `${listUrl}/tag/${encodeURIComponent(tag)}`;
// Retain the existing tag query on both list and tag-path pagination. Do not
// carry arbitrary request queries (tokens, preview flags, etc.) into public links.
const pageUrl = (page, tag = '', pathname = listUrl) =>
  `${pathname}?page=${page}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`;

module.exports = {listUrl, detailUrl, tagUrl, pageUrl};
