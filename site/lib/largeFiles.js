// Which built files are streamed instead of uploaded to Pages (site/build.mjs):
// every video, because Pages' static files ignore Range (measured 2026-10-03:
// every request answered 200 with the whole file), so a <video> could not seek,
// and Safari will not play a video from a server that ignores Range at all;
// and anything over Pages' 25 MiB a file. Each is streamed by a Function
// (site/lib/proxyLarge.js) from GitHub's copy of the commit the site was built
// from, so it always matches the files deployed beside it.
//
// Only files committed under one of these folders can be served that way:
// Journey's public files (/journey/, functions/journey) and the home page's
// film (/reel/, functions/reel; printer/public/reel, made by printer/reel/).
// Anything else that big, or any other video, is a build output, and fails
// the build rather than the deploy.
//
// The Journey lesson videos are not in the repo at all: they are assets on the
// `journey-videos-v2` release (owner, 2026-10-12: the nightly copy left the tree,
// where every lesson added ~20 MB to history). VIDEO_RELEASE_TAG is that release,
// RELEASE_FILES the site paths served from one of its assets by a fixed name.
export const REPO_FOLDERS = {
  '/journey/': 'journey/public/',
  '/reel/': 'printer/public/reel/',
};

export const VIDEO_RELEASE_TAG = 'journey-videos-v2';

// This week's lesson, re-encoded for the Pi by the nightly bot
// (.github/workflows/journey-update-lesson.yml), which replaces the asset in
// place under this one name and commits journey/public/current-lesson-video.json
// (its sha256) beside current-lesson.json. The Pi asks for the same URL it
// always did.
export const RELEASE_FILES = {
  '/journey/current-lesson-video.mp4': 'current-lesson-video.mp4',
};

/** The release download folder for `repo` (owner/name), ending in a slash. */
export function releaseBase(repo) {
  return `https://github.com/${repo}/releases/download/${VIDEO_RELEASE_TAG}/`;
}

/** Site path -> upstream URL for every RELEASE_FILES entry. */
export function releaseFiles(repo) {
  return Object.fromEntries(Object.entries(RELEASE_FILES).map(([sitePath, name]) => [sitePath, releaseBase(repo) + name]));
}

export const PAGES_FILE_MAX = 25 * 1024 * 1024;

const VIDEO = /\.(mp4|webm)$/i;

/** Must this built file be streamed rather than uploaded? */
export function mustStream(sitePath, size) {
  return size >= PAGES_FILE_MAX || VIDEO.test(sitePath);
}

/**
 * The repo path a streamed site path is served from, or null when it may not
 * be streamed (outside the folders above, or not a plain path).
 * @param {string} sitePath  e.g. /reel/reel-1080.mp4
 */
export function repoPathFor(sitePath) {
  for (const [prefix, folder] of Object.entries(REPO_FOLDERS)) {
    if (!sitePath.startsWith(prefix)) continue;
    const rest = sitePath.slice(prefix.length);
    if (!rest || rest.split('/').some((part) => part === '' || part === '.' || part === '..')) return null;
    return folder + rest;
  }
  return null;
}
