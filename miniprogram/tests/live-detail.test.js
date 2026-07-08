const assert = require('assert');

const pagePath = require.resolve('../pages/live-detail/live-detail');

let pageConfig = null;
const toastTitles = [];
const originalWarn = console.warn;

console.warn = () => {};

global.Page = (config) => {
  pageConfig = config;
};
global.wx = {
  env: {
    USER_DATA_PATH: 'http://usr'
  },
  getSystemInfoSync() {
    return { platform: 'devtools' };
  },
  getStorageSync() {
    return '';
  },
  showToast(options) {
    toastTitles.push(options.title);
  }
};

delete require.cache[pagePath];
require(pagePath);

function createContext(videoUrl, videoSourceIndex, videoSourceCandidates) {
  return {
    ...pageConfig,
    videoSourceIndex,
    videoSourceCandidates,
    data: {
      videoUrl
    },
    setData(update) {
      Object.assign(this.data, update);
    }
  };
}

assert(pageConfig, 'live detail page should register config');

let context = createContext('', -1);
pageConfig.prepareVideo.call(context, {
  liveUrl: 'http://127.0.0.1:8787/media/hailin-live.mp4'
});
assert.strictEqual(context.data.videoUrl, 'http://127.0.0.1:8787/media/hailin-live.mp4');
assert.strictEqual(context.videoSourceCandidates[0], 'http://127.0.0.1:8787/media/hailin-live.mp4');

context = createContext(
  'http://127.0.0.1:8787/media/hailin-live.mp4',
  0,
  ['http://127.0.0.1:8787/media/hailin-live.mp4', 'http://usr/hailin-live.mp4', '/assets/videos/hailin-live.mp4']
);
pageConfig.onVideoError.call(context, { detail: { errMsg: 'fail backend media' } });
assert.strictEqual(context.data.videoUrl, 'http://usr/hailin-live.mp4');

context = createContext('http://usr/hailin-live.mp4', 0);
pageConfig.onVideoError.call(context, { detail: { errMsg: 'fail user file' } });
assert.strictEqual(context.data.videoUrl, '/assets/videos/hailin-live.mp4');

context = createContext('/assets/videos/hailin-live.mp4', 1);
pageConfig.onVideoError.call(context, { detail: { errMsg: 'fail package absolute' } });
assert.strictEqual(context.data.videoUrl, '../../assets/videos/hailin-live.mp4');

context = createContext('../../assets/videos/hailin-live.mp4', 2);
pageConfig.onVideoError.call(context, { detail: { errMsg: 'fail package relative' } });
assert.strictEqual(context.data.videoUrl, '');
assert(toastTitles.includes('视频源暂不可用，已切换为封面预览'));

delete global.Page;
delete global.wx;
console.warn = originalWarn;

console.log('live detail video fallback ok');
