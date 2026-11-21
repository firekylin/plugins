'use strict';

const {SAY_TYPE} = require('./say-service');

const listUrl = '/says';
const detailUrl = id => `${listUrl}/${Number(id)}`;
const tagUrl = tag => `${listUrl}/tag/${encodeURIComponent(tag)}`;
// Retain the existing tag query on both list and tag-path pagination. Do not
// carry arbitrary request queries (tokens, preview flags, etc.) into public links.
const pageUrl = (page, tag = '', pathname = listUrl) =>
  `${pathname}?page=${page}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`;

// Both legacy writes and the native Waline UI address the same stored post.
function commentUrl(item) {
  if (typeof item.pathname !== 'string' || !item.pathname.trim()) {
    throw new TypeError('A stored Say pathname is required for native comments');
  }
  return `${detailUrl(item.id)}?pathname=${encodeURIComponent(item.pathname)}&type=${SAY_TYPE}`;
}

module.exports = {listUrl, detailUrl, tagUrl, pageUrl, commentUrl};
