// /api/* on Cast's own site (cast.kvbchurch.org) is the sync Worker, through the SYNC
// service binding (site/cast-site/wrangler.toml): the main site's one proxy, reused.
export { onRequest } from '../../../functions/api/[[path]].js';
