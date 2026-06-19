// URL-safe slug generation with timestamp for uniqueness.

/** Generate a URL-safe slug from text, appending a timestamp for uniqueness. */
function slugify(text) {
  const base = text
    .toLowerCase()
    .replace(/[^\w一-鿿]+/g, '-')
    .replace(/^-|-$/g, '') || 'untitled';
  return base;
}

/** Generate a unique slug for a new post. */
function postSlug(title) {
  return slugify(title) + '-' + Date.now();
}

/** Generate a unique slug for a category from its name. */
function categorySlug(name) {
  return slugify(name) + '-' + Date.now();
}

module.exports = { slugify, postSlug, categorySlug };
